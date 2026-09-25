export type Art = "spice" | "ghee" | "rice" | "pickle";

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Minor units (paise). */
  amount: number;
  currency: string;
  art: Art;
  /** Units available right now. Checked again when paying, as a real backend would. */
  stock: number;
}

const CATALOG: Record<string, Product> = {
  prod_123: { id: "prod_123", name: "Sambar Powder, 250 g", description: "Stone ground the week you order", amount: 16900, currency: "INR", art: "spice", stock: 24 },
  prod_456: { id: "prod_456", name: "Cow Ghee, 500 ml", description: "Bilona method, from Erode", amount: 45900, currency: "INR", art: "ghee", stock: 5 },
  prod_789: { id: "prod_789", name: "Ponni Rice, 5 kg", description: "Aged a year, cooks fluffy", amount: 39900, currency: "INR", art: "rice", stock: 10 },
  prod_321: { id: "prod_321", name: "Mango Pickle, 300 g", description: "Sun-dried, gingelly oil", amount: 9900, currency: "INR", art: "pickle", stock: 20 },
};

/**
 * Pretend catalogue lookup. Latency is real so the loading state is real. The
 * stock it returns is the catalogue's snapshot, like a cached product page;
 * the live count lives in the fake gateway and is checked again at pay time.
 */
export async function fetchProduct(id: string): Promise<Product | null> {
  await new Promise((r) => setTimeout(r, 350 + Math.random() * 250));
  return CATALOG[id] ?? null;
}

/** Store-level perks. In a real integration this comes from the merchant's dashboard. */
export interface Perk {
  /** Minor units of order total that unlock it. */
  threshold: number;
  label: string;
  /** How the "away from" line refers to it. */
  detail: string;
}

export const STORE_PERKS: Perk[] = [
  { threshold: 14900, label: "Free shipping", detail: "free shipping" },
  { threshold: 49900, label: "Free sample", detail: "a free sample" },
  { threshold: 99900, label: "Free tote bag", detail: "a free tote bag" },
];

export const MAX_QUANTITY = 10;

export function maxQuantity(product: Product): number {
  return Math.max(1, Math.min(MAX_QUANTITY, product.stock));
}

export interface PerkProgress {
  unlocked: number;
  /** 0 to 1 along the track, with badges at the centre of equal segments. */
  fill: number;
  next: Perk | null;
  remaining: number;
}

export function perkProgress(total: number, perks: Perk[]): PerkProgress {
  const n = perks.length;
  const unlocked = perks.filter((p) => total >= p.threshold).length;
  if (n === 0) return { unlocked: 0, fill: 0, next: null, remaining: 0 };
  if (unlocked === n) return { unlocked, fill: 1, next: null, remaining: 0 };
  const next = perks[unlocked]!;
  const previous = unlocked === 0 ? 0 : perks[unlocked - 1]!.threshold;
  const partial = Math.min(1, Math.max(0, (total - previous) / (next.threshold - previous)));
  const fill = Math.max(0, (unlocked - 0.5 + partial) / n);
  return { unlocked, fill, next, remaining: next.threshold - total };
}
