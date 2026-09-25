import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The SDK is one plain script. It is built into the checkout app's public
// folder and served from the checkout origin (like js.stripe.com serves
// Stripe.js), so a host site always loads it cross-origin.
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      name: "DodoCheckout",
      formats: ["iife"],
      fileName: () => "dodo-checkout.js",
    },
    outDir: fileURLToPath(new URL("../../apps/checkout/public/sdk", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2020",
  },
});
