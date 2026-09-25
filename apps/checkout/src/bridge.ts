import { PROTOCOL, type ErrorCode, type InitMessage } from "./protocol";

/** Messages the checkout sends to the host. Session and protocol are added here. */
export type Outbound =
  | { type: "resize"; height: number }
  | { type: "dismissable"; value: boolean }
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
      if (typeof data.sessionId !== "string" || typeof data.productId !== "string") return;
      if (event.origin === "null") return; // opaque origin (file://); no safe reply target
      hostOrigin = event.origin;
      sessionId = data.sessionId;
      events.onInit(data as unknown as InitMessage, hostOrigin);
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
