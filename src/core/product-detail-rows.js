/**
 * product-detail-rows.js — ERP search detail / catalog modal 공통 row 데이터 추출
 *
 * 두 매체가 같은 차량 데이터를 다른 마크업(.info-grid vs .cat-rows)으로 표시하지만
 * 라벨·필드 매핑·정책 fallback 룰은 한 곳에서 관리해야 일관성 보장.
 *
 * 사용:
 *   const rows = extractProductDetailRows(product, { canSeeFee: true, isAdmin: false });
 *   rows.basic   → [['차량번호', '12가1234'], ...]
 *   rows.spec    → ...
 *   rows.ins     → [['대인', '1억', '없음'], ...]   // 3-tuple (보장한도/면책금)
 *   rows.cond    → 정책 매핑 후 계약조건
 *   rows.etc     → 부가 정보 (admin/내부용)
 *   rows.price   → [{m, rent, dep, fee}, ...]
 *   rows.fee     → price 중 fee>0 만 (canSeeFee=true 일 때만 채움)
 */
import { fmtMoney, fmtDate, fmtMileage } from './ui-helpers.js';

/* 정책 lookup — product._policy(이미 enrich) 우선, 없으면 직접 매칭 */
function pickPolicy(p, policies = []) {
  return p._policy || (policies || []).find(po => po.policy_code === p.policy_code) || {};
}

/* 심사 필요 판단 — credit_grade 가 신용필요·저신용 등이면 심사 */
function needsReview(p, pol) {
  const v = String(pol?.screening_criteria || pol?.credit_grade || p?.credit_grade || '').trim();
  if (!v) return false;
  return /신용필요|심사|저신용/.test(v);
}

export function extractProductDetailRows(p, options = {}) {
  const { canSeeFee = false, isAdmin = false, policies = [] } = options;
  const pol = pickPolicy(p, policies);
  const policyName = pol.policy_name || p.policy_name || '';

  // 1. 기본정보
  const basic = [
    ['차량번호', p.car_number],
    ['제조사', p.maker],
    ['모델', p.model],
    ['세부모델', p.sub_model],
    ['차량상태', p.vehicle_status],
  ];

  // 2. 제조사 스펙
  const spec = [
    ['트림',       p.trim_name || p.trim],
    ['연식',       p.year],
    ['외장색',     p.ext_color],
    ['내장색',     p.int_color],
    ['연료',       p.fuel_type],
    ['주행',       p.mileage ? fmtMileage(p.mileage) + ' km' : ''],
    ['구동',       p.drive_type],
    ['인승',       p.seats ? p.seats + '인승' : ''],
    ['배기량',     p.engine_cc ? Number(p.engine_cc).toLocaleString() + 'cc' : ''],
    ['차종',       p.vehicle_class],
    ['상품구분',   p.product_type],
    ['용도',       p.usage],
    ['최초등록일', fmtDate(p.first_registration_date)],
    ['차령만료일', fmtDate(p.vehicle_age_expiry_date)],
    ['차량가격',   p.vehicle_price ? fmtMoney(p.vehicle_price) : ''],
    ['차대번호',   p.vin],
    ['위치',       p.location],
  ];

  // 3. 보험 정보 — 3-tuple [구분, 한도, 면책금]
  const ins = [
    ['대인',     pol.injury_compensation_limit,          pol.injury_deductible],
    ['대물',     pol.property_compensation_limit,        pol.property_deductible],
    ['자손사고', pol.personal_injury_compensation_limit, pol.personal_injury_deductible],
    ['무보험상해', pol.uninsured_compensation_limit,     pol.uninsured_deductible],
    ['자차손해', pol.own_damage_compensation,            pol.own_damage_min_deductible],
    ['긴급출동', pol.roadside_assistance, ''],
  ].filter(r => r[1] || r[2]);

  // 4. 기타 계약 조건
  const creditRaw = pol.credit_grade || pol.screening_criteria || p.credit_grade;
  const creditDisplay = String(creditRaw || '').trim() === '저신용' ? '신용무관' : creditRaw;
  const cond = [
    ['심사여부',     needsReview(p, pol) ? '심사필요' : '무심사'],
    ['심사기준',     creditDisplay],
    ['보험 포함',    pol.insurance_included ?? p.insurance_included],
    ['약정 주행거리', pol.annual_mileage || p.annual_mileage],
    ['1만km추가',    pol.mileage_upcharge_per_10000km],
    ['보증금분납',   pol.deposit_installment],
    ['보증카드',     pol.deposit_card_payment],
    ['결제방식',     pol.payment_method],
    ['위약금',       pol.penalty_condition],
    ['대여지역',     pol.rental_region],
    ['탁송비',       pol.delivery_fee],
    ['기본연령',     pol.basic_driver_age || p.base_age || p.min_age],
    ['연령상한',     pol.driver_age_upper_limit],
    ['연령하향',     pol.driver_age_lowering],
    ['연령하향비',   pol.age_lowering_cost],
    ['개인범위',     pol.personal_driver_scope],
    ['사업자범위',   pol.business_driver_scope],
    ['추가인원',     pol.additional_driver_allowance_count],
    ['추가운전비',   pol.additional_driver_cost],
    ['정비서비스',   pol.maintenance_service],
  ];

  // 5. 부가 정보 (admin/내부 — catalog 노출 X)
  const etc = isAdmin ? [
    ['정책코드',   pol.policy_code || p.policy_code],
    ['정책명',     policyName],
    ['정책유형',   pol.policy_type],
    ['공급코드',   p.provider_company_code],
    ['영업코드',   p.partner_code],
    ['상품코드',   p.product_code],
    ['상품UID',    p._key],
    ['수수료환수', pol.commission_clawback_condition],
    ['특이사항',   p.partner_memo || p.note],
  ] : [];

  // 6. 가격 — rent>0 필터, 1~60개월 범위
  const priceEntries = Object.entries(p.price || {})
    .map(([m, v]) => ({
      m: Number(m),
      rent: Number(v?.rent || 0),
      dep:  Number(v?.deposit || 0),
      fee:  Number(v?.fee || v?.commission || 0),
      fee_memo: v?.fee_memo || '',
    }))
    .filter(r => Number.isFinite(r.m) && r.m >= 1 && r.m <= 60 && r.rent > 0)
    .sort((a, b) => a.m - b.m);

  const fee = canSeeFee ? priceEntries.filter(r => r.fee > 0) : [];

  // 옵션 chips (raw 배열로)
  const opts = Array.isArray(p.options)
    ? p.options
    : (p.options ? String(p.options).split(/[·,\/]/).map(s => s.trim()).filter(Boolean) : []);

  return {
    basic, spec, ins, cond, etc,
    price: priceEntries,
    fee,
    options: opts,
    policy: pol,
    policyName,
  };
}
