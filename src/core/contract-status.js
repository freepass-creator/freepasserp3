/**
 * contract-status.js — 계약 상태 단일 소스 (원칙 #13 Enum/Code)
 *
 * 이전: '계약요청'·'계약대기'·'계약발송'·'계약완료'·'계약취소' 리터럴이
 *       contract.js | auto-status.js | app.js | settlement-rules.js 등에 분산.
 * 이제: 이 모듈에서만 정의. 상태 추가/변경 시 한 곳만 고침.
 *  (정산상태 SSOT = settlement-status.js 와 동일 패턴)
 */

export const CONTRACT_STATUS = Object.freeze({
  REQUESTED: '계약요청',
  WAITING:   '계약대기',
  SENT:      '계약발송',
  DONE:      '계약완료',
  CANCELLED: '계약취소',
});

/** 진행 중(미확정) 상태 — 차량 '출고협의' 전환·중복 계약 차단 판정에 사용 */
export const CONTRACT_IN_PROGRESS = Object.freeze([
  CONTRACT_STATUS.REQUESTED,
  CONTRACT_STATUS.WAITING,
  CONTRACT_STATUS.SENT,
]);

export const isContractInProgress = (status) => CONTRACT_IN_PROGRESS.includes(status);
export const isContractDone = (status) => status === CONTRACT_STATUS.DONE;
export const isContractCancelled = (status) => status === CONTRACT_STATUS.CANCELLED;
