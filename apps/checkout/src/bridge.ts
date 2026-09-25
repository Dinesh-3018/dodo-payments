import { sanitizeEmail, sanitizeLayout, sanitizeMerchant, sanitizeQuantity, sanitizeTheme, PRODUCT_ID } from "@dodo/sdk/sanitize";
import { PROTOCOL, type ErrorCode, type InitMessage } from "./protocol";

/** Messages the checkout sends to the host. Session and protocol are added here. */
export type Outbound =
  | { type: "resize"; height: number }
  | { type: "dismissable"; value: boolean }
  | { type: "nudge" }
  | { type: "success" }
  | { type: "error"; code: ErrorCode; message: string; terminal: boolean }
  | { type: "close"; reason: "user" | "complete" | "error" };

export interface BridgeEvents {
  onInit(init: InitMessage, hostOrigin: string): void;
  onCloseRequest(): void;
}

export interface Bridge {
  readonly embedded: boolean;
  send(message: Outbound): void;
  dispose(): void;
}

/**
 * The checkout's side of the conversation. It announces itself, accepts one
 * init from its parent window, and from then on talks only to that origin
 * with that session id. Anything else is dropped without a reply.
 *
 * The init payload is re-validated here. The SDK already did, but a page can
 * skip the SDK and post to the iframe directly, so the SDK is a convenience,
 * not a boundary.
 */
export function createBridge(events: BridgeEvents): Bridge {
  const embedded = window.parent !== window;
  let hostOrigin: string | null = null;
  let sessionId: string | null = null;

  function onMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const data = event.data as { [key: string]: unknown } | null;
    if (!data || data.protocol !== PROTOCOL) return;

    if (data.type === "init") {
      if (sessionId) return; // already initialised; ignore repeats
      if (typeof data.sessionId !== "string" || !/^cs_[a-z0-9]{8,32}$/.test(data.sessionId)) return;
      if (typeof data.productId !== "string" || !PRODUCT_ID.test(data.productId)) return;
      if (event.origin === "null") {
        // file://, data: or a sandboxed frame without allow-same-origin. We
        // could never reply safely, so say so once (nothing sensitive in it)
        // and let the SDK close with load_failed instead of trapping the customer.
        window.parent.postMessage(
          { protocol: PROTOCOL, type: "init_rejected", reason: "the page has an opaque origin (file://, data: or a sandboxed frame)" },
          "*",
        );
        return;
      }
      hostOrigin = event.origin;
      sessionId = data.sessionId;
      const init: InitMessage = {
        protocol: PROTOCOL,
        type: "init",
        sessionId,
        productId: data.productId,
        quantity: sanitizeQuantity(data.quantity),
        layout: sanitizeLayout(data.layout),
        theme: sanitizeTheme(data.theme),
        merchant: sanitizeMerchant(data.merchant),
      };
      const email = sanitizeEmail(data.customerEmail);
      if (email) init.customerEmail = email;
      window.parent.postMessage({ protocol: PROTOCOL, type: "init_ok", sessionId }, hostOrigin);
      events.onInit(init, hostOrigin);
      return;
    }

    if (event.origin !== hostOrigin || data.sessionId !== sessionId) return;
    if (data.type === "close_request") events.onCloseRequest();
  }

  if (embedded) {
    window.addEventListener("message", onMessage);
    // "ready" carries nothing sensitive, so "*" is fine here. Every later
    // message goes to the one origin that answered with init.
    window.parent.postMessage({ protocol: PROTOCOL, type: "ready" }, "*");
  }

  return {
    embedded,
    send(message) {
      if (!hostOrigin || !sessionId) return;
      window.parent.postMessage({ protocol: PROTOCOL, sessionId, ...message }, hostOrigin);
    },
    dispose() {
      window.removeEventListener("message", onMessage);
    },
  };
}
