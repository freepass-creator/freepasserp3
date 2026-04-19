/**
 * SPA Router with View Transitions API
 */
const routes = new Map();
let currentRoute = null;
let onNavigate = null;

export function defineRoutes(routeMap) {
  for (const [path, handler] of Object.entries(routeMap)) {
    routes.set(path, handler);
  }
}

export function setNavigateCallback(cb) {
  onNavigate = cb;
}

export function navigate(path, { transition = true } = {}) {
  if (path === currentRoute) return;

  const handler = routes.get(path);
  if (!handler) {
    console.warn(`[router] unknown route: ${path}`);
    return;
  }

  // currentRoute 즉시 갱신 — startViewTransition이 async라 swap 전에 다시
  //  navigate(path)가 들어와도 가드가 즉시 차단되도록
  currentRoute = path;

  const swap = () => {
    handler();
    onNavigate?.(path);
    history.pushState(null, '', path);
  };

  // renderShell 직후처럼 DOM을 방금 통째로 갈아엎은 경우
  //  → View Transition은 스냅샷/새 프레임 불일치로 abort되어 handler가 실행 안 됨
  //  → { transition: false }로 즉시 swap
  if (transition && document.startViewTransition) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}

export function getCurrentRoute() {
  return currentRoute;
}

/** shell 재생성·로그아웃 등 DOM 리셋 시 호출 — 다음 navigate 가드가 무력화되도록 */
export function resetRoute() {
  currentRoute = null;
}

// Handle browser back/forward
window.addEventListener('popstate', () => {
  const path = location.pathname || '/';
  if (path === currentRoute) return;
  const handler = routes.get(path);
  if (handler) {
    currentRoute = path;
    handler();
    onNavigate?.(path);
  }
});
