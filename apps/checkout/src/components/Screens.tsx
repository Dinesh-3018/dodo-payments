import { useEffect, useRef } from "react";
import { AlertIcon, CheckIcon, LockIcon } from "./icons";

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <div className="card">
        <div className="sk sk-eyebrow" />
        <div className="sk-row">
          <div className="sk sk-art" />
          <div className="sk-col">
            <div className="sk sk-line w60" />
            <div className="sk sk-line w40" />
          </div>
        </div>
        <div className="sk sk-total" />
      </div>
      <div className="card">
        <div className="sk sk-eyebrow" />
        <div className="sk sk-field" />
        <div className="sk sk-field" />
        <div className="sk-row">
          <div className="sk sk-field" />
          <div className="sk sk-field" />
        </div>
        <div className="sk sk-button" />
      </div>
      <p className="skeleton-label">{label}</p>
    </div>
  );
}

interface ProblemProps {
  title: string;
  body: string;
  /** Right-hand value of the Status row. Defaults to "Nothing charged". */
  status?: { label: string; ok: boolean };
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  icon?: "danger" | "neutral";
}

export function ProblemScreen({ title, body, status, primary, secondary, icon = "danger" }: ProblemProps) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  const line = status ?? { label: "Nothing charged", ok: true };
  return (
    <div className="state" role="alert">
      <section className="card state-card">
        <div className="state-head">
          <div className={"state-icon " + (icon === "danger" ? "is-danger" : "is-neutral")}>
            <AlertIcon />
          </div>
          <div className="state-text">
            <h2 className="state-title">{title}</h2>
            <p className="state-body">{body}</p>
          </div>
        </div>
        <dl className="rows">
          <div className="row-line">
            <dt>Status</dt>
            <dd className={line.ok ? "is-ok" : "is-pending"}>
              {line.ok ? <CheckIcon /> : <span className="spinner spinner-ink" aria-hidden="true" />}
              {line.label}
            </dd>
          </div>
        </dl>
      </section>
      <div className="dock state-actions">
        <button ref={button} type="button" className="pay" onClick={primary.onClick}>
          {primary.label}
        </button>
        {secondary && (
          <button type="button" className="secondary" onClick={secondary.onClick}>
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  );
}

export function NotFoundScreen({ onClose }: { onClose: () => void }) {
  return (
    <ProblemScreen
      title="We couldn't find that product"
      body="The store sent a product we don't recognise, so there is nothing to pay for."
      primary={{ label: "Close", onClick: onClose }}
    />
  );
}

export function StandaloneScreen() {
  return (
    <div className="state standalone">
      <section className="card state-card">
        <div className="state-head">
          <div className="state-icon is-neutral">
            <LockIcon />
          </div>
          <div className="state-text">
            <h2 className="state-title">This is the Dodo checkout</h2>
            <p className="state-body">
              It only works inside a store that opens it with the Dodo Checkout script. Opened on its own it has no
              product, no session and no one to report back to, so it does nothing.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
