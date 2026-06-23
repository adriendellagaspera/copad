import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

// y-webrtc relies on `simple-peer`, which expects Node globals (global / Buffer /
// process). The polyfill plugin shims them so the WebRTC transport works in the browser.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { global: true, process: true, Buffer: true } }),
  ],
  build: {
    rollupOptions: {
      input: {
        // Two HTML entry points: the app, and the tiny OAuth popup landing page.
        main: resolve(root, "index.html"),
        redirect: resolve(root, "redirect.html"),
      },
    },
  },
});
