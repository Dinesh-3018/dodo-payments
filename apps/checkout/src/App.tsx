import { useCallback, useEffect, useRef, useState } from "react";
import { createBridge, type Bridge } from "./bridge";
import type { InitMessage } from "./protocol";
import { fetchProduct, type Product } from "./catalog";
import { charge, type ChargeFailure } from "./gateway";
import { applyTheme, resolveBrand, type ResolvedBrand } from "./theme";
import { formatMoney } from "./money";
import { detectBrand, type CardBrand } from "./card";
import { Header } from "./components/Header";
import { Summary } from "./components/Summary";
import { CheckoutForm, emptyForm, type FormValues } from "./components/CheckoutForm";
import { FailedScreen, failureFor, type Failure } from "./components/FailedScreen";
import { SuccessScreen } from "./components/SuccessScreen";
import { NotFoundScreen, ProblemScreen, Skeleton, StandaloneScreen } from "./components/Screens";

type Phase =
  | { status: "standalone" }
  | { status: "booting" }
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "fatal" }
  | { status: "ready"; focus: keyof FormValues }
  | { status: "processing" }
  | { status: "failed"; failure: Failure }
  | { status: "succeeded"; brand: CardBrand; last4: string };

const ERROR_MESSAGES: Record<ChargeFailure, string> = {
  payment_declined: "The customer's bank declined the card. The customer can retry or use another card.",
  payment_failed: "A transient processing error stopped the payment. The customer can retry.",
  offline: "The customer's device was offline when paying. The customer can retry.",
};

export function App() {
  const [phase, setPhase] = useState<Phase>(() => (window.parent === window ? { status: "standalone" } : { status: "booting" }));
  const [init, setInit] = useState<(InitMessage & { hostOrigin: string }) | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [brand, setBrand] = useState<ResolvedBrand | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [announce, setAnnounce] = useState("");

  const bridge = useRef<Bridge | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // ---- talk to the host --------------------------------------------------

  const send = useCallback((message: Parameters<Bridge["send"]>[0]) => bridge.current?.send(message), []);

  const requestClose = useCallback(() => {
    const current = phaseRef.current;
    if (current.status === "processing") {
      // Hold the line, but never silently: shake the panel and say why.
      send({ type: "nudge" });
      setAnnounce("");
      setTimeout(() => setAnnounce("Hang on, we're confirming your payment."), 0);
      return;
    }
    if (current.status === "standalone") return;
    if (current.status === "not_found" || current.status === "fatal") {
      send({ type: "close", reason: "error" });
      return;
    }
    send({ type: "close", reason: current.status === "succeeded" ? "complete" : "user" });
  }, [send]);

  useEffect(() => {
    const b = createBridge({
      onInit: (message, hostOrigin) => setInit({ ...message, hostOrigin }),
      onCloseRequest: () => requestClose(),
    });
    bridge.current = b;
    return () => b.dispose();
  }, [requestClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // ---- boot: product and brand in parallel ---------------------------------

  useEffect(() => {
    if (!init) return;
    let cancelled = false;
    document.body.classList.add(`layout-${init.layout}`);
    setPhase({ status: "loading" });
    if (init.customerEmail) setForm((f) => ({ ...f, email: init.customerEmail ?? f.email }));

    Promise.all([fetchProduct(init.productId), resolveBrand(init, init.hostOrigin)])
      .then(([p, b]) => {
        if (cancelled) return;
        applyTheme(b.accent, init.theme.radius, init.theme.font);
        setBrand(b);
        if (!p) {
          setPhase({ status: "not_found" });
          send({ type: "error", code: "product_not_found", message: `No product with id "${init.productId}".`, terminal: true });
          return;
        }
        setProduct(p);
        setPhase({ status: "ready", focus: init.customerEmail ? "number" : "email" });
      })
      .catch(() => {
        if (cancelled) return;
        setPhase({ status: "fatal" });
        send({ type: "error", code: "load_failed", message: "The checkout hit an unexpected error while setting up.", terminal: true });
      });
    return () => {
      cancelled = true;
    };
  }, [init, send]);

  // ---- modal layout: tell the host how tall we want to be ------------------

  useEffect(() => {
    if (!init || init.layout !== "modal") return;
    const report = () => send({ type: "resize", height: document.documentElement.scrollHeight });
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    report();
    return () => observer.disconnect();
  }, [init, send, phase.status]);

  // ---- pay ------------------------------------------------------------------

  const pay = useCallback(
    async (values: FormValues) => {
      if (phaseRef.current.status === "processing") return; // idempotent: one attempt at a time
      setPhase({ status: "processing" });
      send({ type: "dismissable", value: false });
      const result = await charge(values.number);
      send({ type: "dismissable", value: true });
      if (result.ok) {
        setPhase({ status: "succeeded", brand: detectBrand(values.number), last4: values.number.slice(-4) });
        send({ type: "success" });
      } else {
        setPhase({ status: "failed", failure: failureFor(result.code) });
        send({ type: "error", code: result.code, message: ERROR_MESSAGES[result.code], terminal: false });
      }
    },
    [send],
  );

  // ---- render -----------------------------------------------------------------

  if (phase.status === "standalone") {
    return (
      <main className="app">
        <StandaloneScreen />
      </main>
    );
  }

  const merchantName = brand?.name ?? (init ? hostLabel(init.hostOrigin) : "");
  const processing = phase.status === "processing";

  return (
    <main className="app">
      <Header name={merchantName || "Checkout"} logo={brand?.logo} onClose={requestClose} closeDisabled={processing} />
      <div className="body">
        {phase.status === "booting" || phase.status === "loading" ? (
          <Skeleton label={phase.status === "booting" ? "Connecting to the store" : "Setting up your checkout"} />
        ) : phase.status === "not_found" ? (
          <Screen key="not_found">
            <NotFoundScreen onClose={requestClose} />
          </Screen>
        ) : phase.status === "fatal" ? (
          <Screen key="fatal">
            <ProblemScreen
              title="Something went wrong opening the checkout"
              body="This is on our side, not yours. Close this and try again in a moment."
              onClose={requestClose}
            />
          </Screen>
        ) : phase.status === "failed" ? (
          <Screen key="failed">
            <FailedScreen
              failure={phase.failure}
              amount={product ? formatMoney(product.amount, product.currency) : ""}
              onRetry={() => void pay(form)}
              onChangeCard={() => {
                setForm((f) => ({ ...f, number: "", expiry: "", cvc: "" }));
                setPhase({ status: "ready", focus: "number" });
              }}
            />
          </Screen>
        ) : phase.status === "succeeded" && product ? (
          <Screen key="succeeded">
            <SuccessScreen
              amount={formatMoney(product.amount, product.currency)}
              merchantName={merchantName}
              email={form.email}
              brand={phase.brand}
              last4={phase.last4}
              onDone={() => send({ type: "close", reason: "complete" })}
            />
          </Screen>
        ) : product ? (
          <Screen key="form">
            <Summary product={product} />
            <CheckoutForm
              values={form}
              onChange={setForm}
              product={product}
              merchantName={merchantName}
              processing={processing}
              initialFocus={phase.status === "ready" ? phase.focus : "email"}
              emailPrefilled={Boolean(init?.customerEmail)}
              onPay={(values) => void pay(values)}
            />
          </Screen>
        ) : null}
      </div>
      <div className="sr-only" aria-live="assertive">
        {announce}
      </div>
    </main>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="screen">{children}</div>;
}

function hostLabel(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
