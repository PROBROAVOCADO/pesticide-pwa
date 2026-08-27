/**
 * 離線外殼。
 *
 * 目前只快取 App 本身的檔案，農業部 API 的回應不在這裡處理
 * （跨網域請求直接放行）。「查過的藥劑離線也能翻」需要 IndexedDB，
 * 那是下一階段的工作。
 *
 * 發版時記得把 CACHE 的版本號一起改，否則使用者會拿到舊檔案。
 */
const CACHE = 'field-meds-pwa-v1.0.0-r2';

const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './calc.js',
  './moa.js',
  './manifest.json',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url))))
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
      // 先給快取的版本，同時在背景抓新的，下次開啟就是最新的。
      const cached = await caches.match(request);
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((fresh) =>
              fresh.ok ? caches.open(CACHE).then((cache) => cache.put(request, fresh.clone())) : null,
            )
            .catch(() => null),
        );
        return cached;
      }

      try {
        const fresh = await fetch(request);
        if (fresh.ok) (await caches.open(CACHE)).put(request, fresh.clone());
        return fresh;
      } catch {
        if (request.mode === 'navigate') {
          return (await caches.match('./')) || new Response('目前離線，請稍後再試。', { status: 503 });
        }
        return new Response('', { status: 504 });
      }
    })(),
  );
});
