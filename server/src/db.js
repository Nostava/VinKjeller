import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new DatabaseSync(config.dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passHash TEXT NOT NULL,
  name TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'nb',
  storeId TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expiresAt TEXT NOT NULL
);

-- One row = one physical bottle/item in the cellar
CREATE TABLE IF NOT EXISTS cellar_items (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('vm','custom')),
  vmProductId TEXT,
  customName TEXT,
  customType TEXT,
  customAbv REAL,
  customVolumeCl REAL,
  price REAL,
  photoUrl TEXT,
  note TEXT,
  addedAt TEXT NOT NULL,
  removedAt TEXT,
  removedReason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cellar_user ON cellar_items(userId, removedAt);

-- Vinmonopol product cache (ToS: purge on demand)
CREATE TABLE IF NOT EXISTS products_cache (
  vmProductId TEXT PRIMARY KEY,
  name TEXT,
  longName TEXT,
  category TEXT,
  subCategory TEXT,
  country TEXT,
  region TEXT,
  subRegion TEXT,
  abv REAL,
  volumeCl REAL,
  price REAL,
  vintage TEXT,
  grapes TEXT,
  description TEXT,
  imageUrls TEXT,
  extra TEXT,
  fetchedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_cache (
  month TEXT NOT NULL,
  vmProductId TEXT NOT NULL,
  liters REAL,
  items INTEGER,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (month, vmProductId)
);

CREATE TABLE IF NOT EXISTS stores_cache (
  storeId TEXT PRIMARY KEY,
  name TEXT,
  city TEXT,
  address TEXT,
  gps TEXT,
  openingHours TEXT,
  fetchedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  userId TEXT REFERENCES users(id) ON DELETE CASCADE,
  nameKey TEXT NOT NULL,
  glass TEXT,
  image TEXT,
  ingredients TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_seed ON recipes(nameKey) WHERE userId IS NULL;

CREATE TABLE IF NOT EXISTS recipe_uses (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipeId TEXT NOT NULL,
  at TEXT NOT NULL,
  consumed TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uses_user ON recipe_uses(userId, at);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Learned barcode→product mapping (global fact, not user data). Lets scans
-- resolve without any API call — works in thin mode too.
CREATE TABLE IF NOT EXISTS gtin_map (
  gtin TEXT PRIMARY KEY,
  vmProductId TEXT NOT NULL,
  learnedAt TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();

// ---------- users & sessions ----------
export const users = {
  create: db.prepare(`INSERT INTO users (id, email, passHash, name, lang) VALUES (?,?,?,?,?)`),
  byEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  byId: db.prepare(`SELECT * FROM users WHERE id = ?`),
  update: db.prepare(`UPDATE users SET name = COALESCE(?,name), lang = COALESCE(?,lang), storeId = COALESCE(?,storeId) WHERE id = ?`),
};

export const sessions = {
  create: db.prepare(`INSERT INTO sessions (token, userId, expiresAt) VALUES (?,?,?)`),
  active: db.prepare(`SELECT s.userId FROM sessions s WHERE s.token = ? AND s.expiresAt > ?`),
  delete: db.prepare(`DELETE FROM sessions WHERE token = ?`),
  purgeExpired: db.prepare(`DELETE FROM sessions WHERE expiresAt <= ?`),
};

// ---------- cellar ----------
export const cellar = {
  insert: db.prepare(`INSERT INTO cellar_items (id,userId,source,vmProductId,customName,customType,customAbv,customVolumeCl,price,photoUrl,note,addedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  list: db.prepare(`SELECT * FROM cellar_items WHERE userId = ? AND removedAt IS NULL ORDER BY addedAt DESC`),
  one: db.prepare(`SELECT * FROM cellar_items WHERE id = ? AND userId = ?`),
  update: db.prepare(`UPDATE cellar_items SET customName=COALESCE(?,customName), customType=COALESCE(?,customType), customAbv=COALESCE(?,customAbv), customVolumeCl=COALESCE(?,customVolumeCl), price=COALESCE(?,price), photoUrl=COALESCE(?,photoUrl), note=COALESCE(?,note) WHERE id=? AND userId=?`),
  remove: db.prepare(`UPDATE cellar_items SET removedAt = ?, removedReason = ? WHERE id = ? AND userId = ? AND removedAt IS NULL`),
  history: db.prepare(`SELECT * FROM cellar_items WHERE userId = ? ORDER BY addedAt DESC LIMIT 200`),
};

// ---------- products cache ----------
export const productsCache = {
  upsert: db.prepare(`
    INSERT INTO products_cache (vmProductId,name,longName,category,subCategory,country,region,subRegion,abv,volumeCl,price,vintage,grapes,description,imageUrls,extra,fetchedAt)
    VALUES (@vmProductId,@name,@longName,@category,@subCategory,@country,@region,@subRegion,@abv,@volumeCl,@price,@vintage,@grapes,@description,@imageUrls,@extra,@fetchedAt)
    ON CONFLICT(vmProductId) DO UPDATE SET
      name=COALESCE(excluded.name,name), longName=COALESCE(excluded.longName,longName),
      category=COALESCE(excluded.category,category), subCategory=COALESCE(excluded.subCategory,subCategory),
      country=COALESCE(excluded.country,country), region=COALESCE(excluded.region,region), subRegion=COALESCE(excluded.subRegion,subRegion),
      abv=COALESCE(excluded.abv,abv), volumeCl=COALESCE(excluded.volumeCl,volumeCl), price=COALESCE(excluded.price,price),
      vintage=COALESCE(excluded.vintage,vintage), grapes=COALESCE(excluded.grapes,grapes),
      description=COALESCE(excluded.description,description), imageUrls=COALESCE(excluded.imageUrls,imageUrls),
      extra=COALESCE(excluded.extra,extra), fetchedAt=excluded.fetchedAt`),
  get: db.prepare(`SELECT * FROM products_cache WHERE vmProductId = ?`),
  whereFresh: db.prepare(`SELECT vmProductId FROM products_cache WHERE fetchedAt < ?`),
};

export const salesCache = {
  upsert: db.prepare(`INSERT INTO sales_cache (month,vmProductId,liters,items,updatedAt) VALUES (?,?,?,?,?)
    ON CONFLICT(month,vmProductId) DO UPDATE SET liters=excluded.liters, items=excluded.items, updatedAt=excluded.updatedAt`),
  forIds: db.prepare(`SELECT vmProductId, SUM(liters) AS liters, SUM(items) AS items FROM sales_cache WHERE month IN (SELECT DISTINCT month FROM sales_cache ORDER BY month DESC LIMIT 3) AND vmProductId = ?`),
  topMonths: db.prepare(`SELECT DISTINCT month FROM sales_cache ORDER BY month DESC LIMIT 3`),
  count: db.prepare(`SELECT COUNT(*) AS n FROM sales_cache`),
};

export const gtinMap = {
  get: db.prepare(`SELECT * FROM gtin_map WHERE gtin = ?`),
  upsert: db.prepare(`INSERT INTO gtin_map (gtin,vmProductId,learnedAt) VALUES (?,?,?)
    ON CONFLICT(gtin) DO UPDATE SET vmProductId=excluded.vmProductId, learnedAt=excluded.learnedAt`),
};

export const storesCache = {
  upsert: db.prepare(`INSERT INTO stores_cache (storeId,name,city,address,gps,openingHours,fetchedAt) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(storeId) DO UPDATE SET name=excluded.name, city=excluded.city, address=excluded.address, gps=excluded.gps, openingHours=excluded.openingHours, fetchedAt=excluded.fetchedAt`),
  all: db.prepare(`SELECT * FROM stores_cache ORDER BY city, name`),
  byId: db.prepare(`SELECT * FROM stores_cache WHERE storeId = ?`),
  age: db.prepare(`SELECT MIN(fetchedAt) AS oldest FROM stores_cache`),
};

// ---------- recipes & rounds ----------
export const recipesDb = {
  seedUpsert: db.prepare(`INSERT INTO recipes (id,nameKey,glass,image,ingredients,favorite) VALUES (?,?,?,?,?,0)
    ON CONFLICT(nameKey) WHERE userId IS NULL DO NOTHING`),
  list: db.prepare(`SELECT * FROM recipes WHERE userId IS NULL OR userId = ? ORDER BY (userId IS NULL), favorite DESC, nameKey`),
  one: db.prepare(`SELECT * FROM recipes WHERE id = ?`),
  create: db.prepare(`INSERT INTO recipes (id,userId,nameKey,glass,image,ingredients,favorite) VALUES (?,?,?,?,?,?,0)`),
  update: db.prepare(`UPDATE recipes SET favorite = COALESCE(?,favorite), glass = COALESCE(?,glass) WHERE id = ? AND userId = ?`),
  remove: db.prepare(`DELETE FROM recipes WHERE id = ? AND userId = ?`),
};

export const roundsDb = {
  insert: db.prepare(`INSERT INTO recipe_uses (id,userId,recipeId,at,consumed) VALUES (?,?,?,?,?)`),
  recent: db.prepare(`SELECT * FROM recipe_uses WHERE userId = ? ORDER BY at DESC LIMIT 200`),
  since: db.prepare(`SELECT * FROM recipe_uses WHERE userId = ? AND at >= ? ORDER BY at`),
};

export const meta = {
  get: db.prepare(`SELECT value FROM sync_meta WHERE key = ?`),
  set: db.prepare(`INSERT INTO sync_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
};

// ---------- ToS: purge all Vinmonopol data ----------
export function purgeVinmonopolData() {
  db.exec(`DELETE FROM products_cache; DELETE FROM sales_cache; DELETE FROM stores_cache; DELETE FROM gtin_map;
           UPDATE sync_meta SET value = NULL WHERE key IN ('sales_last_sync','stores_last_sync');`);
}

export { now };
