import { createWorker } from 'tesseract.js';

/**
 * In-browser OCR for bottle labels (tesseract.js, WASM — runs entirely on the
 * device: no server round-trip, no extra Vinmonopol API calls, ToS-clean).
 * The model (eng + nor) is fetched from the CDN on first use per page load
 * and cached in the worker afterwards.
 */
const LANGS = 'eng+nor';

export interface OcrLine {
  text: string;
  confidence: number;
}
export interface OcrResult {
  text: string;
  lines: OcrLine[];
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

/**
 * Recognize text in an image (canvas from a camera frame, or data URL).
 * The worker is kept alive so the model is only loaded once per page load.
 */
export function ocrImage(
  img: HTMLCanvasElement | string,
  onProgress?: (p: number) => void,
): Promise<OcrResult> {
  return (async () => {
    const worker = await getWorker();
    progressCb = onProgress ?? null;
    try {
      const { data } = await worker.recognize(img);
      const lines: OcrLine[] = [];
      for (const b of data.blocks ?? []) {
        for (const p of b.paragraphs ?? []) {
          for (const l of p.lines ?? []) {
            if (l.text) lines.push({ text: l.text, confidence: l.confidence ?? 0 });
          }
        }
      }
      return { text: data.text ?? '', lines };
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
    .filter((l) => l.confidence >= 30)
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
