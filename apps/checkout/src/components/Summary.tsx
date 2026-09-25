import type { Perk, PerkProgress, Product } from "../catalog";
import { MAX_QUANTITY } from "../catalog";
import { formatMoney } from "../money";
import { ProductArt } from "./art";
import { PerksBar } from "./PerksBar";

interface Props {
  product: Product;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  perks: Perk[];
  progress: PerkProgress;
  disabled: boolean;
}

export function Summary({ product, quantity, onQuantityChange, perks, progress, disabled }: Props) {
  const total = formatMoney(product.amount * quantity, product.currency);
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
          <div className="stepper" role="group" aria-label="Quantity">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onQuantityChange(quantity - 1)}
              disabled={disabled || quantity <= 1}
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="stepper-value num" aria-live="polite" aria-atomic="true">
              {quantity}
            </span>
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onQuantityChange(quantity + 1)}
              disabled={disabled || quantity >= MAX_QUANTITY}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>
        <div className="product-price num">{total}</div>
      </div>
      {perks.length > 0 && <PerksBar perks={perks} progress={progress} currency={product.currency} />}
      <div className="total">
        <span className="total-label">Total due</span>
        <span className="total-amount">{total}</span>
      </div>
    </section>
  );
}
