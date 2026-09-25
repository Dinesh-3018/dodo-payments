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

export type Layout = "drawer" | "modal";
export type Radius = "none" | "small" | "medium" | "large";

/** Why the checkout closed. Exactly one onClose fires per open(). */
export type CloseReason =
  | "user" // the customer dismissed it
  | "complete" // the customer finished after a successful payment
  | "host" // the host page called handle.close()
  | "error"; // a terminal error closed it (onError fired first)

export type ErrorCode =
  | "load_failed" // the checkout did not load; terminal
  | "product_not_found" // unknown productId; terminal
  | "payment_declined" // the bank said no; the customer can retry
  | "payment_failed" // a transient failure; the customer can retry
  | "offline"; // no connection when paying; the customer can retry

export interface Theme {
  /** Hex colour like "#0f766e". Used for the pay button and focus ring. */
  accent?: string;
  radius?: Radius;
  /** A font-family string. System fonts only; nothing is downloaded. */
  font?: string;
}

export interface Merchant {
  /**
   * The store's URL. The checkout reads the store's accent colour, name and
   * logo from it so the checkout matches the site with no configuration.
   * Defaults to the page the checkout is opened on. Explicit values below win.
   */
  site?: string;
  /** Shown in the checkout header. Max 40 characters. */
  name?: string;
  /** https URL of a square logo. */
  logo?: string;
}

export interface OpenOptions {
  productId: string;
  /** "drawer" (default) slides in from the right. "modal" is centred. Both become a full-height sheet on phones. */
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
  | { protocol: Protocol; type: "resize"; sessionId: string; height: number }
  | { protocol: Protocol; type: "dismissable"; sessionId: string; value: boolean }
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
  const theme = sanitizeTheme(options.theme);
  const merchant = sanitizeMerchant(options.merchant);
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
      <div class="backdrop" part="backdrop"></div>
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

  const focusFrame = () => frame.focus();
  sentinels.forEach((s) => s.addEventListener("focus", focusFrame));

  // -- host -> checkout ------------------------------------------------------

  const post = (message: ToCheckout) => {
    frame.contentWindow?.postMessage(message, CHECKOUT_ORIGIN);
  };

  const sendInit = () => {
    const init: ToCheckout = {
      protocol: PROTOCOL,
      type: "init",
      sessionId,
      productId: options.productId,
      layout,
      theme,
      merchant,
    };
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
      // Idempotent: the checkout may announce itself more than once.
      sendInit();
      if (!ready) {
        ready = true;
        clearTimeout(loadTimer);
        root.classList.add("is-ready");
        focusFrame();
      }
      return;
    }
    if (data.sessionId !== sessionId) return;
    const message = data as unknown as FromCheckout;

    switch (message.type) {
      case "resize":
        if (typeof message.height === "number" && message.height > 0) {
          panel.style.setProperty("--h", `${Math.ceil(message.height)}px`);
        }
        break;
      case "dismissable":
        dismissable = message.value === true;
        root.classList.toggle("is-locked", !dismissable);
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

  // The customer asks to close. The checkout decides (it refuses mid-payment).
  const requestClose = () => {
    if (closed) return;
    if (!ready) {
      finish("user");
      return;
    }
    if (!dismissable) {
      panel.classList.remove("nudge");
      void panel.offsetWidth; // restart the animation
      panel.classList.add("nudge");
      return;
    }
    post({ protocol: PROTOCOL, type: "close_request", sessionId });
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") requestClose();
  };
  backdrop.addEventListener("click", requestClose);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("message", onMessage);

  const loadTimer = window.setTimeout(() => {
    if (ready || closed) return;
    callHost(options.onError, {
      code: "load_failed",
      message: "The checkout did not load. Check your connection and try again.",
    });
    finish("error");
  }, LOAD_TIMEOUT_MS);

  // -- teardown --------------------------------------------------------------

  function finish(reason: CloseReason) {
    if (closed) return;
    closed = true;
    clearTimeout(loadTimer);
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKeydown);
    root.classList.remove("is-open");
    // Release the singleton before telling the host, so a host that reopens
    // inside onClose gets a fresh checkout rather than the dying one.
    active = null;
    window.setTimeout(() => {
      host.remove();
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
      callHost(options.onClose, { reason });
    }, prefersReducedMotion() ? 0 : EXIT_MS);
  }

  // -- mount -----------------------------------------------------------------

  document.body.style.overflow = "hidden";
  document.body.appendChild(host);
  frame.src = `${CHECKOUT_ORIGIN}/`;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-open")));

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
  if (typeof o.productId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(o.productId)) {
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

function sanitizeTheme(theme: Theme | undefined): Theme {
  const out: Theme = {};
  if (!theme || typeof theme !== "object") return out;
  if (theme.accent !== undefined) {
    const accent = String(theme.accent).trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) out.accent = accent.toLowerCase();
    else warn(`theme.accent ${JSON.stringify(theme.accent)} ignored. Use a hex colour like "#0f766e".`);
  }
  if (theme.radius !== undefined) {
    if (["none", "small", "medium", "large"].includes(theme.radius)) out.radius = theme.radius;
    else warn(`theme.radius ${JSON.stringify(theme.radius)} ignored. Use "none", "small", "medium" or "large".`);
  }
  if (theme.font !== undefined) {
    const font = String(theme.font).trim();
    if (/^[A-Za-z0-9 ,'"-]{1,120}$/.test(font)) out.font = font;
    else warn("theme.font ignored. Use a plain font-family list; webfonts are not loaded.");
  }
  return out;
}

function sanitizeMerchant(merchant: Merchant | undefined): Merchant {
  const out: Merchant = {};
  if (!merchant || typeof merchant !== "object") return out;
  if (merchant.name !== undefined) {
    const name = String(merchant.name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (name.length > 0 && name.length <= 40) out.name = name;
    else warn("merchant.name ignored. Use 1 to 40 characters.");
  }
  if (merchant.logo !== undefined) {
    const logo = sanitizeUrl(merchant.logo);
    if (logo) out.logo = logo;
    else warn("merchant.logo ignored. Use an https URL.");
  }
  if (merchant.site !== undefined) {
    const site = sanitizeUrl(merchant.site);
    if (site) out.site = site;
    else warn("merchant.site ignored. Use an https URL.");
  }
  return out;
}

function sanitizeUrl(value: unknown): string | undefined {
  try {
    const url = new URL(String(value));
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.href;
  } catch {
    /* fall through */
  }
  return undefined;
}

function sanitizeEmail(email: unknown): string | undefined {
  if (typeof email !== "string") return undefined;
  const value = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254 ? value : undefined;
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
}
.backdrop {
  position: absolute; inset: 0; background: rgba(10, 13, 18, 0.5);
  opacity: 0; transition: opacity 220ms ease;
}
.root.is-open .backdrop { opacity: 1; }
.sentinel { position: fixed; width: 1px; height: 1px; opacity: 0; }
.panel {
  position: absolute; background: #ffffff; overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
}
.panel.drawer {
  top: 0; right: 0; bottom: 0; width: min(440px, 100vw);
  transform: translateX(100%);
  transition: transform 320ms var(--ease);
}
.root.is-open .panel.drawer { transform: none; }
.panel.modal {
  left: 50%; top: 50%; width: min(440px, calc(100vw - 32px));
  height: min(var(--h, 600px), calc(100vh - 32px));
  height: min(var(--h, 600px), calc(100dvh - 32px));
  border-radius: 16px; opacity: 0;
  transform: translate(-50%, -50%) scale(0.97);
  transition: transform 240ms var(--ease), opacity 180ms ease, height 200ms var(--ease);
}
.root.is-open .panel.modal { opacity: 1; transform: translate(-50%, -50%) scale(1); }
@media (max-width: 640px) {
  .panel.drawer { width: 100vw; transform: translateY(100%); }
  .panel.modal {
    left: 0; top: auto; bottom: 0; width: 100vw; opacity: 1;
    height: min(var(--h, 600px), 92vh);
    height: min(var(--h, 600px), 92dvh);
    border-radius: 16px 16px 0 0;
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
  opacity: 0; transition: opacity 200ms ease;
}
.root.is-ready .frame { opacity: 1; }
.loading {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  color: #6b7280; font-size: 14px;
}
.root.is-ready .loading { display: none; }
.spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid #e5e7eb; border-top-color: #111827;
  animation: spin 800ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .backdrop, .panel, .frame { transition: none !important; }
  .panel.nudge { animation: none; }
}
`;
