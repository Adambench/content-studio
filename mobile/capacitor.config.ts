import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the web UI (built with VITE_TARGET=app into web/dist-app) bundled in the APK, talking to the
// Content Studio server it was paired with. See PLAN.md → Android app plan.
const config: CapacitorConfig = {
  appId: 'io.github.adambench.contentstudio',
  appName: 'Content Studio',
  webDir: '../web/dist-app',
  backgroundColor: '#09090b',
  // Pages come from https://localhost; the server is another origin and is called with a bearer token. The WebView
  // can be inspected (chrome://inspect) in debug builds only.
  android: { allowMixedContent: false },
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'DARK' },
    PushNotifications: { presentationOptions: ['alert', 'sound'] },
  },
};

export default config;
