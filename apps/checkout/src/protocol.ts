// Single source of truth for the wire protocol is the SDK. Types only: the SDK
// never ships inside the checkout bundle.
import type { Protocol } from "@dodo/sdk";
export type { ToCheckout, FromCheckout, InitMessage, ErrorCode, Layout, Theme, Merchant, Radius } from "@dodo/sdk";
export const PROTOCOL: Protocol = "dodo-checkout/1";
