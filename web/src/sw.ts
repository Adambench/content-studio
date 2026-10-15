/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// App routes load the cached shell; the API is always live.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

self.addEventListener('push', (event) => {
  const data = (() => {
    try {
      return event.data?.json() as { title: string; body: string; url?: string };
    } catch {
      return { title: 'Content Studio', body: event.data?.text() ?? '' };
    }
  })();
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url ?? '/' } }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows[0] as WindowClient | undefined;
      if (existing) {
        await existing.focus();
        await existing.navigate(url);
      } else await self.clients.openWindow(url);
    })(),
  );
});
