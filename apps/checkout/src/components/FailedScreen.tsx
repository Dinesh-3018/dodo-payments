import { useEffect, useRef } from "react";
import type { ChargeFailure } from "../gateway";
import { AlertIcon, WifiOffIcon } from "./icons";

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
  onRetry: () => void;
  onChangeCard: () => void;
}

export function FailedScreen({ failure, amount, onRetry, onChangeCard }: Props) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  return (
    <div className="state" role="alert">
      <div className="state-icon is-danger">{failure.code === "offline" ? <WifiOffIcon /> : <AlertIcon />}</div>
      <h2 className="state-title">{failure.title}</h2>
      <p className="state-body">{failure.body}</p>
      <p className="chip">
        <span className="chip-dot" aria-hidden="true" />
        No money has been taken
      </p>
      <dl className="receipt receipt-compact">
        <div className="receipt-line">
          <dt>Amount</dt>
          <dd className="num">{amount}</dd>
        </div>
      </dl>
      <div className="state-actions">
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
