import recipesSeed from '../../../data/recipes.json';

// Curated standard drink types for the tag picker (BottleDialog). The old
// picker listed every ingredient key from recipes.json — brands (Cointreau,
// Fernet) and fridge stuff (juice, soda) included. What users want is
// standard types (whisky, rum, vodka, …), with liqueur as a type that has
// subtypes (feedback 2026-09-02).
//
// `key` is what gets stored in cellar_items.tag. Keys that already exist as
// recipe ingredients get matching keywords for free (TAG_KEYWORDS in
// match.ts); `keywords` is only needed for the new keys below.
export type DrinkTag = {
  key: string;
  labelKey: string;
  keywords?: string[];
};
export type TagGroup = { labelKey: string; tags: DrinkTag[] };

// Group order is the "sort by type" part; within a group the picker sorts
// alphabetically by the translated label.
export const TAG_GROUPS: TagGroup[] = [
  {
    labelKey: 'taggroup.spirits',
    tags: [
      { key: 'aquavit', labelKey: 'ing.aquavit' },
      { key: 'brandy', labelKey: 'ing.brandy' },
      { key: 'gin', labelKey: 'ing.gin' },
      { key: 'rum', labelKey: 'ing.rum' },
      { key: 'tequila', labelKey: 'ing.tequila' },
      { key: 'vodka', labelKey: 'ing.vodka' },
      { key: 'whiskey', labelKey: 'ing.whiskey' },
    ],
  },
  {
    labelKey: 'taggroup.liqueur',
    tags: [
      { key: 'amaretto', labelKey: 'ing.amaretto', keywords: ['amaretto', 'disaronno', 'mandellikør'] },
      { key: 'bitter', labelKey: 'ing.bitter', keywords: ['campari', 'aperol'] },
      { key: 'coffee-liqueur', labelKey: 'ing.coffee-liqueur' },
      { key: 'cointreau', labelKey: 'ing.cointreau' },
      { key: 'cream-liqueur', labelKey: 'ing.cream-liqueur', keywords: ['baileys', 'cream liqueur', 'kremlikør'] },
      { key: 'hollandsk', labelKey: 'ing.hollandsk', keywords: ['hollandsk', 'jägermeister', 'jaegermeister', 'korn'] },
      { key: 'maraschino', labelKey: 'ing.maraschino', keywords: ['maraschino'] },
      { key: 'sambuca', labelKey: 'ing.sambuca', keywords: ['sambuca', 'anis'] },
    ],
  },
  {
    labelKey: 'taggroup.wine',
    tags: [
      { key: 'port-wine', labelKey: 'ing.port-wine' },
      { key: 'prosecco', labelKey: 'ing.prosecco' },
      { key: 'red-wine', labelKey: 'ing.red-wine' },
      { key: 'white-wine', labelKey: 'ing.white-wine' },
    ],
  },
  {
    labelKey: 'taggroup.other',
    tags: [
      { key: 'cider', labelKey: 'ing.cider' },
    ],
  },
];

/** All curated tag keys — used for the picker and for matching. */
export const TAG_KEYS = new Set(TAG_GROUPS.flatMap((g) => g.tags.map((t) => t.key)));

/** Matching keywords for tags that are NOT recipe ingredients (the rest are
 *  seeded from recipes.json in match.ts). */
export const TAG_KEYWORD_EXTRAS: Record<string, string[]> = Object.fromEntries(
  TAG_GROUPS.flatMap((g) => g.tags)
    .filter((t) => t.keywords)
    .map((t) => [t.key, t.keywords as string[]]),
);

// ---------- recipe ingredient picker ----------
// Creating a drink (recipe) uses the SAME groups as the tag picker, plus one
// final group with the non-alcoholic/mixing ingredients that recipes need but
// are never bottle tags (tonic, juice, syrup, garnish, …). Derived from
// recipes.json so a new seeded ingredient shows up automatically.
const RECIPE_ING_KEYS = new Set<string>();
for (const r of recipesSeed) {
  for (const i of r.ingredients) {
    if (i.nameKey.startsWith('ing.')) RECIPE_ING_KEYS.add(i.nameKey.slice(4));
  }
}

export const INGREDIENT_GROUPS: TagGroup[] = [
  ...TAG_GROUPS,
  {
    labelKey: 'taggroup.mixers',
    tags: [...RECIPE_ING_KEYS].filter((k) => !TAG_KEYS.has(k)).map((k) => ({ key: k, labelKey: 'ing.' + k })),
  },
];
