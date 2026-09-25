import { useEffect, useRef } from "react";
import { LockIcon } from "./icons";

interface Props {
  amount: string;
  merchantName: string;
  onApprove: () => void;
  onDecline: () => void;
}

/**
 * A stand-in for the bank's own page (3-D Secure). In production this is an
 * iframe the bank controls; here it is a card that says what is happening
 * and lets the tester pick the answer, the way Stripe's test mode does.
 */
export function ChallengeScreen({ amount, merchantName, onApprove, onDecline }: Props) {
  const approve = useRef<HTMLButtonElement>(null);
  useEffect(() => approve.current?.focus(), []);
  return (
    <div className="state" role="dialog" aria-labelledby="challenge-title">
      <section className="card state-card">
        <div className="state-head">
          <div className="state-icon is-neutral">
            <LockIcon />
          </div>
          <div className="state-text">
            <h2 className="state-title" id="challenge-title">
              Your bank wants to confirm it's you
            </h2>
            <p className="state-body">
              Some banks add a check before approving a card payment. This is where their page would appear.
            </p>
          </div>
        </div>
        <dl className="rows">
          <div className="row-line">
            <dt>Paying</dt>
            <dd>{merchantName}</dd>
          </div>
          <div className="row-line">
            <dt>Amount</dt>
            <dd className="num">{amount}</dd>
          </div>
        </dl>
      </section>
      <div className="dock state-actions">
        <button ref={approve} type="button" className="pay" onClick={onApprove}>
          Approve
        </button>
        <button type="button" className="secondary" onClick={onDecline}>
          Decline
        </button>
      </div>
    </div>
  );
}
