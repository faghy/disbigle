// Disbigle service worker: Web Push notifications and an offline page for navigations.
// API responses are never cached.

const CACHE = 'disbigle-shell-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// Page navigations go to the network; only when it fails is the offline page shown.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
  );
});

/** Only links inside this site are opened from a notification. */
function safeUrl(value) {
  try {
    const url = new URL(value || '/notifications', self.location.origin);
    return url.origin === self.location.origin ? url.href : `${self.location.origin}/notifications`;
  } catch {
    return `${self.location.origin}/notifications`;
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Disbigle';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.notificationId || undefined,
      timestamp: Date.now(),
      data: { url: safeUrl(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) {
          try {
            await existing.navigate(target);
            return;
          } catch {
            // Not controlled by this worker yet: fall through to a new window.
          }
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
