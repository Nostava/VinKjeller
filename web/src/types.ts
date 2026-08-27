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
  addedAt: string;
  removedAt: string | null;
  removedReason: string | null;
  product?: Product | null;
  popularity?: { liters: number; items: number } | null;
};

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
