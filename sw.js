// Offline shell: the app still opens without a connection (players' phones
// need one to reach the host). Network first, so a deploy shows up at once
// and the host and players never run different versions.
const CACHE = 'felt-v3';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/i18n.js',
  'js/net.js',
  'js/settle.js',
  'js/store.js',
  'js/ui.js',
  'vendor/mqtt.min.js',
  'vendor/qrcode.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
      }
    }),
  );
});
