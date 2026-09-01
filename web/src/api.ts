import type { BrewInfo, Cellar, CellarItem, CellarShare, Product, Recipe, Round, User } from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send Content-Type with an actual body — fastify rejects an empty
  // JSON body on e.g. DELETE ("Body cannot be empty").
  const headers: Record<string, string> = { ...((init?.headers ?? {}) as Record<string, string>) };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!res.ok) {
    let msg = String(res.status);
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => req<User | null>('/api/me'),
  login: (email: string, password: string) =>
    req<{ id: string; email: string; name: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string) =>
    req<{ id: string; email: string; name: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateMe: (patch: { name?: string; storeId?: string | null }) =>
    req<User>('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }),

  // The active cellar (App.tsx keeps this in sync) — adds and list views
  // target it without prop-drilling cellarId through every form.
  cellar: (cellarId?: string | null) =>
    req<{ items: CellarItem[] }>(
      '/api/me/cellar' + (cellarId ? '?cellarId=' + encodeURIComponent(cellarId) : ''),
    ),
  addBottle: (b: {
    source: 'vm' | 'custom'; vmProductId?: string | null; customName?: string | null; customType?: string | null;
    customAbv?: number | null; customVolumeCl?: number | null; price?: number | null;
    photoUrl?: string | null; note?: string | null; qty?: number;
    cellarId?: string | null; brewInfo?: BrewInfo | null; boughtAt?: string | null; tag?: string | null;
  }) => req<{ id: string; ids: string[] }>('/api/me/cellar', { method: 'POST', body: JSON.stringify(b) }),
  updateBottle: (id: string, patch: {
    customName?: string | null; customType?: string | null; customAbv?: number | null;
    customVolumeCl?: number | null; price?: number | null; photoUrl?: string | null;
    note?: string | null; brewInfo?: BrewInfo | null; boughtAt?: string | null; tag?: string | null;
  }) => req<{ ok: boolean }>(`/api/me/cellar/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeBottle: (id: string, reason: string) =>
    req<{ ok: boolean }>(`/api/me/cellar/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),

  cellars: () => req<{ items: Cellar[] }>('/api/me/cellars'),
  createCellar: (name: string) =>
    req<{ id: string; name: string }>('/api/me/cellars', { method: 'POST', body: JSON.stringify({ name }) }),
  renameCellar: (id: string, name: string) =>
    req<{ ok: boolean }>(`/api/cellars/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCellar: (id: string) => req<{ ok: boolean }>(`/api/cellars/${id}`, { method: 'DELETE' }),
  cellarMembers: (id: string) =>
    req<{ items: { userId: string; name: string; role: 'owner' | 'member' }[] }>(`/api/cellars/${id}/members`),
  inviteToCellar: (id: string, username: string) =>
    req<{ ok: boolean; name?: string }>(`/api/cellars/${id}/members`, { method: 'POST', body: JSON.stringify({ username }) }),
  removeFromCellar: (cellarId: string, userId: string) =>
    req<{ ok: boolean }>(`/api/cellars/${cellarId}/members/${userId}`, { method: 'DELETE' }),

  // Party sharing: token links open the cellar read-only without login
  createShare: (cellarId: string, body: { label?: string | null; expiresAt?: string | null }) =>
    req<{ token: string; url: string; expiresAt: string | null }>(`/api/cellars/${cellarId}/shares`, { method: 'POST', body: JSON.stringify(body) }),
  listShares: (cellarId: string) =>
    req<{ items: CellarShare[] }>(`/api/cellars/${cellarId}/shares`),
  revokeShare: (cellarId: string, token: string) =>
    req<{ ok: boolean }>(`/api/cellars/${cellarId}/shares/${token}`, { method: 'DELETE' }),
  shareView: (token: string) =>
    req<{ cellarName: string | null; expiresAt: string | null; items: CellarItem[] }>(`/api/share/${token}`),

  product: (id: string) => req<{ product: Product | null; source: string }>('/api/products/' + id),
  byGtin: (gtin: string) =>
    req<{ product: Product | null; reason?: 'bad_gtin' | 'gtin_unavailable' | 'not_found' }>('/api/products/by-gtin/' + gtin),
  rememberGtin: (gtin: string, vmProductId: string) =>
    req<{ ok: boolean; gtin: string }>('/api/products/remember-gtin', { method: 'POST', body: JSON.stringify({ gtin, vmProductId }) }),
  searchProducts: (q: string) =>
    req<{ items: { vmProductId: string; name: string | null; imageUrls: string | null }[]; mode: string }>('/api/products/search?q=' + encodeURIComponent(q)),

  recipes: () => req<{ items: Recipe[] }>('/api/me/recipes'),
  addRecipe: (r: { nameKey: string; glass: string | null; image: string | null; ingredients: { nameKey: string; keywords: string[]; cl: number; optional?: boolean }[] }) =>
    req<{ id: string }>('/api/me/recipes', { method: 'POST', body: JSON.stringify(r) }),
  deleteRecipe: (id: string) => req<{ ok: boolean }>(`/api/me/recipes/${id}`, { method: 'DELETE' }),
  setFavorite: (id: string, favorite: boolean) =>
    req<{ ok: boolean }>(`/api/me/recipes/${id}`, { method: 'PATCH', body: JSON.stringify({ favorite: favorite ? 1 : 0 }) }),

  rounds: (recipeId?: string, since?: string) => {
    let p = '/api/me/rounds?';
    if (recipeId) p += 'recipeId=' + recipeId + '&';
    if (since) p += 'since=' + since + '&';
    return req<{ items: Round[] }>(p);
  },
  addRound: (recipeId: string, consumed: { cellarItemId: string; cl: number }[]) =>
    req<{ id: string }>('/api/me/rounds', { method: 'POST', body: JSON.stringify({ recipeId, consumed }) }),

  stock: (productId: string, storeId: string) =>
    req<{ productId: string; storeId: string; storeName: string | null; stock: number | null; at: string | null; available: boolean; mode: string; reason?: string }>(
      `/api/products/stock?productId=${encodeURIComponent(productId)}&storeId=${encodeURIComponent(storeId)}`),

  stores: () => req<{ stores: { storeId: string; name: string; city: string }[] }>('/api/stores'),
  purge: () => req<{ ok: boolean; deleted: Record<string, number> }>('/api/purge-vinmonopol', { method: 'POST' }),
};
