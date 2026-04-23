/**
 * 정산 자동화 규칙 — 수수료 계산 + 환수 로직
 *
 * 계약 완료 → 정산 레코드 자동 생성 (계약당 1건)
 * - 수수료: 월 대여료 × 수수료율 (기본 10% / 파트너별 오버라이드)
 * - 환수: 계약 취소/중도해지 시 기지급 수수료 환수 금액 계산
 */

/** 수수료율 조회 — 파트너별 커스텀 > 기본값 */
export function getFeeRate(providerCode, partners = []) {
  const partner = partners.find(p => p.partner_code === providerCode);
  if (partner?.fee_rate != null) return Number(partner.fee_rate);
  return 0.1; // 기본 10%
}

/** 정산 기본값 계산 */
export function calculateSettlement(contract, partners = []) {
  const rentAmount = Number(contract.rent_amount_snapshot || 0);
  const feeRate = getFeeRate(contract.provider_company_code, partners);
  const feeAmount = Math.round(rentAmount * feeRate);

  return {
    settlement_code: `ST_${contract.contract_code}`,
    contract_code: contract.contract_code,
    car_number: contract.car_number_snapshot || '',
    sub_model_snapshot: contract.sub_model_snapshot || contract.model_snapshot || '',
    customer_name: contract.customer_name || '',
    provider_uid: contract.provider_uid || '',
    provider_company_code: contract.provider_company_code || '',
    partner_code: contract.provider_company_code || '',
    agent_uid: contract.agent_uid || '',
    agent_code: contract.agent_code || '',
    agent_channel_code: contract.agent_channel_code || '',
    rent_amount: rentAmount,
    fee_rate: feeRate,
    fee_amount: feeAmount,
    settlement_status: 'pending', // pending | paid | clawback
    contract_date: contract.contract_date || '',
    created_at: Date.now(),
  };
}

/** 환수 금액 계산 — 계약 중도해지 시 기지급분 비례 환수 */
export function calculateClawback(settlement, contract) {
  if (!settlement || settlement.settlement_status !== 'paid') return 0;
  const originalMonths = Number(contract.rent_month_snapshot || 0);
  const contractStart = contract.contract_date ? new Date(contract.contract_date).getTime() : 0;
  const cancelledAt = contract.cancelled_at || Date.now();
  if (!originalMonths || !contractStart) return 0;

  const elapsedMs = cancelledAt - contractStart;
  const elapsedMonths = Math.max(0, elapsedMs / (30 * 86400 * 1000));
  const usedRatio = Math.min(1, elapsedMonths / originalMonths);
  const refundRatio = 1 - usedRatio;
  return Math.round(Number(settlement.fee_amount || 0) * refundRatio);
}

/**
 * 계약 상태 → 정산 상태 자동 전환 제안
 * - 계약완료 + 정산 없음 → 정산 생성 필요
 * - 계약취소 + 정산 paid → 환수 필요
 */
export function getAutoAction(contract, settlement) {
  if (contract.contract_status === '계약완료' && !settlement) return 'create';
  if (contract.contract_status === '계약취소' && settlement?.settlement_status === 'paid') return 'clawback';
  return null;
}
