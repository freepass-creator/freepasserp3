/**
 * 정산 — 4패널: 목록 | 작업(상태/확인) | 상세 | 보조(메모/이력)
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, setRecord, softDelete } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtWon, fmtMoney, empty, cField } from '../core/format.js';
import { fieldView as ffv } from '../core/form-fields.js';
import { initWs4Resize } from '../core/resize.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';
import {
  SETTLEMENT_STATUS as SS,
  SETTLEMENT_STATUSES_FULL,
  SETTLEMENT_STATUS_DEFAULT,
  getSettlementStatus,
  settlementStatusTone,
  settlementStatusPayload,
} from '../core/settlement-status.js';

let unsubSettlements = null;
let allSettlements = [];
let activeKey = null;

const WS_KEY = 'fp.st.widths';

export function mount() {
  unsubSettlements?.();
  activeKey = null;

  const shell = document.querySelector('.shell');

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">목록</div>
        <div class="ws4-search">
          <input class="input input-sm" id="stSearch" placeholder="검색..." >
          <div style="display:flex;gap:3px;">
            <button class="chip is-active" data-f="pending">미완료</button>
            <button class="chip" data-f="done">완료</button>
            <button class="chip" data-f="all">전체</button>
          </div>
        </div>
        <div class="ws4-body" id="stList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="work">
        <div class="ws4-head"><span>작업</span><div style="display:flex;gap:var(--sp-1);" id="stWorkActions"></div></div>
        <div class="ws4-body" id="stWork">
          <div class="srch-empty"><i class="ph ph-coins"></i><p>정산을 선택하세요</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>
      <div class="ws4-panel" data-panel="detail">
        <div class="ws4-head">상세</div>
        <div class="ws4-body" id="stDetail">
          <div class="srch-empty"><i class="ph ph-info"></i><p>상세 정보</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="2"></div>
      <div class="ws4-panel" data-panel="sub">
        <div class="ws4-head">보조</div>
        <div class="ws4-body" id="stSub">
          <div class="srch-empty"><i class="ph ph-note"></i><p>메모/이력</p></div>
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
  document.getElementById('stSearch')?.addEventListener('input', () => renderList());

  unsubSettlements = watchCollection('settlements', (data) => {
    allSettlements = data;
    store.settlements = data;
    renderList();
    updateBrief();
  });

  // Also watch contracts for linking
  watchCollection('contracts', (data) => { store.contracts = data; });
}

function updateBrief() {
  const pending = allSettlements.filter(s => getSettlementStatus(s) === SS.PENDING);
  const pendingSum = pending.reduce((a, s) => a + Number(s.fee_amount || 0), 0);
  const parts = [];
  if (pending.length) parts.push(`미정산 ${pending.length}건${pendingSum ? ` · ${fmtMoney(pendingSum)}` : ''}`);
  const done = allSettlements.filter(s => getSettlementStatus(s) === SS.DONE).length;
  if (done) parts.push(`완료 ${done}`);
  setBreadcrumbBrief(parts.length ? parts.join(' > ') : `총 ${allSettlements.length}건`);
}

function renderList() {
  const el = document.getElementById('stList');
  if (!el) return;
  const q = (document.getElementById('stSearch')?.value || '').toLowerCase();
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || 'pending';

  let list = [...allSettlements];
  if (f === 'pending') list = list.filter(s => getSettlementStatus(s) !== SS.DONE);
  else if (f === 'done') list = list.filter(s => getSettlementStatus(s) === SS.DONE);

  if (q) list = list.filter(s => [
    s.vehicle_name_snapshot, s.car_number, s.customer_name,
    s.contract_code, s.settlement_status, s.agent_code,
    s.partner_code, s.provider_company_code, s._key,
  ].some(v => v && String(v).toLowerCase().includes(q)));
  list.sort((a,b) => (b.created_at||0) - (a.created_at||0));

  el.innerHTML = list.map(s => `
    <div class="room-item ${activeKey === s._key ? 'is-active' : ''}" data-key="${s._key}">
      <div class="room-item-avatar is-${settlementStatusTone(s)}" style="flex-direction:column;gap:1px;font-size:var(--fs-2xs);"><i class="ph ph-coins"></i>${getSettlementStatus(s) === SS.DONE ? '완료' : '미완료'}</div>
      <div class="room-item-body">
        <div class="room-item-top">
          <span class="room-item-name">${s.car_number || ''} ${s.sub_model_snapshot || s.model_snapshot || ''}</span>
          <span class="room-item-time">${gs(s)}</span>
        </div>
        <div class="room-item-msg">
          <span>${[s.provider_company_code, s.agent_code, s.customer_name].filter(Boolean).join(' · ')}</span>
          <span class="list-row-value">${fmtWon(s.fee_amount)}</span>
        </div>
      </div>
    </div>
  `).join('') || empty('정산 없음');

  el.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', async () => {
      activeKey = item.dataset.key;
      renderList();
      loadAll(item.dataset.key);
      const s = list.find(x => x._key === item.dataset.key);
      if (s) {
        const { setBreadcrumbTail } = await import('../core/breadcrumb.js');
        setBreadcrumbTail({ icon: 'ph ph-coins', label: s.vehicle_name_snapshot || s.car_number || s.settlement_code, sub: s.customer_name || '' });
      }
    });
  });
}

function loadAll(key) {
  const s = allSettlements.find(x => x._key === key);
  if (!s) return;
  renderWork(s);
  renderDetail(s);
  renderSub(s);
}

/* ── 작업 패널: 수수료 + 상태 + 확인 ── */
function renderWork(s) {
  const stActions = document.getElementById('stWorkActions');
  if (stActions) stActions.innerHTML = `<button class="btn btn-xs btn-outline" id="stDeleteBtn" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>`;
  setTimeout(() => {
    document.getElementById('stDeleteBtn')?.addEventListener('click', async () => {
      if (!confirm('이 정산을 삭제하시겠습니까?')) return;
      await softDelete(`settlements/${s._key}`);
      showToast('삭제됨');
    });
  });
  const el = document.getElementById('stWork');
  const status = getSettlementStatus(s);
  const confirms = s.confirms || {};

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div style="font-weight:var(--fw-heavy);">${s.settlement_code || s._key}</div>

      <div class="settle-amount">
        <div class="settle-amount-label">수수료</div>
        <div class="settle-amount-value">${fmtWon(s.fee_amount)}</div>
      </div>

      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${SETTLEMENT_STATUSES_FULL.map(st => {
          const active = status === st;
          return `<div class="status-toggle" data-status="${st}" style="font-size:var(--fs-2xs);padding:3px 8px;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : ''}">${st.replace('정산','').replace('환수','')}</div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:var(--sp-1);">
        ${['공급사','영업자','관리자'].map((label,i) => {
          const roles = ['provider','agent','admin'];
          const confirmed = confirms[roles[i]];
          return `<div class="settle-confirm ${confirmed ? 'is-confirmed' : ''}" data-role="${roles[i]}" style="padding:var(--sp-2);font-size:var(--fs-2xs);">
            <i class="ph ${confirmed ? 'ph-check-circle' : 'ph-circle'}" style="font-size:16px;"></i><span>${label}</span>
          </div>`;
        }).join('')}
      </div>

      ${!s.is_clawback ? `<button class="btn btn-outline btn-sm" id="stClawback" style="color:var(--c-err);width:100%;"><i class="ph ph-arrow-counter-clockwise"></i> 환수 처리</button>` : `<div style="padding:var(--sp-2);background:var(--c-err-bg);border:1px solid var(--c-err);border-radius:var(--ctrl-r);font-size:var(--fs-xs);color:var(--c-err);text-align:center;">환수 건 (원본: ${s.clawback_of||'-'})</div>`}
    </div>
  `;

  // Clawback
  el.querySelector('#stClawback')?.addEventListener('click', async () => {
    if (!confirm('환수 처리하시겠습니까?')) return;
    const { createSettlement } = await import('../firebase/collections.js');
    // 환수 = 음수 수수료 정산 생성
    await setRecord(`settlements/${s._key}_CB`, {
      settlement_code: `${s.settlement_code||s._key}_CB`,
      contract_code: s.contract_code,
      ...settlementStatusPayload(SS.CLAWBACK_DONE),
      fee_amount: -(Number(s.fee_amount)||0),
      origin_fee_amount: Number(s.fee_amount)||0,
      is_clawback: true, clawback_of: s.settlement_code || s._key,
      original_settled_date: s.settled_date,
      partner_code: s.partner_code, agent_code: s.agent_code,
      customer_name: s.customer_name, car_number: s.car_number,
      vehicle_name_snapshot: s.vehicle_name_snapshot,
      created_at: Date.now(),
    });
    showToast('환수 처리 완료');
  });

  el.querySelectorAll('.status-toggle').forEach(tog => {
    tog.addEventListener('click', async () => {
      await updateRecord(`settlements/${s._key}`, settlementStatusPayload(tog.dataset.status));
      showToast(`→ ${tog.dataset.status}`);
    });
  });

  el.querySelectorAll('.settle-confirm').forEach(btn => {
    btn.addEventListener('click', async () => {
      const role = btn.dataset.role;
      const current = confirms[role] || false;
      await updateRecord(`settlements/${s._key}`, { [`confirms/${role}`]: !current });
      showToast(!current ? '확인' : '해제');
    });
  });
}

/* ── 상세 패널: 정산 정보 + 계약 연결 ── */
function renderDetail(s) {
  const el = document.getElementById('stDetail');
  const c = (store.contracts||[]).find(x => x.contract_code === s.contract_code);

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="form-section"><div class="form-section-title">정산정보</div>
        <div class="form-section-body">
          ${ffv('계약코드',s.contract_code)}${ffv('대여기간',s.rent_month?s.rent_month+'개월':'-')}
          ${ffv('월대여료',fmtWon(s.rent_amount))}${ffv('보증금',fmtWon(s.deposit_amount))}
          ${ffv('영업자',s.agent_code)}${ffv('공급사',s.partner_code)}
          ${ffv('정산일',s.settled_date||'-')}${ffv('원수수료',fmtWon(s.origin_fee_amount))}
        </div>
      </div>

      ${c ? `
      <div class="form-section"><div class="form-section-title">연결 계약</div>
        <div class="form-section-body">
          ${ffv('차량',c.vehicle_name_snapshot||c.car_number_snapshot)}${ffv('고객',c.customer_name)}
          ${ffv('상태',c.contract_status)}${ffv('계약일',c.contract_date)}
        </div>
      </div>
      ` : ''}

      ${s.is_clawback ? `
      <div style="padding:var(--sp-2);background:var(--c-err-bg);border:1px solid var(--c-err);border-radius:var(--ctrl-r);font-size:var(--fs-xs);color:var(--c-err);">
        환수 건 (원본: ${s.clawback_of||'-'})
      </div>
      ` : ''}
    </div>
  `;
}

/* ── 보조 패널: 메모 + 이력 ── */
function renderSub(s) {
  const el = document.getElementById('stSub');
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="form-section"><div class="form-section-title">공급사 메모</div>
        <div class="form-section-body">
          <textarea class="input st-memo" data-memo="provider_memo" rows="3" style="resize:vertical;height:auto;" placeholder="공급사 메모...">${s.provider_memo||''}</textarea>
        </div>
      </div>
      <div class="form-section"><div class="form-section-title">영업자 메모</div>
        <div class="form-section-body">
          <textarea class="input st-memo" data-memo="agent_memo" rows="3" style="resize:vertical;height:auto;" placeholder="영업자 메모...">${s.agent_memo||''}</textarea>
        </div>
      </div>
      <div class="form-section"><div class="form-section-title">관리자 메모</div>
        <div class="form-section-body">
          <textarea class="input st-memo" data-memo="admin_memo" rows="3" style="resize:vertical;height:auto;" placeholder="관리자 메모...">${s.admin_memo||''}</textarea>
        </div>
      </div>
    </div>
  `;

  let memoTimer;
  el.querySelectorAll('.st-memo').forEach(ta => {
    ta.addEventListener('input', () => {
      clearTimeout(memoTimer);
      memoTimer = setTimeout(() => updateRecord(`settlements/${s._key}`, { [ta.dataset.memo]: ta.value }), 800);
    });
  });
}

export function unmount() {
  unsubSettlements?.();
}
