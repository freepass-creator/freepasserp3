/**
 * drive-photos.js — Google Drive 폴더 사진 지연 로드
 * (freepasserp/static/js/core/drive-photos.js 그대로 포팅)
 *
 * 상품 렌더링 시 image_urls 가 비어있고 photo_link 가 Drive 폴더면,
 * 서버 엔드포인트 `/api/extract-photos?url=...` 로부터 파일 ID 리스트를
 * 받아 lh3 CDN URL 로 변환된 썸네일을 채운다.
 *
 * Vite dev 환경에서는 vite.config.js 의 proxy 로 `/api` → freepasserp Flask
 * 서버(localhost:5200) 로 포워드.
 */

const SESSION_CACHE_KEY = 'fp_drive_folder_cache_v3';  /* v3: /api/img 프록시 URL 전환 */
const SESSION_CACHE_TTL = 60 * 60 * 1000;
const MEMORY = new Map();

const SIZE_THUMB = 480;   // 카드 썸네일
const SIZE_FULL  = 1280;  // 상세 갤러리 (1920은 과함)

function loadSessionCache() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) || '{}'); } catch { return {}; }
}
function saveSessionCache(obj) {
  try { sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(obj)); } catch {}
}

// isomorphic — api/extract-photos.js (서버 serverless) 도 동일 로직 사용
export function extractDriveFolderId(value) {
  if (!value) return '';
  const s = String(value).trim();
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /\/drive\/.*?\/([a-zA-Z0-9_-]{20,})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

export function isDriveFolderLink(value) {
  return !!extractDriveFolderId(value);
}

const SCRAPABLE_HOSTS = ['moderentcar.co.kr'];
export function isSupportedPhotoSource(value) {
  if (!value) return false;
  if (extractDriveFolderId(value)) return true;
  try {
    const u = new URL(value);
    return SCRAPABLE_HOSTS.some((h) => u.hostname.includes(h));
  } catch { return false; }
}

export function fetchDriveFolderImages(sourceUrl, size = SIZE_FULL) {
  if (!sourceUrl || !isSupportedPhotoSource(sourceUrl)) return Promise.resolve([]);

  const cacheKey = `${sourceUrl}:${size}`;
  const cache = loadSessionCache();
  const entry = cache[cacheKey];
  if (entry && Date.now() - (entry.ts || 0) < SESSION_CACHE_TTL) {
    return Promise.resolve(entry.urls || []);
  }
  if (MEMORY.has(cacheKey)) return MEMORY.get(cacheKey);

  const p = fetch(`/api/extract-photos?url=${encodeURIComponent(sourceUrl)}&size=${size}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const rawUrls = j && j.ok && Array.isArray(j.urls) ? j.urls : [];
      // 외부 Drive URL 을 /api/img 프록시로 감싸 모바일 cross-origin 이슈 우회
      const urls = rawUrls.map(u => {
        if (!u || u.startsWith('/api/img')) return u;
        try {
          const host = new URL(u, location.origin).hostname;
          if (/(^|\.)(googleusercontent\.com|drive\.google\.com)$/.test(host)) {
            return `/api/img?url=${encodeURIComponent(u)}`;
          }
        } catch {}
        return u;
      });
      if (urls.length) {
        const next = loadSessionCache();
        next[cacheKey] = { ts: Date.now(), urls };
        saveSessionCache(next);
      } else {
        MEMORY.delete(cacheKey);
      }
      return urls;
    })
    .catch(() => { MEMORY.delete(cacheKey); return []; });

  MEMORY.set(cacheKey, p);
  return p;
}

export { SIZE_THUMB, SIZE_FULL };

export async function resolveProductPhotos(product) {
  if (!product) return [];
  const existing = Array.isArray(product.image_urls) ? product.image_urls.filter(Boolean) : [];
  if (existing.length) return existing;
  if (product.image_url) return [product.image_url];
  const photoLink = String(product.photo_link || product.photoLink || '').trim();
  if (!isSupportedPhotoSource(photoLink)) return [];
  const urls = await fetchDriveFolderImages(photoLink);
  if (urls.length) {
    product.image_urls = urls;
    product.image_url = urls[0];
    product._drive_folder_virtual = true;
  }
  return urls;
}

// ─── DOM 하이드레이션 (ERP와 동일) ─────────────────────────────────────────
// 뷰포트에 들어오는 `<img data-drive-folder="URL" data-drive-mode="thumb">`만
// IntersectionObserver 로 가시성 시점에 Drive API 호출 → src 채움.

function hydrateImg(el, urls) {
  // 실패 / 빈 결과 → img 제거해서 형제 placeholder 아이콘만 남김
  if (!urls.length) {
    if (el.tagName === 'IMG') el.remove();
    el.dispatchEvent?.(new CustomEvent('drive-photos:empty', { bubbles: true }));
    return;
  }
  const img = el.tagName === 'IMG' ? el : el.querySelector('img');
  if (img) {
    img.src = urls[0];
    img.hidden = false;
    img.removeAttribute('data-pending');
    // 형제로 깔린 placeholder 아이콘 제거
    const placeholder = img.parentElement?.querySelector('.srch-thumb-placeholder');
    if (placeholder) placeholder.remove();
  }
  el.dataset.drivePhotoCount = urls.length;
  el.dispatchEvent(new CustomEvent('drive-photos:loaded', { bubbles: true, detail: { urls } }));
}

// 동시 하이드레이션 제한 — Flask/Drive API 호출만 제한, 캐시 hit은 우회
const MAX_CONCURRENT = 8;
let active = 0;
const queue = [];
function runNext() {
  while (active < MAX_CONCURRENT && queue.length) {
    const task = queue.shift();
    active++;
    task().finally(() => { active--; runNext(); });
  }
}
function hydrate(el) {
  if (!el || el.dataset._driveHydrated === '1') return;
  const folderUrl = el.dataset.driveFolder;
  if (!folderUrl) return;
  el.dataset._driveHydrated = '1';
  const mode = el.dataset.driveMode || 'thumb';
  const size = mode === 'gallery' ? SIZE_FULL : SIZE_THUMB;

  // sessionStorage 캐시 hit이면 queue 건너뛰고 즉시 주입
  const cache = loadSessionCache();
  const entry = cache[`${folderUrl}:${size}`];
  if (entry && Date.now() - (entry.ts || 0) < SESSION_CACHE_TTL) {
    hydrateImg(el, entry.urls || []);
    return;
  }

  queue.push(() =>
    fetchDriveFolderImages(folderUrl, size)
      .then((urls) => hydrateImg(el, urls))
      .catch(() => {})
  );
  runNext();
}

// viewport 기다리지 않고 DOM에 들어오자마자 hydrate 큐에 등록
//  → Concurrency 3으로 순차 처리되어 Google 429 방지, 스크롤 전에 미리 로드
function scanAndHydrate(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-drive-folder]:not([data-_drive-hydrated="1"])').forEach(hydrate);
}

let _mo = null;
function startObserver() {
  if (_mo || typeof MutationObserver === 'undefined') return;
  const target = document.body || document.documentElement;
  if (!target) return;
  scanAndHydrate(target);
  _mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.hasAttribute?.('data-drive-folder')) scanAndHydrate(node.parentElement || node);
        if (node.querySelectorAll) scanAndHydrate(node);
      }
    }
  });
  _mo.observe(target, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
}
