/**
 * product-photos.js — 상품 이미지 수집 공용 헬퍼
 *
 * search.js | excel-export.js | mobile 등에서 각각 중복 구현하던
 * 이미지 URL 정규화 로직을 통합. Firebase Storage/외부URL 재귀 파싱.
 *
 * Drive "폴더" / moderentcar 같은 HTML 페이지는 서버 스크래핑 필요 —
 * core/drive-photos.js의 fetchDriveFolderImages 사용.
 */

// 서버 스크래핑이 필요한 URL (img src에 직접 박으면 안 되는 HTML 페이지)
const NEEDS_SERVER_RE = /drive\.google\.com\/(drive\/folders\/|drive\/u\/\d+\/folders\/)|moderentcar\.co\.kr|autoplus\.co\.kr/;

// 모바일 브라우저의 cross-origin 이미지 차단 이슈 우회용 프록시 대상 호스트
//  + 외부 사이트(autoplus, moderentcar) 핫링크 차단 우회
const PROXY_HOSTS_RE = /(^|\.)(googleusercontent\.com|drive\.google\.com|autoplus\.co\.kr|moderentcar\.co\.kr|moren-images\.s3[^.]*\.amazonaws\.com)$/;

/** 로컬 dev 판별 — Vite 에서는 /api/img 서버리스가 없으니 직접 URL 을 쓴다. */
export function isLocalDev() {
  if (typeof location === 'undefined') return false;
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || /^192\.168\./.test(h) || /^10\./.test(h);
}

/** 외부 이미지 URL 을 /api/img 프록시로 감싸서 우리 오리진으로 서빙 —
 *  Drive/lh3 등 cross-origin 이미지의 referrer/CORS/rate-limit 이슈 회피.
 *  Vite dev 도 localServerless 플러그인이 api/img.js 를 처리하므로 dev/prod 모두 프록시 사용.
 *  이미 프록시됐거나 같은 오리진이면 그대로 반환. */
export function toProxiedImage(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/api/img')) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  try {
    const u = new URL(url, (typeof location !== 'undefined' ? location.origin : 'https://x/'));
    if (typeof location !== 'undefined' && u.origin === location.origin) return url;
    if (!PROXY_HOSTS_RE.test(u.hostname)) return url;       // 화이트리스트 외 호스트는 그대로
    return `/api/img?url=${encodeURIComponent(url)}`;
  } catch { return url; }
}

/** URL의 "동일성 키" — 같은 이미지인데 토큰만 다른 케이스 (Firebase Storage)는 합치고,
 *  쿼리로 이미지 ID 를 구분하는 케이스 (Drive thumbnail ?id=, lh3 ?w=) 는 유지.
 *  ⚠ 기본 origin+pathname 으로 dedup 하면 Drive 같은 동일 path 다른 query 가 합쳐짐. */
function dedupKey(url) {
  try {
    const s = String(url || '');
    // 1) 프록시 URL — ?url= 안에 진짜 source URL 추출 후 재귀로 키 생성
    if (s.startsWith('/api/img?')) {
      const m = s.match(/[?&]url=([^&]+)/);
      if (m) return 'proxy:' + dedupKey(decodeURIComponent(m[1]));
      return s;
    }
    const u = new URL(s, typeof location !== 'undefined' ? location.origin : 'https://x/');
    // 2) Firebase Storage — 토큰(쿼리)이 다르더라도 같은 객체. o/path 만 키로
    if (u.hostname.endsWith('firebasestorage.googleapis.com') || u.hostname.endsWith('firebasestorage.app')) {
      const m = u.pathname.match(/\/o\/([^?]+)/);
      if (m) return 'fs:' + decodeURIComponent(m[1]);
    }
    // 3) Drive thumbnail/uc — id 쿼리가 이미지 식별자
    if (u.hostname === 'drive.google.com') {
      const id = u.searchParams.get('id');
      if (id) return 'drive:' + id;
    }
    // 4) lh3.googleusercontent — path 자체가 식별자 (size suffix 가 다르면 같은 이미지)
    //    예: /XXXX=s2000 vs /XXXX=s1280 → 같은 path prefix
    if (/(^|\.)googleusercontent\.com$/.test(u.hostname)) {
      const base = u.pathname.replace(/=[swh]\d+(-[a-z]+)?$/, '');
      return 'lh:' + base;
    }
    // 5) 그 외 — origin+pathname+search 전부 (path 같고 query 만 다른 이미지도 구분)
    return u.origin + u.pathname + u.search;
  } catch { return url; }
}

/** 입력(배열/객체/문자열/JSON문자열) 모두 재귀로 펼쳐 유효한 URL 배열 반환 (중복 제거: 토큰 무시) */
export function collectImages(value) {
  const urls = [];
  const append = (input) => {
    if (input == null) return;
    if (Array.isArray(input)) { input.forEach(append); return; }
    if (typeof input === 'object') { Object.values(input).forEach(append); return; }
    const text = String(input).trim();
    if (!text) return;
    if (text.startsWith('[')) {
      try { append(JSON.parse(text)); return; } catch (e) { /* 일반 문자열 */ }
    }
    urls.push(text);
  };
  append(value);
  // 토큰/쿼리 무시한 키로 dedup — 먼저 들어온 URL 유지
  const seen = new Set();
  const out = [];
  for (const u of urls.filter(Boolean)) {
    const k = dedupKey(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

/** product의 업로드된 이미지 URL 배열 (image_urls/images/photos/image_url) */
export function productImages(product) {
  if (!product) return [];
  return collectImages([product.image_urls, product.images, product.photos, product.image_url]);
}

/** product.photo_link 중 바로 <img src>에 박을 수 있는 URL만
 *  (스크래핑 대상 사이트는 제외 — supportedDriveSource로 별도 처리) */
export function productExternalImages(product) {
  const raw = product?.photo_link || '';
  return String(raw)
    .split(/\s*[\n,]\s*/)
    .map(u => u.trim())
    .filter(u => /^(https?:|data:)/.test(u))
    .filter(u => !NEEDS_SERVER_RE.test(u));
}

/** 첫번째 이미지 URL 한 장 (목록 썸네일용) — 업로드 우선, 없으면 외부링크.
 *  모바일 호환 위해 외부 호스트는 자동으로 /api/img 프록시 URL 로 변환. */
export function firstProductImage(product) {
  const raw = productImages(product)[0] || productExternalImages(product)[0] || '';
  return raw ? toProxiedImage(raw) : '';
}

/** product.photo_link 중 서버 스크래핑이 필요한 URL 하나 반환 (없으면 '') */
export function supportedDriveSource(product) {
  const raw = product?.photo_link || '';
  return String(raw)
    .split(/\s*[\n,]\s*/)
    .map(u => u.trim())
    .find(u => NEEDS_SERVER_RE.test(u)) || '';
}
