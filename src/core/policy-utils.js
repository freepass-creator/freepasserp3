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

/* ── products 배열에 정책 병합 (매 데이터 변경마다 호출되는 핫패스) ──
 *  정책 인덱스(policy_code/_key)를 1회 구성해 매물마다의 선형탐색(O(N×M)) 제거.
 *  또한 정책이 삭제되어 매칭이 사라지면 상품에 남은 stale _policy 를 떼어냄(삭제 정책 스냅샷 잔존 방지). */
export function enrichProductsWithPolicy(products, policies = []) {
  const byCode = new Map();
  for (const t of policies || []) {
    if (t?.policy_code) byCode.set(t.policy_code, t);
    if (t?._key) byCode.set(t._key, t);
  }
  const hasPolicies = byCode.size > 0;
  return products.map(p => {
    const policy = p.policy_code ? byCode.get(p.policy_code) : null;
    if (policy) return { ...p, _policy: policy };
    if (hasPolicies && p._policy) { const { _policy, ...rest } = p; return rest; }  // 삭제된 정책의 stale 스냅샷 제거
    return p;
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
