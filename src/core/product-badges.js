/**
 * product-badges.js — 상품 뱃지 계산 공용 헬퍼
 *
 * search(카드/상세), mobile/m-search, catalog 등에서 동일하게 쓰는
 * 차량상태·렌트구독·신차중고·심사여부 뱃지 문자열 생성.
 */

/* ── 차량상태 → {label, tone}  (B2B 톤: 의미색은 출고상태에만) ── */
const VS_MAP = {
  '즉시출고': { label: '즉시', tone: 'info' },
  '즉시':     { label: '즉시', tone: 'info' },
  '출고가능': { label: '가능', tone: 'ok' },
  '가능':     { label: '가능', tone: 'ok' },
  '상품화중': { label: '상품화', tone: 'muted' },
  '상품화':   { label: '상품화', tone: 'muted' },
  '출고협의': { label: '협의', tone: 'warn' },
  '협의':     { label: '협의', tone: 'warn' },
  '출고불가': { label: '불가', tone: 'err' },
  '불가':     { label: '불가', tone: 'err' },
};

function badgeHtml(label, tone) {
  return `<span class="badge badge-${tone}">${label}</span>`;
}

/* ── 차량상태 뱃지 (즉시/가능/협의/불가) ── */
function vehicleStatusBadge(product) {
  const entry = VS_MAP[product?.vehicle_status];
  return entry ? badgeHtml(entry.label, entry.tone) : '';
}

/* ── 렌트/구독 뱃지 — 구분만 표시, 색은 muted ── */
function rentWayBadge(product) {
  const pt = product?.product_type || '';
  const way = /구독$/.test(pt) ? '구독' : (/렌트$/.test(pt) ? '렌트' : '');
  if (!way) return '';
  return badgeHtml(way, 'muted');
}

/* ── 신차/중고 뱃지 — 구분만 표시, 색은 muted ── */
function originBadge(product) {
  const pt = product?.product_type || '';
  const origin = /^신차/.test(pt) ? '신차' : (/^중고/.test(pt) ? '중고' : '');
  if (!origin) return '';
  return badgeHtml(origin, 'muted');
}

/* ── 심사여부 판정 (boolean) ── */
export function needsReview(product) {
  const raw = product?.review_status || product?.review || '';
  return /필요|필|요청|대기/.test(raw);
}

/* ── 심사여부 하단 풀폭 overlay (카드·갤러리 하단) ── */
export function reviewOverlayHtml(product) {
  const need = needsReview(product);
  return `<span class="srch-thumb-tag ${need ? 'is-review-needed' : 'is-no-review'}">${need ? '심사필요' : '무심사'}</span>`;
}

/* ── 상단 뱃지 라인 (카드·갤러리 공통): [차량상태][신차중고][렌트구독] ── */
export function topBadgesHtml(product) {
  return `${vehicleStatusBadge(product)}${originBadge(product)}${rentWayBadge(product)}`;
}
