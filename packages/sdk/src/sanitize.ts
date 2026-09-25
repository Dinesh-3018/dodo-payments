/**
 * Validation for everything a host page can pass in. The SDK runs it so a
 * developer sees a warning early; the checkout runs it again because a page
 * can skip the SDK and talk to the iframe directly. Neither side trusts the
 * other with anything that ends up in CSS, an <img src>, or a header.
 */

export type Layout = "drawer" | "modal";
export type Radius = "none" | "small" | "medium" | "large";
export interface Theme {
  accent?: string;
  radius?: Radius;
  font?: string;
}
export interface Merchant {
  site?: string;
  name?: string;
  logo?: string;
}

export type Warn = (message: string) => void;
const silent: Warn = () => undefined;

export const HEX_COLOUR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FONT_FAMILY = /^[A-Za-z0-9 ,'"-]{1,120}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RADII: readonly Radius[] = ["none", "small", "medium", "large"];

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

/** https anywhere; plain http only for localhost so local demos work. */
export function sanitizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.href;
  } catch {
    /* fall through */
  }
  return undefined;
}
