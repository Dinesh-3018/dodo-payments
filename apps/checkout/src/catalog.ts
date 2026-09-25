export type Art = "notebook" | "mat";

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Minor units. */
  amount: number;
  currency: string;
  art: Art;
  /** Units available right now. Checked again when paying, as a real backend would. */
  stock: number;
}

const CATALOG: Record<string, Product> = {
  prod_123: {
    id: "prod_123",
    name: "Field Notebook, pack of 3",
    description: "Dot grid, 48 pages each, lies flat",
    amount: 1800,
    currency: "USD",
    art: "notebook",
    stock: 8,
  },
  prod_456: {
    id: "prod_456",
    name: "Desk Mat, slate",
    description: "Wool felt, 80 x 40 cm",
    amount: 4200,
    currency: "USD",
    art: "mat",
    stock: 3,
  },
};

/** Pretend catalogue lookup. Latency is real so the loading state is real. */
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
  { threshold: 1500, label: "Free shipping", detail: "free shipping" },
  { threshold: 4000, label: "Free sleeve", detail: "a free sleeve" },
  { threshold: 7000, label: "Free engraving", detail: "free engraving" },
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
