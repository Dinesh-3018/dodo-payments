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
    const colors = [accent, "#fbbf24", "#60a5fa", "#f472b6", "#34d399"];
    confetti({ particleCount: 90, spread: 75, startVelocity: 38, origin: { x: 0.5, y: 0.42 }, colors, ticks: 220, scalar: 0.9 });
    const timer = setTimeout(() => {
      confetti({ particleCount: 50, spread: 110, startVelocity: 26, origin: { x: 0.5, y: 0.4 }, colors, ticks: 200, scalar: 0.8 });
    }, 220);
    return () => clearTimeout(timer);
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
      <p className="state-body">
        {amount} paid to {merchantName.replace(/\.$/, "")}. Receipt sent to <strong>{email}</strong>.
      </p>
      <div className="receipt-row">
        <CardBrandIcon brand={brand} />
        <span className="mono">•••• {last4}</span>
      </div>
      <button ref={done} type="button" className="pay" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
