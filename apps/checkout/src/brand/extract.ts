/**
 * Reads a store's brand from its public homepage: an accent colour, a name and
 * a logo. No headless browser, no CSS engine. It looks at the signals a site
 * already publishes for exactly this purpose (theme-color, og:site_name, touch
 * icons) and at the colours the site's own CSS uses for buttons and brand
 * variables. Heuristic by design: a wrong guess costs a plain default, not a
 * broken checkout.
 */

export interface Brand {
  accent?: string;
  name?: string;
  logo?: string;
  /** Runner-up accent candidates, best first. */
  palette: string[];
  /** The URL that was actually read after redirects. */
  from: string;
}

export type BrandErrorCode = "invalid_url" | "blocked_host" | "fetch_failed" | "not_html";

export class BrandError extends Error {
  readonly code: BrandErrorCode;
  constructor(code: BrandErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const MAX_HTML_BYTES = 1_000_000;
const MAX_CSS_BYTES = 400_000;
const MAX_SHEETS = 3;
const TIMEOUT_MS = 5000;
const USER_AGENT = "DodoCheckoutBrandReader/0.1 (+https://dodopayments.com)";

const BRAND_VAR = /--([a-z0-9_-]*(?:primary|brand|accent|button|btn|cta|highlight|theme)[a-z0-9_-]*)\s*:\s*([^;}]+)/gi;
const BUTTON_SELECTOR = /(button|\.btn\b|\.button\b|\bbtn-|\bbutton-|\[type=["']?submit|add-to-cart|checkout)/i;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const RGB = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/gi;
const TRIPLET = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/;

export interface ExtractOptions {
  /** Allow localhost and private ranges. Dev only. */
  allowPrivate?: boolean;
  fetchImpl?: typeof fetch;
}

export async function extractBrand(input: string, options: ExtractOptions = {}): Promise<Brand> {
  const url = parseTarget(input, options.allowPrivate === true);
  const doFetch = options.fetchImpl ?? fetch;

  const page = await getText(doFetch, url, MAX_HTML_BYTES, "text/html");
  if (!page.ok) throw new BrandError("fetch_failed", `Could not read ${url.origin}.`);
  if (!/<(html|head|body|meta|link)\b/i.test(page.text.slice(0, 5000))) {
    throw new BrandError("not_html", `${url.origin} did not return an HTML page.`);
  }
  const base = new URL(page.finalUrl);
  const html = page.text;

  const name = pickName(html);
  const logo = pickLogo(html, base);

  // CSS: inline <style> blocks plus a few linked stylesheets, size-capped.
  let css = collectInlineCss(html);
  const sheets = collectStylesheetUrls(html, base).slice(0, MAX_SHEETS);
  const fetched = await Promise.all(
    sheets.map((href) => getText(doFetch, new URL(href), MAX_CSS_BYTES, "text/css").catch(() => null)),
  );
  for (const sheet of fetched) if (sheet?.ok) css += "\n" + sheet.text;
  // Inline style attributes on buttons are a weak but real signal.
  css += "\n" + collectInlineStyleAttributes(html);

  const themeColor = pickThemeColor(html);
  const ranked = rankColours(css, themeColor);

  const brand: Brand = { palette: ranked.slice(1, 6), from: base.href };
  const best = ranked[0];
  if (best) brand.accent = best;
  if (name) brand.name = name;
  if (logo) brand.logo = logo;
  return brand;
}

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

function parseTarget(input: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new BrandError("invalid_url", "Give a full URL like https://example.com.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BrandError("invalid_url", "Only http and https URLs are read.");
  }
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw new BrandError("blocked_host", "Local and private addresses are not read.");
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  return url;
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function getText(
  doFetch: typeof fetch,
  url: URL,
  maxBytes: number,
  accept: string,
): Promise<{ ok: boolean; text: string; finalUrl: string }> {
  const response = await doFetch(url.href, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": USER_AGENT, accept: `${accept},*/*;q=0.5`, "accept-language": "en" },
  });
  if (!response.ok || !response.body) return { ok: false, text: "", finalUrl: response.url || url.href };
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes * 4) return { ok: false, text: "", finalUrl: response.url || url.href };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks, received));
  return { ok: true, text, finalUrl: response.url || url.href };
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTML signals
// ---------------------------------------------------------------------------

function metaContent(html: string, attr: "name" | "property", key: string): string | undefined {
  const re = new RegExp(`<meta\\s+[^>]*${attr}\\s*=\\s*["']${escapeRe(key)}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  if (!tag) return undefined;
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
  return content ? decodeEntities(content.trim()) : undefined;
}

function pickName(html: string): string | undefined {
  const candidates = [
    metaContent(html, "property", "og:site_name"),
    metaContent(html, "name", "application-name"),
    metaContent(html, "name", "apple-mobile-web-app-title"),
    cleanTitle(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]),
  ];
  const name = candidates.find((c) => c && c.length >= 2 && c.length <= 40);
  return name ? decodeEntities(name) : undefined;
}

function cleanTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  // "Carry Home – Cookd" -> "Cookd"; "Cookd | Masalas" -> "Cookd". Prefer the shorter side.
  const parts = title
    .split(/\s+[|–—\-·:]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.reduce((a, b) => (b.length < a.length ? b : a));
}

function pickLogo(html: string, base: URL): string | undefined {
  const links = [...html.matchAll(/<link\s+[^>]*>/gi)].map((m) => m[0]);
  const byRel = (pattern: RegExp) =>
    links
      .filter((tag) => pattern.test(/rel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ""))
      .map((tag) => ({
        href: /href\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1],
        sizes: Number(/sizes\s*=\s*["'](\d+)/i.exec(tag)?.[1] ?? 0),
        svg: /\.svg(\?|$)/i.test(/href\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ""),
      }))
      .filter((x): x is { href: string; sizes: number; svg: boolean } => typeof x.href === "string")
      .sort((a, b) => Number(b.svg) - Number(a.svg) || b.sizes - a.sizes);

  const candidates = [
    ...byRel(/apple-touch-icon/i).map((x) => x.href),
    metaContent(html, "property", "og:logo"),
    ...byRel(/(^|\s)icon(\s|$)/i)
      .filter((x) => x.svg || x.sizes >= 96)
      .map((x) => x.href),
  ];
  for (const href of candidates) {
    if (!href) continue;
    try {
      const url = new URL(href, base);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function pickThemeColor(html: string): string | undefined {
  const raw = metaContent(html, "name", "theme-color");
  return raw ? toHex(raw) : undefined;
}

function collectInlineCss(html: string): string {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "").join("\n");
}

function collectInlineStyleAttributes(html: string): string {
  return [...html.matchAll(/<(button|a)\b[^>]*style\s*=\s*["']([^"']*)["'][^>]*>/gi)]
    .map((m) => `button{${m[2] ?? ""}}`)
    .join("\n");
}

function collectStylesheetUrls(html: string, base: URL): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\s+[^>]*>/gi)) {
    const tag = m[0];
    const rel = /rel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    if (!/stylesheet/i.test(rel)) continue;
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      const url = new URL(href, base);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (isPrivateHost(url.hostname) && !isPrivateHost(base.hostname)) continue;
      out.push(url.href);
    } catch {
      /* skip */
    }
  }
  // Theme stylesheets usually come first and matter most; fonts and vendor CSS later.
  return out.filter((u) => !/fonts\.googleapis|font-awesome|swiper|slick|normalize|reset/i.test(u));
}

// ---------------------------------------------------------------------------
// Colour ranking
// ---------------------------------------------------------------------------

function rankColours(css: string, themeColor: string | undefined): string[] {
  const scores = new Map<string, { score: number; hits: number }>();
  const bump = (hex: string | undefined, score: number) => {
    if (!hex || !qualifies(hex)) return;
    const entry = scores.get(hex) ?? { score: 0, hits: 0 };
    entry.score += score;
    entry.hits += 1;
    scores.set(hex, entry);
  };

  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // 1. Brand-named custom properties. Strongest signal in the CSS.
  const seenVars = new Set<string>();
  for (const m of clean.matchAll(BRAND_VAR)) {
    const name = (m[1] ?? "").toLowerCase();
    const value = m[2] ?? "";
    if (/(hover|active|focus|disabled|text|foreground|border|shadow|secondary|outline|muted|light|dark|bg-)/.test(name)) continue;
    const hex = toHex(value);
    if (!hex) continue;
    const key = `${name}:${hex}`;
    if (seenVars.has(key)) continue;
    seenVars.add(key);
    bump(hex, 4);
  }

  // 2. Button backgrounds.
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1] ?? "";
    const body = m[2] ?? "";
    if (!BUTTON_SELECTOR.test(selector)) continue;
    if (/(hover|focus|active|disabled|secondary|outline|ghost|link)/i.test(selector)) continue;
    for (const decl of body.matchAll(/background(?:-color)?\s*:\s*([^;]+)/gi)) {
      bump(toHex(decl[1] ?? ""), 3);
    }
  }

  // 3. Frequency of saturated colours anywhere. Weak, but breaks ties.
  const freq = new Map<string, number>();
  for (const m of clean.matchAll(HEX)) {
    const hex = toHex(m[0]);
    if (hex) freq.set(hex, (freq.get(hex) ?? 0) + 1);
  }
  for (const m of clean.matchAll(RGB)) {
    const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
    if (hex) freq.set(hex, (freq.get(hex) ?? 0) + 1);
  }
  for (const [hex, count] of freq) bump(hex, Math.min(2, count * 0.1));

  // 4. theme-color. Sites set it deliberately; when it is a real colour, trust it most.
  bump(themeColor, 6);

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score || b[1].hits - a[1].hits)
    .map(([hex]) => hex);
}

/** Saturated enough to be a brand colour, and mid-toned enough to carry a label. */
function qualifies(hex: string): boolean {
  const { s, l } = hsl(hex);
  return s >= 0.28 && l >= 0.18 && l <= 0.72;
}

export function toHex(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b] = hex.slice(0, 3).split("");
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6)}`;
    return undefined;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/.exec(v);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const triplet = TRIPLET.exec(v);
  if (triplet) return rgbToHex(Number(triplet[1]), Number(triplet[2]), Number(triplet[3]));
  return undefined;
}

function rgbToHex(r: number, g: number, b: number): string | undefined {
  if ([r, g, b].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return undefined;
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
