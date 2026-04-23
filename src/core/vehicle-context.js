/**
 * 차량 컨텍스트 조회 — 차량번호 또는 상품코드로 모든 관련 데이터 통합 조회
 *
 * 사용:
 *   import { getVehicleContext } from '../core/vehicle-context.js';
 *   const ctx = getVehicleContext({ carNumber: '146하7728' });
 *   // ctx = { product, policy, provider, partner, contracts, settlements, rooms, price, terms }
 */
import { store } from './store.js';
import { findPolicy } from './policy-utils.js';

/**
 * 차량 컨텍스트 조회
 * @param {Object} query - { carNumber?, productCode?, productUid?, productKey? }
 * @returns {{
 *   product: Object|null,
 *   policy: Object|null,
 *   provider: Object|null,
 *   partner: Object|null,
 *   contracts: Array,
 *   settlements: Array,
 *   rooms: Array,
 *   price: Object,
 *   terms: Object,
 * }}
 */
export function getVehicleContext({ carNumber, productCode, productUid, productKey } = {}) {
  const products = store.products || [];
  const policies = store.policies || [];
  const partners = store.partners || [];
  const contracts = store.contracts || [];
  const settlements = store.settlements || [];
  const rooms = store.rooms || [];

  // 1. 상품 찾기
  const product = products.find(p =>
    (carNumber && p.car_number === carNumber) ||
    (productCode && p.product_code === productCode) ||
    (productUid && p.product_uid === productUid) ||
    (productKey && p._key === productKey)
  ) || null;

  if (!product) {
    return { product: null, policy: null, provider: null, partner: null, contracts: [], settlements: [], rooms: [], price: {}, terms: {} };
  }

  // 2. 정책 매칭
  const policy = findPolicy(product, policies);

  // 3. 공급사(파트너) 매칭
  const provider = partners.find(p =>
    p.partner_code === product.provider_company_code ||
    p.partner_code === product.partner_code ||
    p._key === product.provider_company_code
  ) || null;
  const partner = provider;

  // 4. 관련 계약/정산/대화방
  const relatedContracts = contracts.filter(c =>
    c.product_uid === product._key ||
    c.product_code === product.product_code ||
    c.car_number_snapshot === product.car_number
  );
  const relatedSettlements = settlements.filter(s =>
    s.product_uid === product._key ||
    s.car_number === product.car_number ||
    relatedContracts.some(c => c.contract_code === s.contract_code)
  );
  const relatedRooms = rooms.filter(r =>
    r.product_uid === product._key ||
    r.vehicle_number === product.car_number
  );

  // 5. 가격 (기간별)
  const price = product.price || {};

  // 6. 대여조건 (정책에서 자동 연동)
  const terms = policy ? {
    screening_criteria: policy.screening_criteria,
    credit_grade: policy.credit_grade,
    basic_driver_age: policy.basic_driver_age,
    driver_age_upper_limit: policy.driver_age_upper_limit,
    driver_age_lowering: policy.driver_age_lowering,
    annual_mileage: policy.annual_mileage,
    mileage_upcharge_per_10000km: policy.mileage_upcharge_per_10000km,
    deposit_installment: policy.deposit_installment,
    deposit_card_payment: policy.deposit_card_payment,
    rental_region: policy.rental_region,
    insurance_included: policy.insurance_included,
    maintenance_service: policy.maintenance_service,
    annual_roadside_assistance: policy.annual_roadside_assistance,
  } : {};

  return {
    product,
    policy,
    provider,
    partner,
    contracts: relatedContracts,
    settlements: relatedSettlements,
    rooms: relatedRooms,
    price,
    terms,
  };
}

/** 차량번호로 간편 조회 */
export function getVehicleByCarNumber(carNumber) {
  return getVehicleContext({ carNumber });
}

/** 상품코드로 간편 조회 */
export function getVehicleByProductCode(productCode) {
  return getVehicleContext({ productCode });
}
