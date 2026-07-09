/**
 * vehicle-status.js — 차량(상품) 출고상태 단일 소스 (원칙 #13 Enum/Code)
 *
 * 이전: '즉시출고'·'출고가능'·'상품화중'·'출고협의'·'출고불가' 리터럴이
 *       app.js | contract.js | auto-status.js | product.js | admin-ops.js 등에 분산.
 * 이제: 이 모듈에서만 정의. 상태 추가/변경 시 한 곳만 고침.
 *  (계약상태 SSOT = contract-status.js, 정산상태 SSOT = settlement-status.js 와 동일 패턴)
 *
 * ※ 서버 sync(api/sync/external-sheet.js)의 normalizeVehicleStatus 는 별도 serverless 라
 *   이 모듈을 import 못 함 — 그쪽은 이 값들의 미러(mirror). 값 변경 시 양쪽 함께 수정.
 */

export const VEHICLE_STATUS = Object.freeze({
  IMMEDIATE:   '즉시출고',   // 지금 바로 출고 가능
  AVAILABLE:   '출고가능',   // 출고 가능
  PREPARING:   '상품화중',   // 상품화 작업 중
  NEGOTIABLE:  '출고협의',   // 진행 중·조건부 (섣불리 다른 에이전트에 팔면 안 됨)
  BLOCKED:     '출고불가',   // 계약완료·매각 등으로 판매 불가
});

/** 전체 5종 (UI 토글·필터용) */
export const VEHICLE_STATUSES_FULL = Object.freeze(Object.values(VEHICLE_STATUS));

/** 손님/영업에 노출 가능(판매 가능) 상태 — 즉시출고·출고가능 */
export const VEHICLE_SELLABLE = Object.freeze([VEHICLE_STATUS.IMMEDIATE, VEHICLE_STATUS.AVAILABLE]);

export const isVehicleSellable = (s) => VEHICLE_SELLABLE.includes(s);
export const isVehicleBlocked = (s) => s === VEHICLE_STATUS.BLOCKED;

/** 판매가능 여부 → 'available' | 'unavailable' (레코드 status 플래그와 동일 규격) */
export const vehicleStatusFlag = (s) => (isVehicleSellable(s) ? 'available' : 'unavailable');
