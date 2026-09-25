import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { cvcLength, detectBrand, digitsOnly, formatCardNumber, formatExpiry, luhn, numberLength, validateExpiry } from "../card";
import { validate, type FieldKey, type FormValues } from "../schema";
export { emptyForm, type FormValues } from "../schema";
import { CardBrandIcon, LockIcon, Spinner } from "./icons";

type Key = FieldKey;
const ORDER: Key[] = ["email", "number", "expiry", "cvc"];

interface Props {
  values: FormValues;
  onChange: (values: FormValues) => void;
  /** Formatted total, already multiplied by quantity. */
  total: string;
  merchantName: string;
  processing: boolean;
  /** The charge was sent and the connection dropped; we are waiting for it to return. */
  waitingForNetwork: boolean;
  initialFocus: Key;
  /** The host pre-filled the email: show it as a line, not a field, until the buyer asks to change it. */
  emailPrefilled: boolean;
  onPay: (values: FormValues) => void;
}

/** Autofocus steals the screen on phones: the keyboard covers the order before it has been read. */
function shouldAutofocus(): boolean {
  return matchMedia("(pointer: fine)").matches || window.innerWidth > 640;
}

export function CheckoutForm({ values, onChange, total, merchantName, processing, waitingForNetwork, initialFocus, emailPrefilled, onPay }: Props) {
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [editingEmail, setEditingEmail] = useState(!emailPrefilled);
  const refs = {
    email: useRef<HTMLInputElement>(null),
    number: useRef<HTMLInputElement>(null),
    expiry: useRef<HTMLInputElement>(null),
    cvc: useRef<HTMLInputElement>(null),
  };
  const errors = validate(values);
  const brand = detectBrand(values.number);
  const visible = (key: Key) => ((touched[key] || submitted) && errors[key]) || undefined;

  useEffect(() => {
    if (shouldAutofocus()) refs[initialFocus].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocus]);

  // The buyer asked to change a pre-filled email: the field appears, focus goes with it.
  useEffect(() => {
    if (emailPrefilled && editingEmail) refs.email.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingEmail]);

  const stage = useProcessingCopy(processing, waitingForNetwork);
  const online = useOnline();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (processing) return; // a second Enter or click while paying is absorbed here
    if (!online) return; // the notice above the button says why
    setSubmitted(true);
    const first = ORDER.find((key) => errors[key]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    onPay(values);
  }

  // Leaving a field you never typed in is not a mistake; only a field with content gets judged on blur.
  const blur = (key: Key) => () => {
    if (values[key] !== "") setTouched((t) => ({ ...t, [key]: true }));
  };

  /** Backspace in an empty cell walks back to the previous one, the mirror of auto-advance. */
  const backTo = (previous: Key, current: Key) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && values[current] === "") {
      event.preventDefault();
      refs[previous].current?.focus();
    }
  };

  function onNumber(event: ChangeEvent<HTMLInputElement>) {
    const raw = fixBackspace(event, values.number);
    const newBrand = detectBrand(raw);
    const digits = raw.slice(0, numberLength(newBrand));
    // A CVC typed for one brand must not survive a switch to another.
    const cvc = newBrand === brand ? values.cvc : values.cvc.slice(0, cvcLength(newBrand));
    onChange({ ...values, number: digits, cvc });
    if (digits.length === numberLength(newBrand) && luhn(digits)) refs.expiry.current?.focus();
  }

  function onExpiry(event: ChangeEvent<HTMLInputElement>) {
    let digits = fixBackspace(event, values.expiry).slice(0, 4);
    if (digits.length === 1 && Number(digits) > 1) digits = "0" + digits; // "5" means May
    onChange({ ...values, expiry: digits });
    if (digits.length === 4 && !validateExpiry(digits)) refs.cvc.current?.focus();
  }

  function onCvc(event: ChangeEvent<HTMLInputElement>) {
    onChange({ ...values, cvc: digitsOnly(event.target.value).slice(0, cvcLength(brand)) });
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <section className="card">
      <p className="eyebrow">Pay with card</p>
      <fieldset className="fields" disabled={processing}>
        {editingEmail ? (
          <Field id="email" label="Email" error={visible("email")} hint="For your receipt">
            <input
              ref={refs.email}
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="next"
              spellCheck={false}
              value={values.email}
              onChange={(e) => onChange({ ...values, email: e.target.value })}
              onBlur={blur("email")}
              aria-invalid={Boolean(visible("email"))}
              aria-describedby="email-note"
            />
          </Field>
        ) : (
          <div className="email-row">
            <span className="email-row-label">Receipt to</span>
            <span className="email-row-value" title={values.email}>
              {values.email}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => setEditingEmail(true)}
            >
              Change
            </button>
          </div>
        )}

        <Field id="number" label="Card number" error={visible("number")}>
          <div className="input-wrap">
            <input
              ref={refs.number}
              id="number"
              inputMode="numeric"
              autoComplete="cc-number"
              enterKeyHint="next"
              placeholder="1234 1234 1234 1234"
              value={formatCardNumber(values.number, brand)}
              onChange={onNumber}
              onBlur={blur("number")}
              aria-invalid={Boolean(visible("number"))}
              aria-describedby="number-note"
              className="mono"
            />
            <span className="input-adornment" key={brand}>
              <CardBrandIcon brand={brand} />
            </span>
          </div>
        </Field>

        <div className="row">
          <Field id="expiry" label="Expiry" error={visible("expiry")}>
            <input
              ref={refs.expiry}
              id="expiry"
              inputMode="numeric"
              autoComplete="cc-exp"
              enterKeyHint="next"
              placeholder="MM / YY"
              value={formatExpiry(values.expiry)}
              onChange={onExpiry}
              onKeyDown={backTo("number", "expiry")}
              onBlur={blur("expiry")}
              aria-invalid={Boolean(visible("expiry"))}
              aria-describedby="expiry-note"
              className="mono"
            />
          </Field>
          <Field id="cvc" label="CVC" error={visible("cvc")}>
            <input
              ref={refs.cvc}
              id="cvc"
              inputMode="numeric"
              autoComplete="cc-csc"
              enterKeyHint="done"
              placeholder={brand === "amex" ? "1234" : "123"}
              value={values.cvc}
              onChange={onCvc}
              onKeyDown={backTo("expiry", "cvc")}
              onBlur={blur("cvc")}
              aria-invalid={Boolean(visible("cvc"))}
              aria-describedby="cvc-note"
              className="mono"
            />
          </Field>
        </div>
      </fieldset>

      </section>

      <p className="secure">
        <LockIcon />
        <span>
          Card details are encrypted and go straight to Dodo. {merchantName} never sees them.
        </span>
      </p>
      <p className="terms">
        By paying you agree to Dodo's{" "}
        <a href="https://dodopayments.com/legal/buyer-terms" target="_blank" rel="noreferrer">
          Terms
        </a>{" "}
        and{" "}
        <a href="https://dodopayments.com/legal/privacy-policy" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        .
      </p>

      <div className="dock">
        {!online && !processing && (
          <p className="notice" role="status">
            You're offline. Pay when you're back online; nothing has been sent.
          </p>
        )}
        <button
          type="submit"
          className={"pay" + (processing ? " is-busy" : "") + (!online && !processing ? " is-held" : "")}
          aria-busy={processing}
          aria-disabled={processing || !online}
          aria-live="polite"
        >
          {processing ? (
            <>
              <Spinner />
              <span>{stage}</span>
            </>
          ) : (
            <span>Pay {total}</span>
          )}
        </button>
      </div>
    </form>
  );
}

/**
 * Backspace over a formatting space or slash removes the digit before it,
 * instead of removing the separator (which the formatter would put straight
 * back, making the key feel dead).
 */
function fixBackspace(event: ChangeEvent<HTMLInputElement>, previousDigits: string): string {
  const raw = digitsOnly(event.target.value);
  const inputType = (event.nativeEvent as InputEvent).inputType;
  if (inputType !== "deleteContentBackward" || raw !== previousDigits) return raw;
  const caret = event.target.selectionStart ?? event.target.value.length;
  const before = digitsOnly(event.target.value.slice(0, caret));
  if (before.length === 0) return raw;
  return before.slice(0, -1) + raw.slice(before.length);
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className={"field" + (error ? " has-error" : "")}>
      <label htmlFor={id}>{label}</label>
      {children}
      <div className="field-note" id={`${id}-note`} role={error ? "alert" : undefined}>
        {error ?? hint ?? ""}
      </div>
    </div>
  );
}

/** Every spinner says what it is doing, and says something new if it takes long. */
function useProcessingCopy(processing: boolean, waitingForNetwork: boolean): string {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!processing) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, [processing]);
  if (waitingForNetwork) return "Connection lost, waiting for it";
  return slow ? "Still confirming, hang on" : "Confirming payment";
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
