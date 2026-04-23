/**
 * WS4 리사이즈 — 비활성화됨
 * 사용자 요청으로 좌우 패널 크기조정 기능 제거. 필요 시 재도입.
 * 호출부 호환을 위해 함수는 유지 (no-op) — 이전에 저장된 폭은 제거.
 */
export function initWs4Resize(storageKey) {
  if (storageKey) {
    try { localStorage.removeItem(storageKey); } catch {}
  }
}
