import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleBrandRequest, brandResponseHeaders } from "./src/brand/handler";

// In production /api/brand is a Vercel function (see api/brand.ts). In dev and
// preview the same handler runs as a middleware so the app behaves identically.
function brandApi(): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost").searchParams.get("url");
    const { status, body } = await handleBrandRequest(url, { allowPrivate: true });
    res.writeHead(status, brandResponseHeaders);
    res.end(JSON.stringify(body));
  };
  return {
    name: "dodo-brand-api",
    configureServer(server) {
      server.middlewares.use("/api/brand", (req, res) => void middleware(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/brand", (req, res) => void middleware(req, res));
    },
  };
}

export default defineConfig({
  plugins: [react(), brandApi()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
});
