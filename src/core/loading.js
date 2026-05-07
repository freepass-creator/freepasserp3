/**
 * loading.js — 전역 로딩 인디케이터 (표준 컴포넌트, 모든 비동기 작업 공통).
 *
 *  사용:
 *    import { withLoading, showLoading, hideLoading, setLoadingMessage } from './loading.js';
 *
 *    // 가장 흔한 패턴 — 작업 감싸기
 *    await withLoading('시트 불러오는 중...', async () => {
 *      const data = await fetchSheet();
 *      return data;
 *    });
 *
 *    // 단계별 메시지 갱신 (긴 작업)
 *    showLoading('URL 파싱 중...');
 *    setLoadingMessage('탭 정보 조회 중...');
 *    setLoadingMessage('매물 매칭 중...');
 *    hideLoading();
 *
 *  CSS: desktop.css 의 .app-loading-* 룰 (모바일 mobile.css 도 동일 셀렉터로 적용)
 */

let _overlay = null;
let _msgEl = null;
let _depth = 0;     // 중첩 호출 카운트 — 마지막 hide 시에만 제거

function ensureOverlay() {
  if (_overlay) return _overlay;
  _overlay = document.createElement('div');
  _overlay.className = 'app-loading-overlay';
  _overlay.setAttribute('role', 'status');
  _overlay.setAttribute('aria-live', 'polite');
  _overlay.innerHTML = `
    <div class="app-loading-box">
      <i class="ph ph-circle-notch app-loading-spin"></i>
      <span class="app-loading-msg"></span>
    </div>
  `;
  _msgEl = _overlay.querySelector('.app-loading-msg');
  document.body.appendChild(_overlay);
  return _overlay;
}

/** 오버레이 표시 (이미 떠있으면 메시지 갱신 + depth++). */
export function showLoading(message = '처리 중...') {
  ensureOverlay();
  _depth++;
  _msgEl.textContent = message;
}

/** 진행 중에 메시지만 갱신 (overlay 떠있을 때 의미). */
export function setLoadingMessage(message) {
  if (_msgEl) _msgEl.textContent = message;
}

/** 오버레이 숨김 — depth 가 0 이 되면 실제 제거. */
export function hideLoading() {
  if (_depth > 0) _depth--;
  if (_depth === 0 && _overlay) {
    _overlay.remove();
    _overlay = null;
    _msgEl = null;
  }
}

/** 작업 promise 를 감싸 자동 표시/숨김 — try/finally 패턴 캡슐화.
 *  fn 안에서 setLoadingMessage 로 단계별 메시지 갱신 가능. */
export async function withLoading(message, fn) {
  showLoading(message);
  try {
    return await fn();
  } finally {
    hideLoading();
  }
}
