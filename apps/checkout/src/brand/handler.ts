import { extractBrand, BrandError, type Brand } from "./extract";

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; body: BrandResponse }>();

export type BrandResponse = { ok: true; brand: Brand } | { ok: false; code: string; message: string };

/**
 * GET /api/brand?url=https://store.example
 * Public data in, public data out, so the response is cacheable and CORS-open.
 */
export async function handleBrandRequest(
  target: string | null,
  options: { allowPrivate: boolean },
): Promise<{ status: number; body: BrandResponse }> {
  if (!target) return { status: 400, body: { ok: false, code: "invalid_url", message: "Missing url parameter." } };

  const cached = cache.get(target);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { status: 200, body: cached.body };

  try {
    const brand = await extractBrand(target, { allowPrivate: options.allowPrivate });
    const body: BrandResponse = { ok: true, brand };
    cache.set(target, { at: Date.now(), body });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof BrandError) {
      const status = error.code === "invalid_url" || error.code === "blocked_host" ? 400 : 502;
      return { status, body: { ok: false, code: error.code, message: error.message } };
    }
    return { status: 502, body: { ok: false, code: "fetch_failed", message: "Could not read that site." } };
  }
}

export const brandResponseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
  "access-control-allow-origin": "*",
};
