/**
 * Excel 다운로드 공용 유틸
 * - 컬럼 정의에 get(row) 지원 (중첩 경로·파생 필드)
 * - 헤더 1행 + 첫 2열 freeze (스크롤 시 항상 차량 식별 가능)
 * - autoFilter로 Excel 내에서 직접 필터링
 */

import { first, parsePol, parseRange, findPolicy, insVal } from './policy-utils.js';
import { firstProductImage } from './product-photos.js';

// enrichProductsWithPolicy는 외부(search.js 등)에서도 쓰므로 re-export
export { enrichProductsWithPolicy } from './policy-utils.js';

export async function downloadExcel(title, cols, data) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });

  // 컬럼 폭만 설정 (헤더는 addTable이 생성)
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 12; });

  ws.properties.defaultRowHeight = 18;

  // 데이터 2D 배열 (엑셀 Table은 2D array가 편함)
  const rows = data.map(row =>
    cols.map(c => {
      const raw = c.get ? c.get(row) : row[c.f];
      if (raw === null || raw === undefined) return '';
      if (c.hyperlink) {
        const url = typeof c.hyperlink === 'function' ? c.hyperlink(row) : raw;
        if (url) return { text: c.linkText || '보기', hyperlink: url, tooltip: url };
        return '';
      }
      return raw;
    })
  );

  // Excel Table (네이티브 표) — 헤더에 체크박스 필터 드롭다운 자동 + 슬라이서 삽입 가능
  ws.addTable({
    name: 'DataTbl',
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: cols.map(c => ({ name: c.l, filterButton: true })),
    rows: rows.length ? rows : [cols.map(() => '')],
  });

  // 헤더 스타일 (Pretendard 9pt bold)
  ws.getRow(1).height = 22;
  ws.getRow(1).eachCell(cell => {
    cell.font = { name: 'Pretendard', bold: true, size: 9 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  // 바디 폰트 9pt + 숫자 포맷 + 링크 스타일 + 흐린 stripe
  const stripeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF2' } };
  for (let r = 0; r < rows.length; r++) {
    const excelRow = ws.getRow(r + 2);
    excelRow.height = 18;
    const isStripe = r % 2 === 1;
    cols.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      if (c.hyperlink) {
        cell.font = { name: 'Pretendard', size: 9, color: { argb: 'FF1B2A4A' }, underline: true };
      } else {
        cell.font = { name: 'Pretendard', size: 9 };
      }
      cell.alignment = { vertical: 'middle' };
      if (c.numFmt) cell.numFmt = c.numFmt;
      if (isStripe) cell.fill = stripeFill;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `freepass_${title}_${new Date().toISOString().slice(0,10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── 상품 컬럼 (그룹 기반 — 엑셀에서 셀병합 헤더로 렌더) ── */
const won = '#,##0';
const pr = (m, k) => ({
  f: `${k}_${m}`,
  l: `${m}개월`,
  group: { rent:'대여료', deposit:'보증금', fee:'수수료' }[k],
  w: 12,
  numFmt: won,
  get: r => Number(r.price?.[String(m)]?.[k] || 0) || '',
});

export const PRODUCT_COLS = [
  // ── 뱃지/상태 (먼저) ──
  { f:'vehicle_status', l:'차량상태',  w:10 },
  { f:'product_origin', l:'신차/중고', w:10, get: r => /^신차/.test(r.product_type || '') ? '신차' : (/^중고/.test(r.product_type || '') ? '중고' : '') },
  { f:'product_way',    l:'렌트/구독', w:10, get: r => /구독$/.test(r.product_type || '') ? '구독' : (/렌트$/.test(r.product_type || '') ? '렌트' : '') },
  { f:'review_status',  l:'심사여부',  w:10 },
  // ── 식별 ──
  { f:'car_number',     l:'차량번호',  w:14 },
  { f:'maker',          l:'제조사',    w:12 },
  { f:'model',     l:'모델',      w:16 },
  { f:'sub_model',      l:'세부모델',  w:16 },
  // ── 기본스펙 ──
  { f:'year',           l:'연식',     w:8 },
  { f:'mileage',        l:'주행거리', w:10, numFmt: won },
  { f:'fuel_type',      l:'연료',     w:8 },
  { f:'ext_color',      l:'외장색',   w:10 },
  { f:'int_color',      l:'내장색',   w:10 },
  // ── 문의 하이퍼링크 (차량번호 기준 → 자동 대화 시작) ──
  { f:'erp',            l:'문의',     w:10, linkText:'💬 문의' },
  // ── 사진 (외부링크 + Firebase Storage 통합) ──
  {
    f: 'photo',
    l: '사진',
    w: 10,
    linkText: '📷 사진',
    hyperlink: r => firstProductImage(r),
    get: r => firstProductImage(r),
  },
  // ── 기간별 대여료·보증금 (기간별 쌍으로, 6개월 제외) ──
  pr(1,'rent'),  pr(1,'deposit'),
  pr(12,'rent'), pr(12,'deposit'),
  pr(24,'rent'), pr(24,'deposit'),
  pr(36,'rent'), pr(36,'deposit'),
  pr(48,'rent'), pr(48,'deposit'),
  pr(60,'rent'), pr(60,'deposit'),
  // ── 세부 ──
  { f:'trim_name',      l:'세부트림',  w:14 },
  { f:'options',        l:'세부옵션',  w:40 },
  // ═════ 이하 정책정보 ═════
  // 대여기본
  { f:'basic_driver_age',    l:'운전연령',     group:'대여기본', w:10, get: r => r._policy?.basic_driver_age || r.base_age || '' },
  { f:'annual_mileage',      l:'연간주행거리', group:'대여기본', w:12, get: r => r._policy?.annual_mileage || r.annual_mileage || '' },
  { f:'insurance_included',  l:'보험포함',     group:'대여기본', w:10, get: r => r._policy?.insurance_included || r.insurance_included || '' },
  { f:'credit_grade',        l:'신용등급',     group:'대여기본', w:10, get: r => r._policy?.credit_grade || r.credit_grade || '' },
  // 보험 — 리스크별 한도·면책금 쌍 (개별 필드 → combined 필드 → legacy pol 순 fallback)
  { f:'ins_injury_limit',    l:'대인한도',      w:14, get: r => insVal(r, 'injury_limit_deductible',          'injury_compensation_limit',          'bodily',     'limit') },
  { f:'ins_injury_deduct',   l:'대인면책금',    w:12, get: r => insVal(r, 'injury_limit_deductible',          'injury_deductible',                  'bodily',     'deductible') },
  { f:'ins_property_limit',  l:'대물한도',      w:14, get: r => insVal(r, 'property_limit_deductible',        'property_compensation_limit',        'property',   'limit') },
  { f:'ins_property_deduct', l:'대물면책금',    w:12, get: r => insVal(r, 'property_limit_deductible',        'property_deductible',                'property',   'deductible') },
  { f:'ins_self_limit',      l:'자기신체한도',  w:14, get: r => insVal(r, 'personal_injury_limit_deductible', 'personal_injury_compensation_limit', 'selfBodily', 'limit') },
  { f:'ins_self_deduct',     l:'자기신체면책금',w:12, get: r => insVal(r, 'personal_injury_limit_deductible', 'personal_injury_deductible',         'selfBodily', 'deductible') },
  { f:'ins_unins_limit',     l:'무보험한도',    w:14, get: r => insVal(r, 'uninsured_limit_deductible',       'uninsured_compensation_limit',       'uninsured',  'limit') },
  { f:'ins_unins_deduct',    l:'무보험면책금',  w:12, get: r => insVal(r, 'uninsured_limit_deductible',       'uninsured_deductible',               'uninsured',  'deductible') },
  { f:'ins_own_limit',       l:'자차한도',      w:14, get: r => insVal(r, 'own_damage_limit_deductible',      'own_damage_compensation',            'ownDamage',  'limit') },
  { f:'ins_own_rate',        l:'자차수리비율',  w:10, get: r => first(r._policy?.own_damage_compensation_rate, r._policy?.own_damage_repair_rate) },
  { f:'ins_own_deduct_min',  l:'자차면책금최소', w:12, get: r => {
    const ind = r._policy?.own_damage_min_deductible;
    if (ind) return ind;
    const combined = insVal(r, 'own_damage_limit_deductible', '__none__', 'ownDamage', 'deductible');
    return combined ? parseRange(combined).min : '';
  }},
  { f:'ins_own_deduct_max',  l:'자차면책금최대', w:12, get: r => {
    const ind = r._policy?.own_damage_max_deductible;
    if (ind) return ind;
    const combined = insVal(r, 'own_damage_limit_deductible', '__none__', 'ownDamage', 'deductible');
    return combined ? parseRange(combined).max : '';
  }},
  // 보험 기타
  { f:'ins_roadside',        l:'긴급출동',      w:12, get: r => first(r._policy?.roadside_assistance, r.condition?.emergency) },
  // 대여조건
  { f:'cond_km_upcharge',    l:'1만Km추가',       group:'대여조건', w:14, get: r => r._policy?.mileage_upcharge_per_10000km || '' },
  { f:'cond_deposit_inst',   l:'보증금분납',       group:'대여조건', w:10, get: r => r._policy?.deposit_installment || '' },
  { f:'cond_payment',        l:'결제방식',         group:'대여조건', w:10, get: r => r._policy?.payment_method || '' },
  { f:'cond_penalty',        l:'위약금',           group:'대여조건', w:12, get: r => r._policy?.penalty_condition || '' },
  { f:'cond_card_payment',   l:'보증금카드',       group:'대여조건', w:12, get: r => r._policy?.deposit_card_payment || '' },
  { f:'cond_rental_region',  l:'대여지역',         group:'대여조건', w:10, get: r => r._policy?.rental_region || '' },
  { f:'cond_delivery_fee',   l:'탁송비',           group:'대여조건', w:10, get: r => r._policy?.delivery_fee || '' },
  { f:'cond_age_lowering',   l:'연령하향',         group:'대여조건', w:12, get: r => r._policy?.driver_age_lowering || '' },
  { f:'cond_age_cost',       l:'연령하향비용',     group:'대여조건', w:14, get: r => r._policy?.age_lowering_cost || '' },
  { f:'cond_personal_scope', l:'개인운전자범위',   group:'대여조건', w:12, get: r => r._policy?.personal_driver_scope || '' },
  { f:'cond_business_scope', l:'사업자운전자범위', group:'대여조건', w:12, get: r => r._policy?.business_driver_scope || '' },
  { f:'cond_addl_driver',    l:'추가운전자수',     group:'대여조건', w:10, get: r => r._policy?.additional_driver_allowance_count || '' },
  { f:'cond_addl_cost',      l:'추가운전자비용',   group:'대여조건', w:12, get: r => r._policy?.additional_driver_cost || '' },
  { f:'cond_maintenance',    l:'정비서비스',       group:'대여조건', w:10, get: r => r._policy?.maintenance_service || '' },
  { f:'cond_age_upper',      l:'운전연령상한',     group:'대여조건', w:10, get: r => r._policy?.driver_age_upper_limit || '' },
  // 기간별 수수료 (6개월 제외)
  pr(1,'fee'), pr(12,'fee'), pr(24,'fee'), pr(36,'fee'), pr(48,'fee'), pr(60,'fee'),
  // 차량 메타
  { f:'vehicle_class',  l:'차종구분',   w:10 },
  { f:'first_registration_date', l:'최초등록일', w:12 },
  { f:'vehicle_age_expiry_date', l:'차령만료일', w:12 },
  { f:'vehicle_price',  l:'차량가격',   w:12, numFmt: won },
  { f:'location',       l:'위치',       w:10 },
  // 코드
  { f:'provider_company_code', l:'공급사',   group:'코드', w:12 },
  { f:'partner_code',   l:'파트너',   group:'코드', w:12 },
  { f:'policy_code',    l:'정책',     group:'코드', w:14 },
  { f:'policy_name',    l:'정책명',   group:'코드', w:14 },
  { f:'product_code',   l:'상품',     group:'코드', w:20 },
  // 메타
  { f:'partner_memo',   l:'특이사항',   w:24 },
  { f:'product_uid',    l:'상품UID',    w:18 },
];

/** 원본 탭·상세 탭용 전체 라벨 (group_label) — 단일행 헤더에서 그룹 맥락 유지 */
const fullHead = c => c.group ? `${c.group}_${c.l}` : c.l;

/* ── 엑셀 컬럼 번호 → 문자 (A, B, ..., Z, AA, ...) ── */
function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * 탭1: 좌측 필터 패널 + FILTER() 수식 목록 (ERP 스타일)
 * 탭2: 원본 백업 데이터 (Excel Table, 체크박스 필터)
 * 양 탭 모두 문의/계약 하이퍼링크 컬럼 포함 → 클릭 시 ERP 해당 페이지로 이동
 *
 * @param {string} title
 * @param {Array} cols
 * @param {Array} data
 * @param {Array<{label, field}>} filterFields  필터 패널 항목
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]  링크 기본 URL (기본: location.origin)
 *   ⚠ Excel 2021+ / Microsoft 365 / Google Sheets 필요 (FILTER 수식)
 */
export async function downloadExcelWithFilter(title, cols, data, filterFields, opts = {}) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const baseUrl = opts.baseUrl || (typeof location !== 'undefined' ? location.origin : '');

  // 단일 시트 — 전체 cols를 정해진 순서대로 + 엑셀 네이티브 체크박스 필터
  const ws = wb.addWorksheet(title || '차량목록', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });

  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 12; });

  const headerNames = cols.map(c => fullHead(c));
  const rows = data.map(row => cols.map(c => {
    // 문의 하이퍼링크 — car_number 기반 자동 주입
    if (c.f === 'erp') {
      const car = row.car_number || '';
      return car ? { text: c.linkText || '💬 문의', hyperlink: `${baseUrl}/?car=${encodeURIComponent(car)}` } : '';
    }
    const raw = c.get ? c.get(row) : row[c.f];
    if (c.hyperlink && raw) {
      const url = typeof c.hyperlink === 'function' ? c.hyperlink(row) : raw;
      return url ? { text: c.linkText || '보기', hyperlink: url } : '';
    }
    return (raw === null || raw === undefined) ? '' : raw;
  }));

  ws.addTable({
    name: 'MainTbl',
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: headerNames.map(n => ({ name: n, filterButton: true })),
    rows: rows.length ? rows : [headerNames.map(() => '')],
  });

  ws.getRow(1).height = 22;
  ws.getRow(1).eachCell(cell => {
    cell.font = { name: 'Pretendard', bold: true, size: 9 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  const stripeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF2' } };
  for (let r = 0; r < rows.length; r++) {
    const row = ws.getRow(r + 2);
    row.height = 18;
    const isStripe = r % 2 === 1; // 짝수번째 데이터 행만 살짝 배경
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const isLink = c.f === 'erp' || c.hyperlink;
      cell.font = isLink
        ? { name: 'Pretendard', size: 9, color: { argb: 'FF1B2A4A' }, underline: true }
        : { name: 'Pretendard', size: 9 };
      cell.alignment = { vertical: 'middle' };
      if (c.numFmt) cell.numFmt = c.numFmt;
      if (isStripe) cell.fill = stripeFill;
    });
  }

  // ── 다운로드 ──
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `freepass_${title}_${new Date().toISOString().slice(0,10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 기본 필터 항목 (상품 목록용) */
export const PRODUCT_FILTER_FIELDS = [
  { label: '차량상태',  field: 'vehicle_status' },
  { label: '상품구분',  field: 'product_type' },
  { label: '신차/중고', field: 'product_origin' },
  { label: '렌트/구독', field: 'product_way' },
  { label: '제조사',    field: 'maker' },
  { label: '연료',      field: 'fuel_type' },
  { label: '공급사',    field: 'provider_company_code' },
];

/** 필터 목록 탭(탭1)에 노출할 주요 스펙 필드 — 그룹별 가로 배치 */
export const PRODUCT_MAIN_FIELDS = [
  // 차량정보 (개별)
  'car_number',
  'maker_model',
  'vehicle_status',
  'product_origin',
  'product_way',
  'review_status',
  'sub_model',
  'trim_name',
  'year',
  'fuel_type',
  'mileage',
  'ext_color',
  'int_color',
  'photo',
  // 대여료 (기간별)
  'rent_1','rent_6','rent_12','rent_24','rent_36','rent_48','rent_60',
  // 보증금
  'deposit_1','deposit_6','deposit_12','deposit_24','deposit_36','deposit_48','deposit_60',
  // 수수료
  'fee_1','fee_6','fee_12','fee_24','fee_36','fee_48','fee_60',
  // 보험 한도
  'ins_injury_limit','ins_property_limit','ins_self_limit','ins_unins_limit','ins_own_limit',
  // 보험 면책
  'ins_injury_deduct','ins_property_deduct','ins_self_deduct','ins_unins_deduct','ins_own_deduct',
];
