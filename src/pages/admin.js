/**
 * 관리자 — 엔트리 디스패처
 * /admin/users    → admin/users-partners.js (mode=users)
 * /admin/partners → admin/users-partners.js (mode=partners)
 */

let activeMod = null;

export function mount(subPath) {
  if (activeMod) {
    try { activeMod.unmount?.(); } catch (_) {}
    activeMod = null;
  }
  const main = document.getElementById('mainContent');
  import('./admin/users-partners.js').then(m => {
    activeMod = m;
    m.mount(main, subPath);
  });
}

export function unmount() {
  if (activeMod) {
    try { activeMod.unmount?.(); } catch (_) {}
    activeMod = null;
  }
}
