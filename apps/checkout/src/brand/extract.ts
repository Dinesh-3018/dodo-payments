/**
 * Reads a store's brand from its public homepage: an accent colour, a name and
 * a logo. No headless browser, no CSS engine. It looks at the signals a site
 * already publishes for exactly this purpose (theme-color, og:site_name, touch
 * icons) and at the colours the site's own CSS uses for buttons and brand
 * variables. Heuristic by design: a wrong guess costs a plain default, not a
 * broken checkout.
 *
 * It fetches on behalf of anyone who asks, so it is written like a fetcher
 * that expects hostile input: every redirect hop is validated, IPv6 and
 * private IPv4 targets are refused, bodies are size-capped, requests are
 * time-capped, and every scanner over fetched bytes is linear.
 */

export interface Brand {
  accent?: string;
  name?: string;
  logo?: string;
  /** Runner-up accent candidates, best first. */
  palette: string[];
  /** The origin that was actually read after redirects. */
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
const MAX_HEAD_BYTES = 262_144;
const MAX_CSS_BYTES = 400_000;
const MAX_TOTAL_CSS = 700_000;
const MAX_SHEETS = 3;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 5000;
const USER_AGENT = "DodoCheckoutBrandReader/0.1 (+https://dodopayments.com)";

const BRAND_NAME = /(primary|brand|accent|button|btn|cta|highlight|theme)/;
const BRAND_NAME_EXCLUDE = /(hover|active|focus|disabled|text|foreground|border|shadow|secondary|outline|muted|light|dark|bg-)/;
const BUTTON_SELECTOR = /(button|\.btn\b|\.button\b|\bbtn-|\bbutton-|\[type=["']?submit|add-to-cart|checkout)/i;
const BUTTON_EXCLUDE = /(hover|focus|active|disabled|secondary|outline|ghost|link)/i;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const RGB = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/gi;
const TRIPLET = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/;

export interface ExtractOptions {
  /** Allow localhost and 127.0.0.1 (never other private ranges). Dev only. */
  allowLoopback?: boolean;
  fetchImpl?: typeof fetch;
}

export async function extractBrand(input: string, options: ExtractOptions = {}): Promise<Brand> {
  const allowLoopback = options.allowLoopback === true;
  const url = parseTarget(input);
  const doFetch = options.fetchImpl ?? fetch;

  const page = await fetchChecked(doFetch, url, MAX_HTML_BYTES, "text/html", allowLoopback);
  if (!page.ok) throw new BrandError("fetch_failed", `Could not read ${url.origin}.`);
  if (!/<(html|head|body|meta|link)\b/i.test(page.text.slice(0, 5000))) {
    throw new BrandError("not_html", `${url.origin} did not return an HTML page.`);
  }
  const base = new URL(page.finalUrl);
  const html = page.text;
  const head = html.slice(0, MAX_HEAD_BYTES);

  const name = pickName(head);
  const logo = pickLogo(head, base);

  // CSS: inline <style> blocks plus a few linked stylesheets, size-capped.
  let css = collectInlineCss(html);
  const sheets = collectStylesheetUrls(head, base).slice(0, MAX_SHEETS);
  const fetched = await Promise.all(
    sheets.map((href) => fetchChecked(doFetch, new URL(href), MAX_CSS_BYTES, "text/css", allowLoopback).catch(() => null)),
  );
  for (const sheet of fetched) if (sheet?.ok) css += "\n" + sheet.text;
  css += "\n" + collectInlineStyleAttributes(head);
  css = css.slice(0, MAX_TOTAL_CSS);

  const themeColor = pickThemeColor(head);
  const ranked = rankColours(css, themeColor);

  const brand: Brand = { palette: ranked.slice(1, 6), from: base.origin };
  const best = ranked[0];
  if (best) brand.accent = best;
  if (name) brand.name = name;
  if (logo) brand.logo = logo;
  return brand;
}

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

function parseTarget(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new BrandError("invalid_url", "Give a full URL like https://example.com.");
  }
  return cleanUrl(url);
}

function cleanUrl(url: URL): URL {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BrandError("invalid_url", "Only http and https URLs are read.");
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  return url;
}

function assertAllowed(url: URL, allowLoopback: boolean) {
  const host = url.hostname.toLowerCase();
  if (allowLoopback && (host === "localhost" || host === "127.0.0.1")) return;
  if (isPrivateHost(host)) throw new BrandError("blocked_host", "Local and private addresses are not read.");
}

/** Conservative: any IPv6 literal, any private or special IPv4 range, any local name. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return true;
  if (host.startsWith("[") || host.includes(":")) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/\.(local|internal|home|lan|intranet|corp)$/.test(host)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Fetching: redirects are followed by hand so every hop is checked
// ---------------------------------------------------------------------------

async function fetchChecked(
  doFetch: typeof fetch,
  start: URL,
  maxBytes: number,
  accept: string,
  allowLoopback: boolean,
): Promise<{ ok: boolean; text: string; finalUrl: string }> {
  let current = cleanUrl(new URL(start.href));
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertAllowed(current, allowLoopback);
    const response = await doFetch(current.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: `${accept},*/*;q=0.5`, "accept-language": "en" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return { ok: false, text: "", finalUrl: current.href };
      let next: URL;
      try {
        next = cleanUrl(new URL(location, current));
      } catch {
        return { ok: false, text: "", finalUrl: current.href };
      }
      current = next;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, text: "", finalUrl: current.href };
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes * 4) {
      await response.body.cancel().catch(() => undefined);
      return { ok: false, text: "", finalUrl: current.href };
    }
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
    return { ok: true, text, finalUrl: current.href };
  }
  throw new BrandError("fetch_failed", "Too many redirects.");
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
// HTML signals (linear tag scanning; regexes only run on one short tag)
// ---------------------------------------------------------------------------

/** All `<name ...>` tags, each capped in length. */
function collectTags(html: string, name: string): string[] {
  const out: string[] = [];
  const needle = `<${name}`;
  let i = 0;
  while ((i = html.indexOf(needle, i)) !== -1) {
    const after = html[i + needle.length];
    if (after !== undefined && !/[\s/>]/.test(after)) {
      i += needle.length;
      continue;
    }
    const end = html.indexOf(">", i);
    const stop = end === -1 ? Math.min(html.length, i + 2000) : Math.min(end + 1, i + 2000);
    out.push(html.slice(i, stop));
    i = stop;
    if (out.length >= 400) break;
  }
  return out;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  const value = m?.[1] ?? m?.[2] ?? m?.[3];
  return value === undefined ? undefined : decodeEntities(value.trim());
}

function metaContent(head: string, key: "name" | "property", value: string): string | undefined {
  for (const tag of collectTags(head, "meta")) {
    if ((attr(tag, key) ?? "").toLowerCase() !== value) continue;
    const content = attr(tag, "content");
    if (content) return content;
  }
  return undefined;
}

/**
 * Stores publish their name in several places and the legal one is usually the
 * longest ("Cookd Ventures Private Limited"). The shortest sensible candidate
 * is almost always the brand people know.
 */
function pickName(head: string): string | undefined {
  const candidates = [
    metaContent(head, "property", "og:site_name"),
    metaContent(head, "name", "application-name"),
    metaContent(head, "name", "apple-mobile-web-app-title"),
    cleanTitle(titleText(head)),
  ]
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter((c) => c.length >= 2 && c.length <= 40 && !/^(home|shop|store|welcome)$/i.test(c));
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, c) => (c.length < best.length ? c : best));
}

function titleText(head: string): string | undefined {
  const start = head.search(/<title\b[^>]*>/i);
  if (start === -1) return undefined;
  const open = head.indexOf(">", start);
  const close = head.indexOf("</title>", open);
  if (open === -1 || close === -1) return undefined;
  return decodeEntities(head.slice(open + 1, Math.min(close, open + 500)).trim());
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

function pickLogo(head: string, base: URL): string | undefined {
  const links = collectTags(head, "link").map((tag) => ({
    rel: (attr(tag, "rel") ?? "").toLowerCase(),
    href: attr(tag, "href"),
    sizes: Number(/^(\d+)/.exec(attr(tag, "sizes") ?? "")?.[1] ?? 0),
  }));
  const withHref = links.filter((l): l is { rel: string; href: string; sizes: number } => typeof l.href === "string");
  const svg = (href: string) => /\.svg(\?|$)/i.test(href);
  const sorted = (items: typeof withHref) => items.sort((a, b) => Number(svg(b.href)) - Number(svg(a.href)) || b.sizes - a.sizes);

  const candidates = [
    ...sorted(withHref.filter((l) => l.rel.includes("apple-touch-icon"))).map((l) => l.href),
    metaContent(head, "property", "og:logo"),
    ...sorted(withHref.filter((l) => /(^|\s)icon(\s|$)/.test(l.rel) && (svg(l.href) || l.sizes >= 96))).map((l) => l.href),
    headerLogoImage(head),
    ...sorted(withHref.filter((l) => /(^|\s)(icon|shortcut icon)(\s|$)/.test(l.rel))).map((l) => l.href),
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

/** The first <img> that calls itself a logo, in class, alt, id or file name. */
function headerLogoImage(head: string): string | undefined {
  for (const tag of collectTags(head, "img")) {
    const src = attr(tag, "src") ?? attr(tag, "data-src");
    if (!src || src.startsWith("data:")) continue;
    const hint = `${attr(tag, "class") ?? ""} ${attr(tag, "alt") ?? ""} ${attr(tag, "id") ?? ""} ${src}`;
    if (/logo/i.test(hint) && !/payment|visa|master|paypal|badge|trust|partner/i.test(hint)) return src;
  }
  return undefined;
}

function pickThemeColor(head: string): string | undefined {
  const raw = metaContent(head, "name", "theme-color");
  return raw ? toHex(raw) : undefined;
}

function collectInlineCss(html: string): string {
  const parts: string[] = [];
  let i = 0;
  let total = 0;
  while ((i = html.indexOf("<style", i)) !== -1) {
    const open = html.indexOf(">", i);
    if (open === -1) break;
    const close = html.indexOf("</style>", open);
    const end = close === -1 ? html.length : close;
    parts.push(html.slice(open + 1, end));
    total += end - open;
    i = end;
    if (total > MAX_TOTAL_CSS || parts.length > 50) break;
  }
  return parts.join("\n");
}

function collectInlineStyleAttributes(head: string): string {
  return [...collectTags(head, "button"), ...collectTags(head, "a")]
    .map((tag) => attr(tag, "style"))
    .filter((s): s is string => typeof s === "string")
    .map((s) => `button{${s}}`)
    .join("\n");
}

function collectStylesheetUrls(head: string, base: URL): string[] {
  const out: string[] = [];
  for (const tag of collectTags(head, "link")) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    if (!rel.includes("stylesheet")) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    try {
      const url = new URL(href, base);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      out.push(url.href);
    } catch {
      /* skip */
    }
  }
  // Theme stylesheets usually come first and matter most; fonts and vendor CSS later.
  return out.filter((u) => !/fonts\.googleapis|font-awesome|swiper|slick|normalize|reset/i.test(u));
}

// ---------------------------------------------------------------------------
// Colour ranking (linear scanners over CSS text)
// ---------------------------------------------------------------------------

function isNameChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 45 || // -
    code === 95 // _
  );
}

/** `--name: value` pairs. Each character is visited once. */
function scanCustomProps(css: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  const n = css.length;
  let i = 0;
  while ((i = css.indexOf("--", i)) !== -1) {
    let j = i + 2;
    while (j < n && j - i < 80 && isNameChar(css.charCodeAt(j))) j++;
    let k = j;
    while (k < n && k - j < 20 && (css[k] === " " || css[k] === "\t" || css[k] === "\n" || css[k] === "\r")) k++;
    if (j > i + 2 && css[k] === ":") {
      k++;
      let end = k;
      while (end < n && end - k < 200 && css[end] !== ";" && css[end] !== "}") end++;
      out.push({ name: css.slice(i + 2, j).toLowerCase(), value: css.slice(k, end).trim() });
      i = end;
    } else {
      i = Math.max(j, i + 2);
    }
    if (out.length >= 5000) break;
  }
  return out;
}

/** `selector { body }` pairs, by splitting on braces. Nested at-rules just yield their inner rules. */
function scanRules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const chunk of css.split("}")) {
    const brace = chunk.lastIndexOf("{");
    if (brace === -1) continue;
    const body = chunk.slice(brace + 1);
    if (body.length > 5000) continue;
    out.push({ selector: chunk.slice(Math.max(0, brace - 300), brace), body });
    if (out.length >= 20000) break;
  }
  return out;
}

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
  for (const { name, value } of scanCustomProps(clean)) {
    if (!BRAND_NAME.test(name) || BRAND_NAME_EXCLUDE.test(name)) continue;
    const hex = toHex(value);
    if (!hex) continue;
    const key = `${name}:${hex}`;
    if (seenVars.has(key)) continue;
    seenVars.add(key);
    bump(hex, 4);
  }

  // 2. Button backgrounds.
  for (const { selector, body } of scanRules(clean)) {
    if (!BUTTON_SELECTOR.test(selector) || BUTTON_EXCLUDE.test(selector)) continue;
    for (const decl of body.matchAll(/background(?:-color)?\s*:\s*([^;]{1,100})/gi)) {
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
  const v = value.trim().toLowerCase().slice(0, 64);
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
