import type { CellarItem, Product, Recipe, Round, User } from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
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

  cellar: () => req<{ items: CellarItem[] }>('/api/me/cellar'),
  addBottle: (b: {
    source: 'vm' | 'custom'; vmProductId?: string | null; customName?: string | null; customType?: string | null;
    customAbv?: number | null; customVolumeCl?: number | null; price?: number | null;
    photoUrl?: string | null; note?: string | null;
  }) => req<{ id: string }>('/api/me/cellar', { method: 'POST', body: JSON.stringify(b) }),
  removeBottle: (id: string, reason: string) =>
    req<{ ok: boolean }>(`/api/me/cellar/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),

  product: (id: string) => req<{ product: Product | null; source: string }>('/api/products/' + id),
  byGtin: (gtin: string) => req<{ product: Product | null; source: string } | null>('/api/products/by-gtin/' + gtin),
  searchProducts: (q: string) =>
    req<{ items: { vmProductId: string; name: string | null }[]; mode: string }>('/api/products/search?q=' + encodeURIComponent(q)),

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

  stores: () => req<{ stores: { storeId: string; name: string; city: string }[] }>('/api/stores'),
  purge: () => req<{ ok: boolean; deleted: Record<string, number> }>('/api/purge-vinmonopol', { method: 'POST' }),
};
