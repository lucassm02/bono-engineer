import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '../shared/src/brand.ts';

// Keep in sync with @gt7/shared DEFAULT_HTTP_PORT (not imported: the config is bundled by Node
// before workspace TS sources are resolvable).
// GT7_DEV_SERVER permite apontar o Vite de desenvolvimento para outra instância (ex.: simulador).
const SERVER = process.env.GT7_DEV_SERVER ?? 'http://localhost:8770';

// The web package consumes workspace TS sources (e.g. @gt7/shared) directly; Vite transpiles them.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: PRODUCT_NAME,
        short_name: 'Bono',
        description: PRODUCT_DESCRIPTION,
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'landscape',
        background_color: '#000000',
        theme_color: '#000000',
        categories: ['games', 'sports', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Only the default radio voice (also the fallback) is precached; the other packs are
        // cached when first used. Pack names carry a content hash (npm run radio:voices).
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', 'radio/alex-*.wav'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Live data must never come from the cache.
        navigateFallbackDenylist: [/^\/ws/, /^\/api/, /^\/mcp/],
        runtimeCaching: [
          {
            urlPattern: /\/radio\/[a-z0-9-]+-[0-9a-f]+\.wav$/,
            handler: 'CacheFirst',
            options: { cacheName: 'bono-radio', expiration: { maxEntries: 9 } },
          },
        ],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: SERVER, ws: true, changeOrigin: true },
      '/api': { target: SERVER, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
