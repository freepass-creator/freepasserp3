import { describe, it, expect } from 'vitest';
import { makeTempContractCode, CONTRACT_STATUSES } from '../contract.js';

/* contract.js 의 격리 가능한 export — 코드 발급, 상수 */

describe('makeTempContractCode', () => {
  it('TMP-{년}-{6자리} 형식', () => {
    const code = makeTempContractCode();
    expect(code).toMatch(/^TMP-\d{4}-[0-9A-Z]{6}$/);
  });

  it('현재 연도 포함', () => {
    const code = makeTempContractCode();
    const yyyy = new Date().getFullYear();
    expect(code.startsWith(`TMP-${yyyy}-`)).toBe(true);
  });

  it('연속 호출 시 다른 코드 (시간 차)', async () => {
    const a = makeTempContractCode();
    // Date.now 변화를 보장하기 위해 짧게 대기 (base36 끝 6자리는 ms 범위)
    await new Promise(r => setTimeout(r, 50));
    const b = makeTempContractCode();
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
