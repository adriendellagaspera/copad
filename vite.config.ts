import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadEnv, type ConfigEnv, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// y-webrtc → simple-peer needs Node globals shim'd for the browser,
// but in the Vitest environment Node is already available, so skip the plugin.
export default defineConfig(({ mode }: ConfigEnv) => {
  // Keep the no-flash theme script in index.html in sync with VITE_APP_NAMESPACE
  // (it can't read env at runtime). Same `copad` default as src/config.ts.
  const appNamespace = loadEnv(mode, root).VITE_APP_NAMESPACE?.trim() || 'copad';
  const injectNamespace: Plugin = {
    name: 'inject-app-namespace',
    transformIndexHtml: (html) => html.replaceAll('__APP_NAMESPACE__', appNamespace),
  };

  return {
    plugins: [
      svelte(),
      injectNamespace,
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
  };
});
