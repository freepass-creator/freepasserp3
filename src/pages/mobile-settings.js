/**
 * 모바일 설정 — 히어로 프로필 + 스크롤 시 상단바 응축(collapsing header)
 * - 초기: 큰 프로필 카드 (아바타 + 이름 + 역할)
 * - 스크롤 내리면: 상단 고정바가 compact 프로필(작은 아바타 · 이름 · 메타)로 변형
 */
import { store } from '../core/store.js';
import { showToast } from '../core/toast.js';
import { toggleSound } from '../core/chat-notif.js';
import { requestNotificationPermission } from '../firebase/messaging.js';
import { navigate } from '../core/router.js';
import { updateRecord } from '../firebase/db.js';
import { uploadImage, uploadFile } from '../firebase/storage-helper.js';
import { logout, resetPassword } from '../firebase/auth.js';
import { auth } from '../firebase/config.js';

// 2개 섹션으로 분리 — 소속감 강조를 위해 회사 정보 먼저, 개인 정보 뒤
const COMPANY_FIELDS = [
  { key: 'company_name',    label: '회사명',     placeholder: '회사명' },
  { key: 'position',        label: '직급',       placeholder: '예: 팀장' },
  { key: 'company_code',    label: '회사 코드',  placeholder: 'SP001', readonly: true },
  { key: 'business_number', label: '사업자번호', placeholder: '000-00-00000' },
];
const PERSONAL_FIELDS = [
  { key: 'name',            label: '이름',       placeholder: '이름' },
  { key: 'phone',           label: '연락처',     placeholder: '010-0000-0000' },
  { key: 'email',           label: '이메일',     placeholder: 'email@example.com', readonly: true },
  { key: 'bio',             label: '한마디',     placeholder: '소개 한줄' },
];

let _io = null;

export function mount() {
  render();
}

export function unmount() {
  _io?.disconnect();
  _io = null;
}

/** 스크롤 위치 보존 렌더 */
function render() {
  const prev = document.getElementById('mstBody')?.scrollTop || 0;
  _render();
  const body = document.getElementById('mstBody');
  if (body) body.scrollTop = prev;
  bindHeaderCollapse();
}

const APP_VERSION = 'v2.0.0';
const NOTIF_TYPES = [
  { key: 'inquiry',    label: '신규 문의',   icon: 'ph ph-chat-circle-dots' },
  { key: 'contract',   label: '계약 진행',   icon: 'ph ph-file-text' },
  { key: 'settlement', label: '정산',       icon: 'ph ph-coins' },
  { key: 'notice',     label: '공지사항',   icon: 'ph ph-megaphone' },
];
const AUTO_LOGOUT_OPTIONS = [
  { min: 0,   label: '사용 안 함' },
  { min: 15,  label: '15분' },
  { min: 60,  label: '1시간' },
  { min: 480, label: '8시간' },
];

function _render() {
  const main = document.getElementById('mainContent');
  const u = store.currentUser || {};
  const soundOn = localStorage.getItem('fp.sound') !== 'off';
  const onlyMine = localStorage.getItem('fp.onlyMine') === '1';
  const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
  const role = u.role || '';
  const autoLogoutMin = Number(localStorage.getItem('fp.autoLogout') || '0');
  const autoLogoutLabel = (AUTO_LOGOUT_OPTIONS.find(o => o.min === autoLogoutMin) || AUTO_LOGOUT_OPTIONS[0]).label;
  const lastSync = Number(localStorage.getItem('fp.lastSync') || Date.now());

  const adminMenu = role === 'admin' ? [
    { path: '/admin/users',    icon: 'ph ph-users',            label: '사용자 관리' },
    { path: '/admin/partners', icon: 'ph ph-buildings',         label: '파트너 관리' },
    { path: '/admin/sign',     icon: 'ph ph-paper-plane-tilt',  label: '계약서 관리' },
  ] : [];

  const providerMenu = (role === 'admin' || role === 'provider') ? [
    { path: '/product', icon: 'ph ph-car-simple', label: '재고 관리' },
    { path: '/policy',  icon: 'ph ph-scroll',     label: '정책 관리' },
  ] : [];

  // 회사 CI 우선, 없으면 개인 아바타, 그것도 없으면 이니셜
  // CI 로고는 잘리지 않도록 is-ci 클래스로 object-fit: contain 적용
  const ciUrl = u.company_ci_url || '';
  const avatarHtml = ciUrl
    ? `<img class="is-ci" src="${ciUrl}" alt="회사 CI">`
    : (u.avatar_url ? `<img src="${u.avatar_url}" alt="">` : initial);
  const affiliation = [u.company_name, u.position].filter(Boolean).join(' · ');
  const metaLine = [roleLabel(role), u.user_code].filter(Boolean).join(' · ') || '-';

  main.innerHTML = `
    <div class="m-shell-page m-settings">
      <!-- 상단 고정 바 — 아이콘+설정 (기본) → 아바타+이름 (스크롤 시) + 우측 공지/도움말 -->
      <header class="m-settings-header" id="mstHeader">
        <span class="m-settings-header-icon">
          <i class="ph ph-gear m-settings-header-icon-gear"></i>
          <span class="m-settings-header-icon-avatar">${avatarHtml}</span>
        </span>
        <span class="m-settings-header-text">
          <span class="m-settings-header-title">설정</span>
          <span class="m-settings-header-profile">
            <span class="m-settings-header-name">${u.name || '이름 없음'}</span>
            <span class="m-settings-header-meta">${affiliation || '-'}</span>
          </span>
        </span>
        <span class="m-settings-header-actions">
          <button class="m-topbar-action" id="mstHeaderNotice" title="공지" aria-label="공지사항"><i class="ph ph-megaphone"></i></button>
          <button class="m-topbar-action" id="mstHeaderHelp" title="도움말" aria-label="도움말"><i class="ph ph-question"></i></button>
        </span>
      </header>

      <div class="m-info-page" id="mstBody">
        <!-- 히어로 — 회사 CI 아바타 + 이름·소속·직급 + 역할·코드 -->
        <section class="m-settings-hero" id="mstHero">
          <button class="m-settings-hero-avatar" id="mstAvatar" aria-label="회사 CI / 아바타 변경">
            ${avatarHtml}
            <span class="m-settings-hero-avatar-overlay"><i class="ph ph-camera"></i></span>
          </button>
          <div class="m-settings-hero-body">
            <div class="m-settings-hero-name">${u.name || '이름 없음'}</div>
            ${affiliation ? `<div class="m-settings-hero-affiliation">${affiliation}</div>` : ''}
            <div class="m-settings-hero-meta">${metaLine}</div>
          </div>
        </section>

        <!-- 소속 (회사 정보) -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">소속</span></div>
          ${COMPANY_FIELDS.map(f => `
            <div class="m-info-row-edit">
              <span class="m-info-label">${f.label}</span>
              <input class="m-info-input" data-field="${f.key}"
                     value="${(u[f.key] || '').replace(/"/g, '&quot;')}"
                     placeholder="${f.placeholder}" ${f.readonly ? 'readonly' : ''}>
              <span class="m-state" data-state="${f.key}"></span>
            </div>
          `).join('')}
          <div class="m-info-row">
            <span class="m-info-label">역할</span>
            <span class="m-info-value">${roleLabel(role) || '-'}</span>
          </div>
          <div class="m-info-row">
            <span class="m-info-label">사용자 코드</span>
            <span class="m-info-value">${u.user_code || '-'}</span>
          </div>
        </section>

        <!-- 내 정보 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">내 정보</span></div>
          ${PERSONAL_FIELDS.map(f => `
            <div class="m-info-row-edit">
              <span class="m-info-label">${f.label}</span>
              <input class="m-info-input" data-field="${f.key}"
                     value="${(u[f.key] || '').replace(/"/g, '&quot;')}"
                     placeholder="${f.placeholder}" ${f.readonly ? 'readonly' : ''}>
              <span class="m-state" data-state="${f.key}"></span>
            </div>
          `).join('')}
        </section>

        <!-- 앱 환경 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">앱 환경</span></div>
          <button class="m-info-row" id="mstTheme">
            <span class="m-info-label"><i class="ph ${store.theme === 'dark' ? 'ph-sun' : 'ph-moon'}"></i> 다크 모드</span>
            <span class="m-toggle ${store.theme === 'dark' ? 'is-on' : ''}" aria-hidden="true"><span class="m-toggle-knob"></span></span>
          </button>
          <button class="m-info-row" id="mstSound">
            <span class="m-info-label"><i class="ph ph-speaker-high"></i> 알림 소리</span>
            <span class="m-toggle ${soundOn ? 'is-on' : ''}" aria-hidden="true"><span class="m-toggle-knob"></span></span>
          </button>
          <button class="m-info-row" id="mstPush">
            <span class="m-info-label"><i class="ph ph-bell"></i> 웹 푸시</span>
            <span class="m-toggle ${Notification.permission === 'granted' ? 'is-on' : ''}" aria-hidden="true"><span class="m-toggle-knob"></span></span>
          </button>
          ${role === 'provider' ? `
            <button class="m-info-row" id="mstOnlyMine">
              <span class="m-info-label"><i class="ph ph-car-simple"></i> 내 차량만 보기</span>
              <span class="m-toggle ${onlyMine ? 'is-on' : ''}" aria-hidden="true"><span class="m-toggle-knob"></span></span>
            </button>
          ` : ''}
        </section>

        <!-- 첨부 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">첨부</span></div>
          ${docRow('사업자등록증',   u.ci_url, 'ci')}
          ${docRow('명함',          u.card_url, 'card')}
          ${docRow('회사로고 (CI)', u.company_ci_url, 'company_ci')}
        </section>

        <!-- 알림 상세 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">알림 상세</span></div>
          ${NOTIF_TYPES.map(t => {
            const on = localStorage.getItem(`fp.notif.${t.key}`) !== 'off';
            return `<button class="m-info-row" data-notif="${t.key}">
              <span class="m-info-label"><i class="${t.icon}"></i> ${t.label}</span>
              <span class="m-toggle ${on ? 'is-on' : ''}" aria-hidden="true"><span class="m-toggle-knob"></span></span>
            </button>`;
          }).join('')}
        </section>

        <!-- 보안 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">보안</span></div>
          <button class="m-info-row" id="mstAutoLogout">
            <span class="m-info-label"><i class="ph ph-lock-key"></i> 자동 로그아웃</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);">${autoLogoutLabel} <i class="ph ph-caret-right" style="font-size:12px;"></i></span>
          </button>
        </section>

        <!-- 데이터 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">데이터</span></div>
          <button class="m-info-row" id="mstClearCache">
            <span class="m-info-label"><i class="ph ph-broom"></i> 캐시 지우기</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);">실행</span>
          </button>
          <button class="m-info-row" id="mstReload">
            <span class="m-info-label"><i class="ph ph-arrow-clockwise"></i> 새로고침</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);">즉시</span>
          </button>
          <div class="m-info-row">
            <span class="m-info-label">마지막 동기화</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);">${new Date(lastSync).toLocaleString('ko', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
          </div>
        </section>

        <!-- 고객 지원 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">고객 지원</span></div>
          <button class="m-info-row" id="mstContact">
            <span class="m-info-label"><i class="ph ph-envelope"></i> 문의하기</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);"><i class="ph ph-caret-right"></i></span>
          </button>
          <button class="m-info-row" id="mstNotice">
            <span class="m-info-label"><i class="ph ph-megaphone"></i> 공지사항</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);"><i class="ph ph-caret-right"></i></span>
          </button>
          <button class="m-info-row" id="mstFaq">
            <span class="m-info-label"><i class="ph ph-question"></i> 자주 묻는 질문</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);"><i class="ph ph-caret-right"></i></span>
          </button>
        </section>

        <!-- 법적 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">법적 안내</span></div>
          <button class="m-info-row" id="mstPrivacy">
            <span class="m-info-label"><i class="ph ph-shield-check"></i> 개인정보처리방침</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);"><i class="ph ph-caret-right"></i></span>
          </button>
          <button class="m-info-row" id="mstTerms">
            <span class="m-info-label"><i class="ph ph-scroll"></i> 이용약관</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);"><i class="ph ph-caret-right"></i></span>
          </button>
        </section>

        <!-- 정보 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">정보</span></div>
          <div class="m-info-row">
            <span class="m-info-label">앱 버전</span>
            <span class="m-info-value">${APP_VERSION}</span>
          </div>
          <div class="m-info-row">
            <span class="m-info-label">빌드</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);">${new Date(lastSync).getFullYear()}.${String(new Date(lastSync).getMonth()+1).padStart(2,'0')}.${String(new Date(lastSync).getDate()).padStart(2,'0')}</span>
          </div>
          ${role === 'admin' ? `
            <button class="m-info-row" data-path="/admin/dev">
              <span class="m-info-label"><i class="ph ph-code"></i> 개발자 도구</span>
              <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);"><i class="ph ph-caret-right"></i></span>
            </button>
            <button class="m-info-row" data-path="/admin/stats">
              <span class="m-info-label"><i class="ph ph-chart-line"></i> 영업자 통계</span>
              <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);"><i class="ph ph-caret-right"></i></span>
            </button>
          ` : ''}
        </section>

        ${providerMenu.length ? `
          <section class="m-info-section">
            <div class="m-info-section-head"><span class="m-info-section-title">관리</span></div>
            ${providerMenu.map(menuRow).join('')}
          </section>
        ` : ''}

        ${adminMenu.length ? `
          <section class="m-info-section">
            <div class="m-info-section-head"><span class="m-info-section-title">관리자</span></div>
            ${adminMenu.map(menuRow).join('')}
          </section>
        ` : ''}

        <!-- 계정 관리 -->
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">계정 관리</span></div>
          <button class="m-info-row" id="mstResetPw">
            <span class="m-info-label"><i class="ph ph-key"></i> 비밀번호 변경</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);">메일 전송</span>
          </button>
          <button class="m-info-row" id="mstLogout">
            <span class="m-info-label" style="color:var(--c-err);"><i class="ph ph-sign-out"></i> 로그아웃</span>
          </button>
          <button class="m-info-row" id="mstDelete">
            <span class="m-info-label" style="color:var(--c-err);"><i class="ph ph-trash"></i> 계정 삭제</span>
            <span class="m-info-value" style="color:var(--c-text-muted);font-weight:var(--fw-normal);">되돌릴 수 없음</span>
          </button>
        </section>

      </div>
    </div>
  `;

  bindAll(main, u);
}

/** 히어로가 뷰포트에서 벗어나면 헤더를 compact 모드로 전환 */
function bindHeaderCollapse() {
  _io?.disconnect();
  const hero = document.getElementById('mstHero');
  const header = document.getElementById('mstHeader');
  if (!hero || !header) return;
  _io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      header.classList.toggle('is-condensed', !e.isIntersecting);
    }
  }, { threshold: 0, rootMargin: '-40px 0px 0px 0px' });
  _io.observe(hero);
}

function bindAll(main, u) {
  // 프로필 아바타 업로드 (히어로 아바타 클릭)
  document.getElementById('mstAvatar')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      try {
        const { url } = await uploadImage(`user-avatars/${u.uid}/${Date.now()}.webp`, file);
        await updateRecord(`users/${u.uid}`, { avatar_url: url });
        store.currentUser = { ...store.currentUser, avatar_url: url };
        showToast('프로필 사진 변경됨');
        render();
      } catch (e) {
        showToast(`업로드 실패: ${e?.code || e?.message || ''}`, 'error');
      }
    });
    input.click();
  });

  // 프로필 필드 blur 자동 저장
  main.querySelectorAll('.m-info-input').forEach(inp => {
    if (inp.readOnly) return;
    const field = inp.dataset.field;
    const stateEl = main.querySelector(`[data-state="${field}"]`);
    let original = inp.value;
    inp.addEventListener('focus', () => {
      original = inp.value;
      if (stateEl) { stateEl.className = 'm-state is-editing'; stateEl.textContent = '수정중'; }
    });
    inp.addEventListener('blur', async () => {
      const val = inp.value.trim();
      if (val === original) {
        if (stateEl) { stateEl.className = 'm-state'; stateEl.textContent = ''; }
        return;
      }
      try {
        await updateRecord(`users/${u.uid}`, { [field]: val });
        store.currentUser = { ...store.currentUser, [field]: val };
        original = val;
        if (stateEl) {
          stateEl.className = 'm-state is-saved';
          stateEl.textContent = '저장';
          clearTimeout(stateEl._t);
          stateEl._t = setTimeout(() => { stateEl.className = 'm-state'; stateEl.textContent = ''; }, 1500);
        }
      } catch (e) {
        if (stateEl) { stateEl.className = 'm-state is-error'; stateEl.textContent = '실패'; }
        showToast('저장 실패', 'error');
      }
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });

  // 서류 업로드
  main.querySelectorAll('[data-doc-upload]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      uploadDoc(btn.dataset.docUpload);
    });
  });

  // 서류 삭제
  main.querySelectorAll('[data-doc-delete]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const type = btn.dataset.docDelete;
      const meta = DOC_FIELDS[type];
      if (!meta) return;
      if (!confirm(`${meta.label}을(를) 삭제하시겠습니까?`)) return;
      try {
        await updateRecord(`users/${u.uid}`, { [meta.field]: '' });
        store.currentUser = { ...store.currentUser, [meta.field]: '' };
        showToast(`${meta.label} 삭제됨`);
        render();
      } catch (err) {
        showToast(`삭제 실패: ${err?.code || err?.message || ''}`, 'error');
      }
    });
  });

  // 환경 토글
  document.getElementById('mstTheme')?.addEventListener('click', () => {
    const next = store.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.add('theme-switching');
    store.theme = next;
    document.documentElement.dataset.theme = next;
    localStorage.setItem('fp.theme', next);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-switching');
      render();
    }));
  });
  document.getElementById('mstSound')?.addEventListener('click', () => {
    const on = toggleSound();
    showToast(`알림 소리 ${on ? 'ON' : 'OFF'}`);
    render();
  });
  document.getElementById('mstPush')?.addEventListener('click', async () => {
    const token = await requestNotificationPermission();
    showToast(token ? '알림 허용됨' : '알림 거부됨');
    render();
  });
  document.getElementById('mstOnlyMine')?.addEventListener('click', () => {
    const next = localStorage.getItem('fp.onlyMine') === '1' ? '0' : '1';
    localStorage.setItem('fp.onlyMine', next);
    showToast(next === '1' ? '내 차량만 보기' : '전체 보기');
    render();
  });

  // 알림 상세 토글
  main.querySelectorAll('[data-notif]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.notif;
      const cur = localStorage.getItem(`fp.notif.${key}`);
      const next = cur === 'off' ? 'on' : 'off';
      localStorage.setItem(`fp.notif.${key}`, next);
      render();
    });
  });

  // 자동 로그아웃 선택 (바텀시트)
  document.getElementById('mstAutoLogout')?.addEventListener('click', () => {
    import('../core/mobile-shell.js').then(({ openBottomSheet }) => {
      const cur = Number(localStorage.getItem('fp.autoLogout') || '0');
      const html = `
        <div style="padding:var(--sp-2) 0;">
          ${AUTO_LOGOUT_OPTIONS.map(o => `
            <button class="m-info-row" data-logout-min="${o.min}" style="width:100%;border:0;background:transparent;text-align:left;">
              <span class="m-info-label">${o.label}</span>
              ${o.min === cur ? '<span class="m-info-value" style="color:var(--c-accent);"><i class="ph ph-check"></i></span>' : ''}
            </button>
          `).join('')}
        </div>
      `;
      const sheet = openBottomSheet(html, {
        title: '자동 로그아웃',
        onMount: (root) => {
          root.querySelectorAll('[data-logout-min]').forEach(b => {
            b.addEventListener('click', () => {
              localStorage.setItem('fp.autoLogout', b.dataset.logoutMin);
              showToast('저장됨');
              sheet.close();
              render();
            });
          });
        },
      });
    });
  });

  // 데이터 — 캐시 지우기
  document.getElementById('mstClearCache')?.addEventListener('click', async () => {
    if (!confirm('모든 앱 캐시를 삭제합니다. 계속할까요?')) return;
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if (navigator.serviceWorker?.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      showToast('캐시 삭제 완료 — 재시작해주세요');
    } catch (e) {
      showToast('삭제 실패', 'error');
    }
  });

  // 데이터 — 새로고침
  document.getElementById('mstReload')?.addEventListener('click', () => {
    localStorage.setItem('fp.lastSync', String(Date.now()));
    location.reload();
  });

  // 고객 지원
  document.getElementById('mstContact')?.addEventListener('click', () => {
    location.href = 'mailto:support@freepassmobility.com?subject=freepass ERP 문의';
  });
  document.getElementById('mstNotice')?.addEventListener('click', () => {
    showToast('공지사항 준비 중');
  });
  document.getElementById('mstFaq')?.addEventListener('click', () => {
    showToast('FAQ 준비 중');
  });

  // 법적
  document.getElementById('mstPrivacy')?.addEventListener('click', () => {
    window.open('/privacy.html', '_blank', 'noopener');
  });
  document.getElementById('mstTerms')?.addEventListener('click', () => {
    window.open('/terms.html', '_blank', 'noopener');
  });

  // 역할별 메뉴
  main.querySelectorAll('[data-path]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.path));
  });

  // 계정 관리
  document.getElementById('mstResetPw')?.addEventListener('click', async () => {
    if (!u.email) return;
    try { await resetPassword(u.email); showToast('비밀번호 재설정 메일 전송됨'); }
    catch (e) { showToast('전송 실패', 'error'); }
  });
  document.getElementById('mstDelete')?.addEventListener('click', async () => {
    const entered = prompt('계정을 삭제하려면 이메일을 입력하세요:');
    if (entered !== u.email) { showToast('이메일 불일치', 'error'); return; }
    try {
      await auth.currentUser.delete();
      await updateRecord(`users/${u.uid}`, { status: 'deleted', deleted_at: Date.now() });
      showToast('계정 삭제됨');
    } catch (e) {
      showToast('삭제 실패: 재로그인 후 시도하세요', 'error');
    }
  });
  document.getElementById('mstLogout')?.addEventListener('click', async () => {
    if (!confirm('로그아웃하시겠습니까?')) return;
    await logout();
  });

  // 헤더 우측 공지/도움말
  document.getElementById('mstHeaderNotice')?.addEventListener('click', async () => {
    const { openBottomSheet } = await import('../core/mobile-shell.js');
    // 대시보드 공지 데이터 가져오기 (store.notices 혹은 firebase notices 경로)
    const notices = store.notices || [];
    const list = [...notices].filter(n => !n._deleted).sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 20);
    const html = list.length
      ? `<div class="m-doc-list">${list.map(n => `
          <div class="m-doc-item">
            <span class="m-doc-thumb"><i class="ph ph-megaphone"></i></span>
            <span class="m-doc-info">
              <span class="m-doc-link" style="color:var(--c-text);">${(n.title || '').replace(/</g,'&lt;')}</span>
              <span class="m-doc-meta">${n.created_at ? new Date(n.created_at).toLocaleDateString('ko', { year:'2-digit', month:'2-digit', day:'2-digit' }) : ''}${n.body ? ` · ${String(n.body).slice(0, 80).replace(/</g,'&lt;')}` : ''}</span>
            </span>
          </div>`).join('')}</div>`
      : `<div style="padding:var(--sp-4);text-align:center;color:var(--c-text-muted);font-size:var(--fs-sm);">공지사항이 없습니다</div>`;
    openBottomSheet(html, { title: '공지사항' });
  });

  document.getElementById('mstHeaderHelp')?.addEventListener('click', async () => {
    const { openBottomSheet } = await import('../core/mobile-shell.js');
    const html = `
      <div class="m-info-page" style="padding:var(--sp-3) 0;">
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">주요 기능</span></div>
          <div class="m-info-row"><span class="m-info-label"><i class="ph ph-magnifying-glass"></i> 찾기</span><span class="m-info-value" style="font-weight:var(--fw-normal);color:var(--c-text-sub);font-size:var(--fs-xs);">차량 검색 · 필터 · 문의</span></div>
          <div class="m-info-row"><span class="m-info-label"><i class="ph ph-chat-circle"></i> 소통</span><span class="m-info-value" style="font-weight:var(--fw-normal);color:var(--c-text-sub);font-size:var(--fs-xs);">공급사 ↔ 영업자 채팅</span></div>
          <div class="m-info-row"><span class="m-info-label"><i class="ph ph-file-text"></i> 계약</span><span class="m-info-value" style="font-weight:var(--fw-normal);color:var(--c-text-sub);font-size:var(--fs-xs);">계약 진행 · 고객 · 상세</span></div>
          <div class="m-info-row"><span class="m-info-label"><i class="ph ph-gear"></i> 설정</span><span class="m-info-value" style="font-weight:var(--fw-normal);color:var(--c-text-sub);font-size:var(--fs-xs);">프로필 · 알림 · 자료</span></div>
        </section>
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">계약 진행 단계</span></div>
          <div class="m-info-row"><span class="m-info-label">1</span><span class="m-info-value" style="font-weight:var(--fw-normal);font-size:var(--fs-xs);">출고 문의 → 출고 응답</span></div>
          <div class="m-info-row"><span class="m-info-label">2</span><span class="m-info-value" style="font-weight:var(--fw-normal);font-size:var(--fs-xs);">계약금 입금 → 확인</span></div>
          <div class="m-info-row"><span class="m-info-label">3</span><span class="m-info-value" style="font-weight:var(--fw-normal);font-size:var(--fs-xs);">서류 제출 → 서류 심사</span></div>
          <div class="m-info-row"><span class="m-info-label">4</span><span class="m-info-value" style="font-weight:var(--fw-normal);font-size:var(--fs-xs);">계약서 요청 → 계약서 완료</span></div>
          <div class="m-info-row"><span class="m-info-label">5</span><span class="m-info-value" style="font-weight:var(--fw-normal);font-size:var(--fs-xs);">잔금 입금 → 잔금 확인</span></div>
          <div class="m-info-row"><span class="m-info-label">6</span><span class="m-info-value" style="font-weight:var(--fw-normal);font-size:var(--fs-xs);">출고 요청 → 출고 완료</span></div>
          <div class="m-info-row"><span class="m-info-label">7</span><span class="m-info-value" style="font-weight:var(--fw-normal);font-size:var(--fs-xs);">인도 확인 → 계약 완료</span></div>
        </section>
        <section class="m-info-section">
          <div class="m-info-section-head"><span class="m-info-section-title">팁</span></div>
          <div class="m-info-row" style="padding:var(--sp-3);"><span class="m-info-label" style="font-weight:var(--fw-normal);font-size:var(--fs-xs);">• 대여기간 칩을 누르면 월대여료·보증금이 자동으로 맞춰집니다.<br>• 고객 정보는 입력 후 다른 곳을 누르면 자동 저장됩니다.<br>• 다크 모드는 설정 → 앱 환경 에서 전환.<br>• 문의는 설정 → 고객 지원 → 문의하기.</span></div>
        </section>
      </div>
    `;
    openBottomSheet(html, { title: '도움말' });
  });
}

function docRow(label, url, type) {
  const uploaded = !!url;
  return `
    <div class="m-info-row">
      <span class="m-info-label">${label}</span>
      <span style="display:flex;align-items:center;gap:var(--sp-2);">
        ${uploaded
          ? `<a href="${url}" target="_blank" rel="noopener" class="m-info-value" style="color:var(--c-accent);"><i class="ph ph-file"></i> 업로드됨</a>`
          : `<span class="m-info-value is-empty">미등록</span>`}
        <button class="m-doc-inline-btn" data-doc-upload="${type}" type="button" aria-label="${uploaded ? '교체' : '업로드'}" title="${uploaded ? '교체' : '업로드'}">
          <i class="ph ${uploaded ? 'ph-arrows-clockwise' : 'ph-upload-simple'}"></i>
        </button>
        ${uploaded ? `
          <button class="m-doc-inline-btn" data-doc-delete="${type}" type="button" aria-label="삭제" title="삭제">
            <i class="ph ph-trash"></i>
          </button>
        ` : ''}
      </span>
    </div>
  `;
}

function menuRow(m) {
  return `
    <button class="m-info-row" data-path="${m.path}">
      <span class="m-info-label"><i class="${m.icon}"></i> ${m.label}</span>
      <span class="m-info-value" style="color:var(--c-text-muted);"><i class="ph ph-caret-right"></i></span>
    </button>
  `;
}

const DOC_FIELDS = {
  ci:         { field: 'ci_url',         label: '사업자등록증' },
  card:       { field: 'card_url',       label: '명함' },
  company_ci: { field: 'company_ci_url', label: '회사로고 (CI)' },
};

async function uploadDoc(type) {
  const user = store.currentUser;
  const meta = DOC_FIELDS[type] || DOC_FIELDS.ci;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*,.pdf';
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    try {
      const path = `user-docs/${user.uid}/${type}_${Date.now()}_${sanitizeName(file.name)}`;
      const isImage = (file.type || '').startsWith('image/');
      const { url } = isImage ? await uploadImage(path, file) : await uploadFile(path, file);
      await updateRecord(`users/${user.uid}`, { [meta.field]: url });
      store.currentUser = { ...store.currentUser, [meta.field]: url };
      showToast(`${meta.label} 업로드 완료`);
      render();
    } catch (e) {
      showToast(`업로드 실패: ${e?.code || e?.message || ''}`, 'error');
    }
  });
  input.click();
}

function sanitizeName(name) {
  return String(name).trim().replace(/\s+/g, '_').replace(/[^\w.\-가-힣]/g, '_').slice(0, 120) || 'file';
}

function roleLabel(role) {
  return { admin: '관리자', provider: '공급사', agent: '영업자', agent_admin: '영업관리자' }[role] || role;
}
