/**
 * settlement-status.js — 정산 상태 단일 소스
 *
 * 이전: '정산대기'·'정산완료'·'정산보류'·'환수대기'·'환수결정' 문자열이
 *       settlement.js | workspace.js | dashboard.js | menu-badges.js 등에 분산.
 * 이제: 이 모듈에서만 정의. 상태 추가/변경 시 한 곳만 고침.
 */

export const SETTLEMENT_STATUS = {
  PENDING: '정산대기',
  DONE:    '정산완료',
  HOLD:    '정산보류',
  CLAWBACK_WAIT: '환수대기',
  CLAWBACK_DONE: '환수결정',
};

/** 전체 상태 (UI 토글용 — 전체 상태 변경) */
export const SETTLEMENT_STATUSES_FULL = [
  SETTLEMENT_STATUS.PENDING,
  SETTLEMENT_STATUS.DONE,
  SETTLEMENT_STATUS.HOLD,
  SETTLEMENT_STATUS.CLAWBACK_WAIT,
  SETTLEMENT_STATUS.CLAWBACK_DONE,
];

/** 간이 상태 (workspace 등 좁은 패널용 — 핵심 3종) */
export const SETTLEMENT_STATUSES_BASIC = [
  SETTLEMENT_STATUS.PENDING,
  SETTLEMENT_STATUS.DONE,
  SETTLEMENT_STATUS.HOLD,
];

export const SETTLEMENT_STATUS_DEFAULT = SETTLEMENT_STATUS.PENDING;

/** 레코드에서 상태값 정규화 (settlement_status | status 병행 지원) */
export function getSettlementStatus(s) {
  return s?.settlement_status || s?.status || SETTLEMENT_STATUS_DEFAULT;
}

/** 상태 → 뱃지 톤 (badge-* 클래스에 사용) */
export function settlementStatusTone(s) {
  const st = getSettlementStatus(s);
  if (st === SETTLEMENT_STATUS.DONE) return 'ok';
  if (st === SETTLEMENT_STATUS.PENDING) return 'warn';
  if (st === SETTLEMENT_STATUS.HOLD || st.includes('환수')) return 'err';
  return 'muted';
}

/** 상태 업데이트 payload — settlement_status | status 두 필드 동기화 */
export function settlementStatusPayload(next) {
  return { settlement_status: next, status: next };
}
