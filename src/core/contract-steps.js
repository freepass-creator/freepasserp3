/**
 * contract-steps.js — 계약 진행단계 단일 소스 (v2: 4단계 단순화)
 *
 * 4단계:
 *  1. 출고 문의 — 가능 여부
 *  2. 서류    — 서류 + 계약서 모두 완료
 *  3. 입금    — 계약금 + 잔금 모두 완료
 *  4. 출고    — 출고 요청 + 인도 확인 → 정산 자동
 *
 * 기존 14개 체크 키는 그대로 유지 (DB 호환). 단계 정의만 4개로 그룹핑.
 */

export const STEPS = [
  {
    id: 'inquiry',
    phase: 1,
    label: '출고 문의',
    icon: 'magnifying-glass',
    checks: [
      { actor: 'agent',    key: 'agent_delivery_inquiry',     label: '출고 문의' },
      { actor: 'provider', key: 'provider_delivery_response', label: '출고 응답', choices: ['출고 가능', '출고 협의', '출고 불가'] },
    ],
  },
  {
    id: 'docs',
    phase: 2,
    label: '서류',
    icon: 'file-text',
    checks: [
      { actor: 'agent',    key: 'agent_docs_submitted', label: '서류 제출' },
      { actor: 'provider', key: 'provider_docs_review', label: '서류 확인', choices: ['승인', '부결'] },
    ],
  },
  {
    id: 'payment',
    phase: 3,
    label: '입금',
    icon: 'coin',
    checks: [
      { actor: 'agent',    key: 'agent_balance_paid',         label: '계약금 입금', paymentShared: true },
      { actor: 'provider', key: 'provider_balance_confirmed', label: '잔금 확인', paymentShared: true },
    ],
  },
  {
    id: 'release',
    phase: 4,
    label: '출고',
    icon: 'truck',
    checks: [
      { actor: 'agent',    key: 'agent_handover_confirmed',    label: '인도 확인' },
      { actor: 'provider', key: 'provider_release_completed',  label: '출고 완료' },
    ],
  },
];

/* 체크 값 판정 — true / 'yes' / 긍정 선택지 모두 done 으로 인정 */
function isDone(value) {
  if (value === true || value === 'yes') return true;
  if (typeof value === 'string') {
    return ['가능', '승인', '출고 가능', '출고 협의', '서류 승인'].includes(value);
  }
  return false;
}
function isRejected(value) {
  if (typeof value === 'string') {
    return ['불가', '부결', '출고 불가', '서류 부결'].includes(value);
  }
  return false;
}

/**
 * 단계별 상태
 *   states[stepId] = {
 *     locked:      이전 단계 미완료
 *     done:        모든 sub-check done (rejected 없을 때)
 *     rejected:    sub-check 중 하나라도 거부
 *     subStates:   [{ key, actor, label, done, rejected, choice }]
 *     doneCount, totalCount
 *   }
 */
export function getStepStates(checks = {}) {
  const states = {};
  let prevDone = true;

  for (const step of STEPS) {
    const subStates = (step.checks || []).map((c) => {
      const v = checks[c.key];
      return {
        key: c.key,
        actor: c.actor,
        label: c.label,
        choices: c.choices,
        auto: !!c.auto,
        choice: typeof v === 'string' ? v : null,
        done: isDone(v),
        rejected: isRejected(v),
      };
    });

    const totalCount = subStates.length;
    const doneCount = subStates.filter((s) => s.done).length;
    const rejected = subStates.some((s) => s.rejected);
    const done = !rejected && totalCount > 0 && doneCount === totalCount;
    const locked = !prevDone;

    states[step.id] = {
      locked,
      done,
      rejected,
      subStates,
      doneCount,
      totalCount,
    };

    prevDone = done; // 이 단계 완료해야 다음 단계 활성
  }

  return states;
}

/**
 * 전체 진행률 — 단계 단위 (N/4)
 */
export function getProgress(checks = {}) {
  const states = getStepStates(checks);
  const total = STEPS.length;
  const done = STEPS.filter((s) => states[s.id]?.done).length;
  return { done, total };
}

/**
 * sub-check 단위 진행률 — 카드 등에서 세부 표시용 (예: 8/14)
 */
export function getDetailProgress(checks = {}) {
  let total = 0, done = 0;
  for (const step of STEPS) {
    for (const c of step.checks || []) {
      total += 1;
      if (isDone(checks[c.key])) done += 1;
    }
  }
  return { done, total };
}

/**
 * 모든 체크 키 목록 — 데이터 마이그레이션·필드 검증용
 */
export function allCheckKeys() {
  const keys = [];
  for (const step of STEPS) {
    for (const c of step.checks || []) keys.push(c.key);
  }
  return keys;
}
