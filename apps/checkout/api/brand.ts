import { handleBrandRequest, brandResponseHeaders } from "../src/brand/handler.js";

/**
 * GET /api/brand?url=https://store.example
 * Vercel's Node runtime hands the Web-standard Request to named method
 * exports (a default export gets Node's req/res instead).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url).searchParams.get("url");
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { status, body } = await handleBrandRequest(url, { allowLoopback: false, caller });
  return new Response(JSON.stringify(body), { status, headers: brandResponseHeaders });
}
