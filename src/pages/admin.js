/**
 * 관리자 — 사이드바 하위메뉴로 분기
 * /admin/users → 사용자 관리 (4패널)
 * /admin/partners → 파트너 관리 (4패널)
 * /admin/dev → 개발모드
 */
import { store } from '../core/store.js';
import { watchCollection, watchRecord, updateRecord, softDelete, setRecord, pushRecord, fetchCollection } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { cField, empty } from '../core/format.js';
import { fieldInput as ffi, fieldSelect as ffs, fieldView as ffv, fieldTextarea as ffta, bindAutoSave as bindFormAutoSave } from '../core/form-fields.js';
import { initWs4Resize } from '../core/resize.js';
import { saveNotice, updateNotice, deleteNotice, uploadNoticeImage } from '../firebase/notices.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';
import { renderExcelTable } from '../core/excel-table.js';
import { renderVehicleTab } from './admin/vehicle-master.js';

let unsubs = [];
let activeKey = null;
let mode = 'users'; // users | partners | sign | dev
let viewMode = 'card';

export function mount(subPath) {
  unsubs.forEach(u => u?.());
  unsubs = [];
  activeKey = null;

  // Detect mode from URL
  const path = location.pathname;
  if (path.includes('partners')) mode = 'partners';
  else if (path.includes('dev')) mode = 'dev';
  else if (path.includes('sign')) mode = 'sign';
  else mode = 'users';

  const main = document.getElementById('mainContent');

  if (mode === 'dev') { mountDev(main); return; }
  if (mode === 'sign') {
    import('./admin/sign-inbox.js').then(m => m.mount(main));
    return;
  }

  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">
          <span>${mode === 'users' ? '사용자 목록' : '파트너 목록'}</span>
          <span style="display:flex;gap:var(--sp-1);"><button class="btn btn-sm btn-outline" id="admViewToggle"><i class="ph ph-table"></i> 엑셀보기</button>${mode === 'partners' ? '<button class="btn btn-sm btn-primary" id="admNewPartner"><i class="ph ph-plus"></i> 새 파트너</button>' : ''}</span>
        </div>
        <div class="ws4-search">
          <input class="input input-sm" id="admSearch" placeholder="검색..." >
          <div class="ws4-search-chips">
            ${mode === 'users'
              ? '<button class="chip is-active" data-f="pending">대기</button><button class="chip" data-f="active">승인</button><button class="chip" data-f="hold">보류</button><button class="chip" data-f="all">전체</button>'
              : '<button class="chip is-active" data-f="active">활성</button><button class="chip" data-f="inactive">비활성</button><button class="chip" data-f="pending">대기</button><button class="chip" data-f="all">전체</button>'
            }
          </div>
        </div>
        <div class="ws4-body" id="admList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="form">
        <div class="ws4-head"><span>${mode === 'users' ? '사용자 정보' : '파트너 정보'}</span><div style="display:flex;gap:var(--sp-1);" id="admFormActions"></div></div>
        <div class="ws4-body" id="admForm">${empty('선택하세요')}</div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>
      <div class="ws4-panel" data-panel="detail">
        <div class="ws4-head">${mode === 'users' ? '사용자 상세' : '파트너 상세'}</div>
        <div class="ws4-body" id="admDetail">${empty('상세')}</div>
      </div>
      <div class="ws4-resize" data-idx="2"></div>
      <div class="ws4-panel" data-panel="sub">
        <div class="ws4-head">활동 이력</div>
        <div class="ws4-body" id="admSub">${empty('이력')}</div>
      </div>
    </div>
  `;

  initWs4Resize(`fp.adm.${mode}.widths`);

  main.querySelectorAll('.chip[data-f]').forEach(c => {
    c.addEventListener('click', () => {
      main.querySelectorAll('.chip[data-f]').forEach(x => x.classList.remove('is-active'));
      c.classList.add('is-active');
      renderList();
    });
  });
  document.getElementById('admSearch')?.addEventListener('input', () => renderList());

  document.getElementById('admViewToggle')?.addEventListener('click', () => {
    viewMode = viewMode === 'excel' ? 'card' : 'excel';
    const btn = document.getElementById('admViewToggle');
    if (btn) btn.innerHTML = viewMode === 'excel' ? '<i class="ph ph-cards"></i> 카드보기' : '<i class="ph ph-table"></i> 엑셀보기';
    renderList();
  });

  document.getElementById('admNewPartner')?.addEventListener('click', () => {
    const fa = document.getElementById('admFormActions');
    if (fa) fa.innerHTML = `<button class="btn btn-xs btn-primary" id="admSaveNew"><i class="ph ph-check"></i> 저장</button>`;
    const el = document.getElementById('admForm');
    el.innerHTML = `
      <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
        <div class="form-section">
          <div class="form-section-title"><i class="ph ph-plus-circle"></i> 새 파트너 등록</div>
          <div class="form-section-body">
            ${ffi('파트너코드','partner_code',{})}
            ${ffi('파트너명','partner_name',{})}
            ${ffs('유형','partner_type',{},['공급사','영업채널'])}
            ${ffi('담당자명','manager_name',{})}
            ${ffi('직급','manager_position',{})}
            ${ffi('연락처','manager_phone',{})}
            ${ffta('비고','note',{},{ rows: 3 })}
          </div>
        </div>
      </div>
    `;
    document.getElementById('admSaveNew')?.addEventListener('click', async () => {
      const fields = {};
      el.querySelectorAll('.contract-field-input').forEach(inp => { fields[inp.dataset.field] = inp.value.trim(); });
      if (!fields.partner_code) { showToast('파트너코드 필수'); return; }
      await setRecord('partners/' + fields.partner_code, {
        ...fields,
        status: 'active',
        created_at: Date.now(),
        created_by: store.currentUser?.uid || '',
      });
      showToast('파트너 등록 완료');
    });
  });

  const col = mode === 'users' ? 'users' : 'partners';
  unsubs.push(watchCollection(col, (data) => {
    store[col] = data;
    renderList();
    if (mode === 'users') {
      const pending = data.filter(u => u.status === 'pending').length;
      const active = data.filter(u => u.status === 'active').length;
      setBreadcrumbBrief(`대기 ${pending} · 승인 ${active} / 전체 ${data.length}`);
    } else {
      const active = data.filter(p => p.status === 'active').length;
      setBreadcrumbBrief(`활성 ${active} / 전체 ${data.length}`);
    }
  }));
}

function renderList() {
  const el = document.getElementById('admList');
  if (!el) return;
  const q = (document.getElementById('admSearch')?.value || '').toLowerCase();
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || (mode === 'users' ? 'pending' : 'active');
  const data = mode === 'users' ? (store.users || []) : (store.partners || []);

  let list = [...data];
  if (f !== 'all') {
    const statusMap = { active: 'active', pending: 'pending', hold: 'rejected', inactive: 'inactive' };
    const target = statusMap[f] || f;
    list = list.filter(item => item.status === target);
  }

  if (q) {
    if (mode === 'users') list = list.filter(u => [u.name, u.email, u.role, u.company_name, u.phone, u.uid, u.status].some(v => v && String(v).toLowerCase().includes(q)));
    else list = list.filter(p => [p.partner_name, p.partner_code, p.partner_type, p.manager_name, p.manager_phone].some(v => v && String(v).toLowerCase().includes(q)));
  }

  list.sort((a,b) => (b.created_at||0) - (a.created_at||0));

  if (viewMode === 'excel') {
    const cols = mode === 'users' ? [
      { key: 'name', label: '이름', width: 90, pin: 'left', filter: 'search' },
      { key: 'email', label: '이메일', width: 160, filter: 'search' },
      { key: 'role', label: '역할', width: 80, filter: 'check' },
      { key: 'company_name', label: '회사명', width: 120, filter: 'search' },
      { key: 'phone', label: '연락처', width: 110 },
      { key: 'status', label: '상태', width: 70, filter: 'check' },
    ] : [
      { key: 'partner_name', label: '파트너명', width: 120, pin: 'left', filter: 'search' },
      { key: 'partner_code', label: '코드', width: 100, filter: 'search' },
      { key: 'partner_type', label: '유형', width: 80, filter: 'check' },
      { key: 'manager_name', label: '담당자', width: 90, filter: 'search' },
      { key: 'manager_phone', label: '연락처', width: 110 },
      { key: 'status', label: '상태', width: 70, filter: 'check' },
    ];
    renderExcelTable(el, {
      cols,
      data: list,
      activeKey: activeKey,
      keyField: '_key',
      onRowClick: async (it) => {
        activeKey = it._key;
        loadItem(it._key);
        const { setBreadcrumbTail } = await import('../core/breadcrumb.js');
        const nm = mode === 'users' ? (it.name || it.email) : (it.partner_name || it.partner_code);
        const icon = mode === 'users' ? 'ph ph-user' : 'ph ph-buildings';
        setBreadcrumbTail({ icon, label: nm, sub: mode === 'users' ? (it.role || '') : (it.partner_code || '') });
      },
    });
    return;
  }

  // Card view
  const STATUS_TONE = { active: 'ok', pending: 'warn', rejected: 'err', inactive: 'muted' };
  const tone = st => STATUS_TONE[st] || 'muted';

  el.innerHTML = list.map(item => {
    const key = item._key;
    const name = mode === 'users'
      ? [item.email, item.name, item.position].filter(Boolean).join(' ')
      : [item.partner_name, item.ceo_name, item.manager_name].filter(Boolean).join(' ');
    const statusLabel = { active: '승인', pending: '대기', rejected: '반려', inactive: '비활' }[item.status] || '';
    const avatarIcon = mode === 'users' ? 'ph-user' : 'ph-buildings';
    const roleLabel = { admin: '관리자', provider: '공급사', agent: '영업자', agent_admin: '영업관리자' }[item.role] || item.role || '';
    const sub = mode === 'users'
      ? [roleLabel, item.company_name, item.phone].filter(Boolean).join(' · ')
      : [item.partner_type, item.business_number, item.manager_phone || item.company_phone].filter(Boolean).join(' · ');

    return `
      <div class="room-item ${activeKey === key ? 'is-active' : ''}" data-key="${key}">
        <div class="room-item-avatar is-${tone(item.status)}" style="flex-direction:column;gap:1px;font-size:var(--fs-2xs);"><i class="ph ${avatarIcon}"></i>${statusLabel}</div>
        <div class="room-item-body">
          <div class="room-item-top">
            <span class="room-item-name">${name}</span>
          </div>
          <div class="room-item-msg"><span>${sub}</span></div>
        </div>
      </div>
    `;
  }).join('') || empty('없음');

  el.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', async () => {
      activeKey = item.dataset.key;
      renderList();
      loadItem(item.dataset.key);
      const it = list.find(x => x._key === item.dataset.key);
      if (it) {
        const { setBreadcrumbTail } = await import('../core/breadcrumb.js');
        const nm = mode === 'users' ? (it.name || it.email) : (it.partner_name || it.partner_code);
        const icon = mode === 'users' ? 'ph ph-user' : 'ph ph-buildings';
        setBreadcrumbTail({ icon, label: nm, sub: mode === 'users' ? (it.role || '') : (it.partner_code || '') });
      }
    });
  });
}

function loadItem(key) {
  if (mode === 'users') loadUser(key);
  else loadPartner(key);
}

/* ── 사용자 상세 ── */
function loadUser(key) {
  const u = (store.users || []).find(x => x._key === key);
  if (!u) return;
  const fa = document.getElementById('admFormActions');
  if (fa) {
    fa.innerHTML = `<button class="btn btn-xs btn-outline" id="admDeleteBtn" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>`;
    document.getElementById('admDeleteBtn')?.addEventListener('click', async () => {
      if (!confirm('삭제하시겠습니까?')) return;
      await updateRecord(`users/${key}`, { status: 'deleted' });
      showToast('삭제됨');
    });
  }
  // 상태 토글 → 헤드로
  if (fa) {
    fa.innerHTML = `
      ${['pending','active','rejected'].map(s => {
        const active = u.status === s;
        const labels = { pending: '대기', active: '승인', rejected: '반려' };
        return `<div class="status-toggle" data-status="${s}" style="font-size:var(--fs-2xs);padding:2px 6px;border-radius:var(--ctrl-r);cursor:pointer;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : 'color:var(--c-text-muted);'}">${labels[s]}</div>`;
      }).join('')}
      <button class="btn btn-xs btn-outline" id="admDeleteBtn" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>
    `;
    document.getElementById('admDeleteBtn')?.addEventListener('click', async () => {
      if (!confirm('삭제하시겠습니까?')) return;
      await updateRecord(`users/${key}`, { status: 'deleted' });
      showToast('삭제됨');
    });
  }

  // 폼
  const formEl = document.getElementById('admForm');
  formEl.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-user"></i> 계정</div>
        <div class="form-section-body">
          ${ffi('이름','name',u)}
          ${ffv('이메일', u.email)}
          ${ffs('역할','role',u,[{value:'admin',label:'관리자'},{value:'provider',label:'공급사'},{value:'agent',label:'영업자'},{value:'agent_admin',label:'영업관리자'}])}
          ${ffv('소속코드', u.company_code)}
          ${ffi('소속명','company_name',u)}
          ${ffv('계정코드', u.user_code)}
          ${ffi('연락처','phone',u)}
          ${ffi('직급','position',u)}
        </div>
      </div>
    </div>
  `;
  bindFormAutoSave(formEl, (field, value) => updateRecord(`users/${key}`, { [field]: value }));

  // 상세
  document.getElementById('admDetail').innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-info"></i> 상세</div>
        <div class="form-section-body">
          ${ffv('UID', u.uid)}
          ${ffv('상태', { active: '승인', pending: '대기', rejected: '반려', inactive: '비활', deleted: '삭제' }[u.status] || u.status)}
          ${ffv('역할', { admin: '관리자', provider: '공급사', agent: '영업자', agent_admin: '영업관리자' }[u.role] || u.role)}
          ${ffv('가입일', u.created_at ? new Date(u.created_at).toLocaleDateString('ko') : '-')}
        </div>
      </div>
    </div>
  `;

  // 보조
  document.getElementById('admSub').innerHTML = `
    <div style="padding:var(--sp-3);color:var(--c-text-muted);font-size:var(--fs-xs);">사용자 관련 로그/활동</div>
  `;

  // 상태 토글 이벤트 (헤드) — 승인자/시각 기록
  document.querySelectorAll('#admFormActions .status-toggle').forEach(tog => {
    tog.addEventListener('click', async () => {
      const me = store.currentUser || {};
      const newStatus = tog.dataset.status;
      const updates = { status: newStatus };
      if (newStatus === 'active') {
        updates.approved_at = Date.now();
        updates.approved_by = me.uid || '';
      } else if (newStatus === 'rejected') {
        updates.rejected_at = Date.now();
        updates.rejected_by = me.uid || '';
      }
      await updateRecord(`users/${key}`, updates);
      const labels = { pending: '대기', active: '승인', rejected: '반려' };
      showToast(`${u.name || u.email} → ${labels[newStatus]}`);
    });
  });
}

/* ── 파트너 상세 ── */
function loadPartner(key) {
  const fa = document.getElementById('admFormActions');
  const p = (store.partners || []).find(x => x._key === key);
  if (!p) return;

  if (fa) {
    fa.innerHTML = `
      ${['active','inactive'].map(s => {
        const active = p.status === s;
        return `<div class="status-toggle" data-status="${s}" style="font-size:var(--fs-2xs);padding:2px 6px;border-radius:var(--ctrl-r);cursor:pointer;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : 'color:var(--c-text-muted);'}">${s === 'active' ? '활성' : '비활성'}</div>`;
      }).join('')}
      <button class="btn btn-xs btn-outline" id="admDeleteBtn" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>
    `;
    document.getElementById('admDeleteBtn')?.addEventListener('click', async () => {
      if (!confirm('삭제하시겠습니까?')) return;
      await softDelete(`partners/${key}`);
      showToast('삭제됨');
    });
    document.querySelectorAll('#admFormActions .status-toggle').forEach(tog => {
      tog.addEventListener('click', async () => {
        await updateRecord(`partners/${key}`, { status: tog.dataset.status });
        showToast(`→ ${tog.dataset.status}`);
      });
    });
  }

  const formEl = document.getElementById('admForm');
  formEl.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-buildings"></i> 회사정보</div>
        <div class="form-section-body">
          ${ffv('파트너코드', p.partner_code)}
          ${ffi('파트너명','partner_name',p)}
          ${ffs('유형','partner_type',p,['공급사','영업채널'])}
          ${ffi('사업자번호','business_number',p)}
          ${ffi('대표자','ceo_name',p)}
          ${ffi('주소','address',p)}
          ${ffi('전화','company_phone',p)}
          ${ffi('이메일','email',p)}
          ${ffi('팩스','fax',p)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-user"></i> 담당자</div>
        <div class="form-section-body">
          ${ffi('담당자명','manager_name',p)}
          ${ffi('직급','manager_position',p)}
          ${ffi('연락처','manager_phone',p)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-note"></i> 비고</div>
        <div class="form-section-body">
          ${ffta('메모','note',p,{ rows: 3 })}
        </div>
      </div>
    </div>
  `;
  bindFormAutoSave(formEl, (field, value) => updateRecord(`partners/${key}`, { [field]: value }));

  document.getElementById('admDetail').innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-info"></i> 상세</div>
        <div class="form-section-body">
          ${ffv('코드', p.partner_code)}
          ${ffv('유형', p.partner_type)}
          ${ffv('상태', { active: '활성', inactive: '비활성' }[p.status] || p.status)}
          ${ffv('생성자', p.created_by)}
        </div>
      </div>
    </div>
  `;

  document.getElementById('admSub').innerHTML = `
    <div style="padding:var(--sp-3);color:var(--c-text-muted);font-size:var(--fs-xs);">파트너 연결 상품/정책</div>
  `;
}

/* ── 개발모드 (구 관리자 통합) ── */
/** JPKerp DEV_LABELS/DEV_SUBS/DEV_ICONS 규격 — 좌측 리스트에서 아이콘+제목+부제 표시 */
const DEV_TABS = [
  { id: 'vehicle', icon: 'ph ph-car-profile',         label: '차종 마스터',   sub: 'vehicle_master — 제조사·모델·세부모델 CRUD' },
  { id: 'notice',  icon: 'ph ph-megaphone',           label: '공지',         sub: '대시보드 공지 CRUD' },
  { id: 'color',   icon: 'ph ph-palette',             label: '색상 옵션',    sub: '외장·내장 색상 마스터' },
  { id: 'data',    icon: 'ph ph-database',            label: 'RTDB 현황',     sub: '컬렉션별 레코드 수·용량' },
  { id: 'upload',  icon: 'ph ph-upload-simple',       label: '일괄 업로드',  sub: 'CSV · Excel · Google Sheets 임포트' },
  { id: 'sync',    icon: 'ph ph-google-drive-logo',   label: '시트 동기화',  sub: 'Google Sheets ↔ Firebase' },
  { id: 'stock',   icon: 'ph ph-trash',               label: '데이터 삭제',  sub: '재고·계약·정산 일괄 삭제 (soft/hard)' },
  { id: 'tools',   icon: 'ph ph-wrench',              label: '시스템 도구',  sub: '버전·캐시·Store·일회성 마이그레이션' },
];

const devLog = (msg) => {
  const el = document.getElementById('devLog');
  if (el) el.textContent += `[${new Date().toLocaleTimeString('ko')}] ${msg}\n`;
};

/* 계약서 발송 inbox — src/pages/admin/sign-inbox.js 로 분리됨 */

function mountDev(main) {
  main.innerHTML = `
    <div class="ws4">
      <!-- Panel 1: 도구 목록 -->
      <div class="ws4-panel" data-panel="nav">
        <div class="ws4-head"><i class="ph ph-code"></i> <span>개발도구</span></div>
        <div class="ws4-body" id="devNav" style="padding:var(--sp-2);display:flex;flex-direction:column;gap:2px;overflow-y:auto;">
          ${DEV_TABS.map((t, i) => `
            <button class="dev-tool-item ${i === 0 ? 'is-active' : ''}" data-dev-tab="${t.id}">
              <i class="${t.icon}"></i>
              <span class="dev-tool-text">
                <span class="dev-tool-label">${t.label}</span>
                <span class="dev-tool-sub">${t.sub || ''}</span>
              </span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>

      <!-- Panel 2+3 (병합): 선택된 도구 — 내부에 목록+상세 자체 배치 -->
      <div class="ws4-panel" data-panel="content" style="flex:2 1 50%;">
        <div class="ws4-head">
          <i class="ph" id="devTitleIcon"></i>
          <span id="devTitle" style="font-weight:var(--fw-semibold);"></span>
          <span id="devTitleSub" style="margin-left:var(--sp-2);color:var(--c-text-muted);font-size:var(--fs-xs);font-weight:normal;"></span>
        </div>
        <div class="ws4-body" id="devContent" style="padding:var(--sp-3);overflow-y:auto;"></div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>

      <!-- Panel 4: 로그 -->
      <div class="ws4-panel" data-panel="log">
        <div class="ws4-head"><i class="ph ph-terminal"></i> 로그</div>
        <div class="ws4-body" id="devLog" style="padding:var(--sp-3);font-family:monospace;font-size:11px;color:var(--c-text-sub);white-space:pre-wrap;overflow-y:auto;"></div>
      </div>
    </div>
    <style>
      .dev-tool-item {
        display: flex; align-items: flex-start; gap: var(--sp-2);
        padding: var(--sp-2) var(--sp-3);
        border-radius: var(--ctrl-r);
        background: transparent;
        border: 1px solid transparent;
        text-align: left;
        cursor: pointer;
        transition: all var(--dur) var(--ease);
      }
      .dev-tool-item:hover { background: var(--c-bg-hover); }
      .dev-tool-item.is-active {
        background: var(--c-accent-soft);
        border-color: var(--c-accent);
      }
      .dev-tool-item > i {
        flex-shrink: 0;
        font-size: var(--fs-lg);
        color: var(--c-text-sub);
        margin-top: 2px;
      }
      .dev-tool-item.is-active > i { color: var(--c-accent); }
      .dev-tool-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .dev-tool-label {
        font-size: var(--fs-sm); font-weight: var(--fw-medium);
        color: var(--c-text);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .dev-tool-item.is-active .dev-tool-label { color: var(--c-accent); font-weight: var(--fw-semibold); }
      .dev-tool-sub {
        font-size: var(--fs-2xs);
        color: var(--c-text-muted);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        line-height: 1.3;
      }
    </style>
  `;

  const selectTab = (id) => {
    main.querySelectorAll('[data-dev-tab]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.devTab === id);
    });
    const tab = DEV_TABS.find(t => t.id === id);
    document.getElementById('devTitle').textContent = tab?.label || '';
    document.getElementById('devTitleSub').textContent = tab?.sub || '';
    const ic = document.getElementById('devTitleIcon');
    if (ic && tab) ic.className = tab.icon;
    renderDevTab(id);
  };

  main.querySelectorAll('[data-dev-tab]').forEach(btn => {
    btn.addEventListener('click', () => selectTab(btn.dataset.devTab));
  });

  selectTab(DEV_TABS[0].id);
}

function renderDevTab(id) {
  const el = document.getElementById('devContent');
  if (!el) return;
  if (id === 'tools')   return renderToolsTab(el);
  if (id === 'stock')   return renderStockTab(el);
  if (id === 'notice')  return renderNoticeTab(el);
  if (id === 'vehicle') return renderVehicleTab(el);
  if (id === 'color')   return renderColorTab(el);
  if (id === 'upload')  return renderUploadTab(el);
  if (id === 'sync')    return renderSyncTab(el);
  if (id === 'data')    return renderDataTab(el);
}

/* 도구 */
function renderToolsTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="form-section"><div class="form-section-title">시스템</div>
        <div class="form-section-body">
          ${ffv('버전','v2.0.0')}${ffv('Firebase','freepasserp3')}${ffv('빌드','Vite 8')}
        </div>
      </div>
      <div class="form-section"><div class="form-section-title">동작</div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          <button class="btn btn-outline btn-sm" id="devCacheClear"><i class="ph ph-trash"></i> 캐시 초기화</button>
          <button class="btn btn-outline btn-sm" id="devStoreView"><i class="ph ph-database"></i> Store 상태 보기</button>
          <button class="btn btn-outline btn-sm" id="devReload"><i class="ph ph-arrow-clockwise"></i> 강제 새로고침</button>
        </div>
      </div>
      <div class="form-section"><div class="form-section-title">일회성 마이그레이션</div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          <button class="btn btn-outline btn-sm" id="devMigrateTermPolicy"><i class="ph ph-swap"></i> policies: term_* → policy_*</button>
          <button class="btn btn-outline btn-sm" id="devMigrateModelName"><i class="ph ph-swap"></i> model_name → model (products · contracts · rooms)</button>
          <button class="btn btn-outline btn-sm" id="devMigratePartnerType"><i class="ph ph-swap"></i> partner_type 영어 → 한글 (provider→공급사)</button>
          <button class="btn btn-outline btn-sm" id="devMigrateUserCode"><i class="ph ph-identification-badge"></i> user_code 일괄부여 (미부여자만 · 전역 시퀀스)</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('devCacheClear').addEventListener('click', () => {
    localStorage.clear(); devLog('✓ localStorage 초기화'); showToast('캐시 초기화');
  });
  document.getElementById('devStoreView').addEventListener('click', () => {
    devLog(JSON.stringify({
      products: (store.products||[]).length, contracts: (store.contracts||[]).length,
      settlements: (store.settlements||[]).length, rooms: (store.rooms||[]).length,
      users: (store.users||[]).length, partners: (store.partners||[]).length,
      currentUser: store.currentUser?.email,
    }, null, 2));
  });
  document.getElementById('devReload').addEventListener('click', () => location.reload());

  document.getElementById('devMigrateTermPolicy').addEventListener('click', async () => {
    if (!confirm('policies/ 의 모든 문서에서 term_code/term_name/term_type → policy_* 로 rename합니다. 멱등(여러 번 실행 OK).\n진행하시겠습니까?')) return;
    const btn = document.getElementById('devMigrateTermPolicy');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> 마이그레이션 중...';
    try {
      const { ref, get, update } = await import('firebase/database');
      const { db } = await import('../firebase/config.js');
      const snap = await get(ref(db, 'policies'));
      const all = snap.val() || {};
      let moved = 0;
      let scanned = 0;
      for (const [k, v] of Object.entries(all)) {
        scanned++;
        const patch = {};
        if (v?.term_code != null) { if (v.policy_code == null) patch.policy_code = v.term_code; patch.term_code = null; }
        if (v?.term_name != null) { if (v.policy_name == null) patch.policy_name = v.term_name; patch.term_name = null; }
        if (v?.term_type != null) { if (v.policy_type == null) patch.policy_type = v.term_type; patch.term_type = null; }
        if (Object.keys(patch).length) {
          await update(ref(db, `policies/${k}`), patch);
          moved++;
        }
      }
      devLog(`✓ policies 스캔 ${scanned}건 · rename ${moved}건 완료`);
      showToast(`마이그레이션 완료 (${moved}/${scanned})`);
    } catch (e) {
      console.error(e);
      devLog(`✗ 실패: ${e.message}`);
      showToast('마이그레이션 실패 — 콘솔 확인', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-swap"></i> policies: term_* → policy_*';
    }
  });

  document.getElementById('devMigrateModelName').addEventListener('click', async () => {
    if (!confirm('products · contracts · rooms 의 model_name/model_name_snapshot 필드를 model/model_snapshot 으로 rename합니다. 멱등.\n진행하시겠습니까?')) return;
    const btn = document.getElementById('devMigrateModelName');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> 마이그레이션 중...';
    try {
      const { ref, get, update } = await import('firebase/database');
      const { db } = await import('../firebase/config.js');

      const migrateField = async (collection, srcField, dstField) => {
        const snap = await get(ref(db, collection));
        const all = snap.val() || {};
        let moved = 0;
        for (const [k, v] of Object.entries(all)) {
          if (!v || typeof v !== 'object') continue;
          if (v[srcField] == null) continue;
          const patch = {};
          if (v[dstField] == null) patch[dstField] = v[srcField];
          patch[srcField] = null;
          await update(ref(db, `${collection}/${k}`), patch);
          moved++;
        }
        return { scanned: Object.keys(all).length, moved };
      };

      const jobs = [
        ['products', 'model_name', 'model'],
        ['contracts', 'model_name_snapshot', 'model_snapshot'],
        ['contracts', 'model_name', 'model'],
        ['rooms', 'model_name', 'model'],
        ['settlements', 'model_name', 'model'],
      ];
      let totalMoved = 0;
      for (const [col, src, dst] of jobs) {
        try {
          const r = await migrateField(col, src, dst);
          devLog(`  ${col}.${src} → ${dst}: ${r.moved}/${r.scanned}`);
          totalMoved += r.moved;
        } catch (e) {
          devLog(`  ${col}.${src} → ${dst}: SKIP (${e.message})`);
        }
      }
      devLog(`✓ 전체 rename ${totalMoved}건 완료`);
      showToast(`마이그레이션 완료 (${totalMoved}건)`);
    } catch (e) {
      console.error(e);
      devLog(`✗ 실패: ${e.message}`);
      showToast('마이그레이션 실패', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-swap"></i> model_name → model (products · contracts · rooms)';
    }
  });

  document.getElementById('devMigratePartnerType').addEventListener('click', async () => {
    if (!confirm('partners/ 의 partner_type을 영어→한글로 변환합니다.\nprovider→공급사, channel→영업채널\n진행하시겠습니까?')) return;
    const btn = document.getElementById('devMigratePartnerType');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> 마이그레이션 중...';
    try {
      const { ref, get, update } = await import('firebase/database');
      const { db } = await import('../firebase/config.js');
      const snap = await get(ref(db, 'partners'));
      const data = snap.val() || {};
      const MAP = { provider: '공급사', channel: '영업채널', supplier: '공급사' };
      let count = 0;
      for (const [key, val] of Object.entries(data)) {
        const cur = val.partner_type || '';
        const mapped = MAP[cur.toLowerCase()];
        if (mapped && mapped !== cur) {
          await update(ref(db, `partners/${key}`), { partner_type: mapped });
          count++;
        }
      }
      devLog(`partner_type 한글 변환: ${count}건 완료`);
      showToast(`${count}건 변환 완료`);
    } catch (e) {
      console.error(e);
      devLog(`✗ 실패: ${e.message}`);
      showToast('마이그레이션 실패', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-swap"></i> partner_type 영어 → 한글 (provider→공급사)';
    }
  });

  document.getElementById('devMigrateUserCode').addEventListener('click', async () => {
    if (!confirm('user_code 가 비어있는 활성 유저에게 전역 시퀀스로 일괄 부여합니다.\n포맷: UNNNN (예: U0001, U0002)\n기존 user_code 있는 유저는 미변경. created_at 순.\n카운터(counters/user_code_seq)는 기존 최대값 이후부터 이어서 증가.\n진행하시겠습니까?')) return;
    const btn = document.getElementById('devMigrateUserCode');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> 부여 중...';
    try {
      const { ref, get, update, runTransaction } = await import('firebase/database');
      const { db } = await import('../firebase/config.js');
      const snap = await get(ref(db, 'users'));
      const all = snap.val() || {};

      // 1) 기존 U 접두 패턴에서 최대 seq 파악 (카운터 초기값 동기화용)
      let maxSeq = 0;
      const missing = [];
      for (const [uid, u] of Object.entries(all)) {
        if (!u || u.status === 'deleted') continue;
        if (u.user_code) {
          const m = /^U(\d+)$/.exec(u.user_code);
          if (m) {
            const n = Number(m[1]);
            if (n > maxSeq) maxSeq = n;
          }
        } else {
          missing.push({ uid, createdAt: u.created_at || 0, name: u.name || '' });
        }
      }

      // 2) 카운터가 maxSeq 보다 작으면 bump (transaction)
      const counterRef = ref(db, 'counters/user_code_seq');
      const curSnap = await get(counterRef);
      const curVal = curSnap.val() || 0;
      if (curVal < maxSeq) {
        // validate 규칙 상 한번에 못 뛰므로 순차 증가
        for (let v = curVal; v < maxSeq; v++) {
          await runTransaction(counterRef, (c) => (c || 0) + 1);
        }
        devLog(`  counter bump ${curVal} → ${maxSeq}`);
      }

      // 3) 미부여자 created_at 순 배정
      missing.sort((a, b) => a.createdAt - b.createdAt);
      let assigned = 0;
      for (const { uid, name } of missing) {
        const result = await runTransaction(counterRef, (c) => (c || 0) + 1);
        if (!result.committed) { devLog(`  ✗ seq 발급 실패: ${uid}`); continue; }
        const seq = result.snapshot.val();
        const code = `U${String(seq).padStart(4, '0')}`;
        await update(ref(db, `users/${uid}`), { user_code: code, updated_at: Date.now() });
        devLog(`  ${name || uid.slice(0,6)} → ${code}`);
        assigned++;
      }

      devLog(`✓ user_code 부여 ${assigned}건 완료`);
      showToast(`${assigned}건 부여 완료`);
    } catch (e) {
      console.error(e);
      devLog(`✗ 실패: ${e.message}`);
      showToast('마이그레이션 실패 — 콘솔 확인', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-identification-badge"></i> user_code 일괄부여 (미부여자만 · 전역 시퀀스)';
    }
  });
}

/* 재고 일괄삭제 */
function renderStockTab(el) {
  const products = (store.products || []).filter(p => p.status !== 'deleted');
  const checked = new Set();

  const makers = [...new Set(products.map(p => p.maker).filter(Boolean))].sort();
  const statuses = [...new Set(products.map(p => p.vehicle_status).filter(Boolean))].sort();
  const partners = [...new Set(products.map(p => p.provider_company_code || p.partner_code).filter(Boolean))].sort();

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-2);height:100%;">
      <div style="display:flex;gap:var(--sp-1);flex-wrap:wrap;">
        <input class="input input-sm" id="stkQ" placeholder="차량번호/모델 검색" style="flex:1;min-width:140px;">
        <select class="input input-sm" id="stkMaker" ><option value="">전체 제조사</option>${makers.map(m=>`<option>${m}</option>`).join('')}</select>
        <select class="input input-sm" id="stkStatus" ><option value="">전체 상태</option>${statuses.map(s=>`<option>${s}</option>`).join('')}</select>
        <select class="input input-sm" id="stkPartner" ><option value="">전체 공급사</option>${partners.map(p=>`<option>${p}</option>`).join('')}</select>
      </div>
      <div style="display:flex;gap:var(--sp-1);align-items:center;">
        <span id="stkCount" style="font-size:var(--fs-xs);color:var(--c-text-muted);">0대</span>
        <button class="btn btn-outline btn-sm" id="stkAll">전체 선택</button>
        <button class="btn btn-outline btn-sm" id="stkNone">해제</button>
        <button class="btn btn-sm" style="background:var(--c-err);color:var(--c-text-inv);margin-left:auto;" id="stkDel"><i class="ph ph-trash"></i> 선택 삭제</button>
      </div>
      <div id="stkList" style="flex:1;overflow-y:auto;border:1px solid var(--c-border);border-radius:4px;"></div>
    </div>
  `;

  const filter = () => {
    const q = document.getElementById('stkQ').value.toLowerCase().trim();
    const m = document.getElementById('stkMaker').value;
    const s = document.getElementById('stkStatus').value;
    const p = document.getElementById('stkPartner').value;
    return products.filter(x => {
      if (m && x.maker !== m) return false;
      if (s && x.vehicle_status !== s) return false;
      if (p && (x.provider_company_code || x.partner_code) !== p) return false;
      if (q && ![x.car_number, x.model, x.maker, x.sub_model, x.provider_company_code, x.partner_code, x.policy_code, x.vehicle_status].some(v => v && String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  };

  const render = () => {
    const list = filter();
    document.getElementById('stkCount').textContent = `${list.length}대 · 선택 ${checked.size}`;
    document.getElementById('stkList').innerHTML = list.slice(0, 500).map(p => {
      const k = p.product_uid || p.product_code || p._key;
      return `<div style="display:flex;align-items:center;gap:var(--sp-2);padding:4px 8px;border-bottom:1px solid var(--c-border);font-size:var(--fs-xs);">
        <input type="checkbox" data-k="${k}" ${checked.has(k)?'checked':''}>
        <span style="width:100px;">${p.provider_company_code||p.partner_code||'-'}</span>
        <span style="width:90px;">${p.car_number||'-'}</span>
        <span style="width:70px;">${p.maker||''}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.model||''} ${p.sub_model||''}</span>
        <span style="width:70px;color:var(--c-text-muted);">${p.vehicle_status||''}</span>
      </div>`;
    }).join('') + (list.length > 500 ? `<div style="padding:8px;text-align:center;color:var(--c-text-muted);font-size:var(--fs-xs);">상위 500건만 표시 · 필터로 좁히세요</div>` : '');

    document.getElementById('stkList').querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) checked.add(cb.dataset.k); else checked.delete(cb.dataset.k);
        document.getElementById('stkCount').textContent = `${list.length}대 · 선택 ${checked.size}`;
      });
    });
  };

  ['stkQ','stkMaker','stkStatus','stkPartner'].forEach(id => {
    document.getElementById(id).addEventListener(id==='stkQ'?'input':'change', render);
  });
  document.getElementById('stkAll').addEventListener('click', () => { filter().forEach(p => checked.add(p.product_uid || p.product_code || p._key)); render(); });
  document.getElementById('stkNone').addEventListener('click', () => { checked.clear(); render(); });
  document.getElementById('stkDel').addEventListener('click', async () => {
    if (!checked.size) return showToast('선택 없음', 'error');
    if (!confirm(`${checked.size}대 삭제? (soft delete)`)) return;
    let n = 0;
    for (const k of checked) { try { await softDelete(`products/${k}`); n++; } catch(e){} }
    devLog(`✓ ${n}대 삭제`);
    showToast(`${n}대 삭제 완료`);
    checked.clear();
  });
  render();
}

/* 공지 CRUD */
function renderNoticeTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="form-section"><div class="form-section-title">새 공지 등록</div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          <input class="input input-sm" id="ncTitle" placeholder="제목" >
          <textarea class="input" id="ncContent" rows="3" placeholder="내용" style="height:auto;font-size:var(--fs-xs);"></textarea>
          <input type="file" id="ncImg" accept="image/*" style="font-size:var(--fs-2xs);">
          <button class="btn btn-primary btn-sm" id="ncSave"><i class="ph ph-megaphone"></i> 등록</button>
        </div>
      </div>
      <div class="form-section"><div class="form-section-title">공지 목록</div>
        <div id="ncList" style="padding:var(--sp-2) var(--sp-3);"></div>
      </div>
    </div>
  `;
  const renderList = async () => {
    const notices = await fetchCollection('home_notices');
    const list = notices.filter(n => n.status !== 'deleted').sort((a,b)=>(b.created_at||0)-(a.created_at||0));
    document.getElementById('ncList').innerHTML = list.map(n => `
      <div style="padding:var(--sp-2);border-bottom:1px solid var(--c-border);">
        <div style="display:flex;justify-content:space-between;gap:var(--sp-2);">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:var(--fw-medium);font-size:var(--fs-sm);">${n.title||''}</div>
            <div style="font-size:var(--fs-xs);color:var(--c-text-muted);white-space:pre-wrap;">${n.content||''}</div>
            <div style="font-size:var(--fs-2xs);color:var(--c-text-muted);margin-top:2px;">${new Date(n.created_at||0).toLocaleString('ko')}</div>
          </div>
          <button class="btn btn-xs" style="background:var(--c-err);color:var(--c-text-inv);" data-del="${n._key}"><i class="ph ph-x"></i></button>
        </div>
      </div>
    `).join('') || empty('공지 없음');
    document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('삭제?')) return;
      await deleteNotice(b.dataset.del);
      showToast('삭제 완료'); renderList();
    }));
  };
  document.getElementById('ncSave').addEventListener('click', async () => {
    const title = document.getElementById('ncTitle').value.trim();
    const content = document.getElementById('ncContent').value.trim();
    if (!title) return showToast('제목 필수', 'error');
    let image_url = '';
    const f = document.getElementById('ncImg').files[0];
    if (f) image_url = await uploadNoticeImage(f);
    await saveNotice({ title, content, image_url, created_by: store.currentUser?.user_code || '' });
    showToast('등록 완료'); devLog(`✓ 공지: ${title}`);
    document.getElementById('ncTitle').value = '';
    document.getElementById('ncContent').value = '';
    document.getElementById('ncImg').value = '';
    renderList();
  });
  renderList();
}

/* 색상 마스터 CRUD */
function renderColorTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="form-section"><div class="form-section-title">외장색</div>
        <div class="form-section-body">
          <div style="display:flex;gap:var(--sp-1);margin-bottom:var(--sp-2);">
            <input class="input input-sm" id="extIn" placeholder="색상명" style="flex:1;">
            <button class="btn btn-primary btn-sm" id="extAdd"><i class="ph ph-plus"></i> 추가</button>
          </div>
          <div id="extList" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
        </div>
      </div>
      <div class="form-section"><div class="form-section-title">내장색</div>
        <div class="form-section-body">
          <div style="display:flex;gap:var(--sp-1);margin-bottom:var(--sp-2);">
            <input class="input input-sm" id="intIn" placeholder="색상명" style="flex:1;">
            <button class="btn btn-primary btn-sm" id="intAdd"><i class="ph ph-plus"></i> 추가</button>
          </div>
          <div id="intList" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
        </div>
      </div>
    </div>
  `;
  const refresh = () => {
    const cm = store.colorMaster || {};
    const ext = cm.ext_colors || [];
    const intC = cm.int_colors || [];
    document.getElementById('extList').innerHTML = ext.map(c => `<span class="chip" style="cursor:default;">${c}<button style="background:none;border:none;margin-left:4px;cursor:pointer;color:var(--c-err);" data-exd="${c}">×</button></span>`).join('') || `<span style="color:var(--c-text-muted);font-size:var(--fs-xs);">없음</span>`;
    document.getElementById('intList').innerHTML = intC.map(c => `<span class="chip" style="cursor:default;">${c}<button style="background:none;border:none;margin-left:4px;cursor:pointer;color:var(--c-err);" data-ind="${c}">×</button></span>`).join('') || `<span style="color:var(--c-text-muted);font-size:var(--fs-xs);">없음</span>`;
    document.querySelectorAll('[data-exd]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`"${b.dataset.exd}" 삭제?`)) return;
      await updateRecord('color_master', { ext_colors: ext.filter(x => x !== b.dataset.exd) });
      showToast('삭제');
    }));
    document.querySelectorAll('[data-ind]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`"${b.dataset.ind}" 삭제?`)) return;
      await updateRecord('color_master', { int_colors: intC.filter(x => x !== b.dataset.ind) });
      showToast('삭제');
    }));
  };
  document.getElementById('extAdd').addEventListener('click', async () => {
    const v = document.getElementById('extIn').value.trim();
    if (!v) return;
    const ext = (store.colorMaster?.ext_colors || []);
    if (ext.includes(v)) return showToast('이미 있음', 'error');
    await updateRecord('color_master', { ext_colors: [...ext, v] });
    document.getElementById('extIn').value = '';
    devLog(`✓ 외장색 추가: ${v}`);
  });
  document.getElementById('intAdd').addEventListener('click', async () => {
    const v = document.getElementById('intIn').value.trim();
    if (!v) return;
    const intC = (store.colorMaster?.int_colors || []);
    if (intC.includes(v)) return showToast('이미 있음', 'error');
    await updateRecord('color_master', { int_colors: [...intC, v] });
    document.getElementById('intIn').value = '';
    devLog(`✓ 내장색 추가: ${v}`);
  });
  refresh();
  const cmUnsub = watchRecord('color_master', (val) => { store.colorMaster = val || {}; refresh(); });
  unsubs.push(cmUnsub);
}

/* CSV 업로드 */
function renderUploadTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="form-section"><div class="form-section-title">상품 CSV 업로드</div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          <div style="font-size:var(--fs-xs);color:var(--c-text-muted);">차량번호 컬럼 필수 · 헤더 첫 행</div>
          <input type="file" id="upFile" accept=".csv,.tsv" style="font-size:var(--fs-xs);">
          <button class="btn btn-primary btn-sm" id="upBtn"><i class="ph ph-upload-simple"></i> 업로드</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('upBtn').addEventListener('click', async () => {
    const file = document.getElementById('upFile').files[0];
    if (!file) return showToast('파일 선택', 'error');
    devLog(`업로드: ${file.name} (${(file.size/1024).toFixed(1)}KB)`);
    const text = await file.text();
    const sep = file.name.endsWith('.tsv') ? '\t' : ',';
    const lines = text.split(/\r?\n/).map(l => l.split(sep).map(c => c.replace(/^"|"$/g,'').trim()));
    if (lines.length < 2) { devLog('✗ 데이터 없음'); return; }
    const headers = lines[0];
    const rows = lines.slice(1).filter(r => r.length >= 2);
    devLog(`헤더: ${headers.join(', ')}`);
    const carIdx = headers.findIndex(h => h.includes('차량번호') || h === 'car_number');
    if (carIdx < 0) { devLog('✗ 차량번호 컬럼 없음'); return showToast('차량번호 컬럼 필요','error'); }
    let saved = 0;
    for (const row of rows) {
      const carNumber = row[carIdx];
      if (!carNumber || !/[가-힣]/.test(carNumber)) continue;
      const product = {};
      headers.forEach((h,i) => { if (row[i]) product[h] = row[i]; });
      product.car_number = carNumber;
      product.source = 'csv_upload';
      const uid = `CSV_${carNumber.replace(/\s/g,'')}`;
      await setRecord(`products/${uid}`, { product_uid: uid, ...product, status: 'available', vehicle_status: product.vehicle_status || '출고가능' });
      saved++;
    }
    devLog(`✓ ${saved}대 저장`);
    showToast(`${saved}대 업로드 완료`);
  });
}

/* 구글시트 동기화 */
function renderSyncTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="form-section"><div class="form-section-title">외부 시트 동기화</div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          <input class="input input-sm" id="syncUrl" placeholder="구글시트 공유 URL" >
          <button class="btn btn-primary btn-sm" id="syncBtn"><i class="ph ph-google-drive-logo"></i> 가져오기</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('syncBtn').addEventListener('click', async () => {
    const url = document.getElementById('syncUrl').value.trim();
    if (!url) return showToast('URL 필요', 'error');
    devLog('동기화 요청...');
    try {
      const res = await fetch('/api/vehicle-master/fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url: url })
      });
      const data = await res.json();
      if (data.ok) { devLog(`✓ ${data.text?.split('\n').length || 0}행`); showToast('동기화 완료'); }
      else { devLog(`✗ ${data.message}`); showToast(data.message || '실패', 'error'); }
    } catch (e) { devLog(`✗ ${e.message}`); showToast('오류', 'error'); }
  });
}

/* 데이터 뷰어 */
function renderDataTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-2);height:100%;">
      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${['products','contracts','settlements','rooms','users','partners','policies','home_notices'].map(c =>
          `<button class="chip" data-col="${c}">${c}</button>`
        ).join('')}
      </div>
      <div id="dataView" style="flex:1;overflow-y:auto;border:1px solid var(--c-border);border-radius:4px;padding:var(--sp-2);"></div>
    </div>
  `;
  el.querySelectorAll('[data-col]').forEach(c => {
    c.addEventListener('click', async () => {
      el.querySelectorAll('[data-col]').forEach(x => x.classList.remove('is-active'));
      c.classList.add('is-active');
      const data = await fetchCollection(c.dataset.col);
      const view = document.getElementById('dataView');
      view.innerHTML = `<div style="font-size:var(--fs-2xs);color:var(--c-text-muted);margin-bottom:var(--sp-2);">${data.length}건 (상위 100건)</div>` +
        data.slice(0, 100).map(d => `<div style="font-size:var(--fs-2xs);padding:2px 0;border-bottom:1px solid var(--c-border);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d._key}: ${JSON.stringify(d).slice(0, 200)}</div>`).join('');
    });
  });
}


export function unmount() {
  unsubs.forEach(u => u?.());
  unsubs = [];
  activeKey = null;
}