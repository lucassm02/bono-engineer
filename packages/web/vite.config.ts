import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The web package consumes workspace TS sources (e.g. @gt7/shared) directly; Vite transpiles them.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'GT7 Race Engineer',
        short_name: 'GT7 RE',
        lang: 'pt-BR',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
