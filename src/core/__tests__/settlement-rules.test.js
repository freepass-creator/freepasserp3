import { describe, it, expect } from 'vitest';
import {
  getFeeRate,
  calculateSettlement,
  calculateClawback,
  getAutoAction,
} from '../settlement-rules.js';

describe('getFeeRate', () => {
  it('파트너 커스텀 fee_rate 우선', () => {
    const partners = [{ partner_code: 'HCAP', fee_rate: 0.15 }];
    expect(getFeeRate('HCAP', partners)).toBe(0.15);
  });
  it('파트너 없으면 기본 10%', () => {
    expect(getFeeRate('UNKNOWN', [])).toBe(0.1);
  });
  it('파트너에 fee_rate 없으면 기본', () => {
    const partners = [{ partner_code: 'HCAP' }];
    expect(getFeeRate('HCAP', partners)).toBe(0.1);
  });
  it('fee_rate=0 명시는 그대로 (할인 케이스)', () => {
    const partners = [{ partner_code: 'HCAP', fee_rate: 0 }];
    expect(getFeeRate('HCAP', partners)).toBe(0);
  });
});

describe('calculateSettlement', () => {
  it('월대여료 × 기본 10% 수수료 계산', () => {
    const contract = {
      contract_code: 'CT2604_01',
      rent_amount_snapshot: 1000000,    // 100만원
      provider_company_code: 'HCAP',
      car_number_snapshot: '12가3456',
    };
    const result = calculateSettlement(contract, []);
    expect(result.fee_amount).toBe(100000);   // 10만원
    expect(result.fee_rate).toBe(0.1);
    expect(result.settlement_code).toBe('ST_CT2604_01');
    expect(result.contract_code).toBe('CT2604_01');
    expect(result.car_number).toBe('12가3456');
    expect(result.settlement_status).toBe('pending');
  });

  it('파트너 커스텀 수수료율 적용', () => {
    const contract = {
      contract_code: 'CT2604_02',
      rent_amount_snapshot: 1000000,
      provider_company_code: 'KCAP',
    };
    const partners = [{ partner_code: 'KCAP', fee_rate: 0.2 }];
    const result = calculateSettlement(contract, partners);
    expect(result.fee_amount).toBe(200000);
    expect(result.fee_rate).toBe(0.2);
  });

  it('rent_amount 없으면 fee 0', () => {
    const contract = { contract_code: 'CT0', provider_company_code: 'HCAP' };
    const result = calculateSettlement(contract, []);
    expect(result.fee_amount).toBe(0);
  });

  it('필수 snapshot 필드 보존 (agent/provider/customer)', () => {
    const contract = {
      contract_code: 'CT1',
      rent_amount_snapshot: 500000,
      provider_company_code: 'HCAP',
      provider_uid: 'p001',
      agent_uid: 'a001',
      agent_code: 'U0001',
      agent_channel_code: 'AGT01',
      customer_name: '홍길동',
      sub_model_snapshot: 'IG',
      model_snapshot: '그랜저',
    };
    const r = calculateSettlement(contract, []);
    expect(r.provider_uid).toBe('p001');
    expect(r.agent_uid).toBe('a001');
    expect(r.agent_code).toBe('U0001');
    expect(r.customer_name).toBe('홍길동');
    expect(r.sub_model_snapshot).toBe('IG');
  });
});

describe('calculateClawback', () => {
  it('지급되지 않은 정산 → 환수 0', () => {
    const settlement = { settlement_status: 'pending', fee_amount: 100000 };
    const contract = {};
    expect(calculateClawback(settlement, contract)).toBe(0);
  });

  it('지급된 정산 — 절반 사용 시 절반 환수', () => {
    const start = new Date('2024-01-01').getTime();
    const cancelledAt = start + 6 * 30 * 86400 * 1000;   // 6개월 경과 (12개월 계약 중 절반)
    const settlement = { settlement_status: 'paid', fee_amount: 1000000 };
    const contract = {
      rent_month_snapshot: 12,
      contract_date: '2024-01-01',
      cancelled_at: cancelledAt,
    };
    const refund = calculateClawback(settlement, contract);
    expect(refund).toBe(500000);
  });

  it('지급된 정산 — 만료 후 취소 → 환수 0 (모두 사용)', () => {
    const start = new Date('2024-01-01').getTime();
    const cancelledAt = start + 13 * 30 * 86400 * 1000;
    const settlement = { settlement_status: 'paid', fee_amount: 1000000 };
    const contract = {
      rent_month_snapshot: 12,
      contract_date: '2024-01-01',
      cancelled_at: cancelledAt,
    };
    expect(calculateClawback(settlement, contract)).toBe(0);
  });

  it('계약 정보 부족 → 0', () => {
    const settlement = { settlement_status: 'paid', fee_amount: 100000 };
    expect(calculateClawback(settlement, {})).toBe(0);
  });
});

describe('getAutoAction', () => {
  it('계약완료 + 정산 없음 → create', () => {
    expect(getAutoAction({ contract_status: '계약완료' }, null)).toBe('create');
  });
  it('계약취소 + paid 정산 → clawback', () => {
    const action = getAutoAction(
      { contract_status: '계약취소' },
      { settlement_status: 'paid' },
    );
    expect(action).toBe('clawback');
  });
  it('계약완료 + 정산 있음 → null (이미 처리)', () => {
    const action = getAutoAction(
      { contract_status: '계약완료' },
      { settlement_status: 'pending' },
    );
    expect(action).toBeNull();
  });
  it('계약요청 → null (아직 정산 단계 아님)', () => {
    expect(getAutoAction({ contract_status: '계약요청' }, null)).toBeNull();
  });
});
