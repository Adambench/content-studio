import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; repository?: string | { url: string } };
const repo = (typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '')).replace(/^git\+/, '').replace(/\.git$/, '');

// `--mode app` builds the UI for the Android app (into dist-app, bundled in the APK): no service worker or web
// manifest, and the API is on the server the app paired with. See src/lib/native.ts.
export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(process.env.CS_APP_VERSION || pkg.version), __APP_REPO__: JSON.stringify(repo) },
  build: { outDir: mode === 'app' ? 'dist-app' : 'dist' },
  plugins: [
    react(),
    tailwindcss(),
    mode !== 'app' &&
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectRegister: false,
        injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
        manifest: {
          name: 'Content Studio',
          short_name: 'Content Studio',
          description: 'Your content studio',
          start_url: '/',
          display: 'standalone',
          background_color: '#09090b',
          theme_color: '#09090b',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          shortcuts: [{ name: 'Capture an idea', url: '/capture', icons: [{ src: '/icon-192.png', sizes: '192x192' }] }],
          // Android share sheet → Content Studio. The server saves the files and redirects into the app.
          share_target: {
            action: '/api/share-target',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              title: 'title',
              text: 'text',
              url: 'url',
              files: [{ name: 'media', accept: ['video/*', 'image/*', 'audio/*'] }],
            },
          },
        },
        devOptions: { enabled: false },
      }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787' } },
  },
}));
