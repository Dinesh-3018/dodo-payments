export type Art = "notebook" | "mat";

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Minor units. */
  amount: number;
  currency: string;
  art: Art;
}

const CATALOG: Record<string, Product> = {
  prod_123: {
    id: "prod_123",
    name: "Field Notebook, pack of 3",
    description: "Dot grid, 48 pages each, lies flat",
    amount: 1800,
    currency: "USD",
    art: "notebook",
  },
  prod_456: {
    id: "prod_456",
    name: "Desk Mat, slate",
    description: "Wool felt, 80 x 40 cm",
    amount: 4200,
    currency: "USD",
    art: "mat",
  },
};

/** Pretend catalogue lookup. Latency is real so the loading state is real. */
export async function fetchProduct(id: string): Promise<Product | null> {
  await new Promise((r) => setTimeout(r, 350 + Math.random() * 250));
  return CATALOG[id] ?? null;
}
