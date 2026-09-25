import { HEX_COLOUR } from "@dodo/sdk";
import type { InitMessage, Radius } from "./protocol";

export interface ResolvedBrand {
  accent: string;
  name?: string;
  logo?: string;
  /** Where the accent came from, for the demo's honesty and for debugging. */
  accentSource: "host" | "site" | "default";
}

const DEFAULT_ACCENT = "#111827";
const BRAND_TIMEOUT_MS = 6500;

/**
 * Brand precedence: explicit values from the host, then whatever the store's
 * own site publishes, then a plain default. A failed lookup costs nothing but
 * the default.
 */
export async function resolveBrand(init: InitMessage, hostOrigin: string): Promise<ResolvedBrand> {
  const explicit: ResolvedBrand = {
    accent: init.theme.accent ?? DEFAULT_ACCENT,
    accentSource: init.theme.accent ? "host" : "default",
  };
  if (init.merchant.name) explicit.name = init.merchant.name;
  if (init.merchant.logo) explicit.logo = init.merchant.logo;

  const complete = init.theme.accent && init.merchant.name && init.merchant.logo;
  if (complete) return explicit;

  const site = init.merchant.site ?? hostOrigin;
  try {
    const response = await fetch(`/api/brand?url=${encodeURIComponent(site)}`, {
      signal: AbortSignal.timeout(BRAND_TIMEOUT_MS),
    });
    const body = (await response.json()) as
      | { ok: true; brand: { accent?: string; name?: string; logo?: string } }
      | { ok: false };
    if (!body.ok) return explicit;
    const out: ResolvedBrand = { ...explicit };
    if (!init.theme.accent && body.brand.accent && HEX_COLOUR.test(body.brand.accent)) {
      out.accent = body.brand.accent;
      out.accentSource = "site";
    }
    if (!out.name && body.brand.name) out.name = body.brand.name;
    if (!out.logo && body.brand.logo) out.logo = body.brand.logo;
    return out;
  } catch {
    return explicit;
  }
}

const RADIUS: Record<Radius, string> = { none: "6px", small: "10px", medium: "14px", large: "999px" };

export function applyTheme(accent: string, radius: Radius | undefined, font: string | undefined) {
  const style = document.documentElement.style;
  // Belt and braces: only a hex colour ever reaches a CSS variable.
  const safeAccent = HEX_COLOUR.test(accent) ? accent : DEFAULT_ACCENT;
  style.setProperty("--accent", safeAccent);
  style.setProperty("--accent-ink", readableOn(safeAccent));
  if (radius) style.setProperty("--radius", RADIUS[radius]);
  if (font) style.setProperty("--font", font);
}

/** White or near-black, whichever reads better on the accent. */
export function readableOn(hex: string): string {
  const l = luminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastDark = (l + 0.05) / 0.05;
  return contrastWhite >= contrastDark ? "#ffffff" : "#0b0f14";
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
