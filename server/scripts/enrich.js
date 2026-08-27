#!/usr/bin/env node
/**
 * OPTIONAL MANUAL ENRICHMENT — NOT PART OF THE APP.
 *
 * Fetches ONE official Vinmonopol product page (the URL you can open in a browser)
 * and stores its JSON-LD info (description, price, brand, size, country) into your
 * local products_cache. Run it at your own pace, for bottles you actually own.
 *
 *   node server/scripts/enrich.js <productId> [more ids...]
 *
 * ToS note (v01.09.2024): the API license covers the APIs only. This script reads a
 * public webpage the same way a browser does, one page at a time, for personal use.
 * Use responsibly; if in doubt, don't run it.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = process.env.DB_FILE || path.join(root, 'data', 'vinkjeller.db');
const ids = process.argv.slice(2);
if (!ids.length) {
  console.log('Usage: node server/scripts/enrich.js <productId> [more ids...]');
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error('DB not found at', dbPath, '(run the app once first)');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const stmt = db.prepare(`
  INSERT INTO products_cache (vmProductId, name, price, description, extra, fetchedAt)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(vmProductId) DO UPDATE SET
    name = COALESCE(excluded.name, name),
    price = COALESCE(excluded.price, price),
    description = COALESCE(excluded.description, description),
    extra = COALESCE(excluded.extra, extra),
    fetchedAt = excluded.fetchedAt`);

const HDR = { 'User-Agent': 'Mozilla/5.0 (personal enrichment script)' };

for (const id of ids) {
  const code = id.replace(/\D/g, '');
  if (!code) { console.log(`skip (bad id):`, id); continue; }
  const url = `https://www.vinmonopolet.no/p/${code}`;
  try {
    const res = await fetch(url, { headers: HDR, redirect: 'follow' });
    if (!res.ok) { console.log(`HTTP ${res.status} for ${code}`); continue; }
    const html = await res.text();
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!m) { console.log(`no JSON-LD for ${code}`); continue; }
    const ld = JSON.parse(m[1]);
    const extra = JSON.stringify({ brand: ld.brand?.name ?? null, color: ld.color ?? null, keywords: ld.keywords ?? [] });
    stmt.run(code, ld.name ?? null, ld.offers?.price ?? null, ld.description ?? null, extra, new Date().toISOString());
    console.log(`✔ ${code}: ${ld.name} — ${ld.offers?.price ?? '?'} ${ld.offers?.priceCurrency ?? ''}, ${ld.size ?? ''}, ${ld.countryOfOrigin ?? ''}`);
    await new Promise((r) => setTimeout(r, 3000)); // be gentle: one page per 3s
  } catch (e) {
    console.log(`error for ${code}:`, e.message);
  }
}
db.close();
