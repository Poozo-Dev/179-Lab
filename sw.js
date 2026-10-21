// sw.js — makes the app work offline after the first successful visit.
// Strategy: pre-cache the app shell on install; afterwards answer from cache immediately and refresh the
// cache from the network in the background (stale-while-revalidate), so a redeployed update arrives on the
// next launch without anyone having to bump a version number.
// APP_VERSION in js/config.js is shown in the camera screen's settings, to see which version a phone runs.
const CACHE = 'physlab-shell-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/main.js', 'js/config.js', 'js/timing.js', 'js/frame-source.js', 'js/recorder.js', 'js/store.js', 'js/gallery.js', 'js/plot.js', 'js/save.js',
  'js/measure.js', 'js/geometry.js', 'js/countdown.js', 'js/i18n.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    // cache:'no-cache' = always ask the server (cheap 304 if unchanged); otherwise the phone's HTTP cache
    // (GitHub Pages: 10 min) could keep serving an old file and an update would arrive late.
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(network); return hit; }
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
    return Response.error();
  })());
});
