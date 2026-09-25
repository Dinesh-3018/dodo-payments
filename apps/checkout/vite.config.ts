import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleBrandRequest, brandResponseHeaders } from "./src/brand/handler.js";

const PORT = 5174;
const SELF = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, "http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * Content-Security-Policy for the built checkout. The production copy lives in
 * vercel.json (keep the two in sync); preview applies it too so a CSP mistake
 * shows up locally, not after a deploy. Dev is exempt because Vite injects
 * styles inline.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors *",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// In production /api/brand is a Vercel function (see api/brand.ts). In dev and
// preview the same handler runs as a middleware so the app behaves identically.
// It accepts loopback targets (the demo runs on localhost) and refuses
// cross-origin callers so a random tab cannot use it as a LAN scanner.
function brandApi(): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? "/", "http://localhost").searchParams.get("url");
    // Loopback targets (the demo on localhost) only for our own pages; public sites for anyone.
    const trusted = !origin || SELF.includes(origin);
    const { status, body } = await handleBrandRequest(url, { allowLoopback: trusted, caller: req.socket.remoteAddress ?? "local" });
    res.writeHead(status, brandResponseHeaders);
    res.end(JSON.stringify(body));
  };
  return {
    name: "dodo-brand-api",
    configureServer(server) {
      server.middlewares.use("/api/brand", (req, res) => void middleware(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", CSP.replace("img-src 'self' https: data:", "img-src 'self' https: data: http://localhost:* http://127.0.0.1:*"));
        next();
      });
      server.middlewares.use("/api/brand", (req, res) => void middleware(req, res));
    },
  };
}

export default defineConfig({
  plugins: [react(), brandApi()],
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
});
