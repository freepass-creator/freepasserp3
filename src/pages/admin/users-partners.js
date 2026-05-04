/**
 * 사용자/파트너 관리 — 4패널 UI
 * /admin/users → 사용자 관리
 * /admin/partners → 파트너 관리
 */
import { store } from '../../core/store.js';
import { watchCollection, updateRecord, softDelete, setRecord } from '../../firebase/db.js';
import { showToast } from '../../core/toast.js';
import { empty } from '../../core/format.js';
import { fieldInput as ffi, fieldSelect as ffs, fieldView as ffv, fieldTextarea as ffta, bindAutoSave as bindFormAutoSave } from '../../core/form-fields.js';
import { initWs4Resize } from '../../core/resize.js';
import { setBreadcrumbBrief } from '../../core/breadcrumb.js';
import { renderExcelTable } from '../../core/excel-table.js';

let unsubs = [];
let activeKey = null;
let mode = 'users'; // users | partners
let viewMode = 'card';

export function mount(main, subPath) {
  unsubs.forEach(u => u?.());
  unsubs = [];
  activeKey = null;

  // Detect mode from URL
  const path = location.pathname;
  mode = path.includes('partners') ? 'partners' : 'users';

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
      setBreadcrumbBrief(`대기 ${pending} | 승인 ${active} / 전체 ${data.length}`);
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
        const { setBreadcrumbTail } = await import('../../core/breadcrumb.js');
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
        const { setBreadcrumbTail } = await import('../../core/breadcrumb.js');
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
  bindFormAutoSave(formEl, (field, value) => updateRecord(`users/${key}`, { [field]: value }), { eager: true });

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
  bindFormAutoSave(formEl, (field, value) => updateRecord(`partners/${key}`, { [field]: value }), { eager: true });

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

export function unmount() {
  unsubs.forEach(u => u?.());
  unsubs = [];
  activeKey = null;
}
