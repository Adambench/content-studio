import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const server = process.env.CS_DEV_SERVER || 'http://127.0.0.1:8787';

// `--mode app` builds the UI for the Android app (dist-app, bundled in the APK): it talks to ai-server by its address.
export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: mode === 'app' ? 'dist-app' : 'dist', chunkSizeWarningLimit: 1500 },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: { proxy: { '/api': server, '/media': server }, fs: { allow: ['..'] } },
}));
