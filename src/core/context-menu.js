/**
 * 공용 컨텍스트 메뉴 (우클릭 팝업)
 * 사용: openContextMenu(e, [{ icon, label, action, danger? }])
 */

let activeMenu = null;

export function openContextMenu(event, items) {
  event.preventDefault();
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, i) => `
    <button class="ctx-item ${it.danger ? 'is-danger' : ''}" role="menuitem" data-i="${i}">
      ${it.icon ? `<i class="${it.icon}" aria-hidden="true"></i>` : ''}
      <span>${it.label}</span>
    </button>
  `).join('');
  document.body.appendChild(menu);

  // 위치 — 화면 밖 넘치지 않게 보정
  const { clientX: x, clientY: y } = event;
  const { offsetWidth: w, offsetHeight: h } = menu;
  const px = Math.min(x, window.innerWidth - w - 8);
  const py = Math.min(y, window.innerHeight - h - 8);
  menu.style.left = `${px}px`;
  menu.style.top  = `${py}px`;

  // 이벤트 위임 + AbortController로 cleanup 통합
  const ac = new AbortController();
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.ctx-item');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    closeContextMenu();
    items[i].action?.();
  }, { signal: ac.signal });

  // 첫 항목 포커스 (키보드 사용자)
  const firstItem = menu.querySelector('.ctx-item');
  firstItem?.focus();

  activeMenu = menu;
  activeMenuAC = ac;
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
    document.addEventListener('contextmenu', closeContextMenu, { once: true });
    document.addEventListener('keydown', onKey, { signal: ac.signal });
  }, 0);
}

let activeMenuAC = null;

function onKey(e) {
  if (e.key === 'Escape') { closeContextMenu(); return; }
  // 위/아래 화살표로 항목 이동
  if (!activeMenu) return;
  const items = Array.from(activeMenu.querySelectorAll('.ctx-item'));
  const idx = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
  else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); items[idx].click(); }
}

export function closeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
    activeMenuAC?.abort();
    activeMenuAC = null;
  }
}
