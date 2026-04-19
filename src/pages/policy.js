/**
 * 정책 등록/관리 — 4패널: 목록 | 등록(폼) | 상세 | 보조
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, setRecord, softDelete } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { cField, fmtWon, empty } from '../core/format.js';
import { initWs4Resize } from '../core/resize.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';

let unsubPolicies = null;
let allPolicies = [];
let activeCode = null;

const WS_KEY = 'fp.policy.widths';

export function mount() {
  unsubPolicies?.();
  activeCode = null;

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">목록</div>
        <div class="ws4-search">
          <input class="input input-sm" id="plSearch" placeholder="정책명, 공급사..." >
          <div style="display:flex;gap:3px;margin-top:var(--sp-1);">
            <button class="chip is-active" data-f="active">활성</button>
            <button class="chip" data-f="all">전체</button>
          </div>
        </div>
        <div class="ws4-body" id="plList"></div>
        <div style="padding:var(--sp-2) var(--sp-3);border-top:1px solid var(--c-border);">
          <button class="btn btn-primary btn-sm" id="plNewBtn" style="width:100%;"><i class="ph ph-plus"></i> 정책 등록</button>
        </div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="form">
        <div class="ws4-head">등록</div>
        <div class="ws4-body" id="plForm">
          <div class="srch-empty"><i class="ph ph-scroll"></i><p>정책을 선택하세요</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>
      <div class="ws4-panel" data-panel="detail">
        <div class="ws4-head">상세</div>
        <div class="ws4-body" id="plDetail">
          <div class="srch-empty"><i class="ph ph-info"></i><p>상세 정보</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="2"></div>
      <div class="ws4-panel" data-panel="sub">
        <div class="ws4-head">보조</div>
        <div class="ws4-body" id="plSub">
          <div class="srch-empty"><i class="ph ph-note"></i><p>연결 상품</p></div>
        </div>
      </div>
    </div>
  `;

  initWs4Resize(WS_KEY);

  main.querySelectorAll('.chip[data-f]').forEach(c => {
    c.addEventListener('click', () => {
      main.querySelectorAll('.chip[data-f]').forEach(x => x.classList.remove('is-active'));
      c.classList.add('is-active');
      renderList();
    });
  });
  document.getElementById('plSearch')?.addEventListener('input', () => renderList());
  document.getElementById('plNewBtn')?.addEventListener('click', () => renderNewForm());

  unsubPolicies = watchCollection('policies', (data) => {
    allPolicies = data;
    store.policies = data;
    renderList();
    const active = data.filter(p => p.status === 'active').length;
    const providers = new Set(data.map(p => p.provider_company_code).filter(Boolean)).size;
    setBreadcrumbBrief(`활성 ${active} · 공급사 ${providers}`);
  });

  // Also watch products for linked products
  watchCollection('products', (data) => { store.products = data; });
}

function renderList() {
  const el = document.getElementById('plList');
  if (!el) return;
  const q = (document.getElementById('plSearch')?.value || '').toLowerCase();
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || 'active';

  let list = [...allPolicies];
  if (f === 'active') list = list.filter(p => p.status !== 'deleted' && p.status !== 'inactive');
  if (q) list = list.filter(p =>
    (p.policy_name||'').toLowerCase().includes(q) ||
    (p.policy_code||'').toLowerCase().includes(q) ||
    (p.provider_company_code||'').toLowerCase().includes(q)
  );
  list.sort((a,b) => (b.created_at||0) - (a.created_at||0));

  el.innerHTML = list.map(p => {
    const tone = p.status === 'active' ? 'ok' : 'muted';
    const badge = p.status === 'active' ? '<span class="badge badge-ok">활성</span>' : p.status ? `<span class="badge">${p.status}</span>` : '';
    return `
    <div class="room-item ${activeCode === p._key ? 'is-active' : ''}" data-key="${p._key}">
      <div class="room-item-avatar is-${tone}"><i class="ph ph-scroll"></i></div>
      <div class="room-item-body">
        <div class="room-item-top">
          <span class="room-item-name">${p.policy_name || p.policy_code || ''}</span>
          ${badge}
        </div>
        <div class="room-item-msg">${p.provider_company_code || ''} · ${p.policy_code || ''}</div>
      </div>
    </div>`;
  }).join('') || empty('정책 없음');

  el.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', async () => {
      activeCode = item.dataset.key;
      renderList();
      loadAll(item.dataset.key);
      const p = list.find(x => x._key === item.dataset.key);
      if (p) {
        const { setBreadcrumbTail } = await import('../core/breadcrumb.js');
        setBreadcrumbTail({ icon: 'ph ph-scroll', label: p.policy_name || p.policy_code || '정책', sub: p.provider_company_code || '' });
      }
    });
  });
}

function loadAll(key) {
  const p = allPolicies.find(x => x._key === key);
  if (!p) return;
  renderForm(p, key);
  renderDetail(p);
  renderSub(p);
}

function renderForm(p, key) {
  const el = document.getElementById('plForm');
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);overflow-y:auto;height:100%;">
      <div style="display:flex;gap:3px;">
        ${['active','inactive'].map(s => {
          const active = p.status === s;
          return `<div class="status-toggle" data-status="${s}" style="font-size:var(--fs-2xs);padding:3px 8px;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : ''}">${s === 'active' ? '활성' : '비활성'}</div>`;
        }).join('')}
      </div>
      <div class="contract-section"><div class="contract-section-title">기본정보</div>
        <div style="padding:var(--sp-2) var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-1);">
          ${fi('정책코드','policy_code',p)}
          ${fi('정책명','policy_name',p)}
          ${fi('공급사코드','provider_company_code',p)}
          ${fi('정책유형','policy_type',p)}
        </div>
      </div>
      <button class="btn btn-outline btn-sm" id="plDeleteBtn" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>
    </div>
  `;

  el.querySelectorAll('.status-toggle').forEach(tog => {
    tog.addEventListener('click', async () => {
      await updateRecord(`policies/${key}`, { status: tog.dataset.status });
      showToast(`→ ${tog.dataset.status === 'active' ? '활성' : '비활성'}`);
    });
  });

  el.querySelectorAll('.contract-field-input').forEach(inp => {
    inp.addEventListener('blur', async () => { await updateRecord(`policies/${key}`, { [inp.dataset.field]: inp.value.trim() }); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });

  el.querySelector('#plDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm('삭제하시겠습니까?')) return;
    await softDelete(`policies/${key}`);
    showToast('삭제됨');
  });
}

function renderNewForm() {
  const el = document.getElementById('plForm');
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div style="font-weight:var(--fw-heavy);">정책 등록</div>
      <div class="contract-section"><div class="contract-section-title">기본정보</div>
        <div style="padding:var(--sp-2) var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-1);">
          ${finew('정책명','policy_name')}
          ${finew('공급사코드','provider_company_code')}
          ${finew('정책유형','policy_type')}
        </div>
      </div>
      <button class="btn btn-primary btn-sm" id="plSaveNew"><i class="ph ph-check"></i> 등록</button>
    </div>
  `;

  el.querySelector('#plSaveNew')?.addEventListener('click', async () => {
    const fields = {};
    el.querySelectorAll('.contract-field-input').forEach(inp => { fields[inp.dataset.field] = inp.value.trim(); });
    if (!fields.policy_name) { showToast('정책명 필수'); return; }

    const code = `${fields.provider_company_code || 'XX'}_P${String(Date.now()).slice(-3)}`;
    await setRecord(`policies/${code}`, {
      policy_code: code,
      ...fields,
      status: 'active',
      created_by: store.currentUser?.user_code || '',
      created_at: Date.now(),
    });
    showToast('등록 완료');
  });
}

function renderDetail(p) {
  const el = document.getElementById('plDetail');
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="contract-section"><div class="contract-section-title">정책 정보</div>
        <div class="contract-section-grid">
          ${cField('코드',p.policy_code)}${cField('이름',p.policy_name)}
          ${cField('공급사',p.provider_company_code)}${cField('유형',p.policy_type)}
          ${cField('상태',p.status)}${cField('생성자',p.created_by)}
        </div>
      </div>
    </div>
  `;
}

function renderSub(p) {
  const el = document.getElementById('plSub');
  const products = (store.products || []).filter(x => x.policy_code === p.policy_code);

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-2);">
      <div style="font-weight:var(--fw-bold);font-size:var(--fs-sm);">연결 상품 (${products.length})</div>
      ${products.map(pr => `
        <div class="room-item">
          <div class="room-item-name">${pr.car_number || ''} · ${pr.model || ''}</div>
        </div>
      `).join('') || '<div style="color:var(--c-text-muted);font-size:var(--fs-xs);">연결된 상품 없음</div>'}
    </div>
  `;
}

function fi(l,field,p) { return `<div class="contract-field"><span class="contract-field-label">${l}</span><input class="contract-field-input" data-field="${field}" value="${p[field]||''}" placeholder="-"></div>`; }
function finew(l,field) { return `<div class="contract-field"><span class="contract-field-label">${l}</span><input class="contract-field-input" data-field="${field}" value="" placeholder="-"></div>`; }

export function unmount() {
  unsubPolicies?.();
  activeCode = null;
}
