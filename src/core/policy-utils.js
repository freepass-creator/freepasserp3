/**
 * policy-utils.js — 상품·정책 공용 파싱/매칭 헬퍼
 *
 * 여러 페이지에서 중복 구현되던 로직 통합.
 */

/* ── 값 선택: 비어있지 않은 첫 값 ── */
export function first(...vs) {
  for (const v of vs) {
    if (v !== undefined && v !== null && String(v).trim() && v !== '-') return v;
  }
  return '';
}

/* ── "한도/면책" 슬래시 결합 문자열 파싱 ── */
export function parsePol(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === '-') return { limit: '', deductible: '' };
  const parts = s.split('/').map(x => x.trim()).filter(Boolean);
  return parts.length >= 2
    ? { limit: parts[0], deductible: parts.slice(1).join(' / ') }
    : { limit: s, deductible: '' };
}

/* ── "min~max" 범위 문자열 파싱 (~, -, –, —) ── */
export function parseRange(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { min: '', max: '' };
  const parts = s.split(/[~\-–—]/).map(x => x.trim()).filter(Boolean);
  return parts.length >= 2
    ? { min: parts[0], max: parts[parts.length - 1] }
    : { min: s, max: '' };
}

/* ── 정책 문서에서 product에 해당하는 정책 찾기 (policy_code 매칭) ── */
export function findPolicy(product, policies = []) {
  if (!product || !policies?.length) return {};
  if (!product.policy_code) return {};
  return policies.find(t => t.policy_code === product.policy_code || t._key === product.policy_code) || {};
}

/* ── products 배열에 정책 병합 (엑셀 내보내기 전 호출) ── */
export function enrichProductsWithPolicy(products, policies = []) {
  return products.map(p => {
    const policy = findPolicy(p, policies);
    return policy && Object.keys(policy).length ? { ...p, _policy: policy } : p;
  });
}

/* ── 보험 값 추출 (개별 필드 → combined slash 필드 → legacy product.policy 순)
 * @param r product (_policy, .policy 가질 수 있음)
 * @param combinedField  정책 레거시 combined 필드명 (예: 'injury_limit_deductible')
 * @param individualField 정책 신규 단일 필드명 (예: 'injury_compensation_limit')
 * @param polKey legacy product.policy 안의 키 (예: 'bodily', 'ownDamage')
 * @param kind 'limit' | 'deductible'
 */
export function insVal(r, combinedField, individualField, polKey, kind) {
  const t = r?._policy || {};
  if (t[individualField]) return t[individualField];
  const combined = t[combinedField];
  if (combined) {
    const p = parsePol(combined);
    return p[kind] || '';
  }
  const pol = r?.policy || {};
  if (pol[polKey]) {
    const p = parsePol(pol[polKey]);
    return p[kind] || '';
  }
  return '';
}
