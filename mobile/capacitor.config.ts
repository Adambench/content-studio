import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is a thin shell (2026-11-24): it loads the live app from ai-server over Tailscale, so the UI never
// needs a new APK, and keeps the native parts (files shared from the gallery, background uploads, saving to the
// gallery) in StudioPlugin. shell/ is only the page shown when ai-server can't be reached.
const config: CapacitorConfig = {
  appId: 'io.github.adambench.contentstudio',
  appName: 'Content Studio',
  webDir: 'shell',
  backgroundColor: '#09090b',
  server: {
    url: 'https://ai-server.tail1e2ac8.ts.net:8443',
    errorPath: 'index.html',
  },
  android: { allowMixedContent: false },
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'DARK' },
  },
};

export default config;
