/**
 * search-match.js — 모든 페이지 공통 검색 규격.
 *
 * 페이지마다 검색 필드를 일일이 나열하면 항목 누락이 생김.
 * 대신 레코드의 **모든 원시값(문자/숫자/배열)** + **공급사 코드→회사명·담당자명** + **연결 정책**을
 * 한 haystack 으로 자동 합쳐 "있는 정보로 뭐든 검색" 보장.
 *
 *   matchRecord(record, query, store)  → boolean
 *   recordHaystack(record, store)      → 소문자 합친 문자열
 */

// 검색 노이즈/긴 값 제외 (URL·타임스탬프·내부플래그·순수숫자 스펙)
const SKIP_KEYS = new Set([
  'image_urls', 'image_url', 'images', 'photo_urls', 'thumbnail',
  'updated_at', 'created_at', 'deleted_at', 'created_by', 'updated_by',
  '_deleted', '_drive_folder_virtual', '_dirty',
  // 순수 숫자 스펙 — 차량번호 검색 시 주행거리·가격 등이 오매칭되는 것 방지
  'mileage', 'vehicle_price', 'engine_cc',
]);

/* 공급사 코드 → 회사명·담당자명·연락처 (회사/담당자 어느 걸로 쳐도 매칭) */
function partnerText(code, store) {
  const p = (store.partners || []).find(
    x => (x.partner_code === code || x.company_code === code || x._key === code) && !x._deleted
  );
  if (!p) return '';
  return [p.partner_name, p.company_name, p.ceo_name, p.manager_name, p.manager_phone, p.company_phone, p.business_number]
    .filter(Boolean).join(' ');
}

export function recordHaystack(record, store = {}) {
  if (!record || typeof record !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(record)) {
    if (v == null || SKIP_KEYS.has(k)) continue;
    if (typeof v === 'string' || typeof v === 'number') parts.push(v);
    else if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string' || typeof x === 'number') parts.push(x);
    }
    // 중첩 객체(price·_policy 등)는 자동 제외 — 정책은 아래에서 명시 포함
  }
  // 공급사 코드 → 회사명·담당자명 (여러 코드 필드 중복 제거)
  const codes = [...new Set([
    record.provider_company_code, record.partner_code, record.company_code, record.provider_code,
  ].filter(Boolean))];
  for (const code of codes) parts.push(partnerText(code, store));
  // 연결 정책 (enrich 된 _policy)
  const pol = record._policy;
  if (pol && typeof pol === 'object') {
    parts.push(pol.policy_name, pol.policy_code, pol.credit_grade, pol.screening_criteria, pol.term_description);
  }
  return parts.filter(v => v != null && v !== '').join(' ').toLowerCase();
}

export function matchRecord(record, query, store = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return recordHaystack(record, store).includes(q);
}
