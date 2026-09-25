import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
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
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (Date.now() - lastBurst < 800) return; // StrictMode double-mount guard
    lastBurst = Date.now();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#111827";
    // One burst, in the brand colour and neutrals. A receipt, not a party popper.
    const colors = [accent, "#0a0a0a", "#737373", "#d4d4d4", "#f5b400"];
    confetti({ particleCount: 110, spread: 80, startVelocity: 36, origin: { x: 0.5, y: 0.4 }, colors, ticks: 210, scalar: 0.85, gravity: 1.1 });
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
