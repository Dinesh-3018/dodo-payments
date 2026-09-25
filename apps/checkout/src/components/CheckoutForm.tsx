import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  cvcLength,
  detectBrand,
  digitsOnly,
  formatCardNumber,
  formatExpiry,
  luhn,
  numberLength,
  validateCvc,
  validateEmail,
  validateExpiry,
  validateNumber,
} from "../card";
import type { Product } from "../catalog";
import { formatMoney } from "../money";
import { CardBrandIcon, LockIcon, Spinner } from "./icons";

export interface FormValues {
  email: string;
  /** Digits only. */
  number: string;
  /** Digits only, MMYY. */
  expiry: string;
  /** Digits only. */
  cvc: string;
}

export const emptyForm: FormValues = { email: "", number: "", expiry: "", cvc: "" };

type Key = keyof FormValues;
const ORDER: Key[] = ["email", "number", "expiry", "cvc"];

export function validate(values: FormValues): Partial<Record<Key, string>> {
  const errors: Partial<Record<Key, string>> = {};
  const brand = detectBrand(values.number);
  const email = validateEmail(values.email);
  const number = validateNumber(values.number);
  const expiry = validateExpiry(values.expiry);
  const cvc = validateCvc(values.cvc, brand);
  if (email) errors.email = email;
  if (number) errors.number = number;
  if (expiry) errors.expiry = expiry;
  if (cvc) errors.cvc = cvc;
  return errors;
}

interface Props {
  values: FormValues;
  onChange: (values: FormValues) => void;
  product: Product;
  merchantName: string;
  processing: boolean;
  initialFocus: Key;
  onPay: (values: FormValues) => void;
}

export function CheckoutForm({ values, onChange, product, merchantName, processing, initialFocus, onPay }: Props) {
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
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
    refs[initialFocus].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocus]);

  const stage = useProcessingCopy(processing);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (processing) return; // a second Enter or click while paying is absorbed here
    setSubmitted(true);
    const first = ORDER.find((key) => errors[key]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    onPay(values);
  }

  const blur = (key: Key) => () => setTouched((t) => ({ ...t, [key]: true }));

  function onNumber(event: ChangeEvent<HTMLInputElement>) {
    const raw = digitsOnly(event.target.value);
    const digits = raw.slice(0, numberLength(detectBrand(raw)));
    onChange({ ...values, number: digits });
    if (digits.length === numberLength(detectBrand(digits)) && luhn(digits)) refs.expiry.current?.focus();
  }

  function onExpiry(event: ChangeEvent<HTMLInputElement>) {
    let digits = digitsOnly(event.target.value).slice(0, 4);
    if (digits.length === 1 && Number(digits) > 1) digits = "0" + digits; // "5" means May
    onChange({ ...values, expiry: digits });
    if (digits.length === 4 && !validateExpiry(digits)) refs.cvc.current?.focus();
  }

  function onCvc(event: ChangeEvent<HTMLInputElement>) {
    onChange({ ...values, cvc: digitsOnly(event.target.value).slice(0, cvcLength(brand)) });
  }

  const total = formatMoney(product.amount, product.currency);

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <fieldset className="fields" disabled={processing}>
        <Field id="email" label="Email" error={visible("email")} hint="For your receipt">
          <input
            ref={refs.email}
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={values.email}
            onChange={(e) => onChange({ ...values, email: e.target.value })}
            onBlur={blur("email")}
            aria-invalid={Boolean(visible("email"))}
            aria-describedby="email-note"
          />
        </Field>

        <Field id="number" label="Card number" error={visible("number")}>
          <div className="input-wrap">
            <input
              ref={refs.number}
              id="number"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 1234 1234 1234"
              value={formatCardNumber(values.number, brand)}
              onChange={onNumber}
              onBlur={blur("number")}
              aria-invalid={Boolean(visible("number"))}
              aria-describedby="number-note"
              className="mono"
            />
            <span className="input-adornment">
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
              placeholder="MM / YY"
              value={formatExpiry(values.expiry)}
              onChange={onExpiry}
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
              placeholder={brand === "amex" ? "1234" : "123"}
              value={values.cvc}
              onChange={onCvc}
              onBlur={blur("cvc")}
              aria-invalid={Boolean(visible("cvc"))}
              aria-describedby="cvc-note"
              className="mono"
            />
          </Field>
        </div>
      </fieldset>

      <button type="submit" className={"pay" + (processing ? " is-busy" : "")} aria-busy={processing} aria-live="polite">
        {processing ? (
          <>
            <Spinner />
            <span>{stage}</span>
          </>
        ) : (
          <span>Pay {total}</span>
        )}
      </button>

      <p className="secure">
        <LockIcon />
        <span>
          Card details are encrypted and go straight to Dodo. {merchantName} never sees them.
        </span>
      </p>
      <p className="terms">
        By paying you agree to Dodo's{" "}
        <a href="https://dodopayments.com/terms" target="_blank" rel="noreferrer">
          Terms
        </a>{" "}
        and{" "}
        <a href="https://dodopayments.com/privacy" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
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
function useProcessingCopy(processing: boolean): string {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!processing) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, [processing]);
  return slow ? "Still confirming, hang on" : "Confirming payment";
}
