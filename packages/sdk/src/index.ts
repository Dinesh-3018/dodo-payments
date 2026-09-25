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
 * Or with no JavaScript at all: put the defaults on the script tag and mark
 * any element with data-dodo-product.
 *
 *   <script src=".../sdk/dodo-checkout.js" data-layout="modal" data-accent="#1d4ed8"></script>
 *   <button data-dodo-product="prod_123" data-dodo-quantity="2">Buy</button>
 *
 * The element then receives "dodo:success", "dodo:close" and "dodo:error"
 * events (they bubble) with the same payloads the callbacks get.
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
  | "load_failed" // the checkout did not load or could not talk to this page; terminal
  | "product_not_found" // unknown productId; terminal
  | "payment_declined" // the bank said no; the customer can retry
  | "payment_failed" // a transient failure; the customer can retry
  | "authentication_failed" // the bank's extra check was declined or abandoned; the customer can retry
  | "insufficient_stock" // fewer units left than asked for; the customer can lower the quantity
  | "payment_unconfirmed" // the charge was sent but the connection dropped before the answer; outcome unknown
  | "offline" // no connection when paying; the customer can retry
  | "invalid_options"; // a data-dodo-product element was misconfigured (open() throws instead)

export interface Theme {
  /** Hex colour like "#0f766e". Used for the pay button and the focus ring, nothing else. */
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
  /** Units of the product, 1 to 99. Default 1. The customer can still change it inside the checkout. */
  quantity?: number;
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
    DodoCheckout: { open(options: OpenOptions): CheckoutHandle; readonly defaults: ScriptDefaults; readonly version: string };
  }
}

/** Defaults read from the script tag's data-* attributes. Explicit open() options win. */
export type ScriptDefaults = Partial<Pick<OpenOptions, "layout" | "theme" | "merchant">>;

// ---------------------------------------------------------------------------
// Wire protocol. Both sides check origin, source window, protocol and session.
// ---------------------------------------------------------------------------

export type Protocol = "dodo-checkout/1";
const PROTOCOL: Protocol = "dodo-checkout/1";
const LOAD_TIMEOUT_MS = 10_000;
const CLOSE_FALLBACK_MS = 1500;
const ENTRANCE_GRACE_MS = 500;
const EXIT_MS = 240;

/** Host -> checkout. */
export type InitMessage = {
  protocol: Protocol;
  type: "init";
  sessionId: string;
  productId: string;
  quantity: number;
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

const CHECKOUT_ORIGIN = typeof document === "undefined" ? "" : resolveCheckoutOrigin();


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
  const session = createSession(withDefaults(options));
  active = session;
  return session.handle;
}

function withDefaults(options: OpenOptions): OpenOptions {
  const merged: OpenOptions = { ...defaults, ...options };
  if (defaults.theme || options.theme) merged.theme = { ...defaults.theme, ...options.theme };
  if (defaults.merchant || options.merchant) merged.merchant = { ...defaults.merchant, ...options.merchant };
  return merged;
}

// ---------------------------------------------------------------------------
// Validation of everything a host can pass in. The SDK runs it so a developer
// sees a warning early; the checkout imports and runs the same functions again
// because a page can skip the SDK and talk to the iframe directly. Neither
// side trusts the other with anything that ends up in CSS, an <img src>, or a
// header.
// ---------------------------------------------------------------------------

export type Warn = (message: string) => void;
const silent: Warn = () => undefined;

export const HEX_COLOUR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FONT_FAMILY = /^[A-Za-z0-9 ,'"-]{1,120}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RADII: readonly Radius[] = ["none", "small", "medium", "large"];

export function sanitizeQuantity(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 99 ? (value as number) : 1;
}

export function sanitizeLayout(value: unknown): Layout {
  return value === "modal" ? "modal" : "drawer";
}

export function sanitizeTheme(theme: unknown, warn: Warn = silent): Theme {
  const out: Theme = {};
  if (!theme || typeof theme !== "object") return out;
  const t = theme as Record<string, unknown>;
  if (t.accent !== undefined) {
    const accent = String(t.accent).trim();
    if (HEX_COLOUR.test(accent)) out.accent = accent.toLowerCase();
    else warn(`theme.accent ${JSON.stringify(t.accent)} ignored. Use a hex colour like "#0f766e".`);
  }
  if (t.radius !== undefined) {
    if (RADII.includes(t.radius as Radius)) out.radius = t.radius as Radius;
    else warn(`theme.radius ${JSON.stringify(t.radius)} ignored. Use "none", "small", "medium" or "large".`);
  }
  if (t.font !== undefined) {
    const font = String(t.font).trim();
    if (FONT_FAMILY.test(font)) out.font = font;
    else warn("theme.font ignored. Use a plain font-family list; webfonts are not loaded.");
  }
  return out;
}

export function sanitizeMerchant(merchant: unknown, warn: Warn = silent): Merchant {
  const out: Merchant = {};
  if (!merchant || typeof merchant !== "object") return out;
  const m = merchant as Record<string, unknown>;
  if (m.name !== undefined) {
    const name = String(m.name)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim();
    if (name.length > 0 && name.length <= 40) out.name = name;
    else warn("merchant.name ignored. Use 1 to 40 characters.");
  }
  if (m.logo !== undefined) {
    const logo = sanitizeHttpUrl(m.logo);
    if (logo) out.logo = logo;
    else warn("merchant.logo ignored. Use an https URL.");
  }
  if (m.site !== undefined) {
    const site = sanitizeHttpUrl(m.site);
    if (site) out.site = site;
    else warn("merchant.site ignored. Use an https URL.");
  }
  return out;
}

export function sanitizeEmail(email: unknown): string | undefined {
  if (typeof email !== "string") return undefined;
  const value = email.trim();
  return EMAIL.test(value) && value.length <= 254 ? value : undefined;
}

/** https anywhere; plain http only for localhost so local demos work. A bare domain is read as https. */
export function sanitizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.href;
  } catch {
    /* fall through */
  }
  return undefined;
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
  if (o.quantity !== undefined && !(Number.isInteger(o.quantity) && (o.quantity as number) >= 1 && (o.quantity as number) <= 99)) {
    throw new TypeError("DodoCheckout.open: quantity must be a whole number from 1 to 99.");
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

// ---------------------------------------------------------------------------
// Declarative use: attributes on the script tag, triggers on any element.
// ---------------------------------------------------------------------------

/** What the script tag itself declared, if anything. Computed here, after the validators above exist. */
export const defaults: ScriptDefaults = typeof document === "undefined" ? {} : Object.freeze(readScriptDefaults());

function readScriptDefaults(): ScriptDefaults {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return {};
  const d = script.dataset;
  const out: ScriptDefaults = {};
  if (d.layout === "drawer" || d.layout === "modal") out.layout = d.layout;
  else if (d.layout !== undefined) warn('data-layout must be "drawer" or "modal".');
  const theme: Theme = {};
  if (d.accent !== undefined) theme.accent = d.accent;
  if (d.radius !== undefined) theme.radius = d.radius as Radius;
  if (d.font !== undefined) theme.font = d.font;
  if (Object.keys(theme).length) out.theme = sanitizeTheme(theme, warn);
  const merchant: Merchant = {};
  if (d.merchantName !== undefined) merchant.name = d.merchantName;
  if (d.merchantLogo !== undefined) merchant.logo = d.merchantLogo;
  if (d.merchantSite !== undefined) merchant.site = d.merchantSite;
  if (Object.keys(merchant).length) out.merchant = sanitizeMerchant(merchant, warn);
  return out;
}

if (typeof document !== "undefined") {
  // One delegated listener: elements added later work too, and a keyboard
  // activation of a button arrives here as a click like any other.
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-dodo-product]") : null;
    if (!target) return;
    event.preventDefault();
    const emit = (name: string, detail: unknown) => target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    const options: OpenOptions = {
      productId: target.dataset.dodoProduct ?? "",
      onSuccess: (e) => emit("dodo:success", e),
      onClose: (e) => emit("dodo:close", e),
      onError: (e) => emit("dodo:error", e),
    };
    const quantity = Number(target.dataset.dodoQuantity);
    if (target.dataset.dodoQuantity !== undefined) options.quantity = quantity;
    if (target.dataset.dodoLayout === "drawer" || target.dataset.dodoLayout === "modal") options.layout = target.dataset.dodoLayout;
    if (target.dataset.dodoEmail !== undefined) options.customerEmail = target.dataset.dodoEmail;
    try {
      open(options);
    } catch (error) {
      // A misconfigured attribute must be loud for the developer and visible to the page.
      console.error("[DodoCheckout]", error);
      emit("dodo:error", { code: "invalid_options", message: error instanceof Error ? error.message : String(error) });
    }
  });
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
  // The shadow root shields everything inside; the host element itself still
  // lives in the page, so pin the few properties a global stylesheet could use
  // to hide it or break position: fixed for its contents.
  host.setAttribute(
    "style",
    "display:block!important;position:static!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;visibility:visible!important;opacity:1!important;transform:none!important;filter:none!important;clip-path:none!important;contain:none!important;pointer-events:auto!important",
  );
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
  let succeeded = false;
  let backdropPressed = false;
  const openedAt = performance.now();

  const focusFrame = () => frame.focus();
  sentinels.forEach((s) => s.addEventListener("focus", focusFrame));

  // -- host -> checkout ------------------------------------------------------

  const post = (message: ToCheckout) => {
    frame.contentWindow?.postMessage(message, CHECKOUT_ORIGIN);
  };

  const sendInit = () => {
    const init: InitMessage = {
      protocol: PROTOCOL,
      type: "init",
      sessionId,
      productId: options.productId,
      quantity: options.quantity ?? 1,
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
        // While a payment is in flight, leaving the page is the one thing that
        // can lose the answer. Let the browser ask first.
        if (dismissable) window.removeEventListener("beforeunload", onBeforeUnload);
        else window.addEventListener("beforeunload", onBeforeUnload);
        break;
      case "nudge":
        clearTimeout(closeFallback);
        nudge();
        break;
      case "success":
        // At most once per session, whatever the checkout does.
        if (succeeded) break;
        succeeded = true;
        callHost(options.onSuccess, { sessionId });
        break;
      case "error":
        if (succeeded) break; // nothing can go wrong after the money moved
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
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  // A backdrop dismissal must be a deliberate gesture: pointer down and up on
  // the backdrop itself, and not during the entrance. The second click of a
  // double-click on Buy lands here about 100ms after open(); it is not a
  // request to close. Neither is a drag that starts in the panel and ends
  // outside it.
  backdrop.addEventListener("pointerdown", () => {
    backdropPressed = performance.now() - openedAt > ENTRANCE_GRACE_MS;
  });
  backdrop.addEventListener("click", () => {
    const deliberate = backdropPressed;
    backdropPressed = false;
    if (deliberate) requestClose();
  });
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
    window.removeEventListener("beforeunload", onBeforeUnload);
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
