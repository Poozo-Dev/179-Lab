// sw.js — makes the app work offline after the first successful visit.
//
// Updates are ALL-OR-NOTHING. Each version has its own cache, named after APP_VERSION (tests/sw.test.js checks
// they match, so bump both together). A new version is installed completely — every file fetched fresh, past
// the browser's and the CDN's caches (?v=…) — into a new cache before it is used; until then the phone keeps
// answering from the old cache. So a page can never mix files of two versions (an old index.html with new
// JavaScript broke the gallery on some Android phones in v1.10.0).
// A redeploy arrives on the next launch after the one that downloaded it ("two opens").
const VERSION = '1.10.1';
const CACHE = 'physlab-' + VERSION;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/main.js', 'js/config.js', 'js/timing.js', 'js/frame-source.js', 'js/recorder.js', 'js/store.js', 'js/gallery.js', 'js/plot.js', 'js/save.js',
  'js/measure.js', 'js/geometry.js', 'js/countdown.js', 'js/i18n.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // fetch everything first; only if ALL files arrived are they stored (a failed install keeps the old version)
    const responses = await Promise.all(SHELL.map(async (u) => {
      const res = await fetch(new Request(u + (u.includes('?') ? '&' : '?') + 'v=' + VERSION, { cache: 'reload' }));
      if (!res.ok) throw new Error('precache failed: ' + u);
      return [u, res];
    }));
    await Promise.all(responses.map(([u, res]) => cache.put(u, res)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first, from THIS version's cache only. Anything not in the shell (or a first visit before install
// finished) goes to the network.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (_) {
      if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
      return Response.error();
    }
  })());
});
