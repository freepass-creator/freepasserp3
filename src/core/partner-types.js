/**
 * partner-types.js — 파트너 유형(partner_type) 단일 소스
 *
 * partner_type 은 한글('공급사'/'영업채널'/'운영사')이 정본이나, 마이그레이션 과도기라
 * 영문 별칭(provider/sales_channel/operator 등)이 데이터에 혼재. 그 정규화를 여기 한 곳에 모음.
 *  (이전: app.js / admin-settlement.js / dev.js 등에 한↔영 매핑이 제각각 인라인)
 */

/** 표준 3종 (관리 UI 칩/선택지 순서) */
export const PARTNER_TYPES = ['공급사', '영업채널', '운영사'];

// 알려진 모든 표기(한/영) → 표준 한글
const CANON = {
  '공급사': '공급사', provider: '공급사', supplier: '공급사',
  '영업채널': '영업채널', sales_channel: '영업채널', channel: '영업채널',
  '운영사': '운영사', operator: '운영사',
};

/** 어떤 표기든 표준 한글 라벨로 정규화 (미지정/미지값은 원본 반환). 영문 별칭은 대소문자 무관. */
export function partnerTypeLabel(type) {
  const t = String(type || '').trim();
  return CANON[t] || CANON[t.toLowerCase()] || type || '';
}

/** 파트너가 특정 표준 유형인지 (한/영 혼재 흡수). canonical = '공급사'|'영업채널'|'운영사' */
export function isPartnerType(p, canonical) {
  return partnerTypeLabel(p?.partner_type) === canonical;
}

/** 공급사 여부 (가장 흔한 체크) */
export function isProviderPartner(p) {
  return isPartnerType(p, '공급사');
}
