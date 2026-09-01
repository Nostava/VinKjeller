import crypto from 'node:crypto';
import { hashPassword, verifyPassword, newToken, uid } from './auth.js';
import {
  db, users, sessions, cellar, cellars, cellarMembers, cellarShares, recipesDb, roundsDb, storesCache, gtinMap, productsCache, now, purgeVinmonopolData,
} from './db.js';
import { searchProducts, getProduct, getPopular, byGtin, normalizeGtin, gtinCheckOk, stockAt, runDailyJob, imageSet } from './vinmonopol.js';
import seedRecipesJson from '../../data/recipes.json' with { type: 'json' };
const seedRecipes = seedRecipesJson;

const SESSION_DAYS = 30;

export function registerRoutes(app) {
  // ---------- helpers ----------
  const sessionUser = (req) => {
    const token = req.cookies?.vk_session;
    if (!token) return null;
    const row = sessions.active.get(token, new Date().toISOString());
    return row ? users.byId.get(row.userId) : null;
  };
  const requireUser = (req, reply) => {
    const u = sessionUser(req);
    if (!u) { reply.code(401).send({ error: 'unauthorized' }); return null; }
    return u;
  };
  const setSession = (req, reply, userId) => {
    const token = newToken();
    sessions.create.run(token, userId, new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
    reply.setCookie('vk_session', token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: SESSION_DAYS * 86400 });
  };
  // Cellar membership: items belong to a cellar; a user may act on them only
  // through a membership (owner or member) in that cellar.
  const roleIn = (cellarId, userId) => (cellarId ? cellarMembers.role.get(String(cellarId), userId)?.role ?? null : null);
  const homeCellarId = (u) => cellars.homeOf.get(u.id)?.id ?? null;
  const resolveCellarId = (u, requested) => {
    const r = String(requested ?? '');
    if (r && roleIn(r, u.id)) return r;
    return homeCellarId(u);
  };
  const requireOwner = (req, reply, cellarId) => {
    const u = requireUser(req, reply); if (!u) return null;
    const c = cellars.byId.get(String(cellarId));
    if (!c || c.ownerUserId !== u.id) { reply.code(403).send({ error: 'not_owner' }); return null; }
    return { u, c };
  };
  // The startup migration only sees users that existed then — new users get
  // their home cellar here (and lazily when listing cellars).
  const ensureHomeCellar = (u) => {
    if (cellars.homeOf.get(u.id)) return;
    const id = uid();
    cellars.insert.run(id, 'Hjemmekjeller', u.id, now());
    cellarMembers.insert.run(id, u.id, 'owner', now());
  };
  function brewJson(v) {
    try {
      const o = typeof v === 'string' ? JSON.parse(v) : v;
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      return JSON.stringify(o).slice(0, 1000);
    } catch { return null; }
  }

  // 'YYYY-MM-DD' (or a full ISO) if it parses, else null — the bought date
  // the user enters is a plain date, keep it as typed.
  function validDate(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(Date.parse(s))) return null;
    return s;
  }

  // ---------- meta / health ----------
  app.get('/api/health', async () => ({ ok: true, mode: app.cfg.productMode, time: now() }));

  // ---------- auth ----------
  app.post('/api/auth/register', async (req, reply) => {
    const { email, password, name } = req.body ?? {};
    if (!email || !password || password.length < 8 || !name) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    const em = String(email).toLowerCase().trim();
    if (users.byEmail.get(em)) return reply.code(409).send({ error: 'email_taken' });
    const id = uid();
    users.create.run(id, em, hashPassword(password), String(name).slice(0, 80), 'nb');
    ensureHomeCellar(users.byId.get(id));
    // seed recipes
    for (const r of seedRecipes) recipesDb.seedUpsert.run(r.id, r.nameKey, r.glass ?? null, r.image ?? null, JSON.stringify(r.ingredients));
    setSession(req, reply, id);
    reply.code(201).send({ id, email: em, name: String(name) });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    const u = email ? users.byEmail.get(String(email).toLowerCase().trim()) : null;
    if (!u || !verifyPassword(String(password ?? ''), u.passHash)) {
      return reply.code(401).send({ error: 'bad_credentials' });
    }
    for (const r of seedRecipes) recipesDb.seedUpsert.run(r.id, r.nameKey, r.glass ?? null, r.image ?? null, JSON.stringify(r.ingredients));
    setSession(req, reply, u.id);
    reply.send({ id: u.id, email: u.email, name: u.name });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = req.cookies?.vk_session;
    if (t) sessions.delete.run(t);
    reply.clearCookie('vk_session', { path: '/' }).send({ ok: true });
  });

  // ---------- me ----------
  app.get('/api/me', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    reply.send({ id: u.id, email: u.email, name: u.name, lang: u.lang, storeId: u.storeId });
  });

  app.patch('/api/me', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const b = req.body ?? {};
    if (b.name !== undefined || b.lang !== undefined) {
      users.update.run(
        b.name !== undefined ? String(b.name) : null,
        b.lang !== undefined ? String(b.lang) : null,
        u.id
      );
    }
    if ('storeId' in b) users.setStore.run(b.storeId ? String(b.storeId) : null, u.id);
    const fresh = users.byId.get(u.id);
    reply.send({ id: fresh.id, email: fresh.email, name: fresh.name, lang: fresh.lang, storeId: fresh.storeId });
  });

  app.post('/api/purge-vinmonopol', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const count = (sql) => (db.prepare(sql).get() ?? { n: 0 }).n;
    const deleted = {
      products: count('SELECT COUNT(*) AS n FROM products_cache'),
      sales: count('SELECT COUNT(*) AS n FROM sales_cache'),
      stores: count('SELECT COUNT(*) AS n FROM stores_cache'),
    };
    purgeVinmonopolData();
    reply.send({ ok: true, deleted });
  });

  // ---------- products (proxy to official APIs) ----------
  app.get('/api/products/search', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return reply.code(400).send({ error: 'q_too_short' });
    try {
      const results = await searchProducts(q);
      reply.send({
        // imageUrls let the client render name+image candidate cards without extra calls
        items: results.map((r) => ({ vmProductId: r.vmProductId ?? r.id, name: r.name, imageUrls: imageSet(String(r.vmProductId ?? r.id)) })),
        mode: app.cfg.productMode,
      });
    } catch (e) {
      reply.code(e.statusCode ?? 502).send({ error: 'upstream', message: e.message });
    }
  });

  app.get('/api/products/by-gtin/:gtin', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const gtin = String(req.params.gtin).replace(/\D/g, '');
    if (gtin.length < 8) return reply.send({ product: null, reason: 'bad_gtin' });
    try {
      const p = await byGtin(gtin);
      if (p) return reply.send({ product: p });
      // thin mode (or missing my-products v1 subscription) has no official GTIN lookup,
      // so "not found" and "lookup unavailable" must be distinguishable in the UI.
      const reason = app.cfg.productMode === 'rich' ? 'not_found' : 'gtin_unavailable';
      reply.send({ product: null, reason });
    } catch {
      reply.send({ product: null, reason: 'gtin_unavailable' });
    }
  });

  // User learned a barcode→product mapping (e.g. found the product by name in
  // thin mode). The next scan of the same bottle then resolves without any
  // API lookup — in either mode.
  app.post('/api/products/remember-gtin', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const b = req.body ?? {};
    const gtin = normalizeGtin(b.gtin);
    const id = String(b.vmProductId ?? '').replace(/\D/g, '');
    if (!gtinCheckOk(gtin) || !id) return reply.code(400).send({ error: 'bad_request' });
    gtinMap.upsert.run(gtin, id, now());
    reply.send({ ok: true, gtin });
  });

  // Live stock for a product in a store (my-products v1). Gracefully degrades
  // to "unavailable" in thin mode / without my-products subscription.
  app.get('/api/products/stock', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const productId = String(req.query.productId ?? '').replace(/\D/g, '');
    const storeId = String(req.query.storeId ?? '').replace(/\D/g, '');
    if (!productId || !storeId) return reply.code(400).send({ error: 'bad_request' });
    const storeName = storesCache.byId.get(storeId)?.name ?? null;
    try {
      const r = await stockAt(productId, storeId);
      reply.send({ productId, storeId, storeName, stock: r.stock, at: r.at, available: r.available, mode: app.cfg.productMode });
    } catch {
      reply.send({ productId, storeId, storeName, stock: null, at: null, available: false, mode: app.cfg.productMode, reason: 'stock_unavailable' });
    }
  });

  app.get('/api/products/:id', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const id = String(req.params.id).replace(/\D/g, '');
    if (!id) return reply.code(400).send({ error: 'bad_id' });
    try {
      const p = await getProduct(id);
      if (!p) return reply.code(404).send({ error: 'not_found' });
      reply.send({ product: p, popularity: (await getPopular([id]))[0] ?? null });
    } catch (e) {
      reply.code(e.statusCode ?? 502).send({ error: 'upstream', message: e.message });
    }
  });

  app.get('/api/popular', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 500);
    reply.send({ popularity: await getPopular(ids) });
  });

  // ---------- stores ----------
  app.get('/api/stores', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const age = storesAge();
    if (!age || Date.now() - Date.parse(age) > 7 * 86400000) {
      await runDailyJob().catch(() => {}); // refresh opportunistically
    }
    const rows = storesAll();
    reply.send({ stores: rows });
  });

  // ---------- cellars (shared shelves) ----------
  app.get('/api/me/cellars', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    ensureHomeCellar(u);
    reply.send({ items: cellars.forUser.all(u.id) });
  });

  app.post('/api/me/cellars', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const name = String(req.body?.name ?? '').trim().slice(0, 60);
    if (!name) return reply.code(400).send({ error: 'bad_request' });
    const id = uid();
    cellars.insert.run(id, name, u.id, now());
    cellarMembers.insert.run(id, u.id, 'owner', now());
    reply.code(201).send({ id, name });
  });

  app.patch('/api/cellars/:id', async (req, reply) => {
    const o = requireOwner(req, reply, req.params.id); if (!o) return;
    const name = String(req.body?.name ?? '').trim().slice(0, 60);
    if (!name) return reply.code(400).send({ error: 'bad_request' });
    cellars.rename.run(name, o.c.id, o.u.id);
    reply.send({ ok: true });
  });

  app.delete('/api/cellars/:id', async (req, reply) => {
    const o = requireOwner(req, reply, req.params.id); if (!o) return;
    cellars.remove.run(o.c.id, o.u.id); // items cascade
    reply.send({ ok: true });
  });

  app.get('/api/cellars/:id/members', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    if (!roleIn(req.params.id, u.id)) return reply.code(403).send({ error: 'not_a_member' });
    reply.send({ items: cellarMembers.list.all(String(req.params.id)) });
  });

  app.post('/api/cellars/:id/members', async (req, reply) => {
    const o = requireOwner(req, reply, req.params.id); if (!o) return;
    const q = String(req.body?.username ?? '').trim().toLowerCase();
    if (!q) return reply.code(400).send({ error: 'bad_request' });
    const target = users.byEmail.get(q) ?? db.prepare(`SELECT * FROM users WHERE lower(name) = ?`).get(q);
    if (!target) return reply.code(404).send({ error: 'no_such_user' });
    if (target.id === o.u.id) return reply.code(400).send({ error: 'already_owner' });
    if (roleIn(o.c.id, target.id)) return reply.send({ ok: true, name: target.name });
    cellarMembers.insert.run(o.c.id, target.id, 'member', now());
    reply.send({ ok: true, name: target.name });
  });

  app.delete('/api/cellars/:id/members/:userId', async (req, reply) => {
    const o = requireOwner(req, reply, req.params.id); if (!o) return;
    const m = roleIn(o.c.id, req.params.userId);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (m === 'owner') return reply.code(400).send({ error: 'owner_cant_leave' });
    cellarMembers.remove.run(o.c.id, String(req.params.userId));
    reply.send({ ok: true });
  });

  // ---------- sharing (party mode) ----------
  // An unguessable token opens the cellar read-only without login.
  // The token IS the credential; shares expire and/or get revoked.
  app.post('/api/cellars/:id/shares', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const cid = String(req.params.id);
    if (!roleIn(cid, u.id)) return reply.code(403).send({ error: 'not_a_member' });
    const b = req.body ?? {};
    const label = b.label ? String(b.label).trim().slice(0, 60) : null;
    let expiresAt = null;
    if (b.expiresAt) {
      const t = Date.parse(b.expiresAt);
      if (Number.isNaN(t) || t <= Date.now()) return reply.code(400).send({ error: 'bad_request' });
      expiresAt = new Date(t).toISOString();
    }
    const token = crypto.randomBytes(8).toString('hex');
    cellarShares.insert.run(token, cid, label, expiresAt, now());
    reply.code(201).send({ token, url: `/j/${token}`, expiresAt });
  });

  app.get('/api/cellars/:id/shares', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const cid = String(req.params.id);
    if (!roleIn(cid, u.id)) return reply.code(403).send({ error: 'not_a_member' });
    reply.send({ items: cellarShares.activeForCellar.all(cid) });
  });

  app.delete('/api/cellars/:id/shares/:token', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const cid = String(req.params.id);
    if (!roleIn(cid, u.id)) return reply.code(403).send({ error: 'not_a_member' });
    const n = cellarShares.revoke.run(now(), String(req.params.token), cid).changes;
    if (!n) return reply.code(404).send({ error: 'not_found' });
    reply.send({ ok: true });
  });

  // Public read-only view (no auth). Field list is explicit: no internal
  // user ids, no drink log — guests see bottles only.
  app.get('/api/share/:token', async (req, reply) => {
    const s = cellarShares.byToken.get(String(req.params.token));
    if (!s || s.revokedAt) return reply.code(404).send({ error: 'not_found' });
    if (s.expiresAt && Date.parse(s.expiresAt) <= Date.now()) return reply.code(410).send({ error: 'expired' });
    const items = cellar.list.all(s.cellarId);
    const vmIds = [...new Set(items.filter((i) => i.source === 'vm').map((i) => i.vmProductId))];
    const prodMap = new Map(vmIds.map((id) => [id, productsCache.get.get(id) ?? null]));
    reply.send({
      cellarName: cellars.byId.get(s.cellarId)?.name ?? null,
      expiresAt: s.expiresAt,
      items: items.map((i) => ({
        id: i.id, source: i.source, vmProductId: i.vmProductId,
        customName: i.customName, customType: i.customType,
        customAbv: i.customAbv, customVolumeCl: i.customVolumeCl,
        price: i.price, photoUrl: i.photoUrl, note: i.note, brewInfo: i.brewInfo,
        addedAt: i.addedAt,
        product: i.source === 'vm' ? prodMap.get(i.vmProductId) ?? null : null,
        popularity: null,
      })),
    });
  });

  // ---------- cellar ----------
  app.get('/api/me/cellar', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const cellarId = resolveCellarId(u, req.query.cellarId);
    if (!cellarId) return reply.send({ items: [] });
    const items = cellar.list.all(cellarId);
    const vmIds = [...new Set(items.filter((i) => i.source === 'vm').map((i) => i.vmProductId))];
    const pop = vmIds.length ? await getPopular(vmIds) : [];
    const popMap = new Map(pop.map((p) => [p.id, p]));
    // merge cached product info locally (no API calls in the list view)
    const prodMap = new Map(vmIds.map((id) => [id, productsCache.get.get(id) ?? null]));
    reply.send({
      items: items.map((i) => ({
        ...i,
        product: i.source === 'vm' ? prodMap.get(i.vmProductId) ?? null : null,
        popularity: i.source === 'vm' ? popMap.get(i.vmProductId) ?? null : null,
      })),
    });
  });

  app.post('/api/me/cellar', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const b = req.body ?? {};
    const source = b.source === 'custom' ? 'custom' : 'vm';
    if (source === 'vm' && !b.vmProductId) return reply.code(400).send({ error: 'bad_request' });
    if (source === 'custom' && !b.customName) return reply.code(400).send({ error: 'bad_request' });
    const cellarId = resolveCellarId(u, b.cellarId);
    if (!cellarId) return reply.code(400).send({ error: 'no_cellar' });
    const brew = b.brewInfo !== undefined && b.brewInfo !== null ? brewJson(b.brewInfo) : null;
    // One add can cover several physical bottles (e.g. a 6-pack).
    const qty = Math.min(99, Math.max(1, Math.floor(Number(b.qty ?? 1)) || 1));
    const ids = [];
    for (let i = 0; i < qty; i++) {
      const id = uid();
      cellar.insert.run(
        id, u.id, cellarId, source,
        source === 'vm' ? String(b.vmProductId) : null,
        source === 'custom' ? String(b.customName).slice(0, 120) : null,
        b.customType ? String(b.customType).slice(0, 60) : null,
        b.customAbv !== undefined && b.customAbv !== null ? Number(b.customAbv) : null,
        b.customVolumeCl !== undefined && b.customVolumeCl !== null ? Number(b.customVolumeCl) : null,
        b.price !== undefined && b.price !== null ? Number(b.price) : null,
        b.photoUrl ? String(b.photoUrl).slice(0, 300) : null,
        b.note ? String(b.note).slice(0, 500) : null,
        brew,
        now(),
        validDate(b.boughtAt),
        b.tag ? String(b.tag).trim().slice(0, 40) : null
      );
      ids.push(id);
    }
    // warm the product cache (live call, best effort) so list views have names/images
    if (source === 'vm') getProduct(String(b.vmProductId)).catch(() => {});
    reply.code(201).send({ id: ids[0], ids });
  });

  app.patch('/api/me/cellar/:id', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const item = cellar.one.get(req.params.id);
    if (!item || !roleIn(item.cellarId, u.id)) return reply.code(404).send({ error: 'not_found' });
    const b = req.body ?? {};
    cellar.update.run(
      b.customName !== undefined ? String(b.customName).slice(0, 120) : null,
      b.customType !== undefined ? String(b.customType).slice(0, 60) : null,
      b.customAbv !== undefined && b.customAbv !== null ? Number(b.customAbv) : null,
      b.customVolumeCl !== undefined && b.customVolumeCl !== null ? Number(b.customVolumeCl) : null,
      b.price !== undefined && b.price !== null ? Number(b.price) : null,
      b.photoUrl !== undefined ? String(b.photoUrl).slice(0, 300) : null,
      b.note !== undefined ? String(b.note).slice(0, 500) : null,
      b.brewInfo !== undefined && b.brewInfo !== null ? brewJson(b.brewInfo) : null,
      b.boughtAt !== undefined ? validDate(b.boughtAt) : null,
      req.params.id
    );
    // explicit tag change (including clearing it) — see updateTag comment
    if (b.tag !== undefined) {
      cellar.updateTag.run(b.tag ? String(b.tag).trim().slice(0, 40) : null, req.params.id);
    }
    reply.send({ ok: true });
  });

  app.delete('/api/me/cellar/:id', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const item = cellar.one.get(req.params.id);
    if (!item || !roleIn(item.cellarId, u.id)) return reply.code(404).send({ error: 'not_found' });
    const reason = String(req.body?.reason ?? req.query.reason ?? 'drank');
    cellar.remove.run(now(), reason, req.params.id);
    reply.send({ ok: true });
  });

  // ---------- recipes ----------
  app.get('/api/me/recipes', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const rows = recipesDb.list.all(u.id);
    reply.send({ items: rows.map(parseRecipe) });
  });

  app.post('/api/me/recipes', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const b = req.body ?? {};
    if (!b.nameKey || !Array.isArray(b.ingredients) || !b.ingredients.length) return reply.code(400).send({ error: 'bad_request' });
    const id = uid();
    recipesDb.create.run(id, u.id, String(b.nameKey).slice(0, 120), b.glass ? String(b.glass).slice(0, 60) : null, b.image ? String(b.image).slice(0, 300) : null, JSON.stringify(b.ingredients));
    reply.code(201).send({ id });
  });

  app.patch('/api/me/recipes/:id', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const b = req.body ?? {};
    recipesDb.update.run(b.favorite !== undefined ? (b.favorite ? 1 : 0) : null, b.glass !== undefined ? String(b.glass).slice(0, 60) : null, req.params.id, u.id);
    reply.send({ ok: true });
  });

  app.delete('/api/me/recipes/:id', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    recipesDb.remove.run(req.params.id, u.id);
    reply.send({ ok: true });
  });

  // ---------- rounds (consumption log) ----------
  app.get('/api/me/rounds', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    reply.send({ items: roundsDb.recent.all(u.id).map(parseRound) });
  });

  app.post('/api/me/rounds', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const b = req.body ?? {};
    if (!b.recipeId || !Array.isArray(b.consumed) || !b.consumed.length) return reply.code(400).send({ error: 'bad_request' });
    const id = uid();
    roundsDb.insert.run(id, u.id, String(b.recipeId), now(), JSON.stringify(b.consumed));
    reply.code(201).send({ id });
  });
}

function parseRecipe(r) {
  return { ...r, ingredients: safeJson(r.ingredients, []) };
}
function parseRound(r) {
  return { ...r, consumed: safeJson(r.consumed, []) };
}
function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function storesAll() { return storesCache.all.all(); }
function storesAge() { return storesCache.age.get()?.oldest ?? null; }
