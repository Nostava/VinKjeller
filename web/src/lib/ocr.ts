import { createWorker, PSM } from 'tesseract.js';

/**
 * In-browser OCR for bottle labels (tesseract.js, WASM — runs entirely on the
 * device: no server round-trip, no extra Vinmonopol API calls, ToS-clean).
 * The model (eng + nor) is fetched from the CDN on first use per page load
 * and cached in the worker afterwards.
 *
 * Labels are a hard case for tesseract (stylized brand fonts, curved glossy
 * surfaces), so the pipeline is: upscale → grayscale → Otsu binarization,
 * then two passes — SPARSE_TEXT (finds isolated text anywhere in the frame)
 * and, if that looks weak, SINGLE_BLOCK — with the lines merged.
 */
const LANGS = 'eng+nor';
const MIN_WIDTH = 1800; // tesseract likes large text; upscaling a small label helps

export interface OcrLine {
  text: string;
  confidence: number;
}
export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

interface TesseractPage {
  blocks: { paragraphs: { lines: { text: string; confidence: number }[] }[] }[] | null;
}

let workerPromise: ReturnType<typeof createWorker> | null = null;
let progressCb: ((p: number) => void) | null = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(LANGS, undefined, {
      logger: (m) => {
        if (m.status === 'recognizing text') progressCb?.(m.progress);
      },
    });
  }
  return workerPromise;
}

/** Upscale + grayscale + Otsu binarization — high-contrast input is where
 *  tesseract performs best on photographed labels. */
function preprocess(src: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.max(1, MIN_WIDTH / src.width);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  const hist = new Array<number>(256).fill(0);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; // luma
    gray[p] = g;
    hist[g]++;
  }

  // Otsu threshold
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let threshold = 127;
  let maxVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      threshold = t;
    }
  }

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = gray[p] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function collectLines(data: TesseractPage): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        if (l.text) lines.push({ text: l.text, confidence: l.confidence ?? 0 });
      }
    }
  }
  return lines;
}

/**
 * Recognize text in a camera frame. First pass SPARSE_TEXT (good when the
 * label only fills part of the frame); if it yields too little, a second
 * pass with SINGLE_BLOCK. Lines are merged (deduped, best confidence kept).
 */
export function ocrImage(frame: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<OcrResult> {
  return (async () => {
    const worker = await getWorker();
    const img = preprocess(frame);
    progressCb = onProgress ?? null;
    try {
      const seen = new Map<string, OcrLine>();
      const addLines = (lines: OcrLine[]) => {
        for (const l of lines) {
          const key = l.text.toLowerCase().replace(/\s+/g, ' ');
          const ex = seen.get(key);
          if (!ex || l.confidence > ex.confidence) seen.set(key, l);
        }
      };
      const usable = (lines: OcrLine[]) =>
        lines.filter((l) => l.text.trim().length >= 3 && l.confidence >= 20).length;

      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const first = await worker.recognize(img);
      const firstLines = collectLines(first.data);
      addLines(firstLines);
      if (usable(firstLines) < 2) {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        const second = await worker.recognize(img);
        addLines(collectLines(second.data));
      }

      const merged = [...seen.values()].sort((a, b) => b.confidence - a.confidence);
      return {
        text: merged.map((l) => l.text).join('\n'),
        lines: merged,
      };
    } finally {
      progressCb = null;
    }
  })();
}

/**
 * Turn raw OCR output into search queries for `productShortNameContains`.
 *
 * The brand name is usually the longest, most alphabetic line on the label;
 * legal text (ABV %, "produkt av …") is filtered out. For each of the best
 * lines we also emit progressively shorter prefixes, because the searchable
 * short name is often a prefix of the printed name ("CHABLIS SUPÉRIEUR 2022"
 * → "chablis supérieur"). Queries are tried in order until one matches.
 */
export function extractQueries(ocr: OcrResult, maxLines = 3, maxQueries = 8): string[] {
  let lines: string[] = ocr.lines
    .filter((l) => l.confidence >= 20)
    .map((l) => l.text)
    .filter(Boolean);
  if (!lines.length) lines = ocr.text.split(/\n+/);
  const clean = lines
    .map((l) => l.trim().replace(/\s{2,}/g, ' '))
    .filter((l) => {
      if (l.length < 3 || l.length > 60) return false;
      if (/%|°|\bvol\b/i.test(l)) return false; // ABV / legal-print noise
      const letters = (l.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) ?? []).length;
      return letters >= 3 && letters / l.length >= 0.6;
    });
  const byLen = [...new Set(clean.map((l) => l.toLowerCase()))].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    if (q.length < 2) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };
  for (const line of byLen.slice(0, maxLines)) {
    const words = line.split(' ');
    push(line);
    for (let n = Math.min(4, words.length - 1); n >= 2; n--) push(words.slice(0, n).join(' '));
    if (out.length >= maxQueries) break;
  }
  return out.slice(0, maxQueries);
}
