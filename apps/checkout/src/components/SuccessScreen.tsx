import { useEffect, useRef } from "react";
import { burst } from "../confetti";
import type { CardBrand } from "../card";
import { CardBrandIcon } from "./icons";

interface Props {
  amount: string;
  merchantName: string;
  email: string;
  brand: CardBrand;
  last4: string;
  onDone: () => void;
}

let lastBurst = 0;

export function SuccessScreen({ amount, merchantName, email, brand, last4, onDone }: Props) {
  const done = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    done.current?.focus();
    if (Date.now() - lastBurst < 800) return; // StrictMode double-mount guard
    lastBurst = Date.now();
    burst();
    return undefined;
  }, []);

  return (
    <div className="state" role="status">
      <div className="state-icon is-success">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <circle className="check-ring" cx="18" cy="18" r="16" stroke="currentColor" strokeWidth="2.5" />
          <path className="check-mark" d="M10.5 18.5l5 5 10-10" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="state-title">Payment complete</h2>
      <p className="state-body">You're all set. A receipt is on its way.</p>
      <dl className="receipt">
        <div className="receipt-line">
          <dt>Paid</dt>
          <dd className="num">{amount}</dd>
        </div>
        <div className="receipt-line">
          <dt>To</dt>
          <dd>{merchantName}</dd>
        </div>
        <div className="receipt-line">
          <dt>Card</dt>
          <dd className="receipt-card">
            <CardBrandIcon brand={brand} />
            <span className="num">•••• {last4}</span>
          </dd>
        </div>
        <div className="receipt-line">
          <dt>Receipt</dt>
          <dd className="receipt-email">{email}</dd>
        </div>
      </dl>
      <button ref={done} type="button" className="pay" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
