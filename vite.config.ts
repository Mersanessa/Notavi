import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// NOTAVI_BASE lets the PWA live under a sub-path (e.g. GitHub Pages: /notavi/).
const base = process.env.NOTAVI_BASE ?? '/';
// Tauri bundles the app into the binary, so it doesn't need a service worker.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// Production CSP: no remote origins at all. The app never talks to the network.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' ipc: http://ipc.localhost",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

// The opening sequence lives in the HTML itself so it paints instantly, before any script loads.
const splashHtml = readFileSync('scripts/splash.html', 'utf8');
const splashCss = readFileSync('scripts/splash.css', 'utf8');

export default defineConfig({
  base,
  clearScreen: false,
  plugins: [
    react(),
    {
      name: 'notavi-splash',
      transformIndexHtml: (html: string) =>
        html.replace('</head>', `<style>${splashCss}</style>\n  </head>`).replace('<body>', `<body>\n    ${splashHtml}`),
    },
    {
      // Tauri builds get their CSP from tauri.conf.json (Tauri adds its own nonces), so only the PWA gets a meta CSP.
      name: 'notavi-csp',
      apply: () => !isTauri && process.env.NODE_ENV !== 'development',
      transformIndexHtml: (html: string) =>
        html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
    VitePWA({
      disable: isTauri,
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: 'notavi',
        name: 'Notavi',
        short_name: 'Notavi',
        description: 'A private, local-first novel library and reader.',
        theme_color: '#131316',
        background_color: '#131316',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,woff2,png,svg,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { port: 5173, strictPort: true, host: process.env.TAURI_DEV_HOST || false },
} as never);
