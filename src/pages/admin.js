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
  if (mode === 'sign') { mountSignInbox(main); return; }

  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">
          <span>${mode === 'users' ? '사용자 목록' : '파트너 목록'}</span>
          <span style="display:flex;gap:var(--sp-1);"><button class="btn btn-sm btn-outline" id="admViewToggle"><i class="ph ph-table"></i> 엑셀보기</button>${mode === 'partners' ? '<button class="btn btn-sm btn-primary" id="admNewPartner"><i class="ph ph-plus"></i> 새 파트너</button>' : ''}</span>
        </div>
        <div class="ws4-search">
          <input class="input input-sm" id="admSearch" placeholder="검색..." >
          <div style="display:flex;gap:3px;">
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

/* ══════ 계약서 발송 inbox (관리자 전용) ══════════════════════════════════ */
function mountSignInbox(main) {
  main.innerHTML = `
    <div class="ws4">
      <!-- Panel 1 (1fr): 요청 목록 -->
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">
          <span>요청 목록</span>
          <span class="sign-inbox-badge" id="signPendCount" style="font-size:var(--fs-2xs);color:var(--c-err);"></span>
        </div>
        <div class="ws4-search">
          <input class="input input-sm" id="signSearch" placeholder="차량번호·고객명 검색...">
          <div style="display:flex;gap:3px;">
            <button class="chip is-active" data-f="pending">발송대기</button>
            <button class="chip" data-f="sent">발송됨</button>
            <button class="chip" data-f="all">전체</button>
          </div>
        </div>
        <div class="ws4-body" id="signList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>

      <!-- Panel 2 (1fr): 계약서 내용 입력 -->
      <div class="ws4-panel" data-panel="detail">
        <div class="ws4-head">계약 정보</div>
        <div class="ws4-body" id="signDetail">
          <div class="srch-empty"><i class="ph ph-paper-plane-tilt"></i><p>요청을 선택하세요</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>

      <!-- Panel 3 (2fr): 계약서 미리보기 -->
      <div class="ws4-panel" data-panel="preview" style="flex:2 1 50%;">
        <div class="ws4-head">
          <i class="ph ph-file-text"></i>
          <span>계약서 미리보기</span>
          <span id="signPreviewSub" style="margin-left:var(--sp-2);color:var(--c-text-muted);font-size:var(--fs-xs);font-weight:normal;"></span>
        </div>
        <div class="ws4-body" id="signPreview" style="padding:0;background:var(--c-bg-sub);">
          <div class="srch-empty"><i class="ph ph-file-text"></i><p>계약을 선택하면 미리보기가 나타납니다</p></div>
        </div>
      </div>
    </div>
  `;
  initWs4Resize('fp.admin.sign.widths');

  unsubs.push(watchCollection('contracts', (data) => {
    store.contracts = data;
    renderSignList();
  }));

  const search = document.getElementById('signSearch');
  search?.addEventListener('input', renderSignList);
  document.getElementById('signList')?.parentElement?.querySelectorAll('.chip[data-f]').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-f]').forEach(x => x.classList.remove('is-active'));
      c.classList.add('is-active');
      renderSignList();
    });
  });
}

let signActiveKey = null;

function renderSignList() {
  const el = document.getElementById('signList');
  if (!el) return;
  const q = (document.getElementById('signSearch')?.value || '').toLowerCase();
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || 'pending';
  const contracts = store.contracts || [];

  let list = contracts.filter(c => c.sign_requested);
  if (f === 'pending') list = list.filter(c => !c.sign_token);
  else if (f === 'sent')    list = list.filter(c => c.sign_token && !c.signed_at);
  // all: 전체 요청 (발송대기 + 발송됨 + 완료)

  if (q) list = list.filter(c => [
    c.car_number_snapshot, c.customer_name, c.contract_code,
    c.vehicle_name_snapshot, c.agent_code, c.provider_company_code,
  ].some(v => v && String(v).toLowerCase().includes(q)));
  list.sort((a, b) => (b.sign_requested_at||0) - (a.sign_requested_at||0));

  const pendCount = contracts.filter(c => c.sign_requested && !c.sign_token).length;
  const badge = document.getElementById('signPendCount');
  if (badge) badge.textContent = pendCount ? `${pendCount}건 대기` : '';

  if (!list.length) {
    el.innerHTML = `<div class="srch-empty"><i class="ph ph-check-circle"></i><p>발송 요청이 없습니다</p></div>`;
    return;
  }

  el.innerHTML = list.map(c => {
    const state = c.signed_at ? 'done' : (c.sign_token ? 'sent' : 'pending');
    const stateLabel = { pending: '발송대기', sent: '발송됨·서명대기', done: '서명완료' }[state];
    const stateTone  = { pending: 'warn',   sent: 'accent',         done: 'ok' }[state];
    const when = c.sign_requested_at ? new Date(c.sign_requested_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="room-item ${signActiveKey === c.contract_code ? 'is-active' : ''}" data-key="${c.contract_code}">
        <div class="room-item-avatar is-${stateTone}"><i class="ph ph-paper-plane-tilt"></i></div>
        <div class="room-item-body">
          <div class="room-item-top">
            <span class="room-item-name">${c.car_number_snapshot || c.contract_code || ''} · ${c.customer_name || ''}</span>
            <span class="badge badge-${stateTone}">${stateLabel}</span>
          </div>
          <div class="room-item-msg">${c.contract_code || ''} · 요청: ${c.sign_requested_by || '-'} · ${when}</div>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', () => {
      signActiveKey = item.dataset.key;
      renderSignList();
      renderSignDetail(item.dataset.key);
    });
  });
}

function renderSignDetail(code) {
  const el = document.getElementById('signDetail');
  const c = (store.contracts || []).find(x => x.contract_code === code);
  if (!el || !c) return;

  const state = c.signed_at ? 'done' : (c.sign_token ? 'sent' : 'pending');
  const url = c.sign_token ? `${location.origin}/sign.html?t=${c.sign_token}` : '';

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="form-section">
        <div class="form-section-title">계약 정보</div>
        <div class="form-section-body">
          ${ffv('계약번호', c.contract_code)}
          ${ffv('차량', c.car_number_snapshot)}
          ${ffv('차량명', c.vehicle_name_snapshot)}
          ${ffv('고객', c.customer_name)}
          ${ffv('월 대여료', c.rent_amount_snapshot ? Number(c.rent_amount_snapshot).toLocaleString('ko-KR') + '원' : '-')}
          ${ffv('기간', c.rent_month_snapshot ? c.rent_month_snapshot + '개월' : '-')}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">발송 요청</div>
        <div class="form-section-body">
          ${ffv('요청자', c.sign_requested_by || '-')}
          ${ffv('요청일시', c.sign_requested_at ? new Date(c.sign_requested_at).toLocaleString('ko-KR') : '-')}
          ${ffv('발송일시', c.sign_token && c.sign_requested_at ? new Date(c.sign_requested_at).toLocaleString('ko-KR') : '-')}
          ${ffv('서명일시', c.signed_at ? new Date(c.signed_at).toLocaleString('ko-KR') : '-')}
        </div>
      </div>

      ${state === 'pending' ? `
        <button class="btn btn-primary" id="signSendBtn" style="width:100%;">
          <i class="ph ph-paper-plane-tilt"></i> 서명 링크 발송
        </button>
      ` : state === 'sent' ? `
        <div style="padding:var(--sp-2);background:var(--c-bg-sub);border-radius:var(--ctrl-r);font-size:var(--fs-xs);">
          <div style="color:var(--c-text-muted);margin-bottom:4px;">발송된 링크</div>
          <div style="word-break:break-all;font-family:monospace;margin-bottom:var(--sp-2);">${url}</div>
          <button class="btn btn-outline btn-sm" id="signCopyBtn" style="width:100%;">
            <i class="ph ph-copy"></i> 링크 다시 복사
          </button>
          <button class="btn btn-outline btn-sm" id="signResendBtn" style="width:100%;margin-top:var(--sp-1);color:var(--c-err);">
            <i class="ph ph-arrow-clockwise"></i> 링크 재발급 (기존 무효화)
          </button>
        </div>
      ` : `
        <div style="padding:var(--sp-2);background:var(--c-ok-bg, #e6f9ed);border-radius:var(--ctrl-r);color:var(--c-ok);font-size:var(--fs-xs);text-align:center;">
          <i class="ph ph-check-circle"></i> 서명 완료 · ${c.contract_status === '계약완료' ? '계약 체결' : '계약 상태 확인 필요'}
        </div>
      `}
    </div>
  `;

  document.getElementById('signSendBtn')?.addEventListener('click', () => sendSignLink(c));
  document.getElementById('signCopyBtn')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(url).catch(() => {});
    showToast('링크 복사됨');
  });
  document.getElementById('signResendBtn')?.addEventListener('click', async () => {
    if (!confirm('기존 서명 링크를 무효화하고 새 링크를 발급합니다.\n진행하시겠습니까?')) return;
    await sendSignLink(c);
  });

  renderSignPreview(c, state, url);
}

/** Panel 3 — 계약서 미리보기. 항상 로컬 템플릿을 iframe 로드하고 데이터만 postMessage 주입
 *  (sign.html 이 외부 URL 로 iframe 되면 Vercel DEPLOYMENT_NOT_FOUND 등 문제 발생) */
function renderSignPreview(c, state, _url) {
  const el = document.getElementById('signPreview');
  const sub = document.getElementById('signPreviewSub');
  if (!el) return;

  const stateLabel = state === 'done' ? '서명 완료' : state === 'sent' ? '발송됨' : '발송 대기';
  sub && (sub.textContent = `${stateLabel} · 개인 계약서 양식`);

  el.innerHTML = `<iframe id="signPreviewFrame" src="/contract-template/contract-individual.html" style="width:100%;height:100%;border:0;background:#fff;"></iframe>`;
  const frame = document.getElementById('signPreviewFrame');
  const payload = {
    type: 'contract-data',
    data: {
      contract_code: c.contract_code,
      car_number: c.car_number_snapshot,
      vehicle_name: c.vehicle_name_snapshot,
      customer_name: c.customer_name,
      rent_amount: c.rent_amount_snapshot,
      rent_month: c.rent_month_snapshot,
      deposit_amount: c.deposit_amount_snapshot,
      signed_at: c.signed_at,
      state,
    },
  };
  frame?.addEventListener('load', () => {
    try { frame.contentWindow?.postMessage(payload, '*'); } catch {}
  });
}

async function sendSignLink(c) {
  const { setRecord, updateRecord } = await import('../firebase/db.js');
  const token = 'sign_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  const expires_at = Date.now() + 7 * 24 * 60 * 60 * 1000;
  try {
    await setRecord(`contract_sign/${token}`, {
      contract_code: c.contract_code,
      car_number: c.car_number_snapshot || '',
      model_name: c.vehicle_name_snapshot || '',
      customer_name: c.customer_name || '',
      rent_amount: c.rent_amount_snapshot || 0,
      rent_month: c.rent_month_snapshot || 0,
      agent_uid: c.agent_uid || '',
      created_at: Date.now(),
      expires_at,
    });
    await updateRecord(`contracts/${c.contract_code}`, {
      sign_token: token,
      sign_sent_at: Date.now(),
      sign_sent_by: store.currentUser?.user_code || store.currentUser?.uid || '',
    });
    const url = `${location.origin}/sign.html?t=${token}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    showToast('링크 발송 완료 — 복사됨');
    prompt('아래 링크를 고객에게 전달하세요 (카톡·SMS·이메일):', url);
    renderSignDetail(c.contract_code);
  } catch (e) {
    console.error(e);
    showToast('발송 실패', 'error');
  }
}

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

/* 차종 마스터 CRUD */
let _vmUnsub = null;
let _vmModels = [];
let _vmFilterMaker = '';
let _vmSearch = '';
let _vmMode = 'idle'; // idle | view | edit | new | prep
let _vmSelectedKey = null;
let _vmForm = null;
let _vmShowArchived = false;
let _vmPrepRows = [];

// JPKerp2 lib/data/vehicle-constants.ts 기준 (엔카 2026 택소노미)
const VM_CATEGORIES = [
  '경차', '경형 SUV', '경형 EV',
  '소형 SUV', '소형 EV SUV', '소형 EV', '소형 트럭', '소형 EV 트럭',
  '준중형 세단', '준중형 SUV', '준중형 EV', '준중형 EV SUV',
  '중형 세단', '중형 SUV', '중형 EV 세단', '중형 EV SUV',
  '준대형 세단', '준대형 SUV',
  '대형 세단', '대형 SUV', '대형 MPV', '대형 EV SUV',
  '스포츠 세단', '수소 SUV', '픽업트럭',
];
const VM_FUELS = ['가솔린', '디젤', '하이브리드', '전기', 'LPG'];
const VM_ORIGINS = ['국산', '수입'];
const VM_POWERTRAINS = ['내연', '하이브리드', '전기', '수소'];
const VM_BODY_SHAPES = ['세단', '해치백', 'SUV', 'RV/MPV', '쿠페', '컨버터블', '왜건', '트럭', '승합', '기타'];
const VM_SIZE_CLASSES = ['경차', '소형', '준중형', '중형', '준대형', '대형'];

const VM_EMPTY_FORM = {
  maker: '', model: '', sub: '', code: '',
  production_start: '', production_end: '현재',   // 엔카 기준 (YYYY-MM)
  category: '', fuel_type: '',
  origin: '', powertrain: '',
  seats: '', displacement: '', battery_kwh: '',
  // 엔카 확장 필드 (JPKerp2 RtdbCarModel)
  body_type: '', size_class: '',
  type_number_pattern: '', engine_type: '',
  car_name: '',
  maker_code: '', maker_eng: '',
  popularity: '', model_popularity: '',
};

function renderVehicleTab(el) {
  el.innerHTML = `
    <div id="vmRoot" style="display:flex;flex-direction:column;height:100%;gap:var(--sp-2);">
      <!-- 상단 액션바 -->
      <div id="vmActions" style="display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;"></div>

      <!-- 메인: 좌측 그리드 + 우측 상세 -->
      <div style="display:flex;gap:var(--sp-2);flex:1;min-height:0;">
        <!-- 좌측 리스트 -->
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid var(--c-border-soft);border-radius:var(--ctrl-r);overflow:hidden;">
          <div style="display:flex;gap:var(--sp-2);padding:var(--sp-2);border-bottom:1px solid var(--c-border-soft);align-items:center;">
            <input class="input input-sm" id="vmSearch" placeholder="모델·세부모델·코드" style="flex:1;">
            <select class="input input-sm" id="vmMakerFilter" style="width:120px;"><option value="">전체</option></select>
            <span id="vmStats" style="font-size:var(--fs-2xs);color:var(--c-text-muted);"></span>
          </div>
          <div id="vmList" style="flex:1;overflow-y:auto;"></div>
        </div>

        <!-- 우측 상세/편집 패널 (모드 전환) -->
        <aside id="vmDetail" style="width:360px;flex-shrink:0;border:1px solid var(--c-border-soft);border-radius:var(--ctrl-r);overflow-y:auto;display:none;"></aside>
      </div>
    </div>
  `;

  _vmUnsub?.();
  _vmMode = 'idle';
  _vmSelectedKey = null;
  _vmForm = { ...VM_EMPTY_FORM };

  import('../core/vehicle-master.js').then((vm) => {
    _vmUnsub = vm.watchVehicleMaster((list) => {
      _vmModels = list;
      renderVmActions(vm);
      renderVmList(vm);
      renderVmDetail(vm);
    });

    document.getElementById('vmSearch').addEventListener('input', (e) => {
      _vmSearch = e.target.value.trim();
      renderVmList(vm);
    });
    document.getElementById('vmMakerFilter').addEventListener('change', (e) => {
      _vmFilterMaker = e.target.value;
      renderVmList(vm);
    });
  });
}

function renderVmActions(vm) {
  const el = document.getElementById('vmActions');
  if (!el) return;
  const selected = _vmModels.find(v => v._key === _vmSelectedKey);
  const archivedCount = _vmModels.filter(m => m.archived).length;
  const editable = _vmMode === 'edit' || _vmMode === 'new';

  if (_vmMode === 'prep') {
    const checked = _vmPrepRows.filter(r => r.checked && !r.in_jpkerp).length;
    el.innerHTML = `
      <button class="btn btn-sm btn-ghost" id="vmPrepCancel"><i class="ph ph-x"></i> 취소</button>
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">${_vmPrepRows.length}건 발견 · 선택 ${checked}건</span>
      <button class="btn btn-sm btn-primary" id="vmPrepCommit" style="margin-left:auto;"><i class="ph ph-check"></i> 선택 ${checked}건 등록</button>
    `;
    document.getElementById('vmPrepCancel')?.addEventListener('click', () => {
      _vmMode = 'idle'; _vmPrepRows = [];
      renderVmActions(vm); renderVmList(vm); renderVmDetail(vm);
    });
    document.getElementById('vmPrepCommit')?.addEventListener('click', () => vmPrepCommit(vm));
    return;
  }

  if (editable) {
    el.innerHTML = `
      <button class="btn btn-sm btn-ghost" id="vmCancel"><i class="ph ph-x"></i> 취소</button>
      <button class="btn btn-sm btn-primary" id="vmSave" style="margin-left:auto;"><i class="ph ph-check"></i> ${_vmMode === 'edit' ? '수정 저장' : '등록'}</button>
    `;
  } else if (_vmMode === 'view' && selected) {
    el.innerHTML = `
      <button class="btn btn-sm btn-outline" id="vmEdit"><i class="ph ph-pencil"></i> 수정</button>
      <button class="btn btn-sm btn-outline" style="color:var(--c-err);" id="vmDelete"><i class="ph ph-trash"></i> 삭제</button>
      <button class="btn btn-sm btn-primary" id="vmNew" style="margin-left:auto;"><i class="ph ph-plus"></i> 차종 추가</button>
    `;
  } else {
    el.innerHTML = `
      <button class="btn btn-sm ${_vmShowArchived ? 'btn-primary' : 'btn-outline'}" id="vmToggleArchived" title="15년 초과 단종 모델 포함/제외">
        <i class="ph ${_vmShowArchived ? 'ph-eye' : 'ph-eye-slash'}"></i>
        ${_vmShowArchived ? '전체 보기' : `단종 숨김${archivedCount ? ` (${archivedCount})` : ''}`}
      </button>
      <button class="btn btn-sm btn-outline" style="color:var(--c-err);" id="vmDeleteAll" title="vehicle_master 전체 soft-delete (개발용)"><i class="ph ph-trash"></i> 전체 삭제</button>
      <button class="btn btn-sm btn-primary" id="vmEncar" title="엔카 마스터 1092건 (production_start/end · maker_code · popularity 포함) — 멱등 재실행 가능"><i class="ph ph-download-simple"></i> 엔카 마스터 가져오기</button>
      <button class="btn btn-sm btn-outline" id="vmResync" title="vehicle_master 전체 삭제 후 엔카 마스터 1092건만 재임포트 — JPKerp2와 정확히 일치"><i class="ph ph-arrow-clockwise"></i> JPKerp 완전 동기화</button>
      <button class="btn btn-sm btn-outline" id="vmAudit" title="products 의 (maker·model·sub_model) 조합 전수 감사 — 매칭/ambig/결측 상세 리포트"><i class="ph ph-list-magnifying-glass"></i> 차종 감사</button>
      <button class="btn btn-sm btn-outline" id="vmNormalize" title="products 의 maker/model/sub_model 을 엔카 마스터 표준 명칭으로 정규화"><i class="ph ph-magic-wand"></i> 상품 정규화</button>
      <button class="btn btn-sm btn-outline" id="vmAutoReg" title="엔카 미수록 제조사·모델 상품들을 차종마스터에 자동 등록"><i class="ph ph-plus-circle"></i> 누락 차종 등록</button>
      <button class="btn btn-sm btn-primary" id="vmNew" style="margin-left:auto;"><i class="ph ph-plus"></i> 차종 추가</button>
    `;
  }

  // 핸들러 바인딩
  document.getElementById('vmToggleArchived')?.addEventListener('click', () => {
    _vmShowArchived = !_vmShowArchived;
    renderVmActions(vm); renderVmList(vm);
  });
  document.getElementById('vmEncar')?.addEventListener('click', () => vmEncarImportAction(vm));
  document.getElementById('vmResync')?.addEventListener('click', () => vmFullResyncAction(vm));
  document.getElementById('vmAudit')?.addEventListener('click', () => vmAuditAction(vm));
  document.getElementById('vmNormalize')?.addEventListener('click', () => vmNormalizeProductsAction(vm));
  document.getElementById('vmAutoReg')?.addEventListener('click', () => vmAutoRegisterAction(vm));
  document.getElementById('vmDeleteAll')?.addEventListener('click', () => vmDeleteAllAction(vm));
  document.getElementById('vmNew')?.addEventListener('click', () => {
    _vmMode = 'new'; _vmSelectedKey = null; _vmForm = { ...VM_EMPTY_FORM };
    renderVmActions(vm); renderVmDetail(vm);
  });
  document.getElementById('vmEdit')?.addEventListener('click', () => {
    if (!selected) return;
    _vmMode = 'edit'; _vmForm = vmFormFromRow(selected);
    renderVmActions(vm); renderVmDetail(vm);
  });
  document.getElementById('vmDelete')?.addEventListener('click', async () => {
    if (!selected) return;
    if (!confirm(`${selected.maker} ${selected.sub} 삭제?`)) return;
    await vm.deleteVehicleModel(selected._key);
    devLog(`[vm] 삭제: ${selected.maker} ${selected.sub}`);
    showToast('삭제됨');
    _vmMode = 'idle'; _vmSelectedKey = null;
    renderVmActions(vm); renderVmDetail(vm);
  });
  document.getElementById('vmCancel')?.addEventListener('click', () => {
    if (_vmMode === 'edit' && selected) {
      _vmMode = 'view'; _vmForm = vmFormFromRow(selected);
    } else {
      _vmMode = 'idle'; _vmSelectedKey = null; _vmForm = { ...VM_EMPTY_FORM };
    }
    renderVmActions(vm); renderVmDetail(vm);
  });
  document.getElementById('vmSave')?.addEventListener('click', () => vmSaveAction(vm));
}

function vmFormFromRow(r) {
  return {
    maker: r.maker || '', model: r.model || '', sub: r.sub || '', code: r.code || '',
    // production_* 우선, 없으면 year_* 폴백 (레거시 호환)
    production_start: String(r.production_start ?? r.year_start ?? ''),
    production_end: String(r.production_end ?? r.year_end ?? '현재'),
    category: r.category || '', fuel_type: r.fuel_type || '',
    origin: r.origin || '', powertrain: r.powertrain || '',
    seats: r.seats ? String(r.seats) : '',
    displacement: r.displacement ? String(r.displacement) : '',
    battery_kwh: r.battery_kwh ? String(r.battery_kwh) : '',
    body_type: r.body_type || '', size_class: r.size_class || '',
    type_number_pattern: r.type_number_pattern || '',
    engine_type: r.engine_type || '',
    car_name: r.car_name || '',
    maker_code: r.maker_code || '', maker_eng: r.maker_eng || '',
    popularity: r.popularity ? String(r.popularity) : '',
    model_popularity: r.model_popularity ? String(r.model_popularity) : '',
  };
}

function renderVmList(vm) {
  const listEl = document.getElementById('vmList');
  const makerSel = document.getElementById('vmMakerFilter');
  if (!listEl || !makerSel) return;

  // prep 모드: 체크박스 테이블
  if (_vmMode === 'prep') {
    makerSel.disabled = true;
    document.getElementById('vmSearch').disabled = true;
    listEl.innerHTML = `
      <div style="display:grid;grid-template-columns:30px 30px 80px 110px 1fr 60px 50px;gap:6px;padding:6px var(--sp-2);border-bottom:1px solid var(--c-border);background:var(--c-bg-sub);font-size:var(--fs-2xs);color:var(--c-text-muted);position:sticky;top:0;z-index:1;">
        <span><input type="checkbox" id="vmPrepAll" ${_vmPrepRows.every(r => r.checked || r.in_jpkerp) ? 'checked' : ''}></span>
        <span>#</span><span>제조사</span><span>모델</span><span>세부모델</span><span style="text-align:right;">보유</span><span>상태</span>
      </div>
      ${_vmPrepRows.map((r, i) => `
        <div style="display:grid;grid-template-columns:30px 30px 80px 110px 1fr 60px 50px;gap:6px;padding:6px var(--sp-2);border-bottom:1px solid var(--c-border-soft);font-size:var(--fs-xs);align-items:center;${r.in_jpkerp ? 'opacity:0.5;' : ''}">
          <span><input type="checkbox" data-prep-idx="${i}" ${r.checked ? 'checked' : ''} ${r.in_jpkerp ? 'disabled' : ''}></span>
          <span style="color:var(--c-text-muted);">${i + 1}</span>
          <span>${r.maker}</span>
          <span>${r.model}</span>
          <span style="font-weight:var(--fw-medium);">${r.sub}</span>
          <span style="text-align:right;color:var(--c-accent);">${r.product_count || 0}</span>
          <span style="font-size:var(--fs-2xs);color:${r.in_jpkerp ? 'var(--c-ok)' : 'var(--c-warn)'};">${r.in_jpkerp ? '등록됨' : '미등록'}</span>
        </div>
      `).join('')}
    `;
    document.getElementById('vmPrepAll')?.addEventListener('change', (e) => {
      _vmPrepRows.forEach(r => { if (!r.in_jpkerp) r.checked = e.target.checked; });
      renderVmList(vm); renderVmActions(vm);
    });
    listEl.querySelectorAll('[data-prep-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        _vmPrepRows[Number(cb.dataset.prepIdx)].checked = cb.checked;
        renderVmActions(vm);
      });
    });
    return;
  }

  // 일반 모드
  makerSel.disabled = false;
  document.getElementById('vmSearch').disabled = false;

  const makers = vm.uniqueMakers(_vmModels);
  const cur = makerSel.value;
  makerSel.innerHTML = `<option value="">전체 (${_vmModels.length})</option>` +
    makers.map(m => `<option value="${m.maker}" ${cur === m.maker ? 'selected' : ''}>${m.maker} (${m.count})</option>`).join('');

  // asset_count 계산 — products 에서 maker+model+sub 매칭 수
  const countByKey = new Map();
  for (const p of (store.products || [])) {
    if (p._deleted || p.status === 'deleted') continue;
    const k = [p.maker, p.model, p.sub_model].filter(Boolean).join('|');
    countByKey.set(k, (countByKey.get(k) || 0) + 1);
  }

  let list = _vmModels.map(v => ({
    ...v,
    asset_count: countByKey.get([v.maker, v.model, v.sub].filter(Boolean).join('|')) || 0,
  }));

  // 불량 레코드 제외 (maker·model·sub 모두 비어있는 것)
  list = list.filter(v => v.maker || v.model || v.sub);

  if (!_vmShowArchived) list = list.filter(v => !v.archived);
  if (_vmFilterMaker) list = list.filter(v => v.maker === _vmFilterMaker);
  if (_vmSearch) {
    const q = _vmSearch.toLowerCase();
    list = list.filter(v => [v.maker, v.model, v.sub, v.car_name, v.code, v.type_number_pattern]
      .some(s => s && String(s).toLowerCase().includes(q)));
  }
  // JPKerp 기본 정렬: 보유 내림차순
  list.sort((a, b) => b.asset_count - a.asset_count);

  document.getElementById('vmStats').textContent = `${list.length}/${_vmModels.length}종`;

  if (!list.length) {
    listEl.innerHTML = `<div style="padding:var(--sp-6);text-align:center;color:var(--c-text-muted);font-size:var(--fs-xs);">${_vmModels.length === 0 ? '차종 없음 — "차종 시드" 로 일괄등록 시작' : '결과 없음'}</div>`;
    return;
  }

  listEl.innerHTML = `
    <div style="display:grid;grid-template-columns:30px 70px 90px 1fr 50px 90px 75px 75px 50px;gap:6px;padding:6px var(--sp-2);border-bottom:1px solid var(--c-border);background:var(--c-bg-sub);font-size:var(--fs-2xs);color:var(--c-text-muted);position:sticky;top:0;z-index:1;">
      <span>#</span><span>제조사</span><span>모델</span><span>세부모델</span><span>제조국</span><span>차종구분</span><span>생산시작</span><span>생산종료</span><span style="text-align:right;">보유</span>
    </div>
    ${list.map((v, i) => `
      <div class="vm-row ${v._key === _vmSelectedKey ? 'is-active' : ''}" data-key="${v._key}"
           style="display:grid;grid-template-columns:30px 70px 90px 1fr 50px 90px 75px 75px 50px;gap:6px;padding:6px var(--sp-2);border-bottom:1px solid var(--c-border-soft);cursor:pointer;font-size:var(--fs-xs);align-items:center;${v._key === _vmSelectedKey ? 'background:var(--c-accent-soft);' : ''}">
        <span style="color:var(--c-text-muted);">${i + 1}</span>
        <span style="font-weight:var(--fw-semibold);">${v.maker || '-'}</span>
        <span>${v.model || '-'}</span>
        <span style="font-weight:var(--fw-medium);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${v.sub || '-'}</span>
        <span style="color:${v.origin === '수입' ? 'var(--c-accent)' : 'var(--c-text-sub)'};font-weight:${v.origin === '수입' ? 'var(--fw-semibold)' : 'normal'};">${v.origin || '-'}</span>
        <span style="color:var(--c-text-sub);">${v.category || '-'}</span>
        <span style="color:var(--c-text-sub);font-size:var(--fs-2xs);">${v.production_start || v.year_start || '-'}</span>
        <span style="color:${(v.production_end || v.year_end) === '현재' ? 'var(--c-ok)' : 'var(--c-text-sub)'};font-size:var(--fs-2xs);font-weight:${(v.production_end || v.year_end) === '현재' ? 'var(--fw-semibold)' : 'normal'};">${v.production_end || v.year_end || '-'}</span>
        <span style="text-align:right;color:${v.asset_count > 0 ? 'var(--c-accent)' : 'var(--c-text-muted)'};font-weight:${v.asset_count > 0 ? 'var(--fw-semibold)' : 'normal'};">${v.asset_count}</span>
      </div>
    `).join('')}
  `;

  listEl.querySelectorAll('.vm-row').forEach(row => {
    row.addEventListener('click', () => {
      _vmSelectedKey = row.dataset.key;
      _vmMode = 'view';
      _vmForm = vmFormFromRow(_vmModels.find(v => v._key === _vmSelectedKey));
      renderVmActions(vm); renderVmList(vm); renderVmDetail(vm);
    });
  });
}

function renderVmDetail(vm) {
  const el = document.getElementById('vmDetail');
  if (!el) return;
  if (_vmMode === 'idle') { el.style.display = 'none'; return; }
  el.style.display = 'block';

  const selected = _vmModels.find(v => v._key === _vmSelectedKey);

  if (_vmMode === 'view' && selected) {
    const kv = (k, v, style = '') => v ? `<dt style="color:var(--c-text-muted);">${k}</dt><dd style="margin:0;${style}">${v}</dd>` : '';
    el.innerHTML = `
      <div style="padding:var(--sp-4);">
        <div style="font-size:var(--fs-lg);font-weight:var(--fw-semibold);margin-bottom:2px;">${selected.maker} <span style="color:var(--c-text-sub);font-weight:var(--fw-medium);">${selected.model}</span></div>
        <div style="font-size:var(--fs-md);color:var(--c-text-sub);margin-bottom:var(--sp-3);">${selected.sub}</div>
        <dl style="display:grid;grid-template-columns:auto 1fr;gap:6px var(--sp-3);margin:0;font-size:var(--fs-sm);">
          ${kv('구분', selected.origin ? `<b style="color:${selected.origin === '수입' ? 'var(--c-accent)' : 'var(--c-text)'};">${selected.origin}</b>` : '')}
          ${kv('동력', selected.powertrain ? `<b style="color:${selected.powertrain === '전기' ? 'var(--c-ok)' : selected.powertrain === '하이브리드' ? 'var(--c-warn)' : 'var(--c-text)'};">${selected.powertrain}</b>` : '')}
          ${kv('코드', selected.code)}
          ${kv('생산기간', `${selected.production_start || selected.year_start || '?'} ~ ${selected.production_end || selected.year_end || '현재'}`)}
          ${kv('분류', selected.category)}
          ${kv('차체', selected.body_type)}
          ${kv('크기', selected.size_class)}
          ${kv('연료', selected.fuel_type)}
          ${kv('승차정원', selected.seats ? `${selected.seats}인승` : '')}
          ${kv('배기량', selected.displacement ? `${selected.displacement.toLocaleString()}cc` : '')}
          ${kv('배터리', selected.battery_kwh ? `${selected.battery_kwh} kWh` : '')}
          ${kv('차명(등록증)', selected.car_name)}
          ${kv('형식번호', selected.type_number_pattern ? `<code style="font-family:monospace;">${selected.type_number_pattern}</code>` : '')}
          ${kv('엔진형식', selected.engine_type)}
          ${kv('제조사 코드', selected.maker_code)}
          ${kv('제조사 영문', selected.maker_eng)}
          ${kv('인기도', selected.popularity ?? '')}
        </dl>
      </div>
    `;
    return;
  }

  if (_vmMode === 'edit' || _vmMode === 'new') {
    const row = (label, key, val, opts = {}) => {
      const type = opts.type || 'text';
      const ph = opts.placeholder || '';
      return `
        <div style="display:flex;flex-direction:column;gap:3px;">
          <label style="font-size:var(--fs-2xs);color:var(--c-text-muted);">${label}</label>
          <input class="input input-sm" data-vmf="${key}" type="${type}" value="${val ?? ''}" placeholder="${ph}">
        </div>
      `;
    };
    const sel = (label, key, val, opts) => `
      <div style="display:flex;flex-direction:column;gap:3px;">
        <label style="font-size:var(--fs-2xs);color:var(--c-text-muted);">${label}</label>
        <select class="input input-sm" data-vmf="${key}">
          <option value="">-</option>
          ${opts.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
    `;
    const f = _vmForm;
    el.innerHTML = `
      <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-2);">
        <div style="font-size:var(--fs-md);font-weight:var(--fw-semibold);">
          <i class="ph ${_vmMode === 'edit' ? 'ph-pencil' : 'ph-plus-circle'}"></i>
          ${_vmMode === 'edit' ? '차종 수정' : '새 차종 추가'}
        </div>
        ${row('제조사 *', 'maker', f.maker, { placeholder: '현대' })}
        ${row('모델명 *', 'model', f.model, { placeholder: '아반떼' })}
        ${row('세부모델 *', 'sub', f.sub, { placeholder: '아반떼 CN7 23-' })}
        ${row('내부코드', 'code', f.code, { placeholder: 'CN7' })}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${row('생산시작', 'production_start', f.production_start, { placeholder: '2023-04 또는 2023' })}
          ${row('생산종료', 'production_end', f.production_end, { placeholder: '현재 또는 2024-12' })}
        </div>
        ${sel('분류', 'category', f.category, VM_CATEGORIES)}
        ${sel('제조국', 'origin', f.origin, VM_ORIGINS)}
        ${sel('동력', 'powertrain', f.powertrain, VM_POWERTRAINS)}
        ${sel('연료', 'fuel_type', f.fuel_type, VM_FUELS)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${row('배기량 (cc)', 'displacement', f.displacement, { type: 'number' })}
          ${row('승차정원', 'seats', f.seats, { type: 'number' })}
        </div>
        ${row('배터리 (kWh)', 'battery_kwh', f.battery_kwh, { type: 'number' })}

        <div style="margin-top:var(--sp-2);padding-top:var(--sp-2);border-top:1px solid var(--c-border-soft);font-size:var(--fs-2xs);color:var(--c-text-muted);font-weight:var(--fw-semibold);">엔카 확장</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${sel('차체', 'body_type', f.body_type, VM_BODY_SHAPES)}
          ${sel('크기', 'size_class', f.size_class, VM_SIZE_CLASSES)}
        </div>
        ${row('차명 (등록증)', 'car_name', f.car_name, { placeholder: '아반떼(CN7)' })}
        ${row('형식번호 패턴', 'type_number_pattern', f.type_number_pattern, { placeholder: 'CN7* 또는 정규식' })}
        ${row('엔진형식', 'engine_type', f.engine_type, { placeholder: 'G4FL, D4HB' })}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${row('제조사 코드', 'maker_code', f.maker_code, { placeholder: '예: 101' })}
          ${row('제조사 영문', 'maker_eng', f.maker_eng, { placeholder: 'Hyundai' })}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${row('인기도', 'popularity', f.popularity, { type: 'number' })}
          ${row('모델 인기도', 'model_popularity', f.model_popularity, { type: 'number' })}
        </div>
      </div>
    `;
    // 폼 입력 → _vmForm 동기화
    el.querySelectorAll('[data-vmf]').forEach(inp => {
      inp.addEventListener('input', () => { _vmForm[inp.dataset.vmf] = inp.value; });
      inp.addEventListener('change', () => { _vmForm[inp.dataset.vmf] = inp.value; });
    });
  }
}

/* ── 차종 시드 · 기존 보완 · 전체 삭제 · 저장 · 삭제 액션 ── */

async function vmSaveAction(vm) {
  const f = _vmForm;
  if (!f.maker || !f.model || !f.sub) { showToast('제조사·모델·세부모델 필수', 'error'); return; }
  const payload = {
    maker: f.maker.trim(), model: f.model.trim(), sub: f.sub.trim(),
    code: f.code.trim() || undefined,
    production_start: f.production_start.trim() || undefined,
    production_end: f.production_end.trim() || '현재',
    // year_* 레거시 필드는 저장 안 함 (기존 레코드는 읽기만)
    category: f.category || undefined,
    fuel_type: f.fuel_type || undefined,
    origin: f.origin || undefined,
    powertrain: f.powertrain || undefined,
    seats: f.seats ? Number(f.seats) : undefined,
    displacement: f.displacement ? Number(f.displacement) : undefined,
    battery_kwh: f.battery_kwh ? Number(f.battery_kwh) : undefined,
    body_type: f.body_type || undefined,
    size_class: f.size_class || undefined,
    car_name: f.car_name?.trim() || undefined,
    type_number_pattern: f.type_number_pattern?.trim() || undefined,
    engine_type: f.engine_type?.trim() || undefined,
    maker_code: f.maker_code?.trim() || undefined,
    maker_eng: f.maker_eng?.trim() || undefined,
    popularity: f.popularity ? Number(f.popularity) : undefined,
    model_popularity: f.model_popularity ? Number(f.model_popularity) : undefined,
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  try {
    if (_vmMode === 'edit' && _vmSelectedKey) {
      await vm.updateVehicleModel(_vmSelectedKey, payload);
      devLog(`[vm] 수정: ${payload.maker} ${payload.sub}`);
      showToast('수정됨');
      _vmMode = 'view';
    } else {
      const exists = _vmModels.some(m => m.maker === payload.maker && m.model === payload.model && m.sub === payload.sub);
      if (exists) { showToast('이미 등록된 세부모델', 'error'); return; }
      const key = await vm.createVehicleModel(payload);
      devLog(`[vm] 추가: ${payload.maker} ${payload.sub} (${key})`);
      showToast('추가됨');
      _vmSelectedKey = key;
      _vmMode = 'view';
    }
    renderVmActions(vm); renderVmDetail(vm);
  } catch (e) {
    showToast(`저장 실패: ${e?.message}`, 'error');
  }
}

/** 차종 감사 — products 의 (maker | model | sub_model) 조합을 전수 분석.
 *  상태별 분류 (✅ 정확 / 🔄 정규화 가능 / ⚠ 애매 (model만 같음) / ❓ 결측 / ❌ 미등록) */
function vmAuditAction(vm) {
  const products = (store.products || []).filter(p => p.status !== 'deleted' && !p._deleted);
  if (!products.length) { showToast('상품 없음'); return; }

  const master = _vmModels.filter(m => m.maker && m.sub && !m.archived);
  const idxExact = new Map();            // "maker|model|sub" → m
  const idxBySub = new Map();            // normSub → [m]
  const byMakerModel = new Map();        // "maker|model" → [m] (ambig 감지)
  const stripYear = s => String(s || '').replace(/\s+\d{2,4}\s*-\s*\d{0,4}\s*$/, '').replace(/\s*\(페리\d*\)\s*/g, ' ').replace(/^\s*더\s*뉴\s+/, '').trim();
  const norm = s => stripYear(s).toLowerCase().replace(/[\s()\/\-.,~·_]/g, '');
  for (const m of master) {
    idxExact.set(`${m.maker}|${m.model}|${m.sub}`, m);
    const n = norm(m.sub);
    if (n) {
      if (!idxBySub.has(n)) idxBySub.set(n, []);
      idxBySub.get(n).push(m);
    }
    const mkm = `${m.maker}|${m.model || ''}`;
    if (!byMakerModel.has(mkm)) byMakerModel.set(mkm, []);
    byMakerModel.get(mkm).push(m);
  }

  // (maker | model | sub) 조합별 product 집계
  const combos = new Map();
  for (const p of products) {
    const mk = (p.maker || '').trim();
    const md = (p.model || '').trim();
    const sub = (p.sub_model || '').trim();
    const key = `${mk}|${md}|${sub}`;
    if (!combos.has(key)) combos.set(key, { maker: mk, model: md, sub_model: sub, count: 0 });
    combos.get(key).count++;
  }

  const buckets = { exact: [], normalizable: [], ambiguous: [], missing: [], unmatched: [] };
  for (const c of combos.values()) {
    if (!c.sub_model) {
      // sub_model 비어있음 — 결측
      buckets.missing.push(c);
      continue;
    }
    const exactKey = `${c.maker}|${c.model}|${c.sub_model}`;
    if (idxExact.has(exactKey)) { buckets.exact.push(c); continue; }

    // sub_model 이 model 과 동일 (generic — "쏘나타")
    if (c.sub_model === c.model) {
      const mmList = byMakerModel.get(`${c.maker}|${c.model}`) || [];
      c.candidates = mmList.length;
      buckets.ambiguous.push(c);
      continue;
    }

    // norm 매칭
    const list = idxBySub.get(norm(c.sub_model)) || [];
    if (list.length === 1) { c.target = list[0]; buckets.normalizable.push(c); continue; }
    if (list.length > 1) {
      const filtered = list.filter(m => m.maker === c.maker);
      if (filtered.length === 1) { c.target = filtered[0]; buckets.normalizable.push(c); continue; }
      c.candidates = list.length;
      buckets.ambiguous.push(c);
      continue;
    }

    // maker+model 동일한 마스터가 있으면 ambiguous, 아예 없으면 unmatched
    const mmList = byMakerModel.get(`${c.maker}|${c.model}`) || [];
    if (mmList.length) { c.candidates = mmList.length; buckets.ambiguous.push(c); continue; }
    buckets.unmatched.push(c);
  }

  const sortByCount = (a, b) => b.count - a.count;
  for (const k of Object.keys(buckets)) buckets[k].sort(sortByCount);

  const total = products.length;
  const comboCount = combos.size;
  devLog(`=== 차종 감사 리포트 (${new Date().toLocaleString('ko')}) ===`);
  devLog(`상품 ${total}건 · 유니크 조합 ${comboCount}개`);
  devLog(`  ✅ 정확 일치: ${buckets.exact.reduce((s, c) => s + c.count, 0)}건 (${buckets.exact.length}조합)`);
  devLog(`  🔄 정규화 가능: ${buckets.normalizable.reduce((s, c) => s + c.count, 0)}건 (${buckets.normalizable.length}조합) — "상품 정규화"로 자동 교정 가능`);
  devLog(`  ⚠ 애매 (후보 여럿): ${buckets.ambiguous.reduce((s, c) => s + c.count, 0)}건 (${buckets.ambiguous.length}조합) — 세부모델 수동 지정 필요`);
  devLog(`  ❓ 결측 (sub_model 빔): ${buckets.missing.reduce((s, c) => s + c.count, 0)}건 (${buckets.missing.length}조합)`);
  devLog(`  ❌ 마스터 미등록: ${buckets.unmatched.reduce((s, c) => s + c.count, 0)}건 (${buckets.unmatched.length}조합) — "누락 차종 등록" 대상`);
  devLog('');

  const dump = (label, rows, show = 20) => {
    if (!rows.length) return;
    devLog(`--- ${label} (상위 ${Math.min(show, rows.length)}/${rows.length}) ---`);
    for (const r of rows.slice(0, show)) {
      const extra = r.candidates ? ` [후보 ${r.candidates}개]` : r.target ? ` → ${r.target.maker}/${r.target.model}/${r.target.sub}` : '';
      devLog(`  ${String(r.count).padStart(4)} × ${r.maker || '?'} / ${r.model || '?'} / ${r.sub_model || '—'}${extra}`);
    }
  };
  dump('🔄 정규화 가능', buckets.normalizable, 15);
  dump('⚠ 애매', buckets.ambiguous, 20);
  dump('❓ 결측', buckets.missing, 10);
  dump('❌ 미등록', buckets.unmatched, 15);
  devLog('');
  devLog('→ 권장 순서: ① 누락 차종 등록 → ② 상품 정규화 → ③ 애매·결측은 상품관리에서 수동 수정');

  showToast(`감사 완료 — 로그 확인 (총 ${comboCount}개 조합)`);
}

/** 엔카 마스터에 없는 제조사·차종을 products 에서 추출해서 vehicle_master 에 자동 등록.
 *  정규화 실패 상품 구제용 — 람보르기니·페라리·벤틀리 등 엔카 택소노미 외 차종.
 *  등록 후 "상품 정규화" 재실행하면 대부분 매칭됨. */
async function vmAutoRegisterAction(vm) {
  const products = (store.products || []).filter(p => p.status !== 'deleted' && !p._deleted);
  if (!products.length) { showToast('상품 없음'); return; }

  // 기존 마스터에 이미 있는 (maker|sub) 조합 인덱스 — 중복 등록 방지
  const existing = new Set();
  for (const m of _vmModels) {
    if (m.maker && m.sub) existing.add(`${m.maker}|${m.sub}`);
  }

  // 제조사별 국산/수입 추정 — JPKerp2 DOMESTIC_MAKERS 준용
  const DOMESTIC = new Set(['현대', '기아', '제네시스', '르노', 'KGM', '쌍용', '쉐보레']);

  // 등록 후보 추출 — 중복 제거 (maker|sub_model 기준)
  const toAdd = new Map();       // key: "maker|sub_model" → row
  const byMakerCount = new Map();
  for (const p of products) {
    const mk = (p.maker || '').trim();
    const sub = (p.sub_model || '').trim();
    if (!mk || !sub) continue;
    const key = `${mk}|${sub}`;
    if (existing.has(key)) continue;
    if (toAdd.has(key)) {
      toAdd.get(key)._count++;
      continue;
    }
    toAdd.set(key, {
      maker: mk,
      model: (p.model || '').trim() || sub,              // model 없으면 sub_model로 대체
      sub,
      car_name: sub,                                     // 등록증 매칭키 초깃값
      origin: DOMESTIC.has(mk) ? '국산' : '수입',
      source: 'from_products',
      status: 'active',
      _count: 1,
    });
    byMakerCount.set(mk, (byMakerCount.get(mk) || 0) + 1);
  }

  if (!toAdd.size) {
    showToast('등록할 누락 차종이 없습니다 — 모든 상품의 차종이 이미 마스터에 있음');
    return;
  }

  // 제조사별 요약 (상위 10개)
  const makerSummary = [...byMakerCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([mk, n]) => `  ${mk}: ${n}종`)
    .join('\n');

  if (!confirm(
    `products 에서 미등록 차종 ${toAdd.size}종 발견\n\n`
    + `제조사별 요약:\n${makerSummary}${byMakerCount.size > 10 ? `\n  외 ${byMakerCount.size - 10}개 제조사` : ''}\n\n`
    + `자동 등록 (source: 'from_products')?\n`
    + `※ category·production 등 메타는 비워두고, 이후 수동 편집 가능합니다.`
  )) return;

  devLog(`[vmAutoReg] ${toAdd.size}종 등록 시작`);
  const { ref: dbRef, update: dbUpdate, push: dbPush } = await import('firebase/database');
  const { db } = await import('../firebase/config.js');
  const updates = {};
  const now = Date.now();
  for (const row of toAdd.values()) {
    const key = dbPush(dbRef(db, 'vehicle_master')).key;
    const { _count, ...payload } = row;
    updates[`vehicle_master/${key}`] = { ...payload, created_at: now, updated_at: now };
  }
  try {
    const keys = Object.keys(updates);
    const CHUNK = 400;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
      await dbUpdate(dbRef(db), slice);
      devLog(`[vmAutoReg] ${Math.min(i + CHUNK, keys.length)}/${keys.length} 패스`);
    }
    devLog(`[vmAutoReg] 완료 · ${toAdd.size}종 등록`);
    showToast(`${toAdd.size}종 등록 — "상품 정규화" 재실행하면 매칭됩니다`);
  } catch (e) {
    showToast(`실패: ${e.message}`, 'error');
  }
}

/** products 의 maker/model/sub_model 을 vehicle_master 의 표준 명칭으로 정규화
 *  매칭: (maker|model|sub_model) exact → (sub_model normalized) → (maker+sub_model 부분일치) */
async function vmNormalizeProductsAction(vm) {
  const products = (store.products || []).filter(p => p.status !== 'deleted' && !p._deleted);
  if (!products.length) { showToast('상품 없음'); return; }

  const master = _vmModels.filter(m => m.maker && m.model && m.sub && !m.archived);
  if (!master.length) { showToast('엔카 마스터가 비어있음 — 먼저 import', 'error'); return; }

  // 1) 연식 suffix 제거 ("쏘렌토 MQ4 20-" → "쏘렌토 MQ4", "아반떼 CN7 2023-" → "아반떼 CN7")
  // 2) "(페리)", "(페리2)", "더 뉴" 같은 페이스리프트 표기 제거
  // 3) 공백·괄호·하이픈·점 제거 후 소문자화
  const stripYear = s => String(s || '')
    .replace(/\s+\d{2,4}\s*-\s*\d{0,4}\s*$/, '')   // " 20-", " 2020-", " 20-22"
    .replace(/\s+\d{4}\s*$/, '')                     // trailing " 2023"
    .replace(/\s*\(페리\d*\)\s*/g, ' ')              // "(페리)", "(페리2)" → space
    .replace(/^\s*더\s*뉴\s+/, '')                   // "더 뉴 " prefix
    .trim();
  const norm = s => stripYear(s).toLowerCase().replace(/[\s()\/\-.,~·_]/g, '');

  const idxExact = new Map();        // "maker|model|sub" → row
  const idxBySub = new Map();        // normSub → [row, ...]
  for (const m of master) {
    idxExact.set(`${m.maker}|${m.model}|${m.sub}`, m);
    const n = norm(m.sub);
    if (n) {
      if (!idxBySub.has(n)) idxBySub.set(n, []);
      idxBySub.get(n).push(m);
    }
  }

  // 연식 기간 체크 — master.production_start ~ production_end 범위 안에 product.year 가 들어가는가
  const yearNum = (p) => {
    const y = Number(p?.year);
    return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null;
  };
  const yearOf = (ym) => {
    const m = String(ym || '').match(/^(\d{4})/);
    return m ? Number(m[1]) : null;
  };
  const withinRange = (p, m) => {
    const y = yearNum(p);
    if (!y) return null;                                        // 연식 없으면 판정 유보
    const ys = yearOf(m.production_start ?? m.year_start);
    const ye = m.production_end === '현재' || !m.production_end ? 9999 : (yearOf(m.production_end ?? m.year_end) ?? 9999);
    if (!ys) return null;
    return y >= ys && y <= ye;
  };
  // 트림 토큰 기반 추가 점수 (예: "인스퍼레이션" 이 master.sub 에 들어있으면 +1)
  const trimTokens = p => {
    const t = String(p?.trim_name || p?.trim || '');
    return (t.match(/[A-Za-z]+|[0-9]+|[가-힯]+/g) || []).map(x => x.toLowerCase());
  };
  /** 여러 후보 중 [연식 매칭 → 트림 토큰 일치 수 → popularity] 순으로 최선 선택 */
  const pickBest = (p, cands) => {
    if (!cands || !cands.length) return null;
    if (cands.length === 1) return cands[0];
    const tks = trimTokens(p);
    const scored = cands.map(m => {
      const yr = withinRange(p, m);                             // true/false/null
      const tokenHits = tks.reduce((s, t) => norm(m.sub).includes(t) ? s + 1 : s, 0);
      return {
        m,
        yearOk: yr === true ? 2 : yr === null ? 1 : 0,          // 범위 일치 > 미판정 > 불일치
        tokens: tokenHits,
        pop: Number(m.popularity || m.model_popularity || 0),
      };
    });
    scored.sort((a, b) => (b.yearOk - a.yearOk) || (b.tokens - a.tokens) || (b.pop - a.pop));
    return scored[0].m;
  };

  let unchanged = 0, unmatched = 0;
  const changes = [];
  const changedMaker = [];            // maker 자체가 바뀐 건 (데이터 오류 교정 — 눈에 띄게 표시)
  const unmatchedSamples = [];
  for (const p of products) {
    if (!p.maker && !p.sub_model) { unmatched++; continue; }
    let best = null;

    // ① 완전일치
    const exactKey = `${p.maker || ''}|${p.model || ''}|${p.sub_model || ''}`;
    if (idxExact.has(exactKey)) best = idxExact.get(exactKey);

    // ② sub 정규화 일치 (maker/model 일치 우선 → 연식·트림 가중치)
    if (!best && p.sub_model) {
      const list = idxBySub.get(norm(p.sub_model)) || [];
      if (list.length === 1) best = list[0];
      else if (list.length > 1) {
        const byMakerModel = list.filter(m => m.maker === p.maker && m.model === p.model);
        const byMaker = list.filter(m => m.maker === p.maker);
        best = pickBest(p, byMakerModel.length ? byMakerModel : byMaker.length ? byMaker : list);
      }
    }

    // ③ maker + sub 부분일치 (master.sub 가 product.sub_model 을 포함, 혹은 그 반대)
    if (!best && p.maker && p.sub_model) {
      const nSub = norm(p.sub_model);
      const cands = master.filter(m => m.maker === p.maker && nSub && (norm(m.sub).includes(nSub) || nSub.includes(norm(m.sub))));
      best = pickBest(p, cands);
    }

    // ④ maker 무시하고 model + sub 로 매칭 (maker 오입력 교정용 — "기아 그랜저" → "현대 그랜저")
    if (!best && p.model && p.sub_model) {
      const nSub = norm(p.sub_model);
      const cands = master.filter(m => m.model === p.model && (norm(m.sub) === nSub || norm(m.sub).includes(nSub) || nSub.includes(norm(m.sub))));
      best = pickBest(p, cands);
    }

    // ⑤ generic sub (sub_model 이 model 과 동일 "쏘나타") — maker+model 로 후보 모아 연식+트림으로 세대 특정
    if (!best && p.maker && p.model && p.sub_model === p.model) {
      const cands = master.filter(m => m.maker === p.maker && m.model === p.model);
      if (cands.length) best = pickBest(p, cands);
    }

    if (!best) {
      unmatched++;
      if (unmatchedSamples.length < 8) unmatchedSamples.push(`  · ${p.maker || '?'} / ${p.model || '?'} / ${p.sub_model || '?'}`);
      continue;
    }

    // 매칭 성공 → 연식 보완 체크 (product.year 가 비어있거나 범위 밖이면 master.production_start 연도로 채움)
    const bestStartYear = yearOf(best.production_start ?? best.year_start);
    const py = yearNum(p);
    const needYearFix = bestStartYear && (!py || withinRange(p, best) === false);
    const identical = best.maker === p.maker && best.model === p.model && best.sub === p.sub_model;

    if (identical && !needYearFix) {
      unchanged++;
    } else {
      const change = {
        key: p._key,
        from: { maker: p.maker, model: p.model, sub_model: p.sub_model, year: p.year },
        to:   { maker: best.maker, model: best.model, sub_model: best.sub, year: needYearFix ? String(bestStartYear) : undefined },
        makerChanged: best.maker !== p.maker,
        yearChanged: needYearFix,
        fieldChanged: !identical,
      };
      changes.push(change);
      if (change.makerChanged) changedMaker.push(change);
    }
  }

  const sampleChanges = changes.slice(0, 6).map(c =>
    `  ${c.from.maker || '-'} / ${c.from.model || '-'} / ${c.from.sub_model || '-'}\n    → ${c.to.maker} / ${c.to.model} / ${c.to.sub_model}`
  ).join('\n');
  const sampleMakerChanges = changedMaker.slice(0, 6).map(c =>
    `  ⚠ ${c.from.maker || '-'} → ${c.to.maker}  (${c.to.sub_model})`
  ).join('\n');

  const yearChangeCount = changes.filter(c => c.yearChanged).length;
  if (!confirm(
    `상품 ${products.length}건 분석 결과\n`
    + `  변경 필요: ${changes.length}건`
    + (changedMaker.length ? ` (제조사 교정 ${changedMaker.length})` : '')
    + (yearChangeCount ? ` (연식 교정 ${yearChangeCount})` : '')
    + `\n`
    + `  이미 표준: ${unchanged}건\n`
    + `  매칭 실패: ${unmatched}건\n\n`
    + (changedMaker.length ? `제조사 교정 예시:\n${sampleMakerChanges}\n\n` : '')
    + (changes.length ? `전체 변경 예시:\n${sampleChanges}\n\n` : '')
    + (unmatched ? `매칭 실패 예시:\n${unmatchedSamples.join('\n')}\n\n` : '')
    + `${changes.length}건 적용?`)) return;

  if (!changes.length) { showToast('변경 사항 없음'); return; }

  const { ref: dbRef, update: dbUpdate } = await import('firebase/database');
  const { db } = await import('../firebase/config.js');
  const updates = {};
  const now = Date.now();
  for (const c of changes) {
    if (c.fieldChanged) {
      updates[`products/${c.key}/maker`] = c.to.maker;
      updates[`products/${c.key}/model`] = c.to.model;
      updates[`products/${c.key}/sub_model`] = c.to.sub_model;
    }
    if (c.yearChanged && c.to.year) {
      updates[`products/${c.key}/year`] = c.to.year;
    }
    updates[`products/${c.key}/updated_at`] = now;
  }
  const keys = Object.keys(updates);
  const CHUNK = 400;
  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
      await dbUpdate(dbRef(db), slice);
      devLog(`[vmNormalize] ${Math.min(i + CHUNK, keys.length)}/${keys.length} 패스`);
    }
    devLog(`[vmNormalize] 완료 · ${changes.length}건 정규화`);
    showToast(`${changes.length}건 정규화 완료`);
  } catch (e) {
    showToast(`실패: ${e.message}`, 'error');
  }
}

async function vmSeedAction(vm) {
  const { KOREAN_CAR_MODELS, subWithYear } = await import('../core/car-models-seed.js');
  const existing = new Set(_vmModels.map(m => `${m.maker}|${m.model}|${m.sub}`));
  const toAdd = KOREAN_CAR_MODELS.filter(s => !existing.has(`${s.maker}|${s.model}|${subWithYear(s.sub, s.year_start)}`));
  if (!toAdd.length) { showToast(`차종 ${KOREAN_CAR_MODELS.length}종 모두 이미 등록됨`); return; }
  if (!confirm(`차종 ${toAdd.length}종 등록 (이미 ${KOREAN_CAR_MODELS.length - toAdd.length}종 존재). 진행?`)) return;
  devLog(`[vmSeed] ${toAdd.length}종 등록 시작...`);
  try {
    const result = await vm.seedVehicleMaster(({ i, total, added, skipped }) => {
      if (i % 30 === 0 || i === total) devLog(`[vmSeed] ${i}/${total} (추가 ${added} · 스킵 ${skipped})`);
    });
    devLog(`[vmSeed] 완료: 추가 ${result.added} · 스킵 ${result.skipped}`);
    showToast(`${result.added}종 시드 완료`);
  } catch (e) { showToast(`시드 실패: ${e?.message}`, 'error'); }
}

/** JPKerp2 완전 동기화 — vehicle_master 전체 하드 삭제 후 엔카 시드만 재임포트.
 *  결과: JPKerp2의 `import-vehicle-master.mjs --replace` 실행 결과와 1:1 일치 */
async function vmFullResyncAction(vm) {
  const before = _vmModels.length;
  const msg1 = `⚠ JPKerp2 완전 동기화\n\n`
    + `현재 vehicle_master ${before}건을 모두 하드 삭제하고\n`
    + `엔카 마스터 1092건만 새로 임포트합니다.\n\n`
    + `이전 "차종 시드"로 들어온 연식 suffix 형식 (예: "아반떼 CN7 22-") 이 모두 제거되고\n`
    + `엔카 표준 ("더 뉴 아반떼 (CN7)") 만 남습니다.\n\n`
    + `계속?`;
  if (!confirm(msg1)) return;
  if (!confirm(`마지막 확인 — ${before}건 삭제 후 1092건 재임포트`)) return;

  const { ref: dbRef, remove: dbRemove, update: dbUpdate } = await import('firebase/database');
  const { db } = await import('../firebase/config.js');

  devLog(`[vmResync] 1/2 — vehicle_master ${before}건 전체 삭제`);
  try {
    await dbRemove(dbRef(db, 'vehicle_master'));
  } catch (e) {
    showToast(`삭제 실패: ${e.message}`, 'error');
    return;
  }

  devLog(`[vmResync] 2/2 — 엔카 1092건 임포트`);
  let rows;
  try {
    const res = await fetch('/data/encar-master-seed.json', { cache: 'no-store' });
    rows = await res.json();
  } catch (e) {
    showToast(`엔카 JSON 로드 실패: ${e.message}`, 'error');
    return;
  }

  const updates = {};
  const now = Date.now();
  for (const r of rows) {
    const { _key, ...payload } = r;
    updates[`vehicle_master/${_key}`] = { ...payload, created_at: now, updated_at: now };
  }
  const keys = Object.keys(updates);
  const CHUNK = 400;
  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
      await dbUpdate(dbRef(db), slice);
      devLog(`[vmResync] 배치 ${Math.min(i + CHUNK, keys.length)}/${keys.length}`);
    }
    devLog(`[vmResync] 완료 · JPKerp2 와 1:1 일치 (${rows.length}건)`);
    showToast(`완전 동기화 완료: ${rows.length}건`);
  } catch (e) {
    showToast(`임포트 실패: ${e.message}`, 'error');
  }
}

/** JPKerp2 /scripts/vehicle-master-seed.json (엔카 1092건) 일괄 import
 *  _key (encar_xxx) 기반 멱등 · 기존 레코드는 엔카 필드만 merge */
async function vmEncarImportAction(vm) {
  let rows;
  try {
    const res = await fetch('/data/encar-master-seed.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (e) {
    showToast(`엔카 JSON 로드 실패: ${e.message}`, 'error');
    return;
  }
  if (!Array.isArray(rows) || !rows.length) {
    showToast('엔카 JSON 비어있음', 'error');
    return;
  }

  // 기존 레코드 index: maker|model|sub → key
  const existingByCombo = new Map();
  const existingByKey = new Map();
  for (const m of _vmModels) {
    if (m._key) existingByKey.set(m._key, m);
    const combo = [m.maker, m.model, m.sub].filter(Boolean).join('|');
    if (combo && !existingByCombo.has(combo)) existingByCombo.set(combo, m);
  }

  const toAdd = [];
  const toMerge = [];
  for (const r of rows) {
    const combo = [r.maker, r.model, r.sub].filter(Boolean).join('|');
    const byKey = r._key && existingByKey.get(r._key);
    const byCombo = existingByCombo.get(combo);
    const existing = byKey || byCombo;
    if (existing) toMerge.push({ key: existing._key, row: r });
    else toAdd.push(r);
  }

  if (!confirm(
    `엔카 마스터 ${rows.length}건 import\n`
    + `  신규 추가: ${toAdd.length}\n`
    + `  기존 병합 (production_*·popularity·maker_code 채움): ${toMerge.length}\n\n`
    + `진행?`)) return;

  devLog(`[vmEncar] 시작 · 추가 ${toAdd.length} · 병합 ${toMerge.length}`);
  const { ref: dbRef, update: dbUpdate } = await import('firebase/database');
  const { db } = await import('../firebase/config.js');

  // 멀티패스 update로 배치 처리 — 청크당 200건씩 1 라운드트립
  const MERGE_FIELDS = ['production_start','production_end','car_name','maker_eng','maker_code','popularity','model_popularity','category','archived','source'];
  const updates = {};
  const now = Date.now();
  for (const r of toAdd) {
    const { _key, ...payload } = r;
    updates[`vehicle_master/${_key}`] = { ...payload, created_at: now, updated_at: now };
  }
  for (const { key, row } of toMerge) {
    for (const f of MERGE_FIELDS) {
      if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
        updates[`vehicle_master/${key}/${f}`] = row[f];
      }
    }
    updates[`vehicle_master/${key}/updated_at`] = now;
  }

  const keys = Object.keys(updates);
  const CHUNK = 400;
  let ok = 0, fail = 0;
  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
      try {
        await dbUpdate(dbRef(db), slice);
        ok += Object.keys(slice).length;
        devLog(`[vmEncar] 배치 ${Math.min(i + CHUNK, keys.length)}/${keys.length}`);
      } catch (e) { fail += Object.keys(slice).length; console.error('[vmEncar] 배치 실패', e); }
    }
    devLog(`[vmEncar] 완료 · 패스 ${ok} · 실패 ${fail}`);
    showToast(`엔카 import 완료 (신규 ${toAdd.length} · 병합 ${toMerge.length})`);
  } catch (e) {
    showToast(`import 실패: ${e.message}`, 'error');
  }
}

async function vmEnrichAction(vm) {
  const { KOREAN_CAR_MODELS, inferOrigin, inferPowertrain, inferFuel, subWithYear } = await import('../core/car-models-seed.js');
  const seedByKey = new Map();
  for (const s of KOREAN_CAR_MODELS) seedByKey.set(`${s.maker}|${s.model}|${subWithYear(s.sub, s.year_start)}`, s);

  const targets = _vmModels.filter(m => {
    const isEv = m.powertrain === '전기' || /EV|전기/i.test(m.category || '');
    return !m.category || !m.origin || !m.powertrain || !m.displacement || !m.seats
      || !m.code || !m.year_start
      || (isEv && !m.battery_kwh)
      || (!isEv && !m.fuel_type);
  });
  if (!targets.length) { showToast('모든 레코드 스펙 완성 상태'); return; }
  const matchedBySeed = targets.filter(m => seedByKey.has(`${m.maker}|${m.model}|${m.sub}`)).length;
  if (!confirm(`${targets.length}개 보완 대상:\n· 시드 매칭 ${matchedBySeed}개 (스펙 전부 채움)\n· 매칭 실패 ${targets.length - matchedBySeed}개 (제조사로 구분만 추정)\n\n진행?`)) return;
  devLog(`[vm] enrich 시작: ${targets.length}건`);
  let ok = 0, fail = 0;
  for (const m of targets) {
    try {
      const seed = seedByKey.get(`${m.maker}|${m.model}|${m.sub}`);
      const patch = {};
      if (seed) {
        if (!m.category && seed.category) patch.category = seed.category;
        if (!m.code && seed.code) patch.code = seed.code;
        if (!m.year_start && seed.year_start) patch.year_start = seed.year_start;
        if (!m.year_end && seed.year_end) patch.year_end = seed.year_end;
        if (!m.origin) patch.origin = inferOrigin(seed.maker);
        if (!m.powertrain) patch.powertrain = inferPowertrain(seed.category);
        if (!m.fuel_type) patch.fuel_type = seed.fuel_type || inferFuel(seed.category);
        if (!m.displacement && seed.displacement) patch.displacement = seed.displacement;
        if (!m.seats && seed.seats) patch.seats = seed.seats;
        if (!m.battery_kwh && seed.battery_kwh) patch.battery_kwh = seed.battery_kwh;
      } else {
        if (!m.origin && m.maker) patch.origin = inferOrigin(m.maker);
        if (!m.powertrain && m.category) patch.powertrain = inferPowertrain(m.category);
        if (!m.fuel_type && m.category) patch.fuel_type = inferFuel(m.category);
      }
      if (Object.keys(patch).length) {
        await vm.updateVehicleModel(m._key, patch);
        ok++;
      }
    } catch (e) { fail++; }
  }
  devLog(`[vm] enrich 완료: ${ok}건 성공 / ${fail}건 실패`);
  showToast(`${ok}건 보완 완료${fail ? ` (${fail}건 실패)` : ''}`);
}

function vmStartPrep(vm) {
  // products 에서 고유 차종 조합 추출
  const merged = new Map();
  for (const p of (store.products || [])) {
    if (p._deleted || p.status === 'deleted') continue;
    const maker = (p.maker || '').trim();
    const model = (p.model || '').trim();
    const sub = (p.sub_model || '').trim();
    if (!maker && !model && !sub) continue;
    const id = [maker, model, sub].filter(Boolean).join('|');
    let cur = merged.get(id);
    if (!cur) {
      cur = { id, maker: maker || '미지정', model: model || '—', sub: sub || model || '—', product_count: 0, in_jpkerp: false, checked: true };
      merged.set(id, cur);
    }
    cur.product_count++;
  }
  // 이미 vehicle_master 에 있는지 확인
  const existing = new Set(_vmModels.map(m => [m.maker, m.model, m.sub].filter(Boolean).join('|')));
  merged.forEach(r => {
    if (existing.has(r.id)) { r.in_jpkerp = true; r.checked = false; }
  });
  _vmPrepRows = [...merged.values()].sort((a, b) => {
    if (a.in_jpkerp !== b.in_jpkerp) return a.in_jpkerp ? 1 : -1;
    return b.product_count - a.product_count;
  });
  if (!_vmPrepRows.length) { showToast('products 에서 추출할 차종 없음'); return; }
  _vmMode = 'prep';
  renderVmActions(vm); renderVmList(vm); renderVmDetail(vm);
}

async function vmPrepCommit(vm) {
  const toAdd = _vmPrepRows.filter(r => r.checked && !r.in_jpkerp);
  if (!toAdd.length) { showToast('등록 대상 없음'); return; }
  if (!confirm(`${toAdd.length}종 vehicle_master 에 등록?`)) return;
  devLog(`[vmPrep] ${toAdd.length}건 등록 시작...`);
  let ok = 0, fail = 0;
  for (const r of toAdd) {
    try {
      await vm.createVehicleModel({
        maker: r.maker, model: r.model, sub: r.sub,
        year_end: '현재', status: 'active', seeded_from: 'products_prep',
      });
      ok++;
    } catch (e) { fail++; }
  }
  devLog(`[vmPrep] 완료: ${ok}건 성공 / ${fail}건 실패`);
  showToast(`${ok}종 등록 완료${fail ? ` (${fail} 실패)` : ''}`);
  _vmMode = 'idle'; _vmPrepRows = [];
  renderVmActions(vm); renderVmList(vm); renderVmDetail(vm);
}

async function vmDeleteAllAction(vm) {
  const { ref, remove } = await import('firebase/database');
  const { db } = await import('../firebase/config.js');
  const active = _vmModels.length;
  if (!active) { showToast('삭제할 레코드 없음'); return; }

  // 불량 레코드 (maker/model/sub 모두 비어있는 것) 자동 감지
  const broken = _vmModels.filter(m => !m.maker && !m.model && !m.sub);
  if (broken.length && broken.length < active) {
    if (confirm(`불량 레코드 ${broken.length}건을 찾았습니다 (빈 데이터). 먼저 정리?\n· 확인: 불량만 하드 삭제\n· 취소: 전체 삭제로 진행`)) {
      let ok = 0;
      for (const m of broken) {
        try { await remove(ref(db, `vehicle_master/${m._key}`)); ok++; } catch {}
      }
      devLog(`[vm] 불량 ${ok}건 정리 완료`);
      showToast(`불량 ${ok}건 정리 완료`);
      return;
    }
  }

  if (!confirm(`⚠ vehicle_master ${active}건 전체 하드 삭제.\n복구 불가. 진행?`)) return;
  if (!confirm(`마지막 확인: ${active}건 전체 하드 삭제`)) return;
  devLog(`[vm] 전체 삭제 시작: ${active}건`);
  try {
    await remove(ref(db, 'vehicle_master'));
    devLog(`[vm] 전체 삭제 완료`);
    showToast(`${active}건 삭제 완료`);
  } catch (e) {
    showToast(`삭제 실패: ${e?.message}`, 'error');
  }
}

function openVmEditor(v, updateFn, deleteFn, createFn) {
  const isEdit = !!v?._key;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:var(--c-overlay-dark);z-index:9999;display:flex;align-items:center;justify-content:center;padding:var(--sp-4);';
  modal.innerHTML = `
    <div style="background:var(--c-surface);border-radius:var(--ctrl-r);width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
      <header style="display:flex;align-items:center;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--c-border);">
        <span style="font-size:var(--fs-md);font-weight:var(--fw-semibold);flex:1;">${isEdit ? '차종 수정' : '신규 차종'}</span>
        <button id="vmCancel" class="btn btn-sm btn-ghost"><i class="ph ph-x"></i></button>
      </header>
      <div style="flex:1;overflow-y:auto;padding:var(--sp-4);display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);">
        ${vmFld('제조사', 'maker', v?.maker)}
        ${vmFld('모델', 'model', v?.model)}
        ${vmFld('세부모델', 'sub', v?.sub, { full: true, hint: '예: 그랜저 GN7 22-' })}
        ${vmFld('트림', 'trim', v?.trim)}
        ${vmFld('차명 (등록증)', 'car_name', v?.car_name)}
        ${vmFld('형식번호 패턴', 'type_number_pattern', v?.type_number_pattern, { hint: '예: CN7*' })}
        ${vmFld('생산 시작', 'year_start', v?.year_start, { placeholder: 'YYYY 또는 YYYY-MM' })}
        ${vmFld('생산 종료', 'year_end', v?.year_end, { placeholder: '현재 또는 YYYY' })}
        ${vmSel('카테고리', 'category', v?.category, VM_CATEGORIES)}
        ${vmSel('연료', 'fuel_type', v?.fuel_type, VM_FUELS)}
        ${vmFld('배기량 (cc)', 'displacement', v?.displacement, { type: 'number' })}
        ${vmFld('승차정원', 'seats', v?.seats, { type: 'number' })}
        ${vmFld('구동방식', 'drive_type', v?.drive_type, { placeholder: '전륜/후륜/4륜' })}
        ${vmFld('변속기', 'transmission', v?.transmission)}
        ${vmFld('엔진형식', 'engine_type', v?.engine_type)}
        ${vmFld('배터리 (kWh)', 'battery_kwh', v?.battery_kwh, { type: 'number' })}
        ${vmFld('EV 주행거리 (km)', 'ev_range', v?.ev_range, { type: 'number' })}
        ${vmFld('내부코드', 'code', v?.code)}
      </div>
      <footer style="display:flex;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--c-border);">
        ${isEdit ? `<button id="vmDel" class="btn btn-sm btn-outline" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>` : ''}
        <button id="vmSave" class="btn btn-sm btn-primary" style="margin-left:auto;"><i class="ph ph-check"></i> 저장</button>
      </footer>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.getElementById('vmCancel').addEventListener('click', close);
  document.getElementById('vmSave').addEventListener('click', async () => {
    const data = Object.fromEntries(
      [...modal.querySelectorAll('[data-f]')].map(inp => {
        const key = inp.dataset.f;
        let val = inp.value.trim();
        if (inp.type === 'number') val = val ? Number(val) : undefined;
        return [key, val || undefined];
      })
    );
    if (!data.maker || !data.model || !data.sub) { showToast('제조사·모델·세부모델 필수', 'error'); return; }
    try {
      if (isEdit) await updateFn(v._key, data);
      else await createFn(data);
      devLog(`[vmEdit] ${isEdit ? '수정' : '신규'}: ${data.maker} ${data.model} ${data.sub}`);
      showToast(isEdit ? '수정됨' : '추가됨');
      close();
    } catch (e) {
      showToast(`실패: ${e?.code || e?.message}`, 'error');
    }
  });
  document.getElementById('vmDel')?.addEventListener('click', async () => {
    if (!confirm(`"${v.sub}" 삭제?`)) return;
    await deleteFn(v._key);
    devLog(`[vmEdit] 삭제: ${v.maker} ${v.model} ${v.sub}`);
    showToast('삭제됨');
    close();
  });
}

function vmFld(label, key, val, opts = {}) {
  const type = opts.type || 'text';
  const ph = opts.placeholder || opts.hint || '';
  const full = opts.full ? 'grid-column:1/-1;' : '';
  return `
    <label style="display:flex;flex-direction:column;gap:4px;${full}">
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">${label}</span>
      <input class="input input-sm" data-f="${key}" type="${type}" value="${val ?? ''}" placeholder="${ph}">
    </label>
  `;
}
function vmSel(label, key, val, options) {
  return `
    <label style="display:flex;flex-direction:column;gap:4px;">
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">${label}</span>
      <select class="input input-sm" data-f="${key}">
        <option value="">-</option>
        ${options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </label>
  `;
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
