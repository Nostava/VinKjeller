import { createWorker, PSM } from 'tesseract.js';

/**
 * In-browser OCR for bottle labels — runs entirely on the device
 * (no server round-trip, no extra Vinmonopol API calls, ToS-clean).
 *
 * Two local engines:
 *
 *  • TrOCR (transformers.js, ONNX int8, WebGPU when available) — a
 *    transformer trained on scene text; much better than tesseract on
 *    stylized brand fonts. Trained on single-line crops, so we never
 *    feed it a whole frame: tesseract provides the line boxes, we crop
 *    the biggest lines and TrOCR re-reads those crops.
 *    Model ≈ 100 MB, downloaded once (then cached by the browser).
 *
 *  • Tesseract (tesseract.js, WASM) — the classic engine, used as the
 *    layout detector AND as the fallback engine.
 *
 * Engine selection ('auto' | 'troc' | 'tesseract') comes from settings
 * (localStorage `vk_ocr_engine`). 'auto' = TrOCR when WebGPU exists.
 */
const LANGS = 'eng+nor';
const MIN_WIDTH = 1800; // tesseract likes large text; upscaling a small label helps
const TROC_MODEL = 'onnx-community/trocr-base-handwritten-ONNX';
const TROC_MAX_TOKENS = 16;
const MAX_TROC_CROPS = 3;

export type OcrEngine = 'auto' | 'troc' | 'tesseract';

export interface OcrLine {
  text: string;
  confidence: number;
  /** In the captured frame's pixel coordinates (when available). */
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  source?: 'troc' | 'tesseract';
}
export interface OcrResult {
  text: string;
  lines: OcrLine[];
  engine: 'troc' | 'tesseract';
}

interface TesseractPage {
  blocks: {
    paragraphs: {
      lines: { text: string; confidence: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }[];
    }[];
  }[] | null;
}

// ---------------------------------------------------------------- tesseract

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
function preprocess(src: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.max(1, MIN_WIDTH / src.width);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return { canvas: src, scale: 1 };
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
  return { canvas: out, scale };
}

function collectLines(data: TesseractPage): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        if (l.text) lines.push({ text: l.text, confidence: l.confidence ?? 0, bbox: l.bbox, source: 'tesseract' });
      }
    }
  }
  return lines;
}

/**
 * Tesseract pass: SPARSE_TEXT first (finds isolated text anywhere in the
 * frame); if it yields too little, a SINGLE_BLOCK pass. Lines are merged
 * (deduped, best confidence kept). Line bboxes are mapped back to the
 * original frame's coordinates so TrOCR can crop them.
 */
async function ocrTesseract(frame: HTMLCanvasElement, onProgress?: (p: number) => void): Promise<OcrResult> {
  const worker = await getWorker();
  const { canvas: img, scale } = preprocess(frame);
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

  // progress spans: pass 1 → 0..0.6, pass 2 (if needed) → 0.6..1
  let offset = 0;
  let span = 1;
  const rawProgress = (p: number) => onProgress?.(offset + p * span);

  progressCb = (p) => rawProgress(p);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const first = await worker.recognize(img, undefined, { blocks: true });
    addLines(collectLines(first.data));
    if (usable(collectLines(first.data)) < 2) {
      offset = 0.6;
      span = 0.4;
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const second = await worker.recognize(img, undefined, { blocks: true });
      addLines(collectLines(second.data));
    }
  } finally {
    progressCb = null;
  }

  // Map bboxes from preprocessed space back to the captured frame.
  const merged = [...seen.values()]
    .map((l) => (l.bbox
      ? {
          ...l,
          bbox: {
            x0: l.bbox!.x0 / scale,
            y0: l.bbox!.y0 / scale,
            x1: l.bbox!.x1 / scale,
            y1: l.bbox!.y1 / scale,
          },
        }
      : l))
    .sort((a, b) => b.confidence - a.confidence);
  return {
    text: merged.map((l) => l.text).join('\n'),
    lines: merged,
    engine: 'tesseract',
  };
}

// ---------------------------------------------------------------- TrOCR

type TrocRecognizer = (
  img: HTMLCanvasElement,
  opts?: { max_new_tokens?: number },
) => Promise<Array<{ text?: string; generated_text?: string }>>;

let trocPromise: Promise<TrocRecognizer> | null = null;

function getTrOCR(onDownloadProgress?: (p: number) => void) {
  if (!trocPromise) {
    trocPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const recognizer = await pipeline('image-to-text', TROC_MODEL, {
        dtype: 'q8',
        progress_callback: (m: { status?: string; progress?: number; file?: string }) => {
          if (m.status === 'progress' && m.file?.includes('.onnx')) onDownloadProgress?.(m.progress ?? 0);
        },
      });
      return recognizer as unknown as TrocRecognizer;
    })().catch((e) => {
      trocPromise = null; // allow a later retry
      throw e;
    });
  }
  return trocPromise;
}

function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as { gpu?: unknown }).gpu;
}

function boxHeight(b?: { x0: number; y0: number; x1: number; y1: number }): number {
  return b ? b.y1 - b.y0 : 0;
}

/** Crop a line box (frame coords) from the captured frame with padding. */
function cropFrame(frame: HTMLCanvasElement, box: { x0: number; y0: number; x1: number; y1: number }): HTMLCanvasElement {
  const h = box.y1 - box.y0;
  const padX = Math.max(6, h * 0.3); // wide crops dilute the text — stay close to the line
  const padY = Math.max(6, h * 0.5);
  const x0 = Math.max(0, Math.floor(box.x0 - padX));
  const y0 = Math.max(0, Math.floor(box.y0 - padY));
  const x1 = Math.min(frame.width, Math.ceil(box.x1 + padX));
  const y1 = Math.min(frame.height, Math.ceil(box.y1 + padY));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, x1 - x0);
  canvas.height = Math.max(1, y1 - y0);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(frame, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** TrOCR is far more reliable on light backgrounds: if the crop is mostly dark
 * (white text on a colored label), invert it. Verified on a synthetic label:
 * q8 went from "OD120063566 British States" to "Orange Bitters" after inverting. */
function invertIfDark(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 36) {
    sum += (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    n++;
  }
  if (n === 0 || sum / n >= 128) return canvas;
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < id.data.length; i += 4) {
    id.data[i] = 255 - id.data[i];
    id.data[i + 1] = 255 - id.data[i + 1];
    id.data[i + 2] = 255 - id.data[i + 2];
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

async function trocReadText(rec: TrocRecognizer, canvas: HTMLCanvasElement): Promise<string> {
  const out = await rec(canvas, { max_new_tokens: TROC_MAX_TOKENS });
  const items = Array.isArray(out)
    ? out
    : [out as unknown as { text?: string; generated_text?: string }];
  const text = items.map((o) => o.text ?? o.generated_text ?? '').join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- pipeline

/**
 * Recognize a captured label frame.
 *
 * 'troc' / 'auto' (with WebGPU): tesseract finds the text lines (boxes),
 * the biggest lines are cropped from the ORIGINAL frame (no binarization —
 * the transformer handles natural photos better) and TrOCR re-reads them.
 * Any TrOCR failure degrades gracefully to the plain tesseract result.
 */
export async function ocrImage(
  frame: HTMLCanvasElement,
  opts: { engine?: OcrEngine; onProgress?: (p: number) => void } = {},
): Promise<OcrResult> {
  const engine = opts.engine ?? 'auto';
  const onProgress = opts.onProgress;

  const wantTroc = engine === 'troc' || (engine === 'auto' && hasWebGPU());
  if (!wantTroc) {
    return ocrTesseract(frame, onProgress);
  }

  // Layout pass (tesseract): scaled to 0..0.55 of the total progress.
  const tess = await ocrTesseract(frame, (p) => onProgress?.(p * 0.55));

  // The biggest lines (font height) are the brand name — crop up to 3.
  const candidates = tess.lines
    .filter((l) => l.bbox && l.text.trim().length >= 2 && boxHeight(l.bbox) >= 4)
    .sort((a, b) => boxHeight(b.bbox) - boxHeight(a.bbox))
    .slice(0, MAX_TROC_CROPS);
  if (!candidates.length) return tess; // no lines found — tesseract result as-is

  let rec: TrocRecognizer;
  try {
    rec = await getTrOCR((p) => onProgress?.(0.55 + p * 0.35));
  } catch {
    return tess; // model unavailable (e.g. offline, no cache) — fallback
  }

  const trocLines: OcrLine[] = [];
  try {
    for (let i = 0; i < candidates.length; i++) {
      onProgress?.(0.9 + (i / candidates.length) * 0.1);
      const text = await trocReadText(rec, invertIfDark(cropFrame(frame, candidates[i].bbox!)));
      if (text.length >= 2) {
        trocLines.push({ text, confidence: 90, bbox: candidates[i].bbox, source: 'troc' });
      }
    }
  } catch {
    return tess; // inference hiccup — fallback
  }
  onProgress?.(1);
  if (!trocLines.length) return tess;

  // Merge: TrOCR lines first (in line-height order = brand first), then
  // tesseract lines that aren't spatially covered by a TrOCR crop.
  const covered = (b?: { x0: number; y0: number; x1: number; y1: number }) =>
    !b ||
    trocLines.some((tl) => {
      const box = tl.bbox!;
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      const padX = (box.x1 - box.x0) * 0.5;
      const padY = (box.y1 - box.y0) * 0.5;
      return cx >= box.x0 - padX && cx <= box.x1 + padX && cy >= box.y0 - padY && cy <= box.y1 + padY;
    });
  const merged = [
    ...trocLines,
    ...tess.lines.filter((l) => !covered(l.bbox)),
  ];
  return {
    text: merged.map((l) => l.text).join('\n'),
    lines: merged,
    engine: 'troc',
  };
}

/**
 * Turn raw OCR output into search queries for `productShortNameContains`.
 *
 * The brand name is usually the biggest / most confident line on the label;
 * legal text (ABV %, "produkt av …") is filtered out. For each of the best
 * lines we also emit progressively shorter prefixes, because the searchable
 * short name is often a prefix of the printed name ("CHABLIS SUPÉRIEUR 2022"
 * → "chablis supérieur"). Queries are tried in order until one matches.
 */
export function extractQueries(ocr: OcrResult, maxLines = 3, maxQueries = 8): string[] {
  let lines: OcrLine[] = ocr.lines.filter((l) => l.confidence >= 20);
  if (!lines.length) lines = ocr.text.split(/\n+/).map((text) => ({ text, confidence: 0 }));
  const clean = lines
    .map((l) => l.text.trim().replace(/\s{2,}/g, ' '))
    .filter((l) => {
      if (l.length < 3 || l.length > 60) return false;
      if (/%|°|\bvol\b/i.test(l)) return false; // ABV / legal-print noise
      const letters = (l.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) ?? []).length;
      return letters >= 3 && letters / l.length >= 0.6;
    });
  // Most confident first (TrOCR lines are 90), then longest — the brand
  // name is both the biggest and the best-read line.
  const confOf = new Map(clean.map((l) => [l.toLowerCase(), confFor(l)]));
  const byScore = [...new Map(clean.map((l) => [l.toLowerCase(), l])).values()].sort(
    (a, b) => (confOf.get(b.toLowerCase()) ?? 0) - (confOf.get(a.toLowerCase()) ?? 0) || b.length - a.length,
  );
  function confFor(l: string): number {
    const found = lines.find((x) => x.text.trim().replace(/\s{2,}/g, ' ').toLowerCase() === l.toLowerCase());
    return found?.confidence ?? 0;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    if (q.length < 2) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };
  for (const line of byScore.slice(0, maxLines)) {
    const words = line.split(' ');
    push(line);
    for (let n = Math.min(4, words.length - 1); n >= 2; n--) push(words.slice(0, n).join(' '));
    if (out.length >= maxQueries) break;
  }
  return out.slice(0, maxQueries);
}
