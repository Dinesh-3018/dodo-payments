import { useEffect, useRef } from "react";
import { AlertIcon, LockIcon } from "./icons";

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <div className="sk-row">
        <div className="sk sk-art" />
        <div className="sk-col">
          <div className="sk sk-line w60" />
          <div className="sk sk-line w40" />
        </div>
      </div>
      <div className="sk sk-field" />
      <div className="sk sk-field" />
      <div className="sk-row">
        <div className="sk sk-field" />
        <div className="sk sk-field" />
      </div>
      <div className="sk sk-button" />
      <p className="skeleton-label">{label}</p>
    </div>
  );
}

export function ProblemScreen({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <div className="state" role="alert">
      <div className="state-icon is-danger">
        <AlertIcon />
      </div>
      <h2 className="state-title">{title}</h2>
      <p className="state-body">{body}</p>
      <p className="state-note">No money has been taken.</p>
      <button ref={button} type="button" className="pay" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

export function NotFoundScreen({ onClose }: { onClose: () => void }) {
  return (
    <ProblemScreen
      title="We couldn't find that product"
      body="The store sent a product we don't recognise, so there is nothing to pay for."
      onClose={onClose}
    />
  );
}

export function StandaloneScreen() {
  return (
    <div className="state standalone">
      <div className="state-icon is-neutral">
        <LockIcon />
      </div>
      <h2 className="state-title">This is the Dodo checkout</h2>
      <p className="state-body">
        It only works inside a store that opens it with the Dodo Checkout script. Opened on its own it has no product, no
        session and no one to report back to, so it does nothing.
      </p>
    </div>
  );
}
