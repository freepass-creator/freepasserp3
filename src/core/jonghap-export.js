/**
 * 종합표 생성 — ERP 매물(products) + 정책(policies) → 프리패스 종합시트 양식(42컬럼) 행 배열.
 *
 * 용도: 직원이 매일 공급사 탭들을 손으로 종합탭에 취합하던 작업을 대체.
 *   ERP 가 이미 (자동동기화 + 수기등록으로) 전 공급사 매물을 보유 → 종합탭 양식 그대로 뽑아
 *   클립보드 TSV 로 복사 → 직원이 구글시트 종합탭에 붙여넣기.
 *
 * 종합탭 컬럼 순서(2026-06 기준)는 JONGHAP_COLUMNS 에 고정. 시트 양식 바뀌면 여기만 수정.
 *   - 차량 컬럼(상태~배기량·비고·코드): product 에서 직접
 *   - 보험·운전 컬럼(운전자범위~전용계좌): 연결 policy 에서 압축 표기로 변환 (best-effort)
 */

import { normalizeProductType } from './normalize.js';

/* 종합탭 머리글 순서 — 절대 임의 변경 금지 (붙여넣기 정합성). 시트 헤더와 1:1 */
export const JONGHAP_COLUMNS = [
  '상태', '입고일자', '구분', '차량번호', '차종분류', '세부모델', '연료', '외장', '내장', 'Km',
  '단기보증', '1개월', '6개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월',
  '트림', '옵션', '최초등록', '소비자가격', '제조사', '배기량', '차고지',
  '운전자범위', '연주행', '분납', '21세', '23세', '1만+',
  '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌',
  '비고', '공급사코드', '정책코드',
];

/* ── 포맷 헬퍼 ── */
const won = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d]/g, ''));
  return n ? n.toLocaleString('ko-KR') : '';
};
// "1억원"→"1억" / "5,000만원"→"5,000만" / "무한"·"없음"→그대로
const shortLimit = (v) => String(v ?? '').replace(/원$/, '').trim();
// "30만원"→"30" / "없음"→"없음" / 빈값→''
const manOnly = (v) => {
  const s = String(v ?? '').trim();
  if (!s || s === '없음') return s;
  const m = s.match(/([\d,]+)\s*만/);
  return m ? m[1] : s;
};
// "연간 3만Km"→"3만Km"
const stripYearly = (v) => String(v ?? '').replace(/^연간\s*/, '').trim();
// "차량가액"→"차량"
const ownComp = (v) => String(v ?? '').replace(/가액$/, '').trim();

/* 정책 → 보험·운전 컬럼 (압축 표기). 정책 없으면 전부 빈값. */
function policyCells(pol) {
  if (!pol) return {};
  const join = (limit, ded) => {
    const l = shortLimit(limit), d = manOnly(ded);
    if (!l && !d) return '';
    return d ? `${l}/${d}` : l;
  };
  const own = () => {
    const comp = ownComp(pol.own_damage_compensation);
    const lo = manOnly(pol.own_damage_min_deductible);
    const hi = manOnly(pol.own_damage_max_deductible);
    const range = lo && hi ? `${lo}~${hi}` : (lo || hi || '');
    if (!comp && !range) return '';
    return range ? `${comp}/${range}` : comp;
  };
  return {
    운전자범위: pol.personal_driver_scope || '',
    연주행: stripYearly(pol.annual_mileage),
    분납: (pol.deposit_installment || '').replace('불가능', '불가'),
    대인: join(pol.injury_compensation_limit, pol.injury_deductible),
    대물: join(pol.property_compensation_limit, pol.property_deductible),
    자차: own(),
    자손: join(pol.self_body_accident, pol.self_body_deductible),
    무보험: shortLimit(pol.uninsured_damage),
    정비: pol.maintenance_service || '',
  };
}

/* product 의 product_type → 종합 '구분' (신차/중고). */
function gubun(p) {
  const t = normalizeProductType(p.product_type);
  if (t === '신차')   return '신차';
  if (t === '재렌트') return '중고';
  if (t === '재구독') return '중고';
  return '';
}

/* 단일 product → 종합 42컬럼 셀 배열 (JONGHAP_COLUMNS 순서). */
function productToRow(p, policiesByCode) {
  const pol = p.policy_code ? policiesByCode.get(p.policy_code) : null;
  const c = policyCells(pol);
  const price = p.price || {};
  const rent = (m) => won(price[m]?.rent);
  // 보증금 — 기간 무관 첫 번째 값 사용 (단기/장기 동일하므로 통일)
  const anyDep = won(
    price['12']?.deposit || price['24']?.deposit ||
    price['6']?.deposit  || price['36']?.deposit ||
    price['1']?.deposit  || price['48']?.deposit || price['60']?.deposit
  );

  const byCol = {
    상태: p.vehicle_status || '',
    입고일자: '',
    구분: gubun(p),
    차량번호: p.car_number || '',
    차종분류: p.model || '',
    세부모델: p.sub_model || '',
    연료: p.fuel_type || '',
    외장: p.ext_color || '',
    내장: p.int_color || '',
    Km: p.mileage ? String(p.mileage) : '',
    단기보증: anyDep,
    '1개월': rent('1'),
    '6개월': rent('6'),
    '12개월': rent('12'),
    장기보증: anyDep,
    '24개월': rent('24'),
    '36개월': rent('36'),
    '48개월': rent('48'),
    '60개월': rent('60'),
    트림: p.trim_name || '',
    옵션: p.options || '',
    최초등록: p.first_registration_date || '',
    소비자가격: won(p.vehicle_price),
    제조사: p.maker || '',
    배기량: p.engine_cc ? String(p.engine_cc) : '',
    차고지: p.location || '',
    ...c,
    '21세': p.sheet_meta?.age_21 || '',
    '23세': p.sheet_meta?.age_23 || '',
    '1만+': p.sheet_meta?.year_1plus || '',
    전용계좌: '',
    비고: p.partner_memo || '',
    공급사코드: p.provider_company_code || p.partner_code || '',
    정책코드: p.policy_code || '',
  };
  return JONGHAP_COLUMNS.map(col => byCol[col] ?? '');
}

/* products + policies → 종합 행 배열.
 *  - 삭제/차량번호 없는 매물 제외
 *  - 제조사·모델·차량번호 순 정렬
 *  반환: { columns, rows } (rows = string[][], 헤더 미포함) */
export function buildJonghapRows(products, policies) {
  const policiesByCode = new Map();
  for (const pol of (policies || [])) {
    const key = pol.policy_code || pol.term_code || pol._key;
    if (key && !policiesByCode.has(key)) policiesByCode.set(key, pol);
  }
  const rows = (products || [])
    .filter(p => p && !p._deleted && p.car_number)
    .sort((a, b) =>
      (a.maker || '').localeCompare(b.maker || '', 'ko') ||
      (a.model || '').localeCompare(b.model || '', 'ko') ||
      (a.car_number || '').localeCompare(b.car_number || '', 'ko'))
    .map(p => productToRow(p, policiesByCode));
  return { columns: JONGHAP_COLUMNS, rows };
}

/* 행 배열 → 클립보드용 TSV (탭 구분, 줄바꿈 행). includeHeader 면 머리글 행 포함.
 *  셀 내 탭/개행은 공백으로 치환 (붙여넣기 깨짐 방지). */
export function rowsToTsv({ columns, rows }, includeHeader) {
  const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  const lines = [];
  if (includeHeader) lines.push(columns.map(clean).join('\t'));
  for (const r of rows) lines.push(r.map(clean).join('\t'));
  return lines.join('\n');
}
