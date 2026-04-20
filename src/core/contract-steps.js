/**
 * contract-steps.js — 계약 진행단계 단일 소스
 *
 * 7단계 (2a/2b 병렬):
 *  1  출고문의 → 출고응답 (가능/불가)
 *  2a 계약금입금 → 계약금확인
 *  2b 서류제출 → 서류심사 (승인/부결)
 *  3  계약서요청 → 계약서발송 (관리자)
 *  4  계약서완료 → 잔금완료
 *  5  출고요청 → 출고완료
 *  6  인도확인 → 계약완료 → 정산생성
 */

export const STEPS = [
  {
    id: 'delivery_inquiry',
    phase: 1,
    agent: { key: 'agent_delivery_inquiry', label: '출고 문의' },
    provider: { key: 'provider_delivery_response', label: '출고 응답', choices: ['가능', '불가'] },
  },
  {
    id: 'deposit',
    phase: 2,
    parallel: true,
    agent: { key: 'agent_deposit_paid', label: '계약금 입금' },
    provider: { key: 'provider_deposit_confirmed', label: '계약금 확인' },
  },
  {
    id: 'documents',
    phase: 2,
    parallel: true,
    agent: { key: 'agent_docs_submitted', label: '서류 제출' },
    provider: { key: 'provider_docs_review', label: '서류 심사', choices: ['승인', '부결'] },
  },
  {
    id: 'contract_request',
    phase: 3,
    requires: ['deposit', 'documents'], // 2a + 2b 둘 다 완료 필요
    agent: { key: 'agent_contract_requested', label: '계약서 요청' },
    admin: { key: 'admin_contract_sent', label: '계약서 발송' },
  },
  {
    id: 'balance',
    phase: 4,
    agent: { key: 'agent_contract_completed', label: '계약서 완료' },
    provider: { key: 'provider_balance_confirmed', label: '잔금 완료' },
  },
  {
    id: 'release',
    phase: 5,
    agent: { key: 'agent_release_requested', label: '출고 요청' },
    provider: { key: 'provider_release_completed', label: '출고 완료' },
  },
  {
    id: 'handover',
    phase: 6,
    agent: { key: 'agent_handover_confirmed', label: '인도 확인' },
    provider: { key: 'provider_contract_completed', label: '계약 완료' },
    auto: true, // 양쪽 완료 시 → 계약완료 + 정산 생성
  },
];

/**
 * 단계별 잠금 상태 계산
 * @param {object} checks - 계약의 체크 필드들 (contract.agent_delivery_inquiry 등)
 * @returns {object} { stepId: { locked, agentDone, providerDone, adminDone, choice } }
 */
export function getStepStates(checks = {}) {
  const states = {};
  const isDone = key => {
    const v = checks[key];
    return v === true || v === 'yes' || v === '가능' || v === '승인';
  };
  const isRejected = key => {
    const v = checks[key];
    return v === '불가' || v === '부결';
  };
  const getChoice = key => checks[key] || null;

  let prevPhaseDone = true; // 1단계는 항상 열림

  for (const step of STEPS) {
    const agentKey = step.agent?.key;
    const providerKey = step.provider?.key;
    const adminKey = step.admin?.key;

    const agentDone = agentKey ? isDone(agentKey) : true;
    const providerDone = providerKey ? isDone(providerKey) : true;
    const adminDone = adminKey ? isDone(adminKey) : true;
    const rejected = providerKey ? isRejected(providerKey) : false;

    // 잠금: 이전 단계 미완료 or requires 미충족
    let locked = false;
    if (step.phase === 1) {
      locked = false;
    } else if (step.requires) {
      // 병렬 의존: requires의 모든 step이 완료되어야
      locked = step.requires.some(reqId => {
        const reqState = states[reqId];
        return !reqState || !(reqState.agentDone && (reqState.providerDone || reqState.adminDone));
      });
    } else if (step.parallel) {
      // 병렬 단계: 이전 phase 완료 필요
      const prevPhase = step.phase - 1;
      const prevSteps = STEPS.filter(s => s.phase === prevPhase);
      locked = prevSteps.some(s => {
        const ps = states[s.id];
        return !ps || !(ps.agentDone && (ps.providerDone || ps.adminDone));
      });
    } else {
      // 순차: 이전 단계 완료 필요
      const prevIdx = STEPS.indexOf(step) - 1;
      if (prevIdx >= 0) {
        const prev = states[STEPS[prevIdx].id];
        locked = !prev || !(prev.agentDone && (prev.providerDone || prev.adminDone));
      }
    }

    states[step.id] = {
      locked,
      agentDone,
      providerDone: providerKey ? isDone(providerKey) : true,
      adminDone: adminKey ? isDone(adminKey) : true,
      rejected,
      choice: providerKey ? getChoice(providerKey) : null,
      done: agentDone && (providerDone || adminDone) && !rejected,
    };
  }

  return states;
}

/**
 * 전체 진행률
 */
export function getProgress(checks = {}) {
  const states = getStepStates(checks);
  const total = STEPS.length;
  const done = STEPS.filter(s => states[s.id]?.done).length;
  return { done, total };
}

/**
 * 모든 체크 키 목록
 */
export function allCheckKeys() {
  const keys = [];
  for (const step of STEPS) {
    if (step.agent?.key) keys.push(step.agent.key);
    if (step.provider?.key) keys.push(step.provider.key);
    if (step.admin?.key) keys.push(step.admin.key);
  }
  return keys;
}
