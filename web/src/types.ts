export type Product = {
  vmProductId: string;
  name: string | null;
  longName: string | null;
  category: string | null;
  subCategory: string | null;
  country: string | null;
  region: string | null;
  subRegion: string | null;
  abv: number | null;
  volumeCl: number | null;
  price: number | null;
  vintage: string | null;
  grapes: string | null;
  description: string | null;
  imageUrls: string | null;
  extra: string | null;
  fetchedAt: string | null;
};

export type CellarItem = {
  id: string;
  source: 'vm' | 'custom';
  vmProductId: string | null;
  customName: string | null;
  customType: string | null;
  customAbv: number | null;
  customVolumeCl: number | null;
  price: number | null;
  photoUrl: string | null;
  note: string | null;
  // JSON: homebrew batch details (style, og, fg, ibu, malt, hops, yeast, …)
  brewInfo: string | null;
  // When the bottle was bought (user-editable, 'YYYY-MM-DD'). Falls back to
  // addedAt for the shelf-age tag.
  boughtAt: string | null;
  // Drink-type tag (an ingredient key from data/recipes.json, e.g. 'vodka')
  // — recipe matching also tests the tag's keywords, so Grey Goose still
  // counts as vodka even though the name never says so.
  tag: string | null;
  addedAt: string;
  removedAt: string | null;
  removedReason: string | null;
  product?: Product | null;
  popularity?: { liters: number; items: number } | null;
};

export type Cellar = {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  role: 'owner' | 'member';
  itemCount: number;
};

export type CellarShare = {
  token: string;
  cellarId: string;
  label: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

/** Homebrew batch details stored as JSON in CellarItem.brewInfo. */
export type BrewInfo = {
  style?: string | null;
  og?: number | null;
  fg?: number | null;
  ibu?: number | null;
  malt?: string | null;
  hops?: string | null;
  yeast?: string | null;
  carbonation?: 'light' | 'medium' | 'full' | null;
  brewDate?: string | null; // YYYY-MM-DD
};

export function parseBrewInfo(raw: string | null | undefined): BrewInfo | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

export type Ingredient = {
  nameKey: string;
  keywords: string[];
  cl: number;
  optional?: boolean;
};

export type Recipe = {
  id: string;
  userId: string | null;
  nameKey: string;
  glass: string | null;
  image: string | null;
  ingredients: Ingredient[];
  favorite: number;
  createdAt: string;
};

export type Round = {
  id: string;
  recipeId: string;
  at: string;
  consumed: { cellarItemId: string; cl: number }[];
};

export type User = { id: string; email: string; name: string | null; storeId: string | null };

export type Store = { storeId: string; name: string; city: string; address: string | null; gpsCoord: string | null };
