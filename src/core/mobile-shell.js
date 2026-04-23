/**
 * mobile-shell.js — 모바일 전용 UI 유틸
 * - isMobile(): UA 기반 폰 감지 (데스크톱 창 축소로는 트리거 안 됨)
 * - openBottomSheet(html, options): 재사용 가능 바텀시트
 * - openFab(opts): 플로팅 액션 버튼 헬퍼
 * - pushMobileView(html, options): 풀스크린 슬라이드 스택 뷰
 */

export const MOBILE_BREAKPOINT = 768;

// 실제 폰 UA만 매칭 — iPad/Android 태블릿/데스크톱 좁은 창 제외
// · iPhone: "iPhone"
// · Android 폰: "Android" + "Mobile" (태블릿은 "Mobile" 없음)
// · iPadOS 13+: 데스크톱 Safari UA 사용 → 매칭 안 됨 (의도)
const UA_PHONE = /iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini|Windows Phone/i;

/** 모바일(폰) 여부 — UA 기반. ?mobile=1/0 URL 파라미터로 강제 가능 (개발용) */
export function isMobile() {
  const force = new URLSearchParams(location.search).get('mobile');
  if (force === '1') return true;
  if (force === '0') return false;
  return UA_PHONE.test(navigator.userAgent || '');
}

/** 햅틱 피드백 — 사용자 설정 존중 (localStorage fp.haptic === 'off' 면 비활성) */
export function haptic(type = 'light') {
  if (localStorage.getItem('fp.haptic') === 'off') return;
  if (!navigator.vibrate) return;
  const patterns = {
    light:   5,            // 일반 탭 (버튼/칩/탭바)
    medium:  12,           // 중요 액션 (시트 열기/카드 진입)
    heavy:   20,           // 강한 확인 (계약 완료/삭제)
    toggle:  [4, 40, 4],   // 토글 on/off
    success: [10, 60, 10], // 성공 피드백
    error:   [30, 40, 30], // 오류
  };
  try { navigator.vibrate(patterns[type] ?? 5); } catch {}
}

/** 모바일 뷰포트 변경 감지 (debounced) */
export function onMobileChange(cb) {
  let last = isMobile();
  const handler = () => {
    const now = isMobile();
    if (now !== last) {
      last = now;
      cb(now);
    }
  };
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}

/**
 * 바텀 시트
 * @param {string} html - 시트 내부 HTML
 * @param {object} opts
 * @param {string} [opts.title] - 상단 제목
 * @param {boolean} [opts.dragToDismiss=true] - 핸들 드래그로 닫기
 * @param {(sheet)=>void} [opts.onMount] - DOM 마운트 직후 (바인딩)
 * @param {()=>void} [opts.onClose] - 닫힐 때
 * @returns {{close: ()=>void, root: HTMLElement}}
 */
export function openBottomSheet(html, opts = {}) {
  const { title = '', dragToDismiss = true, onMount, onClose } = opts;

  // 기존 시트 닫기
  document.querySelectorAll('.m-sheet-overlay, .m-sheet').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'm-sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'm-sheet';
  sheet.innerHTML = `
    <div class="m-sheet-handle"></div>
    ${title ? `
      <div class="m-sheet-header">
        <span class="m-sheet-title">${title}</span>
        <button class="m-sheet-close" aria-label="닫기"><i class="ph ph-x"></i></button>
      </div>
    ` : ''}
    <div class="m-sheet-body">${html}</div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  haptic('medium');

  // 하드웨어 뒤로가기로 시트 닫기 (history stack 활용)
  const historyKey = `mSheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  history.pushState({ mSheet: historyKey }, '', location.href);
  let closed = false;
  let poppedByBrowser = false;
  const onPopState = () => {
    poppedByBrowser = true;
    cleanup();
  };
  window.addEventListener('popstate', onPopState);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPopState);
    sheet.style.transition = 'transform var(--dur-slow) var(--ease)';
    sheet.style.transform = 'translateY(100%)';
    overlay.style.transition = 'opacity var(--dur) var(--ease)';
    overlay.style.opacity = '0';
    setTimeout(() => {
      sheet.remove();
      overlay.remove();
      onClose?.();
    }, 250);
  };
  const close = () => {
    if (closed) return;
    if (!poppedByBrowser && history.state?.mSheet === historyKey) {
      history.back();
    } else {
      cleanup();
    }
  };

  overlay.addEventListener('click', close);
  sheet.querySelector('.m-sheet-close')?.addEventListener('click', close);

  // 핸들 드래그 → 닫기
  if (dragToDismiss) {
    const handle = sheet.querySelector('.m-sheet-handle');
    let startY = 0, curY = 0, dragging = false;
    const onDown = (e) => {
      dragging = true;
      startY = (e.touches ? e.touches[0].clientY : e.clientY);
      curY = startY;
      sheet.style.transition = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      curY = (e.touches ? e.touches[0].clientY : e.clientY);
      const dy = Math.max(0, curY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      const dy = curY - startY;
      if (dy > 80) close();
      else sheet.style.transform = '';
    };
    handle.addEventListener('touchstart', onDown, { passive: true });
    handle.addEventListener('touchmove', onMove, { passive: true });
    handle.addEventListener('touchend', onUp);
    handle.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ESC 닫기
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const origClose = close;
  const wrappedClose = () => { document.removeEventListener('keydown', onKey); origClose(); };

  onMount?.(sheet);

  return { close: wrappedClose, root: sheet };
}

/**
 * 플로팅 액션 버튼
 * @param {object} opts
 * @param {string} opts.icon - phosphor 아이콘 클래스
 * @param {string} [opts.label] - 보조 텍스트
 * @param {()=>void} opts.onClick
 * @param {HTMLElement} [opts.mount=document.body]
 * @returns {{el: HTMLElement, remove: ()=>void}}
 */
export function openFab({ icon, label, onClick, mount }) {
  const host = mount || document.body;
  // 기존 FAB 제거
  host.querySelectorAll('.m-fab').forEach(el => el.remove());

  const btn = document.createElement('button');
  btn.className = 'm-fab';
  btn.innerHTML = `<i class="${icon || 'ph ph-plus'}"></i>${label ? `<span>${label}</span>` : ''}`;
  btn.addEventListener('click', () => onClick?.());
  host.appendChild(btn);

  return { el: btn, remove: () => btn.remove() };
}

/**
 * 풀스크린 뷰 푸시 (slide-in from right). 뒤로 가기 제스처 지원.
 * 뒤로 가기는 history.back() 으로 처리되며, popstate 시 자동 pop.
 *
 * @param {string} html - 내부 HTML
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.headerRight] - 우측 액션 HTML
 * @param {(view)=>void} [opts.onMount]
 * @param {()=>void} [opts.onClose]
 */
export function pushMobileView(html, opts = {}) {
  const { title = '', headerRight = '', onMount, onClose } = opts;

  const view = document.createElement('div');
  view.className = 'm-view m-page-enter';
  view.innerHTML = `
    <div class="m-topbar">
      <button class="m-topbar-back" aria-label="뒤로"><i class="ph ph-caret-left"></i></button>
      <span class="m-topbar-title">${title}</span>
      <span class="m-topbar-actions">${headerRight}</span>
    </div>
    <div class="m-page m-view-body">${html}</div>
  `;

  document.body.appendChild(view);
  haptic('medium');

  // History entry — 하드웨어/브라우저 뒤로가기 버튼 연결
  const historyKey = `mView-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  history.pushState({ mView: historyKey }, '', location.href);

  let closed = false;
  let poppedByBrowser = false;
  const onPopState = (e) => {
    // 우리 dummy entry 가 빠지는 순간 → view 닫기 (history.back() 호출 금지)
    poppedByBrowser = true;
    cleanup();
  };
  window.addEventListener('popstate', onPopState);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPopState);
    view.classList.remove('m-page-enter');
    view.style.animation = 'm-slide-out-right var(--dur-slow) var(--ease) forwards';
    setTimeout(() => { view.remove(); onClose?.(); }, 250);
  };

  const close = () => {
    if (closed) return;
    // history 에 우리 dummy entry 가 아직 있으면 back() → popstate → cleanup
    if (!poppedByBrowser && history.state?.mView === historyKey) {
      history.back();
    } else {
      cleanup();
    }
  };

  view.querySelector('.m-topbar-back').addEventListener('click', close);

  // Edge swipe back (left edge → right)
  let startX = 0, startY = 0, dx = 0, dy = 0, tracking = false;
  view.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t.clientX < 24) { tracking = true; startX = t.clientX; startY = t.clientY; }
  }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    dx = t.clientX - startX;
    dy = t.clientY - startY;
    if (Math.abs(dy) > Math.abs(dx)) { tracking = false; view.style.transform = ''; return; }
    if (dx > 0) view.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  view.addEventListener('touchend', () => {
    if (!tracking) return;
    tracking = false;
    view.style.transform = '';
    if (dx > 80) close();
  });

  onMount?.(view);
  return { view, close };
}
