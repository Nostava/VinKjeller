import type { CellarItem, Ingredient, Recipe, Round } from '../types';
import recipesSeed from '../../../data/recipes.json';

/** tag (ingredient key) → every keyword it has ever been seeded with.
 *  Lets a tagged bottle match an ingredient even when its name contains
 *  none of the keywords (Grey Goose → 'vodka'). */
const TAG_KEYWORDS: Record<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const r of recipesSeed) {
    for (const i of r.ingredients) {
      if (!i.nameKey.startsWith('ing.')) continue;
      const key = i.nameKey.slice(4);
      const arr = m.get(key) ?? [];
      for (const kw of i.keywords ?? []) if (!arr.includes(kw)) arr.push(kw);
      m.set(key, arr);
    }
  }
  return Object.fromEntries(m);
})();

/** The tag's display label ('vodka' → 'Vodka') for UI. */
export function tagLabel(tag: string | null | undefined, t: (k: string) => string): string | null {
  if (!tag) return null;
  const key = tag.replace(/^ing\./, '');
  const label = t('ing.' + key);
  return label && label !== 'ing.' + key ? label : key;
}

function labelOf(item: CellarItem): string {
  return (
    item.customName ??
    item.product?.longName ??
    item.product?.name ??
    item.product?.vmProductId ??
    '?'
  );
}

/** All text we match ingredient keywords against — including the bottle's
 *  tag and every keyword the tag stands for. */
function haystack(item: CellarItem): string {
  return [
    item.customName,
    item.customType,
    item.tag,
    ...(item.tag ? TAG_KEYWORDS[item.tag] ?? [] : []),
    item.product?.name,
    item.product?.longName,
    item.product?.category,
    item.product?.subCategory,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function bottleLabel(item: CellarItem): string {
  return labelOf(item);
}

/** Total volume (cl) of a bottle. */
export function bottleVolumeCl(item: CellarItem): number | null {
  return item.customVolumeCl ?? item.product?.volumeCl ?? null;
}

/** Which cellar bottles match an ingredient (by keyword vs name/category). */
export function matchBottles(ing: Ingredient, items: CellarItem[]): CellarItem[] {
  const kws = ing.keywords.map((k) => k.toLowerCase());
  return items.filter((it) => {
    const hay = haystack(it);
    return kws.some((k) => hay.includes(k));
  });
}

export type IngStatus = {
  ing: Ingredient;
  matches: CellarItem[];
  availableCl: number;
  // matched bottles whose volume we don't know (thin mode has no product
  // volume) — they still count as available, just not measurable
  unknownCount: number;
  ok: boolean;
};

export type RecipeStatus = {
  recipe: Recipe;
  ingredients: IngStatus[];
  canMake: boolean;
  maxRounds: number;
  missing: Ingredient[];
};

export function recipeStatus(recipe: Recipe, items: CellarItem[]): RecipeStatus {
  const ings: IngStatus[] = recipe.ingredients.map((ing) => {
    const matches = matchBottles(ing, items);
    const known = matches.filter((m) => bottleVolumeCl(m) !== null);
    const unknownCount = matches.length - known.length;
    const availableCl = known.reduce((sum, m) => sum + (bottleVolumeCl(m) ?? 0), 0);
    // A matched bottle with unknown volume still satisfies the ingredient —
    // the bottle is in the cellar, we just can't measure it in cl.
    const ok = matches.length > 0 && (ing.cl <= 0 ? true : unknownCount > 0 || availableCl >= ing.cl);
    return { ing, matches, availableCl, unknownCount, ok };
  });

  const required = ings.filter((i) => !i.ing.optional);
  let maxRounds = Infinity;
  for (const i of required) {
    if (!i.ok) continue;
    if (i.ing.cl > 0) {
      // unknown-volume bottles: we can't do cl-math, count bottles instead
      maxRounds = Math.min(maxRounds, i.unknownCount > 0 ? i.matches.length : Math.floor(i.availableCl / i.ing.cl));
    } else {
      // zero-cl required (e.g. bitters drops): limited by number of bottles
      maxRounds = Math.min(maxRounds, i.matches.length);
    }
  }
  const missing = required.filter((i) => !i.ok).map((i) => i.ing);
  return {
    recipe,
    ingredients: ings,
    canMake: missing.length === 0 && (maxRounds === Infinity ? true : maxRounds >= 1),
    maxRounds: maxRounds === Infinity ? 0 : maxRounds,
    missing,
  };
}

/** cl consumed per cellar item from rounds within a window (default 90 days). */
export function consumedPerItem(rounds: Round[], days = 90): Map<string, number> {
  const cutoff = Date.now() - days * 86400 * 1000;
  const map = new Map<string, number>();
  for (const r of rounds) {
    if (new Date(r.at).getTime() < cutoff) continue;
    for (const c of r.consumed) {
      map.set(c.cellarItemId, (map.get(c.cellarItemId) ?? 0) + c.cl);
    }
  }
  return map;
}

export type Estimate = {
  label: string;
  remainingCl: number;
  days: number | null; // null = rarely/never drunk
};

/** Estimated days until a bottle (or product) is empty, based on logged rounds. */
export function estimateEmpty(
  items: CellarItem[],
  consumed: Map<string, number>,
  days = 90
): Estimate[] {
  // group by product identity
  const groups = new Map<string, { label: string; remaining: number; consumedCl: number }>();
  for (const it of items) {
    const key = it.source === 'vm' ? 'vm:' + it.vmProductId : 'custom:' + (it.customName ?? it.id);
    const vol = bottleVolumeCl(it) ?? 0;
    const cons = consumed.get(it.id) ?? 0;
    const g = groups.get(key) ?? { label: bottleLabel(it), remaining: 0, consumedCl: 0 };
    g.remaining += Math.max(0, vol - cons);
    g.consumedCl += cons;
    groups.set(key, g);
  }
  const out: Estimate[] = [];
  for (const g of groups.values()) {
    if (g.remaining <= 0) continue;
    if (g.consumedCl <= 0) {
      out.push({ label: g.label, remainingCl: g.remaining, days: null });
    } else {
      const ratePerDay = g.consumedCl / days;
      out.push({ label: g.label, remainingCl: g.remaining, days: Math.round(g.remaining / ratePerDay) });
    }
  }
  return out.sort((a, b) => (a.days === null ? 1 : b.days === null ? -1 : a.days - b.days));
}
