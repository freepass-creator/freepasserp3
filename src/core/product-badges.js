/**
 * product-badges.js — 상품 뱃지 계산 공용 헬퍼
 *
 * search(카드/상세), mobile/m-search, catalog 등에서 동일하게 쓰는
 * 차량상태·렌트구독·신차중고·심사여부 뱃지 문자열 생성.
 */
import { normalizeProductType } from './normalize.js';

/* ── 차량상태 → tone (라벨은 원래 이름 그대로 사용) ── */
const VS_TONE = {
  '즉시출고': 'info',
  '출고가능': 'ok',
  '상품화중': 'muted',
  '출고협의': 'warn',
  '출고불가': 'err',
};

function badgeHtml(label, tone) {
  return `<span class="badge is-filled badge-${tone}">${label}</span>`;
}

/* ── 차량상태 뱃지 (출고가능/출고협의/...) ── */
function vehicleStatusBadge(product) {
  const vs = product?.vehicle_status;
  const tone = VS_TONE[vs];
  return tone ? badgeHtml(vs, tone) : '';
}

/* ── 상품구분 뱃지 (신차렌트/중고렌트/신차구독/중고구독) — 한 개로 합침
 *    재렌트/재구독 같은 레거시 값은 중고렌트/중고구독으로 정규화 */
function productTypeBadge(product) {
  const pt = normalizeProductType(product?.product_type);
  if (!pt) return '';
  const isNew = /^신차/.test(pt);
  return badgeHtml(pt, isNew ? 'info' : 'rose');
}

/* ── 심사여부 판정 (boolean) ── */
export function needsReview(product) {
  const raw = product?.review_status || product?.review || '';
  return /필요|필|요청|대기/.test(raw);
}

/* ── 심사기준 뱃지 (정책의 credit_grade / screening_criteria) ── */
export function creditGradeBadge(product) {
  const grade = product?._policy?.credit_grade || product?._policy?.screening_criteria || product?.credit_grade || '';
  if (!grade) return '';
  let tone = 'accent';
  if (/무관|없음|전체/.test(grade)) tone = 'ok';
  else if (/소득|심사/.test(grade)) tone = 'warn';
  return badgeHtml(grade, tone);
}

/* ── 심사기준 overlay (썸네일 하단) ── */
export function creditOverlayHtml(product) {
  const grade = product?._policy?.credit_grade || product?._policy?.screening_criteria || product?.credit_grade || '';
  if (!grade) return '';
  return `<span class="srch-thumb-tag is-credit">${grade}</span>`;
}

/* ── 심사여부 하단 풀폭 overlay (카드·갤러리 하단) ── */
export function reviewOverlayHtml(product) {
  const need = needsReview(product);
  return `<span class="srch-thumb-tag ${need ? 'is-review-needed' : 'is-no-review'}">${need ? '심사필요' : '무심사'}</span>`;
}

/* ── 상단 뱃지 라인 (카드·갤러리 공통): [차량상태][상품구분][신용등급] ── */
export function topBadgesHtml(product) {
  return `${vehicleStatusBadge(product)}${productTypeBadge(product)}${creditGradeBadge(product)}`;
}
