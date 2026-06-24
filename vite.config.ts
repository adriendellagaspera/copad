import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { ConfigEnv } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// y-webrtc → simple-peer needs Node globals shim'd for the browser,
// but in the Vitest environment Node is already available, so skip the plugin.
export default defineConfig(({ mode }: ConfigEnv) => ({
  plugins: [
    svelte(),
    mode !== 'test' && nodePolyfills({ globals: { global: true, process: true, Buffer: true } }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        redirect: resolve(root, 'redirect.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
