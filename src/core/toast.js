/**
 * Toast notifications
 */
let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.className = 'toast-container';
  // 스크린리더가 변경 감지 — polite: 현재 발화 끝난 뒤 읽음 (방해 X)
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
  document.body.appendChild(container);
  return container;
}

export function showToast(message, type = 'info', duration = 2600) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  if (type === 'error') el.setAttribute('role', 'alert');  // 에러는 즉시 읽힘
  ensureContainer().appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = `all ${200}ms var(--ease)`;
    setTimeout(() => el.remove(), 200);
  }, duration);
}
