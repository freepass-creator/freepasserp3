/* ── Styles ── */
import './styles/layers.css';
import './styles/tokens.css';
import './styles/reset.css';
import './styles/layout.css';
import './styles/controls.css';
import './styles/workspace.css';
import './styles/search.css';
import './styles/contract.css';
import './styles/contract-send.css';
import './styles/dashboard.css';
import './styles/product-manage.css';
import './styles/dark.css';

/* ── Core ── */
import { store, subscribe } from './core/store.js';
import { navigate, defineRoutes, setNavigateCallback, resetRoute } from './core/router.js';
import { initAuth } from './firebase/auth.js';
import { renderBreadcrumb } from './core/breadcrumb.js';
// Drive 썸네일 자동 하이드레이션 옵저버 — 최초 로드부터 상시 활성화
import './core/drive-photos.js';

/* ── Quick Menu Definition (role-based) ── */
const MENU_ALL = [
  { id: 'search',   icon: 'ph ph-magnifying-glass',  label: '상품 찾기',   path: '/search',   roles: ['admin','provider','agent'] },
  { id: 'home',     icon: 'ph ph-chat-circle',       label: '업무 소통',   path: '/',         roles: ['admin','provider','agent'] },
  { id: 'contract', icon: 'ph ph-file-text',         label: '계약 관리',   path: '/contract', roles: ['admin','provider','agent'] },
  { id: 'settle',   icon: 'ph ph-coins',             label: '정산 관리',   path: '/settle',   roles: ['admin','provider','agent'] },
  { id: 'product',  icon: 'ph ph-car-simple',        label: '재고 관리',   path: '/product',  roles: ['admin','provider'] },
  { id: 'policy',   icon: 'ph ph-scroll',            label: '정책 관리',   path: '/policy',   roles: ['admin','provider'] },
  // 관리자
  { id: 'mgmt',     icon: 'ph ph-crown',             label: '관리자', group: true,       roles: ['admin'] },
  { id: 'users',    icon: 'ph ph-users',             label: '사용자 관리', path: '/admin/users',   parent: 'mgmt', roles: ['admin'] },
  { id: 'partners', icon: 'ph ph-buildings',          label: '파트너 관리', path: '/admin/partners', parent: 'mgmt', roles: ['admin'] },
  { id: 'sign',     icon: 'ph ph-paper-plane-tilt',  label: '계약서 관리', path: '/admin/sign',    parent: 'mgmt', roles: ['admin'] },
  { id: 'dev',      icon: 'ph ph-code',              label: '개발 도구',   path: '/admin/dev',     parent: 'mgmt', roles: ['admin'] },
];

function getMenu(role) {
  return MENU_ALL.filter(m => m.roles.includes(role || 'agent'));
}

/* 모바일 하단 탭바 — 4개 핵심 플로우, 역할별 중앙 라벨만 다름
 *  영업자(agent): 문의 / 공급사(provider): 응대 / 관리자(admin): 소통 */
function getMobileTabs(role) {
  const chatLabel = role === 'agent' ? '문의'
                 : role === 'provider' ? '응대'
                 : '소통';
  return [
    { icon: 'ph ph-magnifying-glass', label: '검색',     path: '/search' },
    { icon: 'ph ph-chat-circle',      label: chatLabel,  path: '/' },
    { icon: 'ph ph-file-text',        label: '계약',     path: '/contract' },
    { icon: 'ph ph-gear',             label: '설정',     path: '/settings' },
  ];
}

function renderMenuItems(role) {
  const menu = getMenu(role);
  const groups = menu.filter(m => m.group);
  const topItems = menu.filter(m => !m.group && !m.parent);
  const openGroups = JSON.parse(localStorage.getItem('fp.sb.open') || '[]');

  let html = '';

  // Top items (현황, 찾기, 작업)
  topItems.forEach(m => {
    if (!m.path) return;
    html += `<button class="sb-item" data-path="${m.path}" data-menu="${m.id}"><i class="${m.icon}"></i><span>${m.label}</span><span class="sb-badge" data-badge="${m.id}"></span></button>`;
  });

  // Groups (조회, 등록, 관리자)
  groups.forEach(g => {
    const children = menu.filter(m => m.parent === g.id);
    const isOpen = openGroups.includes(g.id);
    html += `
      <div class="sb-group ${isOpen ? 'is-open' : ''}" data-group="${g.id}">
        <button class="sb-item sb-group-head">
          <i class="${g.icon}"></i><span>${g.label}</span>
          <i class="ph ph-caret-down sb-chevron"></i>
        </button>
        <div class="sb-group-body">
          ${children.map(c => `
            <button class="sb-item sb-child" data-path="${c.path}" data-menu="${c.id}"><i class="${c.icon}"></i><span>${c.label}</span><span class="sb-badge" data-badge="${c.id}"></span></button>
          `).join('')}
        </div>
      </div>
    `;
  });

  return html;
}

/* ── App Shell ── */
function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="shell">
      <nav class="sidebar" id="sidebar" aria-label="주 메뉴">
        <div class="sb-top">
          <div class="sb-brand">${store.currentUser?.company_name || ''}</div>
          <button class="sb-collapse-btn" id="sbCollapse" title="접기" aria-label="사이드바 접기"><i class="ph ph-caret-left" aria-hidden="true"></i></button>
        </div>
        <div class="sb-menu" id="sbMenu">
          ${renderMenuItems(store.currentUser?.role)}
        </div>
        <div class="sb-bottom">
          <button class="sb-item" id="qmTheme">
            <i class="ph ph-moon"></i><span>다크모드</span>
          </button>
          <button class="sb-item" data-path="/settings">
            <i class="ph ph-gear"></i><span>설정</span>
          </button>
        </div>
      </nav>
      <main class="main" id="mainArea">
        <header class="topbar">
          <div class="breadcrumb" id="breadcrumb" role="navigation" aria-label="현재 위치"></div>
          <div class="topbar-user" id="topbarUser"></div>
        </header>
        <div class="main-content" id="mainContent"></div>
      </main>
      <nav class="mobile-tab" id="mobileTab" aria-label="모바일 탐색">
        ${getMobileTabs(store.currentUser?.role).map(m => `
          <button class="mobile-tab-item" data-path="${m.path}">
            <i class="${m.icon}"></i>
            <span>${m.label}</span>
          </button>
        `).join('')}
      </nav>
    </div>
  `;

  // Sidebar click
  document.getElementById('sidebar').addEventListener('click', (e) => {
    // Navigate
    const btn = e.target.closest('[data-path]');
    if (btn) {
      navigate(btn.dataset.path);
      // Update active
      document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('is-active'));
      btn.classList.add('is-active');
      return;
    }
    // Group toggle
    const groupHead = e.target.closest('.sb-group-head');
    if (groupHead) {
      const group = groupHead.closest('.sb-group');
      group.classList.toggle('is-open');
      // Save open state
      const openGroups = Array.from(document.querySelectorAll('.sb-group.is-open')).map(g => g.dataset.group);
      localStorage.setItem('fp.sb.open', JSON.stringify(openGroups));
    }
  });

  // Mobile tab click
  document.getElementById('mobileTab').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-path]');
    if (btn) navigate(btn.dataset.path);
  });

  // Sidebar collapse/expand
  document.getElementById('sbCollapse')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('sidebar');
    const shell = document.querySelector('.shell');
    sidebar.classList.toggle('is-collapsed');
    if (sidebar.classList.contains('is-collapsed')) {
      shell.style.gridTemplateColumns = '48px 1fr';
      document.querySelector('#sbCollapse i').className = 'ph ph-caret-right';
    } else {
      shell.style.gridTemplateColumns = '';
      document.querySelector('#sbCollapse i').className = 'ph ph-caret-left';
    }
    localStorage.setItem('fp.sb.collapsed', sidebar.classList.contains('is-collapsed') ? '1' : '');
  });

  // Restore collapsed state
  if (localStorage.getItem('fp.sb.collapsed') === '1') {
    document.getElementById('sidebar')?.classList.add('is-collapsed');
    document.querySelector('.shell').style.gridTemplateColumns = '48px 1fr';
    const icon = document.querySelector('#sbCollapse i');
    if (icon) icon.className = 'ph ph-caret-right';
  }

  // Dark mode toggle
  document.getElementById('qmTheme')?.addEventListener('click', () => {
    const next = store.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.add('theme-switching');
    store.theme = next;
    document.documentElement.dataset.theme = next;
    localStorage.setItem('fp.theme', next);
    const btn = document.getElementById('qmTheme');
    const icon = btn?.querySelector('i');
    const label = btn?.querySelector('span');
    if (icon) icon.className = next === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
    if (label) label.textContent = next === 'dark' ? '라이트모드' : '다크모드';
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('theme-switching')));
  });
  // Set initial icon + label
  const themeBtn = document.getElementById('qmTheme');
  if (themeBtn && store.theme === 'dark') {
    const i = themeBtn.querySelector('i'); if (i) i.className = 'ph ph-sun';
    const s = themeBtn.querySelector('span'); if (s) s.textContent = '라이트모드';
  }

  // 상단바 사용자 메뉴
  renderTopbarUser();
}

function renderTopbarUser() {
  const el = document.getElementById('topbarUser');
  if (!el) return;
  const u = store.currentUser || {};
  const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();

  el.innerHTML = `
    <button class="topbar-user-btn" id="topbarUserBtn">
      <div class="topbar-user-avatar">${u.avatar_url ? `<img src="${u.avatar_url}">` : initial}</div>
      <span class="topbar-user-name">${u.name || u.email || '사용자'}</span>
      <i class="ph ph-caret-down icon-hint" aria-hidden="true"></i>
    </button>
    <div class="topbar-user-menu" id="topbarUserMenu" hidden>
      <div class="topbar-user-head">
        <div class="topbar-user-head-name">${u.name || '이름 없음'}</div>
        <div class="topbar-user-head-email">${u.email || ''}</div>
        <div class="topbar-user-head-meta">${[u.company_name, u.role, u.user_code].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="topbar-user-item" data-path="/account"><i class="ph ph-user"></i> 계정 정보</button>
      <button class="topbar-user-item" data-path="/settings"><i class="ph ph-gear"></i> 설정</button>
      <div class="topbar-user-divider"></div>
      <button class="topbar-user-item is-danger" id="topbarLogout"><i class="ph ph-sign-out"></i> 로그아웃</button>
    </div>
  `;

  const btn = document.getElementById('topbarUserBtn');
  const menu = document.getElementById('topbarUserMenu');
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!el.contains(e.target)) menu.hidden = true;
  });
  menu?.querySelectorAll('[data-path]').forEach(b => {
    b.addEventListener('click', () => { menu.hidden = true; navigate(b.dataset.path); });
  });
  document.getElementById('topbarLogout')?.addEventListener('click', async () => {
    menu.hidden = true;
    const { logout } = await import('./firebase/auth.js');
    await logout();
  });
}

function updateActiveMenu(path) {
  document.querySelectorAll('.sb-item[data-path]').forEach(el => {
    const active = el.dataset.path === path;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.querySelectorAll('.mobile-tab-item[data-path]').forEach(el => {
    const active = el.dataset.path === path;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  // Auto-open parent group
  const menuItem = MENU_ALL.find(m => m.path === path);
  if (menuItem?.parent) {
    const group = document.querySelector(`.sb-group[data-group="${menuItem.parent}"]`);
    if (group) group.classList.add('is-open');
  }
  renderBreadcrumb(path);
}

/* ── Login Page ── */
function renderLogin() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-page">
      <div class="login-brand"><span class="login-brand-main">freepass</span> <span class="login-brand-base">erp</span></div>
      <section class="login-card">
        <header class="login-head">
          <h2 class="login-title">로그인</h2>
          <p class="login-sub">이메일과 비밀번호를 입력해주세요.</p>
        </header>
        <form class="login-form" id="loginForm" novalidate>
          <div class="login-field">
            <label for="loginEmail">이메일</label>
            <input id="loginEmail" type="email" placeholder="name@company.com" autocomplete="username" required>
          </div>
          <div class="login-field">
            <label for="loginPw">비밀번호</label>
            <input id="loginPw" type="password" placeholder="비밀번호 입력" autocomplete="current-password" required>
          </div>
          <button type="submit" class="login-submit" id="loginBtn">로그인</button>
        </form>
        <div class="login-links">
          <a href="#" id="signupLink">계정 만들기</a>
          <span class="login-links-sep">·</span>
          <a href="#" id="resetLink">비밀번호 재설정</a>
        </div>
        <p class="login-msg" id="loginMsg" aria-live="polite"></p>
      </section>
      <div class="login-copy">&copy; 2026 freepassmobility. All Rights Reserved.</div>
    </div>
  `;

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pw = document.getElementById('loginPw').value;
    if (!email || !pw) return;

    const btn = document.getElementById('loginBtn');
    const card = btn.closest('.login-card');
    btn.disabled = true;
    card.classList.add('is-loading');

    try {
      const { login } = await import('./firebase/auth.js');
      await login(email, pw);
    } catch (e) {
      btn.disabled = false;
      card.classList.remove('is-loading');
      const { showToast } = await import('./core/toast.js');
      showToast('로그인 실패: 이메일 또는 비밀번호를 확인하세요', 'error');
    }
  });

  document.getElementById('signupLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    renderSignup();
  });

  document.getElementById('resetLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    renderResetPassword();
  });
}

function renderSignup() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-page">
      <div class="login-brand"><span class="login-brand-main">freepass</span> <span class="login-brand-base">erp</span></div>
      <section class="login-card">
        <header class="login-head">
          <h2 class="login-title">계정 만들기</h2>
          <p class="login-sub">가입 후 관리자 승인이 필요합니다.</p>
        </header>
        <form class="login-form" id="suForm" novalidate>
          <div class="login-field">
            <label for="suEmail">이메일</label>
            <input id="suEmail" type="email" placeholder="name@company.com" autocomplete="username" required>
          </div>
          <div class="login-field">
            <label for="suPw">비밀번호</label>
            <input id="suPw" type="password" placeholder="6자 이상" autocomplete="new-password" required>
          </div>
          <div class="login-field">
            <label for="suName">이름</label>
            <input id="suName" placeholder="홍길동" required>
          </div>
          <div class="login-field">
            <label for="suPhone">연락처</label>
            <input id="suPhone" type="tel" placeholder="010-0000-0000">
          </div>
          <div class="login-field">
            <label for="suCompany">소속 회사명</label>
            <input id="suCompany" placeholder="회사명">
          </div>
          <div class="login-field">
            <label for="suRole">역할</label>
            <select id="suRole">
              <option value="agent">영업자</option>
              <option value="provider">공급사</option>
            </select>
          </div>
          <button type="submit" class="login-submit" id="suBtn">가입하기</button>
        </form>
        <div class="login-links">
          <a href="#" id="suBack">로그인으로 돌아가기</a>
        </div>
      </section>
      <div class="login-copy">&copy; 2026 freepassmobility. All Rights Reserved.</div>
    </div>
  `;

  document.getElementById('suForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('suEmail').value;
    const pw = document.getElementById('suPw').value;
    if (!email || !pw || pw.length < 6) { showToast('이메일과 비밀번호(6자+) 필수', 'error'); return; }
    const btn = document.getElementById('suBtn');
    const card = btn.closest('.login-card');
    btn.disabled = true;
    card.classList.add('is-loading');
    try {
      const { signup } = await import('./firebase/auth.js');
      const user = await signup(email, pw);
      const { saveUserProfile } = await import('./firebase/collections.js');
      await saveUserProfile(user.uid, {
        email,
        name: document.getElementById('suName').value.trim(),
        phone: document.getElementById('suPhone').value.trim(),
        company_name: document.getElementById('suCompany').value.trim(),
        role: document.getElementById('suRole').value,
      });
      card.classList.remove('is-loading');
      showToast('가입 완료. 관리자 승인 후 이용 가능합니다.');
    } catch (e) {
      btn.disabled = false;
      card.classList.remove('is-loading');
      showToast('가입 실패: ' + (e.message || ''), 'error');
    }
  });

  document.getElementById('suBack')?.addEventListener('click', (e) => { e.preventDefault(); renderLogin(); });
}

function renderResetPassword() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-page">
      <div class="login-brand"><span class="login-brand-main">freepass</span> <span class="login-brand-base">erp</span></div>
      <section class="login-card">
        <header class="login-head">
          <h2 class="login-title">비밀번호 재설정</h2>
          <p class="login-sub">가입한 이메일로 재설정 링크를 보내드립니다.</p>
        </header>
        <form class="login-form" id="rpForm" novalidate>
          <div class="login-field">
            <label for="rpEmail">이메일</label>
            <input id="rpEmail" type="email" placeholder="name@company.com" autocomplete="username" required>
          </div>
          <button type="submit" class="login-submit" id="rpBtn">재설정 메일 전송</button>
        </form>
        <div class="login-links">
          <a href="#" id="rpBack">로그인으로 돌아가기</a>
        </div>
      </section>
      <div class="login-copy">&copy; 2026 freepassmobility. All Rights Reserved.</div>
    </div>
  `;

  document.getElementById('rpForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('rpEmail').value;
    if (!email) return;
    try {
      const { resetPassword } = await import('./firebase/auth.js');
      await resetPassword(email);
      showToast('재설정 메일 전송됨');
    } catch (e) {
      showToast('전송 실패', 'error');
    }
  });

  document.getElementById('rpBack')?.addEventListener('click', (e) => { e.preventDefault(); renderLogin(); });
}

/* ── Page Placeholders ── */
function placeholder(name) {
  return () => {
    const sub = document.getElementById('subBody');
    const main = document.getElementById('mainContent');
    if (sub) sub.innerHTML = `<div class="sub-notice">${name} 목록</div>`;
    if (main) main.innerHTML = `
      <div class="page-placeholder">
        <div>
          <i class="ph ph-hammer" aria-hidden="true"></i>
          <p>${name} 페이지 준비 중</p>
        </div>
      </div>
    `;
  };
}

/* ── Init ── */
async function init() {
  // Apply saved theme
  document.documentElement.dataset.theme = store.theme;

  // Current page cleanup
  let currentCleanup = null;

  /** 역할 가드 — 허용 역할이 아니면 /search로 리다이렉트 + 안내 토스트 */
  const guard = (allowedRoles, loader) => async () => {
    const role = store.currentUser?.role;
    if (!allowedRoles.includes(role)) {
      const { showToast } = await import('./core/toast.js');
      showToast('접근 권한이 없습니다', 'error');
      // 다음 tick에 /search로 (현재 route 가드 진입 중이라 즉시 navigate는 무시됨)
      setTimeout(() => navigate('/search', { transition: false }), 0);
      return;
    }
    await loader();
  };

  // Define routes
  defineRoutes({
    '/': async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/workspace.js');
      mount();
      currentCleanup = unmount;
    },
    '/search': async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/search.js');
      mount();
      currentCleanup = unmount;
    },
    '/contract': async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/contract.js');
      mount();
      currentCleanup = unmount;
    },
    '/settle': async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/settlement.js');
      mount();
      currentCleanup = unmount;
    },
    '/dash': async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/dashboard.js');
      mount();
      currentCleanup = unmount;
    },
    '/product': guard(['admin', 'provider'], async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/product-manage.js');
      mount();
      currentCleanup = unmount;
    }),
    '/policy': guard(['admin', 'provider'], async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/policy.js');
      mount();
      currentCleanup = unmount;
    }),
    '/settings': async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/settings-page.js');
      mount();
      currentCleanup = unmount;
    },
    '/account': async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/account.js');
      mount();
      currentCleanup = unmount;
    },
    '/admin/sign': guard(['admin'], async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/admin.js');
      mount();
      currentCleanup = unmount;
    }),
    '/admin/users': guard(['admin'], async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/admin.js');
      mount();
      currentCleanup = unmount;
    }),
    '/admin/partners': guard(['admin'], async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/admin.js');
      mount();
      currentCleanup = unmount;
    }),
    '/admin/dev': guard(['admin'], async () => {
      currentCleanup?.();
      const { mount, unmount } = await import('./pages/admin.js');
      mount();
      currentCleanup = unmount;
    }),
  });

  setNavigateCallback(updateActiveMenu);

  // 로딩 화면 표시 (jpkerp-next 규격)
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-splash">
      <i class="ph ph-spinner ph-spin"></i>
      <span>인증 확인 중...</span>
    </div>
  `;

  // 현재 URL 기억 (새로고침 복원용)
  const savedPath = location.pathname || '/search';
  const landingPage = localStorage.getItem('fp.landing') || '/search';

  // 엑셀 "문의" 링크 진입 — ?car=XXX 쿼리 캡처 후 URL 정리
  const incomingCar = new URLSearchParams(location.search).get('car');
  if (incomingCar) {
    sessionStorage.setItem('fp.pendingCar', incomingCar);
    history.replaceState({}, '', location.pathname);
  }

  // Wait for auth
  const user = await initAuth();

  if (user) {
    renderShell();
    const pendingCar = sessionStorage.getItem('fp.pendingCar');
    if (pendingCar) {
      sessionStorage.removeItem('fp.pendingCar');
      handlePendingCar(pendingCar);
    } else {
      // 현재 URL이 유효한 라우트면 복원, 아니면 랜딩 페이지로
      const restorePath = savedPath !== '/' && savedPath !== '/index.html' ? savedPath : landingPage;
      // renderShell 직후는 transition 스킵 (DOM 교체 직후 View Transition abort 방지)
      navigate(restorePath, { transition: false });
    }
    // 전역 데이터 감시 — 사이드바 뱃지 등 앱 전체에서 필요
    import('./firebase/db.js').then(({ watchCollection }) => {
      watchCollection('rooms', d => { store.rooms = d; });
      watchCollection('contracts', d => { store.contracts = d; });
      watchCollection('settlements', d => { store.settlements = d; });
      watchCollection('products', d => { store.products = d; });
      watchCollection('users', d => { store.users = d; });
      watchCollection('partners', d => { store.partners = d; });
    });
    // Init background services
    import('./core/auto-status.js').then(m => m.initAutoStatus());
    import('./core/alerts.js').then(m => m.initAlerts());
    import('./core/chat-notif.js').then(m => m.initChatNotif());
    import('./core/command-palette.js').then(m => m.initCommandPalette());
    import('./core/menu-badges.js').then(m => m.initMenuBadges());
    import('./core/car-models.js').then(m => m.subscribeCarModels());
    import('./firebase/messaging.js').then(m => m.onForegroundMessage(() => {}));
    if (Notification.permission === 'default') Notification.requestPermission();
  } else {
    renderLogin();
  }

  // Watch auth changes — DOM 상태(.shell 유무) + UID 비교로 상황 판정.
  //   user O · shell X  → 최초 로그인: shell + 랜딩 페이지 mount
  //   user O · shell O · uid 다름 → 재로그인(계정 변경): shell 재생성 + 랜딩
  //   user O · shell O · uid 동일 → profile 업데이트: 상단바/사이드바만 갱신
  //   user X · shell O  → 로그아웃: 로그인 폼
  //   user X · shell X  → 로그인 대기: 아무것도 안 함
  let prevUid = store.currentUser?.uid || null;
  subscribe('currentUser', (user) => {
    if (!store.authReady) return;
    const shell = document.querySelector('.shell');
    const nextUid = user?.uid || null;

    if (user && (!shell || nextUid !== prevUid)) {
      resetRoute();  // shell 새로 만드니 router 가드 초기화
      renderShell();
      const pendingCar = sessionStorage.getItem('fp.pendingCar');
      if (pendingCar) {
        sessionStorage.removeItem('fp.pendingCar');
        handlePendingCar(pendingCar);
      } else {
        navigate(localStorage.getItem('fp.landing') || '/search', { transition: false });
      }
    } else if (user && shell && nextUid === prevUid) {
      // 프로필 업데이트 — 상단바·사이드바만 새로고침
      renderTopbarUser();
      const sb = document.querySelector('.sb-brand');
      if (sb) sb.textContent = user.company_name || '';
    } else if (!user && shell) {
      resetRoute();
      renderLogin();
    }
    prevUid = nextUid;
  });
}

/* ── 엑셀 "문의" 링크 진입 처리 — 차량번호로 상품 찾아 대화방 열기 ── */
async function handlePendingCar(carNumber) {
  try {
    const { get, ref } = await import('firebase/database');
    const { db } = await import('./firebase/config.js');
    const { ensureRoom } = await import('./firebase/collections.js');
    const { showToast } = await import('./core/toast.js');

    const snap = await get(ref(db, 'products'));
    if (!snap.exists()) {
      navigate('/search');
      showToast('상품 데이터가 없습니다.');
      return;
    }
    const products = snap.val();
    const entry = Object.entries(products).find(([, p]) => p.car_number === carNumber);
    if (!entry) {
      navigate('/search');
      showToast(`차량번호 ${carNumber} 상품을 찾지 못했습니다.`);
      return;
    }
    const [productUid, product] = entry;
    const me = store.currentUser || {};
    const roomId = await ensureRoom({
      productUid,
      productCode: product.product_code || productUid,
      agentUid: me.uid,
      agentCode: me.company_code || me.user_code || '',
      agentName: me.company_name || me.name || '',
      agentChannelCode: me.channel_code || '',
      providerUid: product.provider_uid || '',
      providerName: product.provider_name || product.provider_company_code || '',
      providerCompanyCode: product.provider_company_code || '',
      vehicleNumber: product.car_number,
      modelName: product.model || '',
      subModel: product.sub_model || '',
      providerCode: product.provider_company_code || '',
    });
    store.pendingOpenRoom = roomId;
    navigate('/', { transition: false });
    showToast(`${product.model || carNumber} 문의방을 열었습니다.`);
  } catch (e) {
    console.error('[handlePendingCar]', e);
    navigate('/search');
  }
}

init();
