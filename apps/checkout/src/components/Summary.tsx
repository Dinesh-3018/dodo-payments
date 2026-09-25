import type { Product } from "../catalog";
import { formatMoney } from "../money";
import { ProductArt } from "./art";

export function Summary({ product, expanded }: { product: Product; expanded: boolean }) {
  return (
    <div id="summary" className={"summary" + (expanded ? " is-open" : "")} aria-hidden={!expanded}>
      <div className="summary-inner">
        <div className="product">
          <div className="product-art">
            <ProductArt art={product.art} />
          </div>
          <div className="product-text">
            <div className="product-name">{product.name}</div>
            <div className="product-desc">{product.description}</div>
          </div>
          <div className="product-price">{formatMoney(product.amount, product.currency)}</div>
        </div>
      </div>
    </div>
  );
}
