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
import { initWs4Resize } from '../core/resize.js';
import { saveNotice, updateNotice, deleteNotice, uploadNoticeImage } from '../firebase/notices.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';

let unsubs = [];
let activeKey = null;
let mode = 'users'; // users | partners | sign | dev

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
          <span>${mode === 'users' ? '사용자' : '파트너'}</span>
          ${mode === 'partners' ? '<button class="btn btn-xs btn-primary" id="admNewPartner"><i class="ph ph-plus"></i> 새 파트너</button>' : ''}
        </div>
        <div class="ws4-search">
          <input class="input input-sm" id="admSearch" placeholder="검색..." >
          <div style="display:flex;gap:3px;margin-top:var(--sp-1);">
            ${mode === 'users'
              ? '<button class="chip is-active" data-f="active">승인</button><button class="chip" data-f="pending">대기</button><button class="chip" data-f="all">전체</button>'
              : '<button class="chip is-active" data-f="active">활성</button><button class="chip" data-f="all">전체</button>'
            }
          </div>
        </div>
        <div class="ws4-body" id="admList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="form">
        <div class="ws4-head"><span>정보</span><div style="display:flex;gap:var(--sp-1);" id="admFormActions"></div></div>
        <div class="ws4-body" id="admForm">${empty('선택하세요')}</div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>
      <div class="ws4-panel" data-panel="detail">
        <div class="ws4-head">상세</div>
        <div class="ws4-body" id="admDetail">${empty('상세')}</div>
      </div>
      <div class="ws4-resize" data-idx="2"></div>
      <div class="ws4-panel" data-panel="sub">
        <div class="ws4-head">보조</div>
        <div class="ws4-body" id="admSub">${empty('보조')}</div>
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

  document.getElementById('admNewPartner')?.addEventListener('click', () => {
    const fa = document.getElementById('admFormActions');
    if (fa) fa.innerHTML = `<button class="btn btn-xs btn-primary" id="admSaveNew"><i class="ph ph-check"></i> 저장</button>`;
    const el = document.getElementById('admForm');
    el.innerHTML = `
      <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);overflow-y:auto;height:100%;">
        <div class="cat-section-title"><i class="ph ph-plus-circle"></i> 새 파트너 등록</div>
        <div class="cat-rows">
          <div class="cat-row"><span class="cat-row-label">파트너코드</span><input class="contract-field-input" data-field="partner_code" placeholder="예: RP001"></div>
          <div class="cat-row"><span class="cat-row-label">파트너명</span><input class="contract-field-input" data-field="partner_name" placeholder="회사명"></div>
          <div class="cat-row"><span class="cat-row-label">파트너유형</span><input class="contract-field-input" data-field="partner_type" placeholder="공급사/대리점"></div>
          <div class="cat-row"><span class="cat-row-label">담당자명</span><input class="contract-field-input" data-field="manager_name" placeholder="이름"></div>
          <div class="cat-row"><span class="cat-row-label">직급</span><input class="contract-field-input" data-field="manager_position" placeholder="직급"></div>
          <div class="cat-row"><span class="cat-row-label">연락처</span><input class="contract-field-input" data-field="manager_phone" placeholder="010-0000-0000"></div>
          <div class="cat-row"><span class="cat-row-label">비고</span><textarea class="contract-field-input" data-field="note" rows="3" placeholder="메모"></textarea></div>
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
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || 'active';
  const data = mode === 'users' ? (store.users || []) : (store.partners || []);

  let list = [...data];
  if (mode === 'users') {
    if (f === 'active') list = list.filter(u => u.status === 'active');
    else if (f === 'pending') list = list.filter(u => u.status === 'pending');
  } else {
    if (f === 'active') list = list.filter(p => p.status === 'active');
  }

  if (q) {
    if (mode === 'users') list = list.filter(u => [u.name, u.email, u.role, u.company_name, u.phone, u.uid, u.status].some(v => v && String(v).toLowerCase().includes(q)));
    else list = list.filter(p => [p.partner_name, p.partner_code, p.partner_type, p.manager_name, p.manager_phone].some(v => v && String(v).toLowerCase().includes(q)));
  }

  list.sort((a,b) => (b.created_at||0) - (a.created_at||0));

  const STATUS_TONE = { active: 'ok', pending: 'warn', rejected: 'err', inactive: 'muted' };
  const tone = st => STATUS_TONE[st] || 'muted';
  const statusBadge = st => {
    const labels = { active: '승인', pending: '대기', rejected: '반려', inactive: '비활' };
    return st ? `<span class="badge badge-${tone(st)}">${labels[st] || st}</span>` : '';
  };

  el.innerHTML = list.map(item => {
    const key = item._key;
    const name = mode === 'users' ? (item.name || item.email) : (item.partner_name || item.partner_code);
    const sub  = mode === 'users' ? `${item.role || ''} · ${item.company_name || ''}` : `${item.partner_type || ''} · ${item.ceo_name || ''}`;
    const avatarContent = mode === 'users'
      ? (name || '?').trim().charAt(0) || '?'
      : `<i class="ph ph-buildings"></i>`;

    return `
      <div class="room-item ${activeKey === key ? 'is-active' : ''}" data-key="${key}">
        <div class="room-item-avatar is-${tone(item.status)}">${avatarContent}</div>
        <div class="room-item-body">
          <div class="room-item-top">
            <span class="room-item-name">${name}</span>
            ${statusBadge(item.status)}
          </div>
          <div class="room-item-msg">${sub}</div>
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
  // 폼
  document.getElementById('admForm').innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);overflow-y:auto;height:100%;">
      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${['pending','active','rejected'].map(s => {
          const active = u.status === s;
          const labels = { pending: '대기', active: '승인', rejected: '반려' };
          return `<div class="status-toggle" data-status="${s}" style="font-size:var(--fs-2xs);padding:3px 8px;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : ''}">${labels[s]}</div>`;
        }).join('')}
      </div>
      <div class="contract-section"><div class="contract-section-title">계정</div>
        <div class="contract-section-grid" style="grid-template-columns:1fr;">
          ${fi('이름','name',u)}${fi('이메일','email',u)}${fi('역할','role',u)}
          ${fi('소속코드','company_code',u)}${fi('소속명','company_name',u)}
          ${fi('계정코드','user_code',u)}${fi('연락처','phone',u)}${fi('직급','position',u)}
        </div>
      </div>
    </div>
  `;

  // 상세
  document.getElementById('admDetail').innerHTML = `
    <div style="padding:var(--sp-3);">
      <div class="contract-section"><div class="contract-section-title">상세</div>
        <div class="contract-section-grid">
          ${cField('UID',u.uid)}${cField('상태',u.status)}
          ${cField('역할',u.role)}${cField('가입일',u.created_at ? new Date(u.created_at).toLocaleDateString('ko') : '-')}
        </div>
      </div>
    </div>
  `;

  // 보조
  document.getElementById('admSub').innerHTML = `
    <div style="padding:var(--sp-3);color:var(--c-text-muted);font-size:var(--fs-xs);">사용자 관련 로그/활동</div>
  `;

  // Events
  document.querySelectorAll('#admForm .status-toggle').forEach(tog => {
    tog.addEventListener('click', async () => {
      await updateRecord(`users/${key}`, { status: tog.dataset.status });
      showToast(`→ ${tog.dataset.status}`);
    });
  });
  document.querySelectorAll('#admForm .contract-field-input').forEach(inp => {
    inp.addEventListener('blur', async () => { await updateRecord(`users/${key}`, { [inp.dataset.field]: inp.value.trim() }); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
}

/* ── 파트너 상세 ── */
function loadPartner(key) {
  const fa = document.getElementById('admFormActions');
  if (fa) {
    fa.innerHTML = `<button class="btn btn-xs btn-outline" id="admDeleteBtn" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>`;
    document.getElementById('admDeleteBtn')?.addEventListener('click', async () => {
      if (!confirm('삭제하시겠습니까?')) return;
      await softDelete(`partners/${key}`);
      showToast('삭제됨');
    });
  }
  const p = (store.partners || []).find(x => x._key === key);
  if (!p) return;

  document.getElementById('admForm').innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);overflow-y:auto;height:100%;">
      <div style="display:flex;gap:3px;">
        ${['active','inactive'].map(s => {
          const active = p.status === s;
          return `<div class="status-toggle" data-status="${s}" style="font-size:var(--fs-2xs);padding:3px 8px;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : ''}">${s === 'active' ? '활성' : '비활성'}</div>`;
        }).join('')}
      </div>
      <div class="contract-section"><div class="contract-section-title">회사정보</div>
        <div class="contract-section-grid" style="grid-template-columns:1fr;">
          ${fi('파트너코드','partner_code',p)}${fi('파트너명','partner_name',p)}
          ${fi('유형','partner_type',p)}${fi('사업자번호','business_number',p)}
          ${fi('대표자','ceo_name',p)}${fi('주소','address',p)}
          ${fi('전화','company_phone',p)}${fi('이메일','email',p)}${fi('팩스','fax',p)}
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">담당자</div>
        <div class="contract-section-grid" style="grid-template-columns:1fr;">
          ${fi('담당자명','manager_name',p)}${fi('직급','manager_position',p)}${fi('연락처','manager_phone',p)}
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">비고</div>
        <div class="contract-section-grid">
          <textarea class="input" id="admMemo" rows="3" style="resize:vertical;height:auto;">${p.note || ''}</textarea>
        </div>
      </div>
    </div>
  `;

  document.getElementById('admDetail').innerHTML = `
    <div style="padding:var(--sp-3);">
      <div class="contract-section"><div class="contract-section-title">상세</div>
        <div class="contract-section-grid">
          ${cField('코드',p.partner_code)}${cField('유형',p.partner_type)}
          ${cField('상태',p.status)}${cField('생성자',p.created_by)}
        </div>
      </div>
    </div>
  `;

  document.getElementById('admSub').innerHTML = `
    <div style="padding:var(--sp-3);color:var(--c-text-muted);font-size:var(--fs-xs);">파트너 연결 상품/정책</div>
  `;

  document.querySelectorAll('#admForm .status-toggle').forEach(tog => {
    tog.addEventListener('click', async () => {
      await updateRecord(`partners/${key}`, { status: tog.dataset.status });
      showToast(`→ ${tog.dataset.status}`);
    });
  });
  document.querySelectorAll('#admForm .contract-field-input').forEach(inp => {
    inp.addEventListener('blur', async () => { await updateRecord(`partners/${key}`, { [inp.dataset.field]: inp.value.trim() }); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  let mt;
  document.getElementById('admMemo')?.addEventListener('input', e => {
    clearTimeout(mt);
    mt = setTimeout(() => updateRecord(`partners/${key}`, { note: e.target.value }), 800);
  });
}

/* ── 개발모드 (구 관리자 통합) ── */
const DEV_TABS = [
  { id: 'tools',   icon: 'ph ph-wrench',      label: '도구' },
  { id: 'stock',   icon: 'ph ph-trash',       label: '재고삭제' },
  { id: 'notice',  icon: 'ph ph-megaphone',   label: '공지' },
  { id: 'vehicle', icon: 'ph ph-car-simple',  label: '차종' },
  { id: 'color',   icon: 'ph ph-palette',     label: '색상' },
  { id: 'upload',  icon: 'ph ph-upload-simple', label: '업로드' },
  { id: 'sync',    icon: 'ph ph-google-drive-logo', label: '시트동기화' },
  { id: 'data',    icon: 'ph ph-database',    label: '데이터' },
];

const devLog = (msg) => {
  const el = document.getElementById('devLog');
  if (el) el.textContent += `[${new Date().toLocaleTimeString('ko')}] ${msg}\n`;
};

/* ══════ 계약서 발송 inbox (관리자 전용) ══════════════════════════════════ */
function mountSignInbox(main) {
  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">
          <span>계약서 발송</span>
          <span class="sign-inbox-badge" id="signPendCount" style="font-size:var(--fs-2xs);color:var(--c-err);"></span>
        </div>
        <div class="ws4-search">
          <input class="input input-sm" id="signSearch" placeholder="차량번호·고객명 검색...">
          <div style="display:flex;gap:3px;margin-top:var(--sp-1);">
            <button class="chip is-active" data-f="pending">발송대기</button>
            <button class="chip" data-f="sent">발송됨</button>
            <button class="chip" data-f="all">전체</button>
          </div>
        </div>
        <div class="ws4-body" id="signList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="detail">
        <div class="ws4-head">요청 상세</div>
        <div class="ws4-body" id="signDetail">
          <div class="srch-empty"><i class="ph ph-paper-plane-tilt"></i><p>요청을 선택하세요</p></div>
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
      <div class="contract-section">
        <div class="contract-section-title">계약 정보</div>
        <div class="contract-section-grid">
          ${cField('계약번호', c.contract_code)}
          ${cField('차량', c.car_number_snapshot)}
          ${cField('차량명', c.vehicle_name_snapshot)}
          ${cField('고객', c.customer_name)}
          ${cField('월 대여료', c.rent_amount_snapshot ? Number(c.rent_amount_snapshot).toLocaleString('ko-KR') + '원' : '-')}
          ${cField('기간', c.rent_month_snapshot ? c.rent_month_snapshot + '개월' : '-')}
        </div>
      </div>

      <div class="contract-section">
        <div class="contract-section-title">발송 요청</div>
        <div class="contract-section-grid">
          ${cField('요청자', c.sign_requested_by || '-')}
          ${cField('요청일시', c.sign_requested_at ? new Date(c.sign_requested_at).toLocaleString('ko-KR') : '-')}
          ${cField('발송일시', c.sign_token && c.sign_requested_at ? new Date(c.sign_requested_at).toLocaleString('ko-KR') : '-')}
          ${cField('서명일시', c.signed_at ? new Date(c.signed_at).toLocaleString('ko-KR') : '-')}
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
    <div class="ws4" style="grid-template-columns:180px 1fr 6px 320px;">
      <div class="ws4-panel" data-panel="nav">
        <div class="ws4-head">개발 · 관리</div>
        <div class="ws4-body" id="devNav" style="padding:var(--sp-2);display:flex;flex-direction:column;gap:2px;">
          ${DEV_TABS.map((t,i) => `
            <button class="sb-item ${i===0?'is-active':''}" data-dev-tab="${t.id}" style="width:100%;">
              <i class="${t.icon}"></i><span>${t.label}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="ws4-panel" data-panel="content">
        <div class="ws4-head" id="devTitle">도구</div>
        <div class="ws4-body" id="devContent" style="padding:var(--sp-3);overflow-y:auto;"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="log">
        <div class="ws4-head">로그</div>
        <div class="ws4-body" id="devLog" style="padding:var(--sp-3);font-family:monospace;font-size:11px;color:var(--c-text-sub);white-space:pre-wrap;overflow-y:auto;"></div>
      </div>
    </div>
  `;

  main.querySelectorAll('[data-dev-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      main.querySelectorAll('[data-dev-tab]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const id = btn.dataset.devTab;
      const tab = DEV_TABS.find(t => t.id === id);
      document.getElementById('devTitle').textContent = tab?.label || '';
      renderDevTab(id);
    });
  });

  renderDevTab('tools');
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
      <div class="contract-section"><div class="contract-section-title">시스템</div>
        <div class="contract-section-grid">
          ${cField('버전','v2.0.0')}${cField('Firebase','freepasserp3')}${cField('빌드','Vite 8')}
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">동작</div>
        <div class="contract-section-grid" style="grid-template-columns:1fr;">
          <button class="btn btn-outline btn-sm" id="devCacheClear"><i class="ph ph-trash"></i> 캐시 초기화</button>
          <button class="btn btn-outline btn-sm" id="devStoreView"><i class="ph ph-database"></i> Store 상태 보기</button>
          <button class="btn btn-outline btn-sm" id="devReload"><i class="ph ph-arrow-clockwise"></i> 강제 새로고침</button>
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">일회성 마이그레이션</div>
        <div class="contract-section-grid" style="grid-template-columns:1fr;">
          <button class="btn btn-outline btn-sm" id="devMigrateTermPolicy"><i class="ph ph-swap"></i> policies: term_* → policy_*</button>
          <button class="btn btn-outline btn-sm" id="devMigrateModelName"><i class="ph ph-swap"></i> model_name → model (products · contracts · rooms)</button>
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
      <div class="contract-section"><div class="contract-section-title">새 공지 등록</div>
        <div class="contract-section-grid" style="grid-template-columns:1fr;">
          <input class="input input-sm" id="ncTitle" placeholder="제목" >
          <textarea class="input" id="ncContent" rows="3" placeholder="내용" style="height:auto;font-size:var(--fs-xs);"></textarea>
          <input type="file" id="ncImg" accept="image/*" style="font-size:var(--fs-2xs);">
          <button class="btn btn-primary btn-sm" id="ncSave"><i class="ph ph-megaphone"></i> 등록</button>
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">공지 목록</div>
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
function renderVehicleTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="contract-section"><div class="contract-section-title">차종 추가</div>
        <div class="contract-section-grid">
          <input class="input input-sm" id="vmMaker" placeholder="제조사" >
          <input class="input input-sm" id="vmModel" placeholder="모델명" >
          <input class="input input-sm" id="vmSub" placeholder="세부모델" >
          <input class="input input-sm" id="vmCat" placeholder="분류(선택)" >
          <button class="btn btn-primary btn-sm" id="vmSave" style="grid-column:span 2;"><i class="ph ph-plus"></i> 추가</button>
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">차종 목록 <span id="vmCount" style="color:var(--c-text-muted);font-weight:normal;font-size:var(--fs-xs);"></span></div>
        <div class="contract-section-grid">
          <input class="input input-sm" id="vmQ" placeholder="검색" style="margin-bottom:var(--sp-1);">
          <div id="vmList" style="max-height:400px;overflow-y:auto;"></div>
        </div>
      </div>
    </div>
  `;
  const refresh = async () => {
    const items = await fetchCollection('vehicle_master/entries');
    const q = document.getElementById('vmQ').value.toLowerCase().trim();
    const list = items.filter(i => !q || `${i.maker} ${i.model} ${i.sub_model}`.toLowerCase().includes(q))
      .sort((a,b) => (a.maker||'').localeCompare(b.maker||'') || (a.model||'').localeCompare(b.model||''));
    document.getElementById('vmCount').textContent = `${list.length}건`;
    document.getElementById('vmList').innerHTML = list.slice(0, 300).map(it => `
      <div style="display:flex;gap:var(--sp-2);align-items:center;padding:4px 8px;border-bottom:1px solid var(--c-border);font-size:var(--fs-xs);">
        <span style="width:80px;">${it.maker||''}</span>
        <span style="width:120px;">${it.model||''}</span>
        <span style="flex:1;">${it.sub_model||''}</span>
        <span style="width:80px;color:var(--c-text-muted);">${it.vehicle_category||''}</span>
        <button class="btn btn-xs" style="background:var(--c-err);color:var(--c-text-inv);" data-vmd="${it._key}"><i class="ph ph-x"></i></button>
      </div>
    `).join('') || empty('없음');
    document.querySelectorAll('[data-vmd]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('삭제?')) return;
      await softDelete(`vehicle_master/entries/${b.dataset.vmd}`);
      showToast('삭제 완료'); refresh();
    }));
  };
  document.getElementById('vmQ').addEventListener('input', refresh);
  document.getElementById('vmSave').addEventListener('click', async () => {
    const maker = document.getElementById('vmMaker').value.trim();
    const model = document.getElementById('vmModel').value.trim();
    const sub_model = document.getElementById('vmSub').value.trim();
    const vehicle_category = document.getElementById('vmCat').value.trim();
    if (!maker || !model) return showToast('제조사/모델 필수', 'error');
    const key = await pushRecord('vehicle_master/entries', { maker, model, sub_model, vehicle_category });
    devLog(`✓ 차종 추가: ${maker} ${model} ${sub_model} (${key})`);
    showToast('추가 완료');
    ['vmMaker','vmModel','vmSub','vmCat'].forEach(id => document.getElementById(id).value = '');
    refresh();
  });
  refresh();
}

/* 색상 마스터 CRUD */
function renderColorTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="contract-section"><div class="contract-section-title">외장색</div>
        <div class="contract-section-grid">
          <div style="display:flex;gap:var(--sp-1);margin-bottom:var(--sp-2);">
            <input class="input input-sm" id="extIn" placeholder="색상명" style="flex:1;">
            <button class="btn btn-primary btn-sm" id="extAdd"><i class="ph ph-plus"></i> 추가</button>
          </div>
          <div id="extList" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">내장색</div>
        <div class="contract-section-grid">
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
      <div class="contract-section"><div class="contract-section-title">상품 CSV 업로드</div>
        <div class="contract-section-grid" style="grid-template-columns:1fr;">
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
      <div class="contract-section"><div class="contract-section-title">외부 시트 동기화</div>
        <div class="contract-section-grid" style="grid-template-columns:1fr;">
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

function fi(l,field,obj) { return `<div class="contract-field"><span class="contract-field-label">${l}</span><input class="contract-field-input" data-field="${field}" value="${obj[field]||''}" placeholder="-"></div>`; }

export function unmount() {
  unsubs.forEach(u => u?.());
  unsubs = [];
  activeKey = null;
}
