import { useCallback, useEffect, useRef, useState } from "react";
import { createBridge, type Bridge } from "./bridge";
import type { InitMessage } from "./protocol";
import { fetchProduct, maxQuantity, perkProgress, STORE_PERKS, type Product } from "./catalog";
import { awaitOutcome, completeChallenge, isOffline, submitPayment, type ChargeFailure } from "./gateway";
import { rain } from "./confetti";
import { applyTheme, resolveBrand, type ResolvedBrand } from "./theme";
import { formatMoney } from "./money";
import { detectBrand, type CardBrand } from "./card";
import { Header } from "./components/Header";
import { Summary } from "./components/Summary";
import { CheckoutForm, emptyForm, type FormValues } from "./components/CheckoutForm";
import { FailedScreen, failureFor, type Failure } from "./components/FailedScreen";
import { SuccessScreen } from "./components/SuccessScreen";
import { ChallengeScreen } from "./components/ChallengeScreen";
import { NotFoundScreen, ProblemScreen, Skeleton, StandaloneScreen } from "./components/Screens";

type Phase =
  | { status: "standalone" }
  | { status: "booting" }
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "fatal" }
  | { status: "ready"; focus: keyof FormValues }
  | { status: "processing"; paymentId: string }
  | { status: "challenge"; paymentId: string }
  | { status: "unconfirmed"; paymentId: string }
  | { status: "failed"; failure: Failure }
  | { status: "succeeded"; brand: CardBrand; last4: string }
  | { status: "expired" };

const ERROR_MESSAGES: Record<ChargeFailure | "offline", string> = {
  payment_declined: "The customer's bank declined the card. The customer can retry or use another card.",
  payment_failed: "A transient processing error stopped the payment. The customer can retry.",
  authentication_failed: "The bank's extra check was declined or abandoned. The customer can retry.",
  insufficient_stock: "Fewer units are left than the customer asked for. The customer can lower the quantity.",
  offline: "The customer's device was offline when paying. Nothing was sent; the customer can retry.",
};

const IDLE_LIMIT_MS = 20 * 60 * 1000;
const UNCONFIRMED_AFTER_MS = 12_000;

export function App() {
  const [phase, setPhase] = useState<Phase>(() => (window.parent === window ? { status: "standalone" } : { status: "booting" }));
  const [init, setInit] = useState<(InitMessage & { hostOrigin: string }) | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [brand, setBrand] = useState<ResolvedBrand | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [quantity, setQuantity] = useState(1);
  const [announce, setAnnounce] = useState("");
  const [waitingForNetwork, setWaitingForNetwork] = useState(false);

  const bridge = useRef<Bridge | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const quantityRef = useRef(quantity);
  quantityRef.current = quantity;
  const declines = useRef(0);
  const lastActivity = useRef(performance.now());

  // ---- talk to the host --------------------------------------------------

  const send = useCallback((message: Parameters<Bridge["send"]>[0]) => bridge.current?.send(message), []);

  const say = useCallback((text: string) => {
    setAnnounce("");
    setTimeout(() => setAnnounce(text), 0);
  }, []);

  const requestClose = useCallback(() => {
    const current = phaseRef.current;
    switch (current.status) {
      case "processing":
        // Hold the line, but never silently: shake the panel and say why.
        send({ type: "nudge" });
        say("Hang on, we're confirming your payment.");
        return;
      case "challenge":
        // Closing the bank's check is the same as failing it.
        completeChallenge(current.paymentId, false);
        setPhase({ status: "processing", paymentId: current.paymentId });
        return;
      case "unconfirmed":
        // The host must know the outcome is unknown before we go.
        send({ type: "error", code: "payment_unconfirmed", message: "The charge was sent but the connection dropped before the answer. Outcome unknown; check by session id.", terminal: false });
        send({ type: "close", reason: "user" });
        return;
      case "standalone":
        return;
      case "not_found":
      case "fatal":
        send({ type: "close", reason: "error" });
        return;
      case "succeeded":
        send({ type: "close", reason: "complete" });
        return;
      default:
        send({ type: "close", reason: "user" });
    }
  }, [send, say]);

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
        setQuantity(Math.min(maxQuantity(p), Math.max(1, init.quantity)));
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

  // ---- idle: a checkout left open for a long time expires ------------------

  useEffect(() => {
    const touch = () => (lastActivity.current = performance.now());
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const timer = setInterval(() => {
      const s = phaseRef.current.status;
      if ((s === "ready" || s === "failed") && performance.now() - lastActivity.current > IDLE_LIMIT_MS) {
        setPhase({ status: "expired" });
      }
    }, 30_000);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      clearInterval(timer);
    };
  }, []);

  // ---- perks: celebrate when one is earned, and once on open if already earned ---

  const total = product ? product.amount * quantity : 0;
  const progress = perkProgress(total, STORE_PERKS);
  const seenUnlocked = useRef<number | null>(null);
  useEffect(() => {
    if (phase.status !== "ready") return;
    if (seenUnlocked.current === null) {
      seenUnlocked.current = progress.unlocked;
      if (progress.unlocked > 0) {
        const timer = setTimeout(() => rain(), 450); // let the panel finish sliding in
        return () => clearTimeout(timer);
      }
      return;
    }
    if (progress.unlocked > seenUnlocked.current) rain();
    seenUnlocked.current = progress.unlocked;
    return;
  }, [phase.status, progress.unlocked]);

  // ---- pay ------------------------------------------------------------------

  const fail = useCallback(
    (code: ChargeFailure | "offline") => {
      if (code === "payment_declined") declines.current += 1;
      setPhase({ status: "failed", failure: failureFor(code, declines.current, product?.stock ?? 0) });
      send({ type: "error", code, message: ERROR_MESSAGES[code], terminal: false });
    },
    [product, send],
  );

  const settle = useCallback(
    async (paymentId: string, values: FormValues) => {
      let unconfirmedTimer = 0;
      const outcome = await awaitOutcome(paymentId, (waiting) => {
        setWaitingForNetwork(waiting);
        clearTimeout(unconfirmedTimer);
        if (waiting) {
          // After a while offline, stop pretending a spinner will fix it.
          unconfirmedTimer = window.setTimeout(() => {
            if (phaseRef.current.status === "processing") {
              setPhase({ status: "unconfirmed", paymentId });
              send({ type: "dismissable", value: true });
            }
          }, UNCONFIRMED_AFTER_MS);
        }
      });
      clearTimeout(unconfirmedTimer);
      setWaitingForNetwork(false);
      send({ type: "dismissable", value: true });
      if (outcome.ok) {
        setPhase({ status: "succeeded", brand: detectBrand(values.number), last4: values.number.slice(-4) });
        send({ type: "success" });
      } else {
        fail(outcome.code);
      }
    },
    [fail, send],
  );

  const pay = useCallback(
    async (values: FormValues, qty = quantityRef.current) => {
      const current = phaseRef.current.status;
      if (current === "processing" || current === "challenge" || !product) return; // one attempt at a time
      if (isOffline()) {
        fail("offline"); // nothing was sent, so retrying is safe
        return;
      }
      const { id, challenge } = submitPayment(values.number, qty, product.stock);
      send({ type: "dismissable", value: false });
      if (challenge) {
        setPhase({ status: "challenge", paymentId: id });
        return;
      }
      setPhase({ status: "processing", paymentId: id });
      await settle(id, values);
    },
    [product, fail, send, settle],
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
  const totalLabel = product ? formatMoney(total, product.currency) : "";

  const orderCard = product ? (
    <Summary
      product={product}
      quantity={quantity}
      onQuantityChange={(q) => setQuantity(Math.min(maxQuantity(product), Math.max(1, q)))}
      perks={STORE_PERKS}
      progress={progress}
      disabled={phase.status !== "ready"}
    />
  ) : null;

  return (
    <main className="app">
      <Header name={merchantName || "Checkout"} logo={brand?.logo} onClose={requestClose} closeDisabled={processing} />
      <div className="body">
        {phase.status === "booting" || phase.status === "loading" ? (
          <Skeleton label={phase.status === "booting" ? "Connecting to the store" : "Matching the store's look"} />
        ) : phase.status === "not_found" ? (
          <Screen key="not_found">
            <NotFoundScreen onClose={requestClose} />
          </Screen>
        ) : phase.status === "fatal" ? (
          <Screen key="fatal">
            <ProblemScreen
              title="Something went wrong opening the checkout"
              body="This is on our side, not yours. Close this and try again in a moment."
              primary={{ label: "Close", onClick: requestClose }}
            />
          </Screen>
        ) : phase.status === "expired" ? (
          <Screen key="expired">
            <ProblemScreen
              icon="neutral"
              title="This checkout timed out"
              body="It sat open for a while, so we cleared the card details to keep them safe. Start again to continue."
              primary={{
                label: "Start again",
                onClick: () => {
                  declines.current = 0;
                  setForm((f) => ({ ...f, number: "", expiry: "", cvc: "" }));
                  setPhase({ status: "ready", focus: "number" });
                },
              }}
              secondary={{ label: "Close", onClick: requestClose }}
            />
          </Screen>
        ) : phase.status === "unconfirmed" ? (
          <Screen key="unconfirmed">
            {orderCard}
            <ProblemScreen
              icon="neutral"
              title="We couldn't confirm your payment yet"
              body="Your connection dropped after the charge was sent. Don't pay again. The moment you're back online, the result appears here."
              status={{ label: "Waiting for your connection", ok: false }}
              primary={{
                label: "Check again",
                onClick: () => {
                  if (!isOffline()) setPhase({ status: "processing", paymentId: phase.paymentId });
                },
              }}
              secondary={{ label: "Close for now", onClick: requestClose }}
            />
          </Screen>
        ) : phase.status === "challenge" && product ? (
          <Screen key="challenge">
            <ChallengeScreen
              amount={totalLabel}
              merchantName={merchantName}
              onApprove={() => {
                completeChallenge(phase.paymentId, true);
                setPhase({ status: "processing", paymentId: phase.paymentId });
                void settle(phase.paymentId, form);
              }}
              onDecline={() => {
                completeChallenge(phase.paymentId, false);
                setPhase({ status: "processing", paymentId: phase.paymentId });
                void settle(phase.paymentId, form);
              }}
            />
          </Screen>
        ) : phase.status === "failed" && product ? (
          <Screen key="failed">
            {orderCard}
            <FailedScreen
              failure={phase.failure}
              amount={totalLabel}
              brand={detectBrand(form.number)}
              last4={form.number.slice(-4)}
              onRetry={() => {
                if (phase.failure.code === "insufficient_stock") {
                  const qty = maxQuantity(product);
                  setQuantity(qty);
                  void pay(form, qty);
                } else {
                  void pay(form);
                }
              }}
              onChangeCard={() => {
                declines.current = 0;
                setForm((f) => ({ ...f, number: "", expiry: "", cvc: "" }));
                setPhase({ status: "ready", focus: "number" });
              }}
            />
          </Screen>
        ) : phase.status === "succeeded" && product ? (
          <Screen key="succeeded">
            <SuccessScreen
              amount={totalLabel}
              merchantName={merchantName}
              email={form.email}
              brand={phase.brand}
              last4={phase.last4}
              onDone={() => send({ type: "close", reason: "complete" })}
            />
          </Screen>
        ) : product ? (
          <Screen key="form">
            {orderCard}
            <CheckoutForm
              values={form}
              onChange={setForm}
              total={totalLabel}
              merchantName={merchantName}
              processing={processing}
              waitingForNetwork={waitingForNetwork}
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
