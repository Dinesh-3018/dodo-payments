import { useEffect, useRef } from "react";
import type { ChargeFailure } from "../gateway";
import type { CardBrand } from "../card";
import { AlertIcon, CardBrandIcon, CheckIcon, WifiOffIcon } from "./icons";

export interface Failure {
  code: ChargeFailure;
  title: string;
  body: string;
  primary: string;
  canChangeCard: boolean;
}

export function failureFor(code: ChargeFailure): Failure {
  switch (code) {
    case "payment_declined":
      return {
        code,
        title: "Your card was declined",
        body: "Your bank didn't approve this payment. That's usually a limit or a security check on their side, not a typo.",
        primary: "Try again with this card",
        canChangeCard: true,
      };
    case "payment_failed":
      return {
        code,
        title: "Something went wrong on our side",
        body: "We hit a problem processing it. Trying again usually works.",
        primary: "Try again with this card",
        canChangeCard: true,
      };
    case "offline":
      return {
        code,
        title: "You're offline",
        body: "We couldn't reach the payment network. Check your connection, then try again.",
        primary: "Try again",
        canChangeCard: false,
      };
  }
}

interface Props {
  failure: Failure;
  amount: string;
  brand: CardBrand;
  last4: string;
  onRetry: () => void;
  onChangeCard: () => void;
}

export function FailedScreen({ failure, amount, brand, last4, onRetry, onChangeCard }: Props) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  return (
    <div className="state" role="alert">
      <section className="card state-card">
        <div className="state-head">
          <div className="state-icon is-danger">{failure.code === "offline" ? <WifiOffIcon /> : <AlertIcon />}</div>
          <div className="state-text">
            <h2 className="state-title">{failure.title}</h2>
            <p className="state-body">{failure.body}</p>
          </div>
        </div>
        <dl className="rows">
          <div className="row-line">
            <dt>Card</dt>
            <dd className="receipt-card">
              <CardBrandIcon brand={brand} />
              <span className="num">•••• {last4}</span>
            </dd>
          </div>
          <div className="row-line">
            <dt>Amount</dt>
            <dd className="num">{amount}</dd>
          </div>
          <div className="row-line">
            <dt>Status</dt>
            <dd className="is-ok">
              <CheckIcon />
              Nothing charged
            </dd>
          </div>
        </dl>
      </section>
      <div className="dock state-actions">
        <button ref={primary} type="button" className="pay" onClick={onRetry}>
          {failure.primary}
        </button>
        {failure.canChangeCard && (
          <button type="button" className="secondary" onClick={onChangeCard}>
            Use a different card
          </button>
        )}
      </div>
    </div>
  );
}
