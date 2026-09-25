/**
 * Dodo Checkout SDK
 *
 * One plain script. Drop it into any page, then:
 *
 *   DodoCheckout.open({
 *     productId: "prod_123",
 *     onSuccess: ({ sessionId }) => {},
 *     onClose: ({ reason }) => {},
 *     onError: ({ code, message }) => {},
 *   });
 *
 * How it works: open() draws an overlay on the host page and puts the hosted
 * checkout inside an iframe on a different origin. Host and checkout talk over
 * postMessage with a strict origin check, a per-open session id, and a fixed
 * set of message types. Card details are typed inside the iframe and never
 * exist in the host page's DOM, memory, or network.
 *
 * The host learns four things and nothing else: that a payment succeeded
 * (session id), that something went wrong (code + message), and why the
 * checkout closed (reason). Every open() ends in exactly one onClose.
 */

import {
  sanitizeEmail,
  sanitizeMerchant,
  sanitizeTheme,
  PRODUCT_ID,
  type Layout,
  type Merchant,
  type Radius,
  type Theme,
} from "./sanitize";

export type { Layout, Merchant, Radius, Theme };

/** Why the checkout closed. Exactly one onClose fires per open(). */
export type CloseReason =
  | "user" // the customer dismissed it
  | "complete" // the customer finished after a successful payment
  | "host" // the host page called handle.close()
  | "error"; // a terminal error closed it (onError fired first)

export type ErrorCode =
  | "load_failed" // the checkout did not load or could not talk to this page; terminal
  | "product_not_found" // unknown productId; terminal
  | "payment_declined" // the bank said no; the customer can retry
  | "payment_failed" // a transient failure; the customer can retry
  | "offline"; // no connection when paying; the customer can retry

export interface OpenOptions {
  productId: string;
  /** "drawer" (default) slides in from the right. "modal" is centred. On phones the drawer is a full-height sheet and the modal a bottom sheet. */
  layout?: Layout;
  theme?: Theme;
  merchant?: Merchant;
  /** Pre-fills the email field. Still editable by the customer. */
  customerEmail?: string;
  onSuccess?: (event: { sessionId: string }) => void;
  onClose?: (event: { reason: CloseReason }) => void;
  onError?: (event: { code: ErrorCode; message: string }) => void;
}

export interface CheckoutHandle {
  readonly sessionId: string;
  /** Closes the checkout now. Fires onClose({ reason: "host" }). */
  close(): void;
}

declare global {
  interface Window {
    DodoCheckout: { open(options: OpenOptions): CheckoutHandle; readonly version: string };
  }
}

// ---------------------------------------------------------------------------
// Wire protocol. Both sides check origin, source window, protocol and session.
// ---------------------------------------------------------------------------

export type Protocol = "dodo-checkout/1";
const PROTOCOL: Protocol = "dodo-checkout/1";
const LOAD_TIMEOUT_MS = 10_000;
const CLOSE_FALLBACK_MS = 1500;
const EXIT_MS = 240;

/** Host -> checkout. */
export type InitMessage = {
  protocol: Protocol;
  type: "init";
  sessionId: string;
  productId: string;
  layout: Layout;
  theme: Theme;
  merchant: Merchant;
  customerEmail?: string;
};
export type ToCheckout = InitMessage | { protocol: Protocol; type: "close_request"; sessionId: string };

/** Checkout -> host. */
export type FromCheckout =
  | { protocol: Protocol; type: "ready" }
  | { protocol: Protocol; type: "init_rejected"; reason: string }
  | { protocol: Protocol; type: "init_ok"; sessionId: string }
  | { protocol: Protocol; type: "resize"; sessionId: string; height: number }
  | { protocol: Protocol; type: "dismissable"; sessionId: string; value: boolean }
  | { protocol: Protocol; type: "nudge"; sessionId: string }
  | { protocol: Protocol; type: "success"; sessionId: string }
  | { protocol: Protocol; type: "error"; sessionId: string; code: ErrorCode; message: string; terminal: boolean }
  | { protocol: Protocol; type: "close"; sessionId: string; reason: "user" | "complete" | "error" };

export const version = "0.1.0";

const CHECKOUT_ORIGIN = resolveCheckoutOrigin();

let active: { handle: CheckoutHandle; focus(): void } | null = null;

/**
 * Opens the checkout. Throws a TypeError synchronously for programmer errors
 * (missing productId, callback that is not a function) so mistakes surface in
 * development rather than as a silent no-op in production.
 *
 * Calling open() while a checkout is already open returns the existing handle
 * and refocuses it. A double-click on Buy therefore opens one checkout.
 */
export function open(options: OpenOptions): CheckoutHandle {
  validateOptions(options);
  if (active) {
    console.info("[DodoCheckout] open() called while a checkout is open; returning the existing one.");
    active.focus();
    return active.handle;
  }
  const session = createSession(options);
  active = session;
  return session.handle;
}

// ---------------------------------------------------------------------------

function createSession(options: OpenOptions): { handle: CheckoutHandle; focus(): void } {
  const sessionId = newSessionId();
  const layout: Layout = options.layout ?? "drawer";
  const theme = sanitizeTheme(options.theme, warn);
  const merchant = sanitizeMerchant(options.merchant, warn);
  const customerEmail = sanitizeEmail(options.customerEmail);

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previousOverflow = document.body.style.overflow;

  // Everything lives in a closed shadow root so host CSS cannot restyle the
  // overlay and our styles cannot leak into the host page.
  const host = document.createElement("div");
  host.setAttribute("data-dodo-checkout", sessionId);
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>${STYLES}</style>
    <div class="root" role="dialog" aria-modal="true" aria-label="Checkout">
      <div class="backdrop"></div>
      <div tabindex="0" class="sentinel" aria-hidden="true"></div>
      <div class="panel ${layout}">
        <div class="loading" aria-live="polite">
          <div class="spinner"></div>
          <div>Opening secure checkout</div>
        </div>
        <iframe class="frame" title="Secure checkout" referrerpolicy="strict-origin" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
      </div>
      <div tabindex="0" class="sentinel" aria-hidden="true"></div>
    </div>`;

  const root = shadow.querySelector<HTMLElement>(".root")!;
  const backdrop = shadow.querySelector<HTMLElement>(".backdrop")!;
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  const frame = shadow.querySelector<HTMLIFrameElement>(".frame")!;
  const sentinels = shadow.querySelectorAll<HTMLElement>(".sentinel");

  let closed = false;
  let ready = false;
  let dismissable = true;
  let closeFallback = 0;

  const focusFrame = () => frame.focus();
  sentinels.forEach((s) => s.addEventListener("focus", focusFrame));

  // -- host -> checkout ------------------------------------------------------

  const post = (message: ToCheckout) => {
    frame.contentWindow?.postMessage(message, CHECKOUT_ORIGIN);
  };

  const sendInit = () => {
    const init: InitMessage = { protocol: PROTOCOL, type: "init", sessionId, productId: options.productId, layout, theme, merchant };
    if (customerEmail) init.customerEmail = customerEmail;
    post(init);
  };

  // -- checkout -> host ------------------------------------------------------

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== CHECKOUT_ORIGIN) return;
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { [key: string]: unknown } | null;
    if (!data || data.protocol !== PROTOCOL) return;

    if (data.type === "ready") {
      sendInit(); // idempotent: the checkout may announce itself more than once
      return;
    }
    if (data.type === "init_rejected") {
      finish("error", () =>
        callHost(options.onError, {
          code: "load_failed",
          message: `The checkout cannot talk to this page: ${String(data.reason ?? "unknown reason")}`,
        }),
      );
      return;
    }
    if (data.sessionId !== sessionId) return;
    const message = data as unknown as FromCheckout;

    switch (message.type) {
      case "init_ok":
        // Only now is the checkout really usable. Until here the load timer runs.
        if (!ready) {
          ready = true;
          clearTimeout(loadTimer);
          root.classList.add("is-ready");
          focusFrame();
        }
        break;
      case "resize":
        if (typeof message.height === "number" && message.height > 0) {
          panel.style.setProperty("--h", `${Math.ceil(message.height)}px`);
        }
        break;
      case "dismissable":
        // The checkout is alive and telling us its state; a pending fallback
        // close would be acting on stale information.
        dismissable = message.value === true;
        clearTimeout(closeFallback);
        break;
      case "nudge":
        clearTimeout(closeFallback);
        nudge();
        break;
      case "success":
        callHost(options.onSuccess, { sessionId });
        break;
      case "error":
        if (typeof message.code === "string" && typeof message.message === "string") {
          callHost(options.onError, { code: message.code, message: message.message });
        }
        break;
      case "close":
        finish(message.reason === "complete" || message.reason === "error" ? message.reason : "user");
        break;
    }
  };

  // -- dismissal -------------------------------------------------------------

  const nudge = () => {
    panel.classList.remove("nudge");
    void panel.offsetWidth; // restart the animation
    panel.classList.add("nudge");
  };

  // The customer asks to close. The checkout decides (it refuses mid-payment).
  // If the checkout never answers, the SDK closes anyway rather than trap anyone.
  const requestClose = () => {
    if (closed) return;
    if (!ready) {
      finish("user");
      return;
    }
    if (!dismissable) {
      nudge();
      return;
    }
    post({ protocol: PROTOCOL, type: "close_request", sessionId });
    clearTimeout(closeFallback);
    closeFallback = window.setTimeout(() => {
      if (!closed && dismissable) finish("user");
    }, CLOSE_FALLBACK_MS);
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") requestClose();
  };
  backdrop.addEventListener("click", requestClose);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("message", onMessage);

  const loadTimer = window.setTimeout(() => {
    if (ready || closed) return;
    finish("error", () =>
      callHost(options.onError, {
        code: "load_failed",
        message: "The checkout did not load. Check your connection and try again.",
      }),
    );
  }, LOAD_TIMEOUT_MS);

  // -- teardown --------------------------------------------------------------

  /**
   * Everything the host page can observe is restored synchronously, so a host
   * that closes and immediately reopens gets a clean slate. Only the exit
   * animation, the DOM removal and onClose are deferred.
   */
  function finish(reason: CloseReason, beforeClose?: () => void) {
    if (closed) return;
    closed = true;
    clearTimeout(loadTimer);
    clearTimeout(closeFallback);
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKeydown);
    root.classList.remove("is-open");
    root.classList.add("is-exiting");
    document.body.style.overflow = previousOverflow;
    active = null;
    previouslyFocused?.focus();
    beforeClose?.();
    window.setTimeout(() => {
      host.remove();
      callHost(options.onClose, { reason });
    }, prefersReducedMotion() ? 0 : EXIT_MS);
  }

  // -- mount -----------------------------------------------------------------

  document.body.style.overflow = "hidden";
  document.body.appendChild(host);
  frame.src = `${CHECKOUT_ORIGIN}/`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!closed) root.classList.add("is-open");
    }),
  );

  const handle: CheckoutHandle = Object.freeze({
    sessionId,
    close: () => finish("host"),
  });

  return { handle, focus: focusFrame };
}

// ---------------------------------------------------------------------------
// Validation. Programmer errors throw; bad brand values are dropped with a warning.
// ---------------------------------------------------------------------------

function validateOptions(options: unknown): asserts options is OpenOptions {
  if (!options || typeof options !== "object") {
    throw new TypeError("DodoCheckout.open(options): an options object is required.");
  }
  const o = options as Record<string, unknown>;
  if (typeof o.productId !== "string" || !PRODUCT_ID.test(o.productId)) {
    throw new TypeError('DodoCheckout.open: productId must be a string like "prod_123".');
  }
  for (const key of ["onSuccess", "onClose", "onError"] as const) {
    if (o[key] !== undefined && typeof o[key] !== "function") {
      throw new TypeError(`DodoCheckout.open: ${key} must be a function.`);
    }
  }
  if (o.layout !== undefined && o.layout !== "drawer" && o.layout !== "modal") {
    throw new TypeError('DodoCheckout.open: layout must be "drawer" or "modal".');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCheckoutOrigin(): string {
  // The script decides where the checkout lives, not the host. A host cannot
  // point the SDK at a look-alike checkout by passing a URL.
  const script = document.currentScript;
  if (script instanceof HTMLScriptElement && script.src) {
    return new URL(script.src, location.href).origin;
  }
  return location.origin;
}

function newSessionId(): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `cs_${raw.slice(0, 24)}`;
}

function callHost<T>(callback: ((event: T) => void) | undefined, event: T) {
  if (!callback) return;
  try {
    callback(event);
  } catch (error) {
    // A throwing host callback must not break the checkout or swallow later events.
    console.error("[DodoCheckout] a callback threw:", error);
  }
}

function warn(message: string) {
  console.warn(`[DodoCheckout] ${message}`);
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------
// Overlay styles. Scoped to the shadow root.
// ---------------------------------------------------------------------------

const STYLES = `
:host { all: initial; }
.root {
  position: fixed; inset: 0; z-index: 2147483647;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --surface: #f5f5f5;
}
.root.is-exiting { pointer-events: none; }
.backdrop {
  position: absolute; inset: 0; background: rgba(10, 10, 10, 0.42);
  opacity: 0; transition: opacity 240ms ease;
}
.root.is-open .backdrop { opacity: 1; }
.sentinel { position: fixed; width: 1px; height: 1px; opacity: 0; }
.panel {
  position: absolute; background: var(--surface); overflow: hidden;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.04), 0 32px 80px -24px rgba(0, 0, 0, 0.45);
}
/* The drawer floats off the edge like a sheet, not a sidebar glued to the window. */
.panel.drawer {
  top: 12px; right: 12px; bottom: 12px; width: min(440px, calc(100vw - 24px));
  border-radius: 28px;
  transform: translateX(calc(100% + 24px));
  transition: transform 360ms var(--ease);
}
.root.is-open .panel.drawer { transform: none; }
.panel.modal {
  left: 50%; top: 50%; width: min(440px, calc(100vw - 32px));
  height: min(var(--h, 600px), calc(100vh - 32px));
  height: min(var(--h, 600px), calc(100dvh - 32px));
  border-radius: 28px; opacity: 0;
  transform: translate(-50%, -50%) scale(0.96);
  transition: transform 260ms var(--ease), opacity 200ms ease, height 220ms var(--ease);
}
.root.is-open .panel.modal { opacity: 1; transform: translate(-50%, -50%) scale(1); }
@media (max-width: 640px) {
  .panel.drawer {
    top: 0; right: 0; bottom: 0; width: 100vw; border-radius: 0;
    transform: translateY(100%);
  }
  .panel.modal {
    left: 0; top: auto; bottom: 0; width: 100vw; opacity: 1;
    height: min(var(--h, 600px), 92vh);
    height: min(var(--h, 600px), 92dvh);
    border-radius: 24px 24px 0 0;
    transform: translateY(100%);
  }
  .root.is-open .panel.modal { transform: none; }
}
.panel.nudge { animation: nudge 360ms var(--ease); }
@keyframes nudge {
  0%, 100% { translate: 0 0; }
  30% { translate: -6px 0; }
  60% { translate: 4px 0; }
}
.frame {
  display: block; width: 100%; height: 100%; border: 0; background: transparent;
  opacity: 0; transition: opacity 220ms ease;
}
.root.is-ready .frame { opacity: 1; }
.loading {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 14px;
  color: #737373; font-size: 14px;
}
.root.is-ready .loading { display: none; }
.spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid #e0e0e0; border-top-color: #0a0a0a;
  animation: spin 800ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .backdrop, .panel, .frame { transition: none !important; }
  .panel.nudge { animation: none; }
}
`;
