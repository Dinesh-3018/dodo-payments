import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        minimal: fileURLToPath(new URL("./minimal.html", import.meta.url)),
        declarative: fileURLToPath(new URL("./declarative.html", import.meta.url)),
      },
    },
  },
});
