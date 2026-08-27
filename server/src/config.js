import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Minimal .env loader (project root) — only fills vars not already set.
try {
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }
} catch { /* no .env */ }

export const config = {
  root,
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '0.0.0.0',
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'vinkjeller.db'),
  vmKey: process.env.VINMONOPOLET_API_KEY || '',
  // 'thin' = products v0 + stores v0 (works today)
  // 'rich' = + my-products v1 (full master data + GTIN, requires access)
  productMode: (process.env.PRODUCT_DATA_MODE || 'thin') === 'rich' ? 'rich' : 'thin',
  // Hotlink product images from Vinmonopol's public image CDN (bilder.vinmonopolet.no)
  hotlinkImages: (process.env.HOTLINK_IMAGES ?? 'true') !== 'false',
  // Keep under official limits (60/min, 4000/day)
  rateLimit: { perMinute: 55, perDay: 3800 },
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()),
  serveWeb: (process.env.SERVE_WEB ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) !== 'false',
};
