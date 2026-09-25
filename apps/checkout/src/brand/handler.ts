import { extractBrand, BrandError, type Brand } from "./extract.js";

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; body: BrandResponse }>();

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const RATE_KEYS_MAX = 5000;
const hits = new Map<string, number[]>();

/** Best effort per caller: this is per instance, which is what a serverless function can promise. */
function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  if (hits.size >= RATE_KEYS_MAX && !hits.has(key)) hits.delete(hits.keys().next().value as string);
  hits.set(key, recent);
  return recent.length > RATE_LIMIT;
}

export type BrandResponse = { ok: true; brand: Brand } | { ok: false; code: string; message: string };

/**
 * GET /api/brand?url=https://store.example
 * Same-origin only: the checkout calls it from inside the iframe. Public data
 * in, public data out, so responses are cacheable.
 */
export async function handleBrandRequest(
  target: string | null,
  options: { allowLoopback: boolean; caller: string },
): Promise<{ status: number; body: BrandResponse }> {
  if (!target) return { status: 400, body: { ok: false, code: "invalid_url", message: "Missing url parameter." } };

  // Cached answers are free; only lookups that fetch a third-party site count against the caller.
  const key = cacheKey(target);
  const cached = key ? cache.get(key) : undefined;
  if (cached && key) {
    if (Date.now() - cached.at < CACHE_TTL_MS) return { status: 200, body: cached.body };
    cache.delete(key);
  }
  if (rateLimited(options.caller)) {
    return { status: 429, body: { ok: false, code: "rate_limited", message: "Too many lookups from this address. Try again in a minute." } };
  }

  try {
    const brand = await extractBrand(target, { allowLoopback: options.allowLoopback });
    const body: BrandResponse = { ok: true, brand };
    if (key) remember(key, body);
    return { status: 200, body };
  } catch (error) {
    if (error instanceof BrandError) {
      const status = error.code === "invalid_url" || error.code === "blocked_host" ? 400 : 502;
      return { status, body: { ok: false, code: error.code, message: error.message } };
    }
    return { status: 502, body: { ok: false, code: "fetch_failed", message: "Could not read that site." } };
  }
}

/** origin + path, lower-cased host, no query, no hash. */
function cacheKey(target: string): string | null {
  try {
    const url = new URL(target.trim());
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? ":" + url.port : ""}${url.pathname}`;
  } catch {
    return null;
  }
}

function remember(key: string, body: BrandResponse) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), body });
}

export const brandResponseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
  // Public data in, public data out: any page may preview a brand. Loopback
  // targets are only allowed in dev, and only for the dev server's own pages.
  "access-control-allow-origin": "*",
};
