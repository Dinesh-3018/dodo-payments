import { handleBrandRequest, brandResponseHeaders } from "../src/brand/handler.js";

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url).searchParams.get("url");
  const { status, body } = await handleBrandRequest(url, { allowLoopback: false });
  return new Response(JSON.stringify(body), { status, headers: brandResponseHeaders });
}
