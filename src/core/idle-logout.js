/**
 * 유휴 자동 로그아웃 — localStorage 'fp.autoLogout'(분) 기준.
 *  설정 페이지(모바일)에서 0(사용 안 함)/15/60/480분 선택. 0 이면 비활성.
 *  사용자 활동(포인터/키/터치/탭 복귀)마다 타이머 리셋, 초과 시 logout + 로그인 화면 복귀.
 *
 * 순환 import 방지: auth.js → idle-logout.js 는 정적, 역방향(logout)은 timeout 안에서 dynamic import.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'visibilitychange'];

/** 자동 로그아웃 선택지 (분) — 모바일/데스크톱 설정 공용 */
export const AUTO_LOGOUT_OPTIONS = [
  { min: 0,   label: '사용 안 함' },
  { min: 15,  label: '15분' },
  { min: 60,  label: '1시간' },
  { min: 480, label: '8시간' },
];

let timer = null;
let bound = null;
let lastReset = 0;

function getMinutes() {
  return Number(localStorage.getItem('fp.autoLogout') || '0');
}

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
}

function schedule() {
  clearTimer();
  const min = getMinutes();
  if (!min || min <= 0) return;          // 사용 안 함
  timer = setTimeout(async () => {
    detach();
    try {
      const { logout } = await import('../firebase/auth.js');
      await logout();
    } catch { /* 무시 — 어차피 reload 로 로그인 복귀 */ }
    location.reload();                    // 로그인 화면으로 확실히 복귀 (SPA 상태 초기화)
  }, min * 60 * 1000);
}

function attach() {
  if (bound) return;
  // 활동 감지마다 타이머 리셋 — mousemove 등 고빈도 이벤트 churn 방지 위해 10초 throttle
  bound = () => {
    const t = Date.now();
    if (t - lastReset < 10_000) return;
    lastReset = t;
    schedule();
  };
  ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, bound, { passive: true }));
}

function detach() {
  if (!bound) return;
  ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, bound));
  bound = null;
}

/** 로그인 직후 호출 — 활동 리스너 부착 + 타이머 시작 */
export function startIdleLogout() {
  if (typeof window === 'undefined') return;
  attach();
  schedule();
}

/** 로그아웃 시 호출 — 리스너 해제 + 타이머 제거 */
export function stopIdleLogout() {
  detach();
  clearTimer();
}

/** 설정값(fp.autoLogout) 변경 후 호출 — 즉시 재적용 */
export function refreshIdleLogout() {
  if (typeof window === 'undefined') return;
  if (!bound) attach();
  schedule();
}
