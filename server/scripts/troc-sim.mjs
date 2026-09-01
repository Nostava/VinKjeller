// Full pipeline simulation on Node (mirrors web/src/lib/ocr.ts):
// fetch bottle photo -> bilinear upscale (1800px) -> grayscale+Otsu ->
// tesseract SINGLE_BLOCK with blocks -> biggest lines -> crop from COLOR
// upscale -> TrOCR (q8). Run: node server/scripts/troc-sim.mjs
import { createWorker, PSM } from 'tesseract.js';
import { pipeline, RawImage } from '@huggingface/transformers';
import zlib from 'node:zlib';
import fs from 'node:fs';

const URL = process.env.VMIMG ?? 'https://bilder.vinmonopolet.no/cache/1200x1200-0/5096703-1.jpg';

// ---------- PNG encode (for tesseract input + saving crops) ----------
function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function toPng(img) {
  const ch = img.channels;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = img.width * 4;
  const raw = Buffer.alloc(img.height * (1 + rowBytes));
  for (let y = 0; y < img.height; y++) {
    const rowStart = y * (1 + rowBytes);
    raw[rowStart] = 0;
    let o = rowStart + 1;
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * ch;
      raw[o++] = img.data[s];
      raw[o++] = img.data[s + 1];
      raw[o++] = img.data[s + 2];
      raw[o++] = ch > 3 ? img.data[s + 3] : 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- upscale / binarize (same math as ocr.ts) ----------
function upscale(src, scale) {
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const out = new RawImage(new Uint8Array(w * h * 3), w, h, 3);
  const inv = 1 / scale;
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) * inv - 0.5;
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(sy)));
    const y1 = Math.max(0, Math.min(src.height - 1, y0 + 1));
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) * inv - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(sx)));
      const x1 = Math.max(0, Math.min(src.width - 1, x0 + 1));
      const fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const top = src.data[(y0 * src.width + x0) * 3 + c] * (1 - fx) + src.data[(y0 * src.width + x1) * 3 + c] * fx;
        const bot = src.data[(y1 * src.width + x0) * 3 + c] * (1 - fx) + src.data[(y1 * src.width + x1) * 3 + c] * fx;
        out.data[(y * w + x) * 3 + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return out;
}

function binarize(src) {
  const n = src.width * src.height;
  const gray = new Uint8ClampedArray(n);
  const hist = new Array(256).fill(0);
  for (let p = 0; p < n; p++) {
    const g = (src.data[p * 3] * 77 + src.data[p * 3 + 1] * 150 + src.data[p * 3 + 2] * 29) >> 8;
    gray[p] = g;
    hist[g]++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, threshold = 127, maxVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; threshold = t; }
  }
  const out = new RawImage(new Uint8Array(n * 3), src.width, src.height, 3);
  for (let p = 0; p < n; p++) {
    const v = gray[p] > threshold ? 255 : 0;
    out.data[p * 3] = out.data[p * 3 + 1] = out.data[p * 3 + 2] = v;
  }
  return out;
}

function crop(src, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(src.width, Math.ceil(x1));
  y1 = Math.min(src.height, Math.ceil(y1));
  if (x1 <= x0 || y1 <= y0) return null;
  const w = x1 - x0, h = y1 - y0;
  const out = new RawImage(new Uint8Array(w * h * 3), w, h, 3);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = (y * src.width + x) * 3;
      const d = ((y - y0) * w + (x - x0)) * 3;
      for (let c = 0; c < 3; c++) out.data[d + c] = src.data[s + c];
    }
  }
  return out;
}

// ---------- run ----------
console.log('fetching bottle photo…');
const img = await RawImage.fromURL(URL);
console.log(`image: ${img.width}x${img.height}`);

const MIN_WIDTH = 1800;
const scale = Math.max(1, MIN_WIDTH / img.width);
const big = upscale(img, scale);
const bin = binarize(big);
console.log(`upscaled: ${big.width}x${big.height} (scale ${scale.toFixed(2)}), binarized`);
fs.writeFileSync('sim_bin.png', toPng(bin));

console.log('\n--- tesseract (SINGLE_BLOCK, blocks) ---');
const t0 = Date.now();
const worker = await createWorker('eng', 1, {});
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
const { data } = await worker.recognize('data:image/png;base64,' + toPng(bin).toString('base64'), undefined, { blocks: true });
await worker.terminate();
console.log(`[tesseract ${(Date.now() - t0) / 1000}s]`);
console.log('text:', JSON.stringify(data.text.slice(0, 300)));

const lines = [];
for (const b of data.blocks ?? []) {
  for (const p of b.paragraphs ?? []) {
    for (const l of p.lines ?? []) {
      const text = (l.text ?? '').trim();
      if (text.length >= 2 && l.bbox) {
        lines.push({ ...l.bbox, h: l.bbox.y1 - l.bbox.y0, conf: l.confidence, text });
      }
    }
  }
}
lines.sort((a, b) => b.h - a.h);
console.log('lines (tallest first):');
for (const l of lines.slice(0, 8)) {
  console.log(`  [h=${Math.round(l.h)} conf=${l.conf.toFixed(0)}] ${JSON.stringify(l.text)}  box=(${Math.round(l.x0)},${Math.round(l.y0)},${Math.round(l.x1 - l.x0)}x${Math.round(l.h)})`);
}

console.log('\n--- TrOCR on top-3 crops (from COLOR upscale) ---');
const t1 = Date.now();
const recognizer = await pipeline('image-to-text', 'onnx-community/trocr-base-handwritten-ONNX', { dtype: 'q8' });
console.log(`[trocr ready ${((Date.now() - t1) / 1000).toFixed(1)}s]`);

for (let i = 0; i < Math.min(3, lines.length); i++) {
  const l = lines[i];
  const padX = Math.max(6, l.h * 0.3);
  const padY = Math.max(6, l.h * 0.5);
  const c = crop(big, l.x0 - padX, l.y0 - padY, l.x1 + padX, l.y1 + padY);
  if (!c) continue;
  fs.writeFileSync(`sim_crop${i + 1}.png`, toPng(c));
  const t2 = Date.now();
  const out = await recognizer(c, { max_new_tokens: 16 });
  const text = Array.isArray(out) ? out.map((o) => o.text ?? o.generated_text ?? '').join(' ') : String(out?.text ?? out?.generated_text ?? '');
  console.log(`  #${i + 1} trocr=${JSON.stringify(text.trim())}  (${Date.now() - t2} ms, crop ${c.width}x${c.height})`);
}
console.log('\ndone. crops saved as sim_crop*.png, sim_bin.png');
