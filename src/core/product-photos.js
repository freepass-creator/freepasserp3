/**
 * product-photos.js — 상품 이미지 수집 공용 헬퍼
 *
 * search.js · excel-export.js · mobile 등에서 각각 중복 구현하던
 * 이미지 URL 정규화 로직을 통합. Firebase Storage/외부URL 재귀 파싱.
 *
 * Drive "폴더" / moderentcar 같은 HTML 페이지는 서버 스크래핑 필요 —
 * core/drive-photos.js의 fetchDriveFolderImages 사용.
 */

// 서버 스크래핑이 필요한 URL (img src에 직접 박으면 안 되는 HTML 페이지)
const NEEDS_SERVER_RE = /drive\.google\.com\/(drive\/folders\/|drive\/u\/\d+\/folders\/)|moderentcar\.co\.kr/;

/** URL의 "동일성 키" — Firebase Storage URL은 경로(o/...)만, 나머지는 쿼리스트링 제외한 origin+path
 *  같은 이미지인데 토큰만 다른 경우를 같은 것으로 인식하기 위함 */
function dedupKey(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('firebasestorage.googleapis.com') || u.hostname.endsWith('firebasestorage.app')) {
      const m = u.pathname.match(/\/o\/([^?]+)/);
      if (m) return 'fs:' + decodeURIComponent(m[1]);
    }
    return u.origin + u.pathname;  // 쿼리스트링 무시
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

/** 첫번째 이미지 URL 한 장 (목록 썸네일용) — 업로드 우선, 없으면 외부링크 */
export function firstProductImage(product) {
  return productImages(product)[0] || productExternalImages(product)[0] || '';
}

/** product.photo_link 중 서버 스크래핑이 필요한 URL 하나 반환 (없으면 '') */
export function supportedDriveSource(product) {
  const raw = product?.photo_link || '';
  return String(raw)
    .split(/\s*[\n,]\s*/)
    .map(u => u.trim())
    .find(u => NEEDS_SERVER_RE.test(u)) || '';
}
