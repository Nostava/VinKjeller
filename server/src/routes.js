import { hashPassword, verifyPassword, newToken, uid } from './auth.js';
import {
  db, users, sessions, cellar, recipesDb, roundsDb, storesCache, productsCache, now, purgeVinmonopolData,
} from './db.js';
import { searchProducts, getProduct, getPopular, byGtin, runDailyJob } from './vinmonopol.js';
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
    const { name, lang, storeId } = req.body ?? {};
    users.update.run(name ?? null, lang ?? null, storeId ?? null, u.id);
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
        items: results.map((r) => ({ vmProductId: r.vmProductId ?? r.id, name: r.name })),
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

  // ---------- cellar ----------
  app.get('/api/me/cellar', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const items = cellar.list.all(u.id);
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
    const id = uid();
    cellar.insert.run(
      id, u.id, source,
      source === 'vm' ? String(b.vmProductId) : null,
      source === 'custom' ? String(b.customName).slice(0, 120) : null,
      b.customType ? String(b.customType).slice(0, 60) : null,
      b.customAbv !== undefined && b.customAbv !== null ? Number(b.customAbv) : null,
      b.customVolumeCl !== undefined && b.customVolumeCl !== null ? Number(b.customVolumeCl) : null,
      b.price !== undefined && b.price !== null ? Number(b.price) : null,
      b.photoUrl ? String(b.photoUrl).slice(0, 300) : null,
      b.note ? String(b.note).slice(0, 500) : null,
      now()
    );
    // warm the product cache (live call, best effort) so list views have names/images
    if (source === 'vm') getProduct(String(b.vmProductId)).catch(() => {});
    reply.code(201).send({ id });
  });

  app.patch('/api/me/cellar/:id', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const b = req.body ?? {};
    cellar.update.run(
      b.customName !== undefined ? String(b.customName).slice(0, 120) : null,
      b.customType !== undefined ? String(b.customType).slice(0, 60) : null,
      b.customAbv !== undefined && b.customAbv !== null ? Number(b.customAbv) : null,
      b.customVolumeCl !== undefined && b.customVolumeCl !== null ? Number(b.customVolumeCl) : null,
      b.price !== undefined && b.price !== null ? Number(b.price) : null,
      b.photoUrl !== undefined ? String(b.photoUrl).slice(0, 300) : null,
      b.note !== undefined ? String(b.note).slice(0, 500) : null,
      req.params.id, u.id
    );
    reply.send({ ok: true });
  });

  app.delete('/api/me/cellar/:id', async (req, reply) => {
    const u = requireUser(req, reply); if (!u) return;
    const reason = String(req.body?.reason ?? req.query.reason ?? 'drank');
    cellar.remove.run(now(), reason, req.params.id, u.id);
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
