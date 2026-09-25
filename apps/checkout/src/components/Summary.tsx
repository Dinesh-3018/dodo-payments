import type { Product } from "../catalog";
import { formatMoney } from "../money";
import { ProductArt } from "./art";

export function Summary({ product }: { product: Product }) {
  const total = formatMoney(product.amount, product.currency);
  return (
    <section className="card summary" aria-label="Your order">
      <p className="eyebrow">Your order</p>
      <div className="product">
        <div className="product-art">
          <ProductArt art={product.art} />
        </div>
        <div className="product-text">
          <div className="product-name">{product.name}</div>
          <div className="product-desc">{product.description}</div>
        </div>
        <div className="product-price">{total}</div>
      </div>
      <div className="total">
        <span className="total-label">Total due</span>
        <span className="total-amount">{total}</span>
      </div>
    </section>
  );
}
