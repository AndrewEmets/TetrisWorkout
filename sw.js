// Service worker: network first, so updates show up right away; the last fetched copy of every file is kept
// for playing offline. Files are cached without their ?v= stamp, so each has one entry.
'use strict';

const CACHE = 'tetris-workout';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const key = url.origin + url.pathname;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)));
        }
        return res;
      })
      .catch(() => caches.match(key).then((r) => r || caches.match(url.origin + url.pathname.replace(/[^/]*$/, ''))))
  );
});
