// Pipeline test on synthetic labels (ground truth text).
// Run: node server/scripts/troc-synth.mjs [file.png]
import { createWorker, PSM } from 'tesseract.js';
import { pipeline, RawImage } from '@huggingface/transformers';
import zlib from 'node:zlib';
import fs from 'node:fs';

const FILE = process.argv[2] ?? 'syn-label-white.png';

function crc32(buf) {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, d) {
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(type), d]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function toPngDataUrl(img) {
  const ch = img.channels;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const rb = img.width * 4;
  const raw = Buffer.alloc(img.height * (1 + rb));
  for (let y = 0; y < img.height; y++) {
    const rs = y * (1 + rb); raw[rs] = 0;
    let o = rs + 1;
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * ch;
      raw[o++] = img.data[s]; raw[o++] = img.data[s + 1]; raw[o++] = img.data[s + 2]; raw[o++] = ch > 3 ? img.data[s + 3] : 255;
    }
  }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
function crop(src, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(src.width, Math.ceil(x1)); y1 = Math.min(src.height, Math.ceil(y1));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const out = new RawImage(new Uint8Array(w * h * 3), w, h, 3);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const s = (y * src.width + x) * 3, d = ((y - y0) * w + (x - x0)) * 3;
    for (let c = 0; c < 3; c++) out.data[d + c] = src.data[s + c];
  }
  return out;
}

// minimal BMP reader (24/32-bit uncompressed, bottom-up)
function readBmp(path) {
  const buf = fs.readFileSync(path);
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('not a BMP');
  const dataOff = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  const h = buf.readInt32LE(22);
  const bits = buf.readUInt16LE(28);
  const comp = buf.readUInt32LE(30);
  if (comp !== 0) throw new Error('unsupported BMP compression');
  const ch = bits === 32 ? 4 : 3;
  const rowBytes = Math.ceil((w * ch) / 4) * 4;
  const out = new RawImage(new Uint8Array(w * h * 3), w, h, 3);
  const topDown = h < 0;
  const rows = Math.abs(h);
  for (let y = 0; y < rows; y++) {
    const srcRow = topDown ? y : rows - 1 - y;
    const rowStart = dataOff + srcRow * rowBytes;
    for (let x = 0; x < w; x++) {
      const s = rowStart + x * ch;
      const d = (y * w + x) * 3;
      out.data[d] = buf[s + 2]; // BGR -> RGB
      out.data[d + 1] = buf[s + 1];
      out.data[d + 2] = buf[s];
    }
  }
  return out;
}
const img = readBmp(FILE);
console.log(`\n=== ${FILE}: ${img.width}x${img.height} ===`);

const worker = await createWorker('eng', 1, {});
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
const { data } = await worker.recognize(FILE, undefined, { blocks: true });
await worker.terminate();

const lines = [];
for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
  const text = (l.text ?? '').trim();
  if (text.length >= 3 && l.bbox) lines.push({ ...l.bbox, h: l.bbox.y1 - l.bbox.y0, conf: l.confidence, text });
}
lines.sort((a, b) => b.h - a.h);
console.log('tesseract lines (tallest first):');
for (const l of lines.slice(0, 5)) console.log(`  [h=${Math.round(l.h)} conf=${l.conf.toFixed(0)}] ${JSON.stringify(l.text)}  box=(${Math.round(l.x0)},${Math.round(l.y0)})`);

const q8 = await pipeline('image-to-text', 'onnx-community/trocr-base-handwritten-ONNX', { dtype: 'q8' });
const f32 = await pipeline('image-to-text', 'Xenova/trocr-base-handwritten', { dtype: 'fp32' });

async function run(name, rec, c) {
  const out = await rec(c, { max_new_tokens: 16 });
  const text = Array.isArray(out) ? out.map((o) => o.text ?? o.generated_text ?? '').join(' ') : String(out?.text ?? out?.generated_text ?? '');
  console.log(`  ${name.padEnd(6)} -> ${JSON.stringify(text.trim())}`);
}

for (let i = 0; i < Math.min(3, lines.length); i++) {
  const l = lines[i];
  const padX = Math.max(6, l.h * 0.3), padY = Math.max(6, l.h * 0.5);
  const c = crop(img, l.x0 - padX, l.y0 - padY, l.x1 + padX, l.y1 + padY);
  console.log(`\ncrop #${i + 1} ${c.width}x${c.height} (tesseract: ${JSON.stringify(l.text)})`);
  await run('q8', q8, c);
  await run('fp32', f32, c);
}
