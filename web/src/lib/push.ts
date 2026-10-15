import { api } from './api';
import { isDesktop } from './desktop';
import { isApp } from './native';

export function registerServiceWorker() {
  // The Android app has no service worker: its pages are in the APK and it gets notifications through FCM.
  if (!('serviceWorker' in navigator) || import.meta.env.DEV || isDesktop || isApp) return;
  // The new worker activates immediately (skipWaiting); reload once so the page runs the new build too.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) {
      reloading = true;
      window.location.reload();
    }
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' });
      // Check for a new build whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
    } catch (err) {
      console.warn('Service worker failed', err);
    }
  });
}

export const pushSupported = () => !isDesktop && !isApp && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(vapidPublicKey: string) {
  if (!pushSupported()) throw new Error('This browser doesn’t support notifications.');
  if (import.meta.env.DEV) throw new Error('Notifications work in the built app (npm run build && npm start), not the dev server.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were blocked. Allow them in the browser’s site settings.');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  await api('/push/subscribe', { body: sub.toJSON() });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}
