import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { uid as newId } from './auth.js';
import seedRecipesJson from '../../data/recipes.json' with { type: 'json' };

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

-- A cellar is a shared shelf: users join it with a role (owner/member).
-- Items belong to a cellar, not to a user (userId = who added it).
CREATE TABLE IF NOT EXISTS cellars (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ownerUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cellar_members (
  cellarId TEXT NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  joinedAt TEXT NOT NULL,
  PRIMARY KEY (cellarId, userId)
);
-- Party sharing: an unguessable token opens the cellar read-only, no login.
CREATE TABLE IF NOT EXISTS cellar_shares (
  token TEXT PRIMARY KEY,
  cellarId TEXT NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  label TEXT,
  expiresAt TEXT,
  createdAt TEXT NOT NULL,
  revokedAt TEXT
);
-- (index on cellar_items.cellarId is created in migrate(), after the column exists)

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
  instructions TEXT,
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

-- User feedback about the app (global, all users see all rows — like the
-- DnD-Scheduler Feedback tab). The feedback bot (owner's PC) reads PENDING
-- rows and sets status/adminNote directly in this table.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('bug','improvement','feature','other')),
  title TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','REPLYING','CLOSED')),
  adminNote TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(createdAt DESC);
`);

const now = () => new Date().toISOString();

// ---------- migrations (idempotent, run on every start) ----------
// Must run before the prepared statements below: SQLite validates column
// names at prepare time.
function migrate() {
  const cols = new Set(db.prepare(`PRAGMA table_info(cellar_items)`).all().map((r) => r.name));
  if (!cols.has('cellarId')) db.exec(`ALTER TABLE cellar_items ADD COLUMN cellarId TEXT REFERENCES cellars(id) ON DELETE CASCADE`);
  if (!cols.has('brewInfo')) db.exec(`ALTER TABLE cellar_items ADD COLUMN brewInfo TEXT`);
  if (!cols.has('boughtAt')) db.exec(`ALTER TABLE cellar_items ADD COLUMN boughtAt TEXT`);
  // drink-type tag ('vodka', 'rum', 'orange-juice', …) — an ingredient key
  // from data/recipes.json; makes recipe matching work for bottles whose
  // name doesn't contain the keyword (e.g. Grey Goose)
  if (!cols.has('tag')) db.exec(`ALTER TABLE cellar_items ADD COLUMN tag TEXT`);
  // fridge item? NULL = regular cellar item, 1 = fridge item on (available),
  // 0 = fridge item off (used up). Fridge items live in the same cellar so
  // guests and co-members see them, but they're toggles, not bottles.
  if (!cols.has('fridgeOn')) db.exec(`ALTER TABLE cellar_items ADD COLUMN fridgeOn INTEGER`);
  // free-text recipe instructions ("slik lager du den") — user recipes only
  const rcols = new Set(db.prepare(`PRAGMA table_info(recipes)`).all().map((r) => r.name));
  if (!rcols.has('instructions')) db.exec(`ALTER TABLE recipes ADD COLUMN instructions TEXT`);
  // seed recipes removed from data/recipes.json disappear from the DB
  // (e.g. the plain akevitt glass — it's a shot, not a drink)
  const seedNameKeys = seedRecipesJson.map((r) => r.nameKey);
  db.prepare(`DELETE FROM recipes WHERE userId IS NULL AND nameKey NOT IN (${seedNameKeys.map(() => '?').join(', ')})`).run(...seedNameKeys);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cellar_items_cellar ON cellar_items(cellarId, removedAt)`);
  // every user gets a home cellar; their existing items move there
  const insC = db.prepare(`INSERT INTO cellars (id,name,ownerUserId,createdAt) VALUES (?,?,?,?)`);
  const insM = db.prepare(`INSERT INTO cellar_members (cellarId,userId,role,joinedAt) VALUES (?,?,?,?)`);
  const hasHome = db.prepare(`SELECT id FROM cellars WHERE ownerUserId = ? LIMIT 1`);
  const move = db.prepare(`UPDATE cellar_items SET cellarId = ? WHERE userId = ? AND cellarId IS NULL`);
  for (const { id: uid } of db.prepare(`SELECT id FROM users`).all()) {
    const home = hasHome.get(uid);
    if (home) {
      move.run(home.id, uid);
      continue;
    }
    const cid = newId();
    insC.run(cid, 'Hjemmekjeller', uid, now());
    insM.run(cid, uid, 'owner', now());
    move.run(cid, uid);
  }
}
migrate();

// ---------- users & sessions ----------
export const users = {
  create: db.prepare(`INSERT INTO users (id, email, passHash, name, lang) VALUES (?,?,?,?,?)`),
  byEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  byId: db.prepare(`SELECT * FROM users WHERE id = ?`),
  update: db.prepare(`UPDATE users SET name = COALESCE(?,name), lang = COALESCE(?,lang) WHERE id = ?`),
  // Explicit storeId set (null clears) — COALESCE can't express that.
  setStore: db.prepare(`UPDATE users SET storeId = ? WHERE id = ?`),
};

export const sessions = {
  create: db.prepare(`INSERT INTO sessions (token, userId, expiresAt) VALUES (?,?,?)`),
  active: db.prepare(`SELECT s.userId FROM sessions s WHERE s.token = ? AND s.expiresAt > ?`),
  delete: db.prepare(`DELETE FROM sessions WHERE token = ?`),
  purgeExpired: db.prepare(`DELETE FROM sessions WHERE expiresAt <= ?`),
};

// ---------- cellar ----------
export const cellar = {
  insert: db.prepare(`INSERT INTO cellar_items (id,userId,cellarId,source,vmProductId,customName,customType,customAbv,customVolumeCl,price,photoUrl,note,brewInfo,addedAt,boughtAt,tag,fridgeOn) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  // fridge toggle (1 = available, 0 = used up)
  setFridgeOn: db.prepare(`UPDATE cellar_items SET fridgeOn = ? WHERE id = ?`),
  list: db.prepare(`SELECT * FROM cellar_items WHERE cellarId = ? AND removedAt IS NULL ORDER BY addedAt DESC`),
  one: db.prepare(`SELECT * FROM cellar_items WHERE id = ?`),
  update: db.prepare(`UPDATE cellar_items SET customName=COALESCE(?,customName), customType=COALESCE(?,customType), customAbv=COALESCE(?,customAbv), customVolumeCl=COALESCE(?,customVolumeCl), price=COALESCE(?,price), photoUrl=COALESCE(?,photoUrl), note=COALESCE(?,note), brewInfo=COALESCE(?,brewInfo), boughtAt=COALESCE(?,boughtAt) WHERE id=?`),
  // tag gets its own statement: COALESCE(?,tag) cannot express "explicitly
  // clear the tag" (null means both "not provided" and "remove")
  updateTag: db.prepare(`UPDATE cellar_items SET tag = ? WHERE id = ?`),
  remove: db.prepare(`UPDATE cellar_items SET removedAt = ?, removedReason = ? WHERE id = ? AND removedAt IS NULL`),
  history: db.prepare(`SELECT * FROM cellar_items WHERE cellarId = ? ORDER BY addedAt DESC LIMIT 200`),
};

export const cellars = {
  insert: db.prepare(`INSERT INTO cellars (id,name,ownerUserId,createdAt) VALUES (?,?,?,?)`),
  byId: db.prepare(`SELECT * FROM cellars WHERE id = ?`),
  // first cellar the user belongs to (by creation order) — the fallback
  homeOf: db.prepare(`SELECT c.* FROM cellars c JOIN cellar_members m ON m.cellarId = c.id WHERE m.userId = ? ORDER BY c.createdAt LIMIT 1`),
  forUser: db.prepare(`SELECT c.id, c.name, c.ownerUserId, c.createdAt, m.role,
      (SELECT COUNT(*) FROM cellar_items i WHERE i.cellarId = c.id AND i.removedAt IS NULL AND i.fridgeOn IS NULL) AS itemCount
    FROM cellars c JOIN cellar_members m ON m.cellarId = c.id WHERE m.userId = ? ORDER BY c.createdAt`),
  remove: db.prepare(`DELETE FROM cellars WHERE id = ? AND ownerUserId = ?`),
  rename: db.prepare(`UPDATE cellars SET name = ? WHERE id = ? AND ownerUserId = ?`),
};

export const cellarShares = {
  insert: db.prepare(`INSERT INTO cellar_shares (token,cellarId,label,expiresAt,createdAt) VALUES (?,?,?,?,?)`),
  activeForCellar: db.prepare(`SELECT * FROM cellar_shares WHERE cellarId = ? AND revokedAt IS NULL ORDER BY createdAt DESC`),
  byToken: db.prepare(`SELECT * FROM cellar_shares WHERE token = ?`),
  revoke: db.prepare(`UPDATE cellar_shares SET revokedAt = ? WHERE token = ? AND cellarId = ? AND revokedAt IS NULL`),
};

export const cellarMembers = {
  insert: db.prepare(`INSERT INTO cellar_members (cellarId,userId,role,joinedAt) VALUES (?,?,?,?)`),
  remove: db.prepare(`DELETE FROM cellar_members WHERE cellarId = ? AND userId = ?`),
  role: db.prepare(`SELECT role FROM cellar_members WHERE cellarId = ? AND userId = ?`),
  list: db.prepare(`SELECT m.userId, u.name, u.email, m.role
    FROM cellar_members m JOIN users u ON u.id = m.userId
    WHERE m.cellarId = ? ORDER BY (m.role <> 'owner'), u.name`),
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
  // DO UPDATE refreshes instructions from data/recipes.json on every
  // login/registration (seed rows can't be edited by users)
  seedUpsert: db.prepare(`INSERT INTO recipes (id,nameKey,glass,image,ingredients,instructions,favorite) VALUES (?,?,?,?,?,?,0)
    ON CONFLICT(nameKey) WHERE userId IS NULL DO UPDATE SET instructions = excluded.instructions`),
  list: db.prepare(`SELECT * FROM recipes WHERE userId IS NULL OR userId = ? ORDER BY (userId IS NULL), favorite DESC, nameKey`),
  one: db.prepare(`SELECT * FROM recipes WHERE id = ?`),
  create: db.prepare(`INSERT INTO recipes (id,userId,nameKey,glass,image,ingredients,instructions,favorite) VALUES (?,?,?,?,?,?,?,0)`),
  // dynamic so callers can set/keep/clear any subset of fields (COALESCE
  // alone can't express "clear instructions")
  update(id, userId, p) {
    const sets = [];
    const params = [];
    if (p.favorite !== undefined) { sets.push('favorite = ?'); params.push(p.favorite ? 1 : 0); }
    if (p.glass !== undefined) { sets.push('glass = ?'); params.push(p.glass ? String(p.glass).slice(0, 60) : null); }
    if (p.instructions !== undefined) { sets.push('instructions = ?'); params.push(p.instructions ? String(p.instructions).slice(0, 2000) : null); }
    if (p.nameKey !== undefined) { sets.push('nameKey = ?'); params.push(String(p.nameKey).slice(0, 120)); }
    if (p.ingredients !== undefined) { sets.push('ingredients = ?'); params.push(JSON.stringify(p.ingredients)); }
    if (!sets.length) return;
    db.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ? AND userId = ?`).run(...params, id, userId);
  },
  remove: db.prepare(`DELETE FROM recipes WHERE id = ? AND userId = ?`),
};

// ---------- feedback ----------
export const feedbackDb = {
  insert: db.prepare(`INSERT INTO feedback (id,userId,type,title,message,status,createdAt,updatedAt) VALUES (?,?,?,?,?,'PENDING',?,?)`),
  list: db.prepare(`SELECT f.*, u.name AS userName FROM feedback f LEFT JOIN users u ON u.id = f.userId ORDER BY f.createdAt DESC LIMIT 200`),
  one: db.prepare(`SELECT * FROM feedback WHERE id = ?`),
  update: db.prepare(`UPDATE feedback SET title = ?, message = ?, updatedAt = ? WHERE id = ?`),
  setStatus: db.prepare(`UPDATE feedback SET status = ?, updatedAt = ? WHERE id = ?`),
  remove: db.prepare(`DELETE FROM feedback WHERE id = ?`),
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
