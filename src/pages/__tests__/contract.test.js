import { describe, it, expect, vi } from 'vitest';
import { makeTempContractCode, CONTRACT_STATUSES } from '../contract.js';

/* contract.js 의 격리 가능한 export — 코드 발급, 상수 */
/* 현재 포맷: TMP-YYMMDD-NN (날짜 6자리 + 시퀀스 2자리)
   nextSequence 는 firebase 호출이라 mock 필요 */

vi.mock('../../firebase/collections.js', () => {
  let n = 0;
  return { nextSequence: vi.fn(async () => { n += 1; return n; }) };
});

describe('makeTempContractCode', () => {
  it('TMP-{YYMMDD}-{NN} 형식', async () => {
    const code = await makeTempContractCode();
    expect(code).toMatch(/^TMP-\d{6}-\d{2}$/);
  });

  it('현재 날짜 포함 (YYMMDD)', async () => {
    const code = await makeTempContractCode();
    const d = new Date();
    const yymmdd = String(d.getFullYear()).slice(2)
                 + String(d.getMonth() + 1).padStart(2, '0')
                 + String(d.getDate()).padStart(2, '0');
    expect(code.startsWith(`TMP-${yymmdd}-`)).toBe(true);
  });

  it('연속 호출 시 다른 코드 (시퀀스 증가)', async () => {
    const a = await makeTempContractCode();
    const b = await makeTempContractCode();
    expect(a).not.toBe(b);
  });
});

describe('CONTRACT_STATUSES', () => {
  it('5개 상태 포함', () => {
    expect(CONTRACT_STATUSES).toHaveLength(5);
    expect(CONTRACT_STATUSES).toContain('계약요청');
    expect(CONTRACT_STATUSES).toContain('계약대기');
    expect(CONTRACT_STATUSES).toContain('계약발송');
    expect(CONTRACT_STATUSES).toContain('계약완료');
    expect(CONTRACT_STATUSES).toContain('계약취소');
  });
});
