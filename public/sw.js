/**
 * Service Worker — 모바일 오프라인 캐시 (2026)
 * 전략:
 *  - App Shell (index.html, sign.html, catalog.html): network-first + fallback to cache
 *  - JS/CSS 번들: cache-first + stale-while-revalidate
 *  - 이미지: cache-first (1일 TTL)
 *  - 폰트: cache-first (영구)
 *  - API/Firebase: 캐시 안 함
 */
const VERSION = 'v28';
const CACHE_SHELL = `freepass-shell-${VERSION}`;
const CACHE_ASSETS = `freepass-assets-${VERSION}`;
const CACHE_IMAGES = `freepass-images-${VERSION}`;
const CACHE_FONTS = `freepass-fonts-${VERSION}`;

const SHELL_URLS = ['/', '/index.html', '/sign.html', '/catalog.html', '/manifest.json', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_SHELL);
    await cache.addAll(SHELL_URLS).catch(() => {}); // 개별 실패 무시
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const valid = new Set([CACHE_SHELL, CACHE_ASSETS, CACHE_IMAGES, CACHE_FONTS]);
    await Promise.all(keys.filter(k => !valid.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') ||
         url.hostname.includes('firebase') ||
         url.hostname.includes('googleapis.com') ||
         url.hostname.includes('anthropic.com');
}
function isImage(request) {
  return request.destination === 'image' || /\.(png|jpe?g|webp|gif|svg)$/i.test(new URL(request.url).pathname);
}
function isFont(request) {
  return request.destination === 'font' || /\.(woff2?|ttf|otf)$/i.test(new URL(request.url).pathname) || new URL(request.url).hostname.includes('pretendard') || new URL(request.url).hostname.includes('fonts.g');
}
function isAsset(request) {
  return /\.(js|mjs|css)$/i.test(new URL(request.url).pathname);
}
function isShell(url) {
  return ['/', '/index.html', '/sign.html', '/catalog.html'].includes(url.pathname);
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(res => {
    if (res && res.status === 200) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.status === 200) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // 앱 쉘 fallback
    return (await cache.match('/index.html')) || new Response('Offline', { status: 504 });
  }
}
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.status === 200) cache.put(request, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (!/^https?:$/.test(url.protocol)) return;

  // 개발 모드 (Vite HMR) — 캐시 패스
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) return;

  // API / Firebase — 캐시 안 함
  if (isApiRequest(url)) return;

  // 앱 쉘 — network-first (최신 index.html, 오프라인 시 캐시)
  if (isShell(url)) { e.respondWith(networkFirst(e.request, CACHE_SHELL)); return; }

  // 폰트 — 영구 캐시
  if (isFont(e.request)) { e.respondWith(cacheFirst(e.request, CACHE_FONTS)); return; }

  // 이미지 — cache-first
  if (isImage(e.request)) { e.respondWith(cacheFirst(e.request, CACHE_IMAGES)); return; }

  // JS/CSS 번들 — stale-while-revalidate
  if (isAsset(e.request)) { e.respondWith(staleWhileRevalidate(e.request, CACHE_ASSETS)); return; }
});

// 강제 업데이트 트리거
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
