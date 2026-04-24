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

function badgeHtml(label, tone, variant = 'is-filled') {
  return `<span class="badge ${variant} badge-${tone}">${label}</span>`;
}

/* ── 차량상태 뱃지 (출고가능/출고협의/...) ── */
function vehicleStatusBadge(product) {
  const vs = product?.vehicle_status;
  const tone = VS_TONE[vs];
  return tone ? badgeHtml(vs, tone) : '';
}

/* ── 상품구분 뱃지 — 계열 분리 + 중고는 soft 변형
 *    렌트  = 파랑(info)  · 구독  = 초록(ok)
 *    신차  = is-filled (진하게) · 중고 = is-soft (연하게) */
function productTypeBadge(product) {
  const pt = normalizeProductType(product?.product_type);
  if (!pt) return '';
  const isNew = /^신차/.test(pt);
  const isRent = /렌트$/.test(pt);
  const tone = isRent ? 'info' : 'ok';
  const variant = isNew ? 'is-filled' : 'is-soft';
  return badgeHtml(pt, tone, variant);
}

/* ── 심사여부 판정 (boolean) ── */
export function needsReview(product) {
  const raw = product?.review_status || product?.review || '';
  return /필요|필|요청|대기/.test(raw);
}

/* ── 레거시 값 치환: "저신용" → "신용무관" (DB 마이그레이션 전이라도 표시부터 반영) ── */
function normalizeCreditGrade(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s === '저신용') return '신용무관';
  return s;
}

/* ── 심사기준 뱃지 (정책의 credit_grade / screening_criteria) ── */
export function creditGradeBadge(product) {
  const raw = product?._policy?.credit_grade || product?._policy?.screening_criteria || product?.credit_grade || '';
  const grade = normalizeCreditGrade(raw);
  if (!grade) return '';
  let tone = 'accent';
  if (/무관|없음|전체/.test(grade)) tone = 'ok';
  else if (/소득|심사/.test(grade)) tone = 'warn';
  return badgeHtml(grade, tone);
}

/* ── 심사기준 overlay — 현재는 reviewOverlayHtml 로 통합되어 빈 문자열 반환
 *   (reviewOverlay 가 credit_grade 우선 표시하고 없으면 무심사/심사필요 fallback) */
export function creditOverlayHtml(_product) {
  return '';
}

/* ── 하단 풀폭 overlay — credit_grade 우선, 없으면 심사여부 ── */
export function reviewOverlayHtml(product) {
  // 1) credit_grade 값 있으면 그걸 (신용무관/중신용/일반신용)
  const credit = normalizeCreditGrade(
    product?._policy?.credit_grade || product?._policy?.screening_criteria || product?.credit_grade
  );
  if (credit) {
    // "무관" 계열은 초록(safe), 아니면 분홍(caution)
    const tone = /무관|없음|전체/.test(credit) ? 'is-no-review' : 'is-review-needed';
    return `<span class="srch-thumb-tag ${tone}">${credit}</span>`;
  }
  // 2) fallback — 심사여부
  const need = needsReview(product);
  return `<span class="srch-thumb-tag ${need ? 'is-review-needed' : 'is-no-review'}">${need ? '심사필요' : '무심사'}</span>`;
}

/* ── 상단 뱃지 라인 (카드·갤러리 공통): [차량상태][상품구분][신용등급] ── */
export function topBadgesHtml(product) {
  return `${vehicleStatusBadge(product)}${productTypeBadge(product)}${creditGradeBadge(product)}`;
}
