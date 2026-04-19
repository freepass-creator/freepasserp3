const CACHE = 'freepass-v2-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  (async () => {
    // 구버전 캐시 정리
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })()
));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // http(s)만 (chrome-extension:// 등 제외)
  if (!/^https?:$/.test(url.protocol)) return;

  // Vite HMR, API proxy, WS 는 캐시 건너뛰기
  if (url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/node_modules/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 정상 응답만 캐시 (opaque·에러는 skip)
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        return cached || new Response('Offline', { status: 504, statusText: 'Offline' });
      })
  );
});
