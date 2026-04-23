/**
 * 관리자 — 엔트리 디스패처
 * /admin/users    → admin/users-partners.js
 * /admin/partners → admin/users-partners.js
 * /admin/sign     → admin/sign-inbox.js
 * /admin/dev      → admin/dev.js
 */

let activeUsersPartnersMod = null;
let activeDevMod = null;

export function mount(subPath) {
  // Unmount previous dev module if loaded
  if (activeDevMod) {
    try { activeDevMod.unmount?.(); } catch (_) {}
    activeDevMod = null;
  }

  // Unmount previous users/partners module if loaded
  if (activeUsersPartnersMod) {
    try { activeUsersPartnersMod.unmount?.(); } catch (_) {}
    activeUsersPartnersMod = null;
  }

  // Detect mode from URL
  const path = location.pathname;
  let mode;
  if (path.includes('partners')) mode = 'partners';
  else if (path.includes('dev')) mode = 'dev';
  else if (path.includes('sign')) mode = 'sign';
  else mode = 'users';

  const main = document.getElementById('mainContent');

  if (mode === 'dev') {
    import('./admin/dev.js').then(m => {
      activeDevMod = m;
      m.mount(main);
    });
    return;
  }
  if (mode === 'sign') {
    import('./admin/sign-inbox.js').then(m => m.mount(main));
    return;
  }

  // users | partners → 분리 모듈로 위임
  import('./admin/users-partners.js').then(m => {
    activeUsersPartnersMod = m;
    m.mount(main, subPath);
  });
}

export function unmount() {
  if (activeDevMod) {
    try { activeDevMod.unmount?.(); } catch (_) {}
    activeDevMod = null;
  }
  if (activeUsersPartnersMod) {
    try { activeUsersPartnersMod.unmount?.(); } catch (_) {}
    activeUsersPartnersMod = null;
  }
}
