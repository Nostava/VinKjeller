import { config } from './config.js';
import { productsCache, salesCache, storesCache, gtinMap, meta, now } from './db.js';

const BASE = 'https://apis.vinmonopolet.no';
const UA = 'VinKjeller/0.1 (personal cellar tracker)';

// ---------- throttling (official limits: 60/min, 4000/day) ----------
let minuteUsed = 0;
let minuteStamp = 0;
let dayUsed = 0;
let dayStamp = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const d = new Date();
  const minute = Math.floor(d.getTime() / 60000);
  const day = d.toISOString().slice(0, 10);
  if (minute !== minuteStamp) { minuteStamp = minute; minuteUsed = 0; }
  if (day !== dayStamp) { dayStamp = day; dayUsed = 0; }
  if (minuteUsed >= config.rateLimit.perMinute) await sleep(60000 - (Date.now() - minuteStamp * 60000));
  if (dayUsed >= config.rateLimit.perDay) throw new Error('Daily API limit reached, try tomorrow');
  minuteUsed += 1;
  dayUsed += 1;
}

async function vmFetch(path, params = {}) {
  if (!config.vmKey) throw Object.assign(new Error('VINMONOPOLET_API_KEY not set'), { statusCode: 503 });
  await throttle();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': config.vmKey, 'User-Agent': UA } });
  if (res.status === 401) throw Object.assign(new Error('Vinmonopol API: invalid key/subscription for this API'), { statusCode: 502 });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`Vinmonopol API ${res.status}: ${body.slice(0, 200)}`), { statusCode: 502 });
  }
  return res.json();
}

const IMAGE_URL = (id, size) => `https://bilder.vinmonopolet.no/cache/${size}/${id}-1.jpg`;
export const imageSet = (id) => config.hotlinkImages
  ? JSON.stringify({ thumbnail: IMAGE_URL(id, '96x96-0'), product: IMAGE_URL(id, '300x300-0'), zoom: IMAGE_URL(id, '515x515-0'), superZoom: IMAGE_URL(id, '1200x1200-0') })
  : null;

// ---------- thin mode (products v0) ----------
async function searchThin(q) {
  const rows = await vmFetch('/products/v0/details-normal', { productShortNameContains: q, maxResults: 24 });
  return rows.map((r) => ({ id: r.basic.productId, name: r.basic.productShortName }));
}

async function productThin(id) {
  const rows = await vmFetch('/products/v0/details-normal', { productId: id, maxResults: 1 });
  const r = rows[0];
  if (!r) return null;
  return {
    vmProductId: String(r.basic.productId),
    name: r.basic.productShortName,
    longName: null, category: null, subCategory: null, country: null, region: null, subRegion: null,
    abv: null, volumeCl: null, price: null, vintage: null, grapes: null, description: null,
    imageUrls: imageSet(String(r.basic.productId)), extra: JSON.stringify({ lastChanged: r.lastChanged }),
  };
}

// ---------- rich mode (my-products v1) ----------
const richSearchQuery = (q) => q.trim().replace(/ /g, '_') + '*';

async function searchRich(q) {
  const rows = await vmFetch('/my-products/v1/details', { freeText: richSearchQuery(q), maxResults: 24 });
  return rows.map(normalizeRich);
}

async function productRich(id) {
  const rows = await vmFetch('/my-products/v1/details', { productId: id, maxResults: 1 });
  return rows.length ? normalizeRich(rows[0]) : null;
}

const GTIN_LENS = new Set([8, 12, 13, 14]);

export function gtinCheckOk(d) {
  if (!/^\d+$/.test(d) || !GTIN_LENS.has(d.length)) return false;
  let sum = 0;
  for (let i = 0; i < d.length - 1; i++) sum += Number(d[i]) * ((d.length - 1 - i) % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}

// Camera misreads can add extra digit(s) at the start and/or end of a code
// (guard-pattern pickup). If the code itself is not a valid GTIN (check
// digit), try trimming one digit from each side and only accept a candidate
// that passes check-digit validation.
export function normalizeGtin(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (gtinCheckOk(d)) return d;
  for (const c of [d.slice(1, -1), d.slice(1), d.slice(0, -1)]) if (gtinCheckOk(c)) return c;
  return d;
}

async function productByGtin(rawGtin) {
  const gtin = normalizeGtin(rawGtin);
  // Learned mapping first — works in thin mode and costs no API quota.
  const hit = gtinMap.get.get(gtin);
  if (hit) {
    const p = await getProduct(hit.vmProductId).catch(() => null);
    if (p) return p;
  }
  if (config.productMode !== 'rich') return null; // no official barcode lookup in thin mode
  const rows = await vmFetch('/my-products/v1/details', { gtin, maxResults: 1 });
  if (!rows.length) return null;
  const p = normalizeRich(rows[0]);
  productsCache.upsert.run({ ...p, fetchedAt: now() });
  // Learn the GTINs this product lists (main + pack codes) for future scans.
  for (const b of rows[0].logistics?.barcodes ?? []) {
    if (b.gtin) gtinMap.upsert.run(normalizeGtin(b.gtin), p.vmProductId, now());
  }
  return p;
}

function normalizeRich(row) {
  const b = row.basic ?? {};
  const cls = row.classification ?? {};
  const org = row.origins?.origin ?? {};
  const ing = row.ingredients ?? {};
  const desc = row.description ?? {};
  const price = (row.prices ?? [])[0] ?? {};
  const barcodes = row.logistics?.barcodes ?? [];
  const mainGtin = barcodes.find((x) => x.isMainGtin) ?? barcodes[0];
  const id = String(b.productId ?? '');
  return {
    vmProductId: id,
    name: b.productShortName ?? null,
    longName: b.productLongName ?? null,
    category: cls.mainProductTypeName ?? null,
    subCategory: cls.subProductTypeName ?? cls.productTypeName ?? null,
    country: org.country ?? null,
    region: org.region ?? null,
    subRegion: org.subRegion ?? null,
    abv: num(b.alcoholContent),
    volumeCl: num(b.volume),
    price: num(price.salesPrice),
    vintage: b.vintage ?? null,
    grapes: JSON.stringify(ing.grapes ?? []),
    description: JSON.stringify({
      characteristics: desc.characteristics ?? null,
      freshness: desc.freshness ?? null, fullness: desc.fullness ?? null,
      bitterness: desc.bitterness ?? null, sweetness: desc.sweetness ?? null, tannins: desc.tannins ?? null,
      recommendedFood: desc.recommendedFood ?? null,
      sugar: ing.sugar ?? null, acid: ing.acid ?? null, allergens: ing.allergens ?? null,
      organic: row.properties?.organic ?? null, storagePotential: row.properties?.storagePotential ?? null,
      assortment: row.assortment?.assortment ?? null,
    }),
    imageUrls: imageSet(id),
    extra: JSON.stringify({
      gtin: mainGtin?.gtin ?? null,
      introductionDate: b.introductionDate ?? null,
      status: b.productStatusSaleName ?? null,
      wholesaler: row.logistics?.wholesalerName ?? null,
    }),
  };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ---------- public API for routes ----------
export async function searchProducts(q) {
  return config.productMode === 'rich' ? searchRich(q) : searchThin(q);
}

export async function getProduct(id) {
  const cached = productsCache.get.get(String(id));
  const fresh = cached && cached.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < 20 * 3600 * 1000;
  if (fresh && config.productMode === 'thin') return cached;
  try {
    const p = config.productMode === 'rich' ? await productRich(id) : await productThin(id);
    if (p) { productsCache.upsert.run({ ...p, fetchedAt: now() }); return { ...p, cached: true }; }
  } catch (e) {
    if (!cached) throw e; // offline? serve stale cache if we have it
  }
  return cached ?? null;
}

// productByGtin upserts the products cache itself (both the learned-mapping
// and rich-API paths) — no double upsert here.
export async function byGtin(gtin) {
  return productByGtin(gtin);
}

// ---------- stock (my-products v1 — "lights up" in rich mode) ----------
const stockCache = new Map(); // "productId:storeId" -> { at, stock }, 5 min

export async function stockAt(productId, storeId) {
  if (config.productMode !== 'rich') return { stock: null, at: null, available: false };
  const key = productId + ':' + storeId;
  const hit = stockCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60000) {
    return { stock: hit.stock, at: new Date(hit.at).toISOString(), available: true };
  }
  try {
    const rows = await vmFetch('/my-products/v1/online-stock', { productId, storeId });
    const entry = (rows?.[0]?.stock ?? []).find((s) => String(s.storeId) === String(storeId));
    const stock = Number(entry?.storeStock ?? 0);
    stockCache.set(key, { at: Date.now(), stock });
    if (stockCache.size > 400) {
      let oldest = key, oldestAt = Infinity;
      for (const [k, v] of stockCache) if (v.at < oldestAt) { oldestAt = v.at; oldest = k; }
      stockCache.delete(oldest);
    }
    return { stock, at: new Date().toISOString(), available: true };
  } catch (e) {
    if (hit) return { stock: hit.stock, at: new Date(hit.at).toISOString(), available: true }; // stale beats nothing
    throw e;
  }
}

export async function getPopular(ids) {
  const out = [];
  for (const id of ids) {
    const row = salesCache.forIds.get(String(id));
    if (row && (row.liters > 0 || row.items > 0)) out.push({ id: String(id), liters: row.liters, items: row.items });
  }
  return out;
}

export async function syncSales() {
  const d = new Date();
  const months = [d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')];
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15));
  months.push(prev.getUTCFullYear() + '-' + String(prev.getUTCMonth() + 1).padStart(2, '0'));
  for (const m of months) {
    try {
      const rows = await vmFetch('/products/v0/monthly-sales', { tosalesmonth: m, fromsalesmonth: m });
      let n = 0;
      for (const r of rows) for (const s of r.sales ?? []) {
        salesCache.upsert.run(m, String(s.productId), s.salesVolume ?? null, s.salesQuantity ?? null, now());
        n += 1;
      }
      if (n) meta.set.run('sales_last_sync', now());
    } catch (e) {
      // monthly sales can lag; don't fail the whole sync
      console.warn(`sales sync ${m}:`, e.message);
    }
  }
}

export async function syncStores() {
  const rows = await vmFetch('/stores/v0/details');
  let n = 0;
  for (const s of rows) {
    storesCache.upsert.run(
      String(s.storeId), s.storeName ?? null, s.address?.city ?? null,
      s.address ? `${s.address.street ?? ''}, ${s.address.postalCode ?? ''} ${s.address.city ?? ''}` : null,
      s.address?.gpsCoord ?? null, JSON.stringify(s.openingHours ?? null), now()
    );
    n += 1;
  }
  if (n) meta.set.run('stores_last_sync', now());
  return n;
}

// Daily background job (sales + stores), cheap: changedSince would be nicer, but
// monthly-sales has no changedSince — we fetch last 2 months once per day.
export async function runDailyJob() {
  await syncStores().catch((e) => console.warn('stores sync:', e.message));
  await syncSales().catch((e) => console.warn('sales sync:', e.message));
}
