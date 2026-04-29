/**
 * pages/settings.js — 통합 설정 페이지 (계정 + 시스템)
 *
 * 좌측: 탭 (계정 / 시스템)
 * 우측: 선택된 섹션 본문
 *
 * v1/v2 의 settings-page.js + account.js 통합
 */
import { store } from '../core/store.js';
import { updateRecord } from '../firebase/db.js';
import { logout as fbLogout, resetPassword } from '../firebase/auth.js';
import { showToast } from '../core/toast.js';
import { esc } from '../core/ui-helpers.js';

const TABS = [
  { id: 'guide',    icon: 'book-open',     label: '사용설명',      sub: '단축키 | 우클릭 | 페이지 가이드' },
  { id: 'account',  icon: 'user-circle',   label: '계정 정보',     sub: '프로필 | 서류 | 계정 관리' },
  { id: 'system',   icon: 'gear',          label: '시스템 설정',   sub: '다크모드 | 폰트 | 알림' },
  { id: 'catalog',  icon: 'share-network', label: '카탈로그 공유', sub: '내 카탈로그 링크' },
];

let _initialized = false;

const TAB_HELP = {
  guide: {
    title: '사용설명',
    body: `
      <p>FreePass ERP 사용 가이드. 각 페이지별 핵심 기능을 정리했습니다.</p>
      <ul>
        <li>좌측 사이드바 = 메인 메뉴</li>
        <li>상단바 = 검색 / 페이지 제목 / 내 정보</li>
        <li>대부분 액션은 <b>우클릭</b>으로 빠르게 가능</li>
      </ul>
      <p class="settings-help-tip">📖 가운데 본문에서 페이지별 상세 설명을 확인하세요.</p>
    `,
  },
  account: {
    title: '계정 정보',
    body: `
      <p>로그인한 사용자 본인의 프로필을 관리합니다.</p>
      <ul>
        <li><b>이름·직급·연락처·한마디</b>는 입력칸을 두 번 클릭하면 수정 모드로 들어갑니다.</li>
        <li><b>이메일·소속</b>은 가입 시 확정된 정보로 직접 수정 불가. 변경이 필요하면 관리자에게 요청해주세요.</li>
        <li><b>비밀번호 변경</b>은 가입한 이메일로 재설정 링크가 전송됩니다.</li>
      </ul>
      <p class="settings-help-tip">📞 입력한 연락처와 직급은 카톡 보낼 때 자동으로 들어갑니다 (상품 내용 복사 시).</p>
    `,
  },
  system: {
    title: '시스템 설정',
    body: `
      <p>화면 환경 설정. 변경 사항은 자동으로 저장되어 다음 로그인에도 유지됩니다.</p>
      <ul>
        <li><b>다크모드</b>: 야간 작업 시 눈 피로 감소.</li>
        <li><b>폰트</b>: 기본은 Consolas + Pretendard 혼합 (영문/숫자 mono + 한글 깔끔). 굴림체로 바꾸면 옛 ERP 톤.</li>
        <li><b>시작 페이지</b>: 로그인 후 자동 이동할 화면.</li>
        <li><b>웹 푸시 알림</b>: 브라우저가 닫혀있어도 받습니다 (한 번만 권한 요청).</li>
      </ul>
      <p class="settings-help-tip">🔔 알림 권한은 브라우저별로 따로 관리됩니다 (Chrome, Edge, Safari 등).</p>
    `,
  },
  catalog: {
    title: '카탈로그 공유',
    body: `
      <p>내 영업자 코드가 포함된 카탈로그 링크. 이 링크로 들어온 고객의 활동은 자동으로 나에게 추적됩니다.</p>
      <ul>
        <li>고객에게 카톡/문자/이메일로 보내세요.</li>
        <li>고객이 차량을 클릭하거나 문의하면 알림이 옵니다.</li>
        <li>계약 생성 시 영업자 코드가 자동으로 입력됩니다.</li>
      </ul>
      <p class="settings-help-tip">💡 단일 차량 링크는 상품 우클릭 → "상품 링크 복사" 에서 받을 수 있습니다.</p>
    `,
  },
};

let _activeTab = 'guide';   // 기본 탭 — 사용설명

export function renderSettings() {
  const page = document.querySelector('.pt-page[data-page="settings"]');
  if (!page) return;
  const me = store.currentUser || {};

  const activeTab = TABS.find(t => t.id === _activeTab);
  const help = TAB_HELP[_activeTab] || { title: '', body: '' };
  page.innerHTML = `
    <div class="ws4">
      <!-- 좌: 탭 목록 (1/4) -->
      <div class="ws4-card ws4-list" style="flex: 1 1 0;">
        <div class="ws4-head"><i class="ph ph-gear"></i> <span>설정</span></div>
        <div class="ws4-body" style="padding: var(--sp-2);">
          ${TABS.map(t => `
            <button class="settings-tab ${t.id === _activeTab ? 'is-active' : ''}" data-tab="${t.id}">
              <i class="ph ph-${t.icon}"></i>
              <span class="settings-tab-text">
                <span class="settings-tab-label">${t.label}</span>
                <span class="settings-tab-sub">${t.sub}</span>
              </span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- 가운데: 선택 섹션 본문 (2/4) -->
      <div class="ws4-card" style="flex: 2 1 0;">
        <div class="ws4-head"><i class="ph ph-${activeTab?.icon}"></i> <span id="settingsBodyTitle">${activeTab?.label}</span></div>
        <div class="ws4-body" id="settingsBody" style="padding: var(--sp-4); overflow-y: auto;"></div>
      </div>

      <!-- 우: 설명 / 도움말 (1/4) -->
      <div class="ws4-card" style="flex: 1 1 0;">
        <div class="ws4-head"><i class="ph ph-info"></i> <span>도움말</span></div>
        <div class="ws4-body settings-help" style="padding: var(--sp-4); overflow-y: auto;">
          <h4 class="settings-help-title">${help.title}</h4>
          ${help.body}
        </div>
      </div>
    </div>
  `;

  // 탭 클릭 → _activeTab 변경 후 재렌더
  page.querySelectorAll('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      renderSettings();
    });
  });

  renderTabBody();
}

function renderTabBody() {
  const body = document.getElementById('settingsBody');
  if (!body) return;
  const me = store.currentUser || {};

  if (_activeTab === 'guide') {
    body.innerHTML = renderGuideSection();
  } else if (_activeTab === 'account') {
    body.innerHTML = renderAccountSection(me);
    bindAccountSection(body, me);
  } else if (_activeTab === 'system') {
    body.innerHTML = renderSystemSection();
    bindSystemSection(body);
  } else if (_activeTab === 'catalog') {
    body.innerHTML = renderCatalogSection(me);
    bindCatalogSection(body);
  }
}

/* ──────── 사용설명 (Guide) ──────── */
function renderGuideSection() {
  return `
    <section class="settings-section">
      <div class="settings-section-title">📋 페이지별 가이드</div>
      <div class="settings-guide-rows">
        <div class="settings-guide-row">
          <div class="settings-guide-label"><i class="ph ph-magnifying-glass"></i> 상품 찾기</div>
          <div class="settings-guide-body">
            영업자가 차량을 찾고 고객에게 공유하는 메인 페이지.<br>
            • 행 우클릭 → <b>상품 링크 복사 / 상품 내용 복사 / 문의 / 계약 생성</b><br>
            • 헤더 클릭 → 컬럼별 필터·정렬<br>
            • 하단바 → 신차/중고/26세 이하 등 빠른 필터 + 1M~60M 기간 토글
          </div>
        </div>
        <div class="settings-guide-row">
          <div class="settings-guide-label"><i class="ph ph-chat-circle-dots"></i> 업무 소통</div>
          <div class="settings-guide-body">
            계약 관련 영업자/공급사/관리자 간 대화방.<br>
            • 좌측 대화방 우클릭 → <b>읽음 / 즐겨찾기 / 숨김 / 삭제</b><br>
            • 진행 단계는 우측 패널에서 체크 (영업/공급 양쪽)
          </div>
        </div>
        <div class="settings-guide-row">
          <div class="settings-guide-label"><i class="ph ph-file-text"></i> 계약 관리</div>
          <div class="settings-guide-body">
            계약 진행상황 추적.<br>
            • 임시 코드(TMP-...) → 완료 시 정식 계약코드 자동 부여<br>
            • 7단계 체크리스트 (영업 ↔ 공급) — 양쪽 모두 ✓ 되어야 다음 단계
          </div>
        </div>
        <div class="settings-guide-row">
          <div class="settings-guide-label"><i class="ph ph-calculator"></i> 정산 관리</div>
          <div class="settings-guide-body">
            영업 수수료 정산. 계약 완료 후 자동 정산 항목 생성.<br>
            • 미정산 / 정산완료 / 환수 3단계
          </div>
        </div>
        <div class="settings-guide-row">
          <div class="settings-guide-label"><i class="ph ph-package"></i> 재고 관리 (관리자)</div>
          <div class="settings-guide-body">
            차량 등록·수정. 사진/가격/옵션 관리.<br>
            • 입력칸 <b>두 번 클릭</b>으로 수정 모드 진입
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-title">🖱 우클릭 (컨텍스트) 메뉴</div>
      <div class="settings-guide-body">
        대부분 목록의 행에서 우클릭으로 빠른 액션 가능:
        <ul>
          <li><b>상품 찾기</b> 행 → 링크/내용 복사, 문의, 계약 생성</li>
          <li><b>대화방</b> → 읽음/즐겨찾기/숨김/삭제</li>
          <li><b>계약</b> → 코드 복사, 삭제</li>
          <li><b>재고</b> → 카탈로그 링크, 삭제</li>
        </ul>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-title">⌨ 입력칸 사용법</div>
      <div class="settings-guide-body">
        모든 편집 가능한 입력칸은 <b>2-click 수정 모드</b>:
        <ol>
          <li>1번째 클릭 → 칸 강조 (선택 표시, 아직 수정 불가)</li>
          <li>2번째 클릭 → 입력 가능, 자동 포커스</li>
          <li>다른 곳 클릭 또는 Enter → 자동 저장 + 다시 잠김</li>
        </ol>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-title">📞 영업 팁</div>
      <div class="settings-guide-body">
        <ul>
          <li><b>고객에게 차량 공유</b>: 상품 우클릭 → "상품 내용 복사" → 카톡 붙여넣기 (담당자 정보 자동 포함)</li>
          <li><b>카탈로그 전체 공유</b>: 설정 → 카탈로그 공유 → 링크 복사 (영업자 추적 코드 포함)</li>
          <li><b>새 계약</b>: 상품 찾기에서 차량 선택 → 우클릭 또는 하단바 "계약" 버튼 → 고객 정보 입력</li>
        </ul>
      </div>
    </section>
  `;
}

/* ──────── 계정 정보 ──────── */
function renderAccountSection(user) {
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();
  const ROLE_LABEL = { admin: '관리자', provider: '공급', agent: '영업', agent_admin: '영업 관리자' };
  // 변경 불가 정보 — 읽기 전용 표시 (가입 시 확정 / 관리자만 변경 가능)
  const READONLY_INFO = [
    { label: '이메일',     value: user.email || '-' },
    { label: '소속',       value: user.company_name || user.company_code || '-' },
    { label: '역할',       value: ROLE_LABEL[user.role] || user.role || '-' },
    { label: '사용자 코드', value: user.user_code || '-' },
    { label: '가입일',     value: user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '-' },
  ];
  // 변경/추가 가능 — 본인이 직접 편집
  const EDITABLE = [
    { key: 'name',            label: '이름',       placeholder: '이름' },
    { key: 'position',        label: '직급',       placeholder: '예: 팀장 / 대리 / 실장' },
    { key: 'phone',           label: '연락처',     placeholder: '010-0000-0000' },
    { key: 'bio',             label: '한마디',     placeholder: '고객에게 보낼 짧은 소개' },
    { key: 'business_number', label: '사업자번호', placeholder: '000-00-00000' },
  ];
  return `
    <!-- 프로필 헤더 -->
    <header class="settings-profile">
      <div class="settings-avatar" id="acAvatar" title="프로필 사진 변경">
        ${user.avatar_url ? `<img src="${esc(user.avatar_url)}">` : esc(initial)}
        <span class="settings-avatar-overlay"><i class="ph ph-camera"></i></span>
      </div>
      <div class="settings-profile-meta">
        <div class="settings-profile-name">${esc(user.name || '이름 없음')}</div>
        <div class="settings-profile-sub">${esc([user.company_name, user.position].filter(Boolean).join(' | ') || '-')}</div>
      </div>
    </header>

    <!-- 기본 정보 (변경 불가) -->
    <section class="settings-section">
      <div class="settings-section-title">기본 정보 <span style="color:var(--text-weak); font-size:var(--font-size);">— 변경 불가</span></div>
      <div class="settings-rows">
        ${READONLY_INFO.map(f => `
          <div class="settings-row">
            <label class="settings-row-label">${f.label}</label>
            <div class="settings-row-control">
              <span class="settings-row-static">${esc(f.value)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- 내가 입력하는 정보 (편집 가능) -->
    <section class="settings-section">
      <div class="settings-section-title">내 정보 <span style="color:var(--text-weak); font-size:var(--font-size);">— 두 번 클릭하여 수정</span></div>
      <div class="settings-rows">
        ${EDITABLE.map(f => `
          <div class="settings-row">
            <label class="settings-row-label">${f.label}</label>
            <div class="settings-row-control">
              <input class="input ac-input" data-field="${f.key}" value="${esc(user[f.key] || '')}" placeholder="${f.placeholder}" readonly data-edit-lock="1">
              <span class="ac-state" data-state="${f.key}"></span>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- 계정 관리 -->
    <section class="settings-section">
      <div class="settings-section-title">계정 관리</div>
      <div class="settings-rows">
        <button class="settings-action" id="acResetPw">
          <span class="settings-action-body"><i class="ph ph-key"></i> <span>비밀번호 변경</span></span>
          <span class="settings-action-hint">메일로 재설정 링크 발송</span>
        </button>
        <button class="settings-action is-danger" id="acLogout">
          <span class="settings-action-body"><i class="ph ph-sign-out"></i> <span>로그아웃</span></span>
        </button>
      </div>
    </section>
  `;
}

function bindAccountSection(body, user) {
  // 자동 저장 (blur). data-permanent-lock 은 진짜 readonly (이메일/소속), data-edit-lock 은 2-click 수정 모드
  body.querySelectorAll('.ac-input').forEach(inp => {
    if (inp.dataset.permanentLock === '1') return;
    const field = inp.dataset.field;
    const stateEl = body.querySelector(`[data-state="${field}"]`);
    let original = inp.value;

    inp.addEventListener('focus', () => {
      original = inp.value;
      if (stateEl) stateEl.innerHTML = '<i class="ph ph-pencil-simple"></i> 수정 중';
    });
    inp.addEventListener('blur', async () => {
      const val = inp.value.trim();
      if (val === original) {
        if (stateEl) stateEl.innerHTML = '';
        return;
      }
      try {
        await updateRecord(`users/${user.uid}`, { [field]: val, updated_at: Date.now() });
        store.currentUser = { ...store.currentUser, [field]: val };
        original = val;
        if (stateEl) {
          stateEl.innerHTML = '<i class="ph ph-check"></i> 저장됨';
          clearTimeout(stateEl._t);
          stateEl._t = setTimeout(() => { stateEl.innerHTML = ''; }, 1500);
        }
      } catch (e) {
        if (stateEl) stateEl.innerHTML = '<i class="ph ph-warning"></i> 저장 실패';
        showToast('저장 실패', 'error');
      }
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });

  // 비밀번호 재설정
  body.querySelector('#acResetPw')?.addEventListener('click', async () => {
    if (!user.email) return showToast('이메일이 없습니다', 'error');
    try {
      await resetPassword(user.email);
      showToast('비밀번호 재설정 메일 전송됨');
    } catch (e) {
      showToast('전송 실패: ' + (e.message || e), 'error');
    }
  });

  // 로그아웃
  body.querySelector('#acLogout')?.addEventListener('click', async () => {
    await fbLogout();
    location.reload();
  });
}

/* ──────── 시스템 설정 ──────── */
/* 폰트 프리셋 — 다양한 조합 (사용자 취향대로). 시스템에 없는 폰트는 다음 폴백 자동 사용 */
const FONT_PRESETS = {
  hybrid:      { label: '🌟 Consolas + Pretendard (기본)',    value: `Consolas, 'SF Mono', ui-monospace, 'Pretendard', sans-serif` },
  jetbrains:   { label: 'JetBrains Mono + Pretendard',       value: `'JetBrains Mono', 'Cascadia Code', Consolas, 'Pretendard', sans-serif` },
  cascadia:    { label: 'Cascadia Code + Pretendard',         value: `'Cascadia Code', 'Cascadia Mono', Consolas, 'Pretendard', sans-serif` },
  d2coding:    { label: 'D2Coding + Pretendard (한글 mono)', value: `'D2Coding', 'D2Coding ligature', Consolas, 'Pretendard', sans-serif` },
  sfmono:      { label: 'SF Mono + Pretendard (Mac)',        value: `'SF Mono', 'Menlo', Monaco, 'Pretendard', sans-serif` },
  pretendard:  { label: 'Pretendard 단독 (모던)',             value: `'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif` },
  noto:        { label: 'Noto Sans KR (구글)',                value: `'Noto Sans KR', 'Noto Sans', 'Pretendard', sans-serif` },
  spoqa:       { label: 'Spoqa Han Sans Neo',                 value: `'Spoqa Han Sans Neo', 'Pretendard', sans-serif` },
  malgun:      { label: '맑은 고딕 (Windows 표준)',           value: `'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif` },
  apple:       { label: 'Apple SD Gothic Neo (Mac 표준)',     value: `'Apple SD Gothic Neo', '맑은 고딕', 'Malgun Gothic', sans-serif` },
  gulim:       { label: '굴림체 (전산실 톤)',                 value: `'GulimChe', '굴림체', 'Gulim', '굴림', monospace` },
  dotum:       { label: '돋움체 (옛 ERP 톤)',                  value: `'DotumChe', '돋움체', 'Dotum', '돋움', monospace` },
  system:      { label: '시스템 기본',                         value: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` },
};

function renderSystemSection() {
  const theme = localStorage.getItem('fp.theme') || 'light';
  const fontKey = localStorage.getItem('fp.font') || 'hybrid';
  const landing = localStorage.getItem('fp.landing') || 'search';
  const soundOn = localStorage.getItem('fp.sound') !== 'off';
  const pushOn = (typeof Notification !== 'undefined' && Notification.permission === 'granted');

  return `
    <!-- 외관 -->
    <section class="settings-section">
      <div class="settings-section-title">외관</div>
      <div class="settings-rows">
        <div class="settings-row settings-row-toggle" id="stTheme">
          <label class="settings-row-label">다크모드</label>
          <span class="settings-row-value">
            <i class="ph ph-${theme === 'dark' ? 'sun' : 'moon'}"></i> ${theme === 'dark' ? 'ON' : 'OFF'}
          </span>
        </div>
        <div class="settings-row">
          <label class="settings-row-label">폰트</label>
          <select class="input" id="stFont" style="max-width: 240px;">
            ${Object.entries(FONT_PRESETS).map(([k, v]) =>
              `<option value="${k}" ${fontKey === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </section>

    <!-- 시작 페이지 -->
    <section class="settings-section">
      <div class="settings-section-title">시작 페이지</div>
      <div class="settings-rows">
        <div class="settings-row">
          <label class="settings-row-label">로그인 후 첫 화면</label>
          <select class="input" id="stLanding" style="max-width: 200px;">
            <option value="search"    ${landing === 'search'    ? 'selected' : ''}>상품 찾기</option>
            <option value="workspace" ${landing === 'workspace' ? 'selected' : ''}>업무 소통</option>
            <option value="contract"  ${landing === 'contract'  ? 'selected' : ''}>계약 관리</option>
            <option value="settle"    ${landing === 'settle'    ? 'selected' : ''}>정산 관리</option>
          </select>
        </div>
      </div>
    </section>

    <!-- 알림 -->
    <section class="settings-section">
      <div class="settings-section-title">알림</div>
      <div class="settings-rows">
        <div class="settings-row settings-row-toggle" id="stPush">
          <label class="settings-row-label">웹 푸시 알림</label>
          <span class="settings-row-value" style="color: ${pushOn ? 'var(--alert-green-text)' : 'var(--text-muted)'};">${pushOn ? '허용됨' : '허용 필요'}</span>
        </div>
        <div class="settings-row settings-row-toggle" id="stSound">
          <label class="settings-row-label">알림 소리</label>
          <span class="settings-row-value" style="color: ${soundOn ? 'var(--alert-green-text)' : 'var(--text-muted)'};">${soundOn ? 'ON' : 'OFF'}</span>
        </div>
      </div>
    </section>
  `;
}

function bindSystemSection(body) {
  // 다크모드 토글
  body.querySelector('#stTheme')?.addEventListener('click', () => {
    const next = (localStorage.getItem('fp.theme') || 'light') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('fp.theme', next);
    renderTabBody();
  });

  // 폰트 변경
  body.querySelector('#stFont')?.addEventListener('change', (e) => {
    const key = e.target.value;
    const preset = FONT_PRESETS[key];
    if (!preset) return;
    document.documentElement.style.setProperty('--font', preset.value);
    localStorage.setItem('fp.font', key);
    showToast(`폰트 변경됨: ${preset.label.split(' ')[0]}`);
  });

  // 시작 페이지
  body.querySelector('#stLanding')?.addEventListener('change', (e) => {
    localStorage.setItem('fp.landing', e.target.value);
    showToast('시작 페이지 변경됨');
  });

  // 푸시 알림 권한
  body.querySelector('#stPush')?.addEventListener('click', async () => {
    if (typeof Notification === 'undefined') return showToast('알림 미지원 브라우저', 'error');
    const result = await Notification.requestPermission();
    showToast(result === 'granted' ? '알림 허용됨' : '알림 거부됨');
    renderTabBody();
  });

  // 소리 토글
  body.querySelector('#stSound')?.addEventListener('click', () => {
    const cur = localStorage.getItem('fp.sound') !== 'off';
    localStorage.setItem('fp.sound', cur ? 'off' : 'on');
    renderTabBody();
  });
}

/* ──────── 카탈로그 공유 ──────── */
function renderCatalogSection(user) {
  const url = `${location.origin}/catalog.html${user.user_code ? '?a=' + encodeURIComponent(user.user_code) : ''}`;
  return `
    <section class="settings-section">
      <div class="settings-section-title">내 카탈로그 링크</div>
      <div class="settings-rows">
        <div class="settings-row" style="flex-direction: column; align-items: stretch; gap: var(--sp-2);">
          <div style="display: flex; gap: var(--sp-2);">
            <input class="input" id="stCatalogUrl" readonly value="${esc(url)}" style="flex: 1;">
            <button class="btn" id="stCatalogCopy"><i class="ph ph-copy"></i> 복사</button>
          </div>
          <div style="font-size: var(--font-size); color: var(--text-weak);">
            이 링크를 고객에게 공유하면 내 카탈로그가 표시됩니다 (영업자 추적 코드 포함)
          </div>
        </div>
      </div>
    </section>
  `;
}

function bindCatalogSection(body) {
  body.querySelector('#stCatalogCopy')?.addEventListener('click', () => {
    const url = body.querySelector('#stCatalogUrl')?.value;
    navigator.clipboard?.writeText(url).then(() => showToast('링크 복사됨'));
  });
}

/* 폰트 부팅 — 저장된 폰트 설정 적용 (HTML 로드 시 호출) */
export function applyStoredFont() {
  const key = localStorage.getItem('fp.font');
  if (!key || !FONT_PRESETS[key]) return;
  document.documentElement.style.setProperty('--font', FONT_PRESETS[key].value);
}

/* 다크모드 부팅 */
export function applyStoredTheme() {
  const theme = localStorage.getItem('fp.theme');
  if (theme) document.documentElement.dataset.theme = theme;
}
