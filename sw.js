/**
 * 離線外殼。
 *
 * 這裡只快取 App 本身的檔案，農業部 API 的跨網域請求直接放行。
 * 「查過的藥劑離線也能翻」是由 db.js 的 drugCache 負責，
 * 因為那份資料同時也是施作紀錄要保存的官方標示快照。
 *
 * 發版時記得把 CACHE 的版本號一起改，否則使用者會拿到舊檔案。
 */
const CACHE = 'field-meds-pwa-v1.6.11-r1';

const CORE = [
  './',
  './index.html',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/views.js',
  './assets/js/calc.js',
  './assets/js/calc-state.js',
  './assets/js/moa.js',
  './assets/js/range-catalog.js',
  './assets/js/db.js',
  './assets/js/records.js',
  './manifest.json',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
];

const coreUrls = new Set(CORE.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...coreUrls].map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('field-meds-pwa-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      // 核心檔案整批切換，避免背景更新把不同版本混在一起。
      if (cached && coreUrls.has(url.href)) return cached;
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((fresh) =>
              fresh.ok ? cache.put(request, fresh.clone()) : null,
            )
            .catch(() => null),
        );
        return cached;
      }

      try {
        const fresh = await fetch(request);
        if (fresh.ok && url.pathname.includes('/data/ranges/')) await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        if (request.mode === 'navigate') {
          return (await cache.match(self.registration.scope)) || new Response('目前離線，請稍後再試。', { status: 503 });
        }
        return new Response('', { status: 504 });
      }
    })(),
  );
});
