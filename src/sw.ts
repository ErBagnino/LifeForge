/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA: every navigation falls back to the cached app shell (works offline).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

type PushPayload = { title?: string; body?: string; tag?: string; url?: string };

function parsePush(msg: PushMessageData | null): PushPayload {
  try {
    return (msg?.json() as PushPayload | undefined) ?? {};
  } catch {
    return { title: 'LifeForge', body: msg?.text() };
  }
}

// Web Push (only used when a push backend is configured).
self.addEventListener('push', (event) => {
  const data = parsePush(event.data);
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'LifeForge', {
      body: data.body ?? '',
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clients.find((c) => 'focus' in c);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await (existing as WindowClient).navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
