/**
 * 모바일 정산
 * - 목록 카드 + 탭 → 바텀시트 상세 (수수료/상태 토글/확인)
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtWon, mEmpty } from '../core/format.js';

function iRow(label, value) {
  const v = value === 0 || value ? String(value) : '';
  const empty = !v;
  return `<div class="m-info-row">
    <span class="m-info-label">${label}</span>
    <span class="m-info-value ${empty ? 'is-empty' : ''}">${empty ? '-' : v}</span>
  </div>`;
}
function iSection(title, rowsHtml) {
  return `<section class="m-info-section">
    <div class="m-info-section-head"><span class="m-info-section-title">${title}</span></div>
    <div class="m-info-body">${rowsHtml}</div>
  </section>`;
}
import { openBottomSheet } from '../core/mobile-shell.js';
import { filterByRole } from '../core/roles.js';
import {
  SETTLEMENT_STATUS as SS,
  SETTLEMENT_STATUSES_FULL,
  getSettlementStatus,
  settlementStatusTone,
  settlementStatusPayload,
} from '../core/settlement-status.js';

let unsub = null;

export function mount() {
  cleanup();
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="m-shell-page">
      <div class="m-search-head">
        <div class="m-search-bar">
          <i class="ph ph-magnifying-glass"></i>
          <input type="search" id="mstSearch" placeholder="차량번호, 고객명, 코드"
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                 enterkeyhint="search">
          <span class="m-search-count" id="mstCount"></span>
          <button class="m-topbar-action" id="mstSearchClear" style="display:none;" aria-label="지우기"><i class="ph ph-x-circle"></i></button>
        </div>
        <div class="m-filter-chips">
          <button class="chip is-active" data-f="all">전체</button>
          <button class="chip" data-f="pending">미정산</button>
          <button class="chip" data-f="done">완료</button>
        </div>
      </div>
      <div class="m-page" id="mstList"></div>
    </div>
  `;

  const mstSearchEl = document.getElementById('mstSearch');
  const mstSearchClearEl = document.getElementById('mstSearchClear');
  mstSearchEl?.addEventListener('input', () => {
    if (mstSearchClearEl) mstSearchClearEl.style.display = mstSearchEl.value ? '' : 'none';
    renderList();
  });
  mstSearchClearEl?.addEventListener('click', () => {
    mstSearchEl.value = '';
    mstSearchClearEl.style.display = 'none';
    renderList();
  });
  main.querySelectorAll('.chip[data-f]').forEach(chip => {
    chip.addEventListener('click', () => {
      main.querySelectorAll('.chip[data-f]').forEach(x => x.classList.remove('is-active'));
      chip.classList.add('is-active');
      renderList();
    });
  });

  document.getElementById('mstList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-key]');
    if (item) openSettlementSheet(item.dataset.key);
  });

  unsub = watchCollection('settlements', (data) => {
    store.settlements = data;
    renderList();
  });
  watchCollection('contracts', (d) => { store.contracts = d; });
}

function getVisible() {
  return filterByRole([...(store.settlements || [])], store.currentUser || {});
}

function renderList() {
  const el = document.getElementById('mstList');
  if (!el) return;
  const q = (document.getElementById('mstSearch')?.value || '').toLowerCase();
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || 'all';

  let list = getVisible();
  if (f === 'pending') list = list.filter(s => getSettlementStatus(s) !== SS.DONE);
  else if (f === 'done') list = list.filter(s => getSettlementStatus(s) === SS.DONE);
  if (q) list = list.filter(s => [s.car_number, s.customer_name, s.contract_code, s.agent_code, s._key].some(v => v && String(v).toLowerCase().includes(q)));
  list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  const countEl = document.getElementById('mstCount');
  if (countEl) countEl.textContent = list.length ? `${list.length}건` : '';

  if (!list.length) {
    el.innerHTML = mEmpty('정산 없음', 'ph-coins');
    return;
  }

  // 요약 헤더
  const pending = list.filter(s => getSettlementStatus(s) !== SS.DONE);
  const sum = pending.reduce((a, s) => a + Number(s.fee_amount || 0), 0);

  el.innerHTML = `
    ${pending.length ? `
      <div class="m-settle-hero">
        <div class="m-settle-hero-label">미정산 ${pending.length}건</div>
        <div class="m-settle-hero-amount">${fmtWon(sum)}</div>
      </div>
    ` : ''}
    ${list.map(s => {
      const status = getSettlementStatus(s);
      const tone = settlementStatusTone(s);
      const icon = tone === 'ok' ? 'ph-check-circle' : tone === 'err' ? 'ph-x-circle' : tone === 'warn' ? 'ph-warning-circle' : 'ph-coins';
      const titleLine = `${s.car_number || ''} ${s.sub_model_snapshot || s.model_snapshot || ''}`.trim() || (s.settlement_code || s._key);
      const subLine = [s.customer_name, s.provider_company_code, s.agent_code].filter(Boolean).join(' · ');
      return `
        <article class="m-card-settle" data-key="${s._key}">
          <div class="m-card-icon-wrap is-${tone}"><i class="ph ${icon}"></i></div>
          <div class="m-card-settle-body">
            <div class="m-card-settle-head">
              <span class="m-card-title">${titleLine}</span>
              <span class="m-card-status m-card-status-${tone}">${status}</span>
            </div>
            ${subLine ? `<div class="m-card-sub">${subLine}</div>` : ''}
            <div class="m-settle-card-head">
              <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">수수료</span>
              <span class="m-settle-card-amount">${fmtWon(s.fee_amount)}</span>
            </div>
          </div>
        </article>
      `;
    }).join('')}
  `;
}

function openSettlementSheet(key) {
  const s = (store.settlements || []).find(x => x._key === key);
  if (!s) return;
  const c = (store.contracts || []).find(x => x.contract_code === s.contract_code);

  const status = getSettlementStatus(s);
  const confirms = s.confirms || {};

  const html = `
    <div class="m-info-page" style="padding:var(--sp-3) 0;">
      <div style="font-weight:var(--fw-semibold);padding:0 var(--sp-1);">${s.car_number || ''} ${s.sub_model_snapshot || s.model_snapshot || ''}</div>

      <div class="m-settle-hero">
        <div class="m-settle-hero-label">수수료</div>
        <div class="m-settle-hero-amount">${fmtWon(s.fee_amount)}</div>
      </div>

      <section class="m-info-section">
        <div class="m-info-section-head"><span class="m-info-section-title">상태</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;padding:0 var(--sp-1);">
          ${SETTLEMENT_STATUSES_FULL.map(st => {
            const active = status === st;
            return `<button class="chip ${active ? 'is-active' : ''}" data-status="${st}">${st}</button>`;
          }).join('')}
        </div>
      </section>

      <div class="m-settle-confirms">
        ${['공급사', '영업자', '관리자'].map((label, i) => {
          const roles = ['provider', 'agent', 'admin'];
          const confirmed = confirms[roles[i]];
          return `<button class="settle-confirm ${confirmed ? 'is-confirmed' : ''}" data-role="${roles[i]}">
            <i class="ph ${confirmed ? 'ph-check-circle' : 'ph-circle'}"></i>
            <span>${label}</span>
          </button>`;
        }).join('')}
      </div>

      ${iSection('정산 정보', `
        ${iRow('계약코드', s.contract_code)}
        ${iRow('대여기간', s.rent_month ? s.rent_month + '개월' : '')}
        ${iRow('월대여료', s.rent_amount ? fmtWon(s.rent_amount) : '')}
        ${iRow('보증금', s.deposit_amount ? fmtWon(s.deposit_amount) : '')}
        ${iRow('영업자', s.agent_code)}
        ${iRow('공급사', s.partner_code || s.provider_company_code)}
        ${iRow('정산일', s.settled_date)}
      `)}

      ${c ? iSection('연결 계약', `
        ${iRow('차량', c.vehicle_name_snapshot || c.car_number_snapshot)}
        ${iRow('고객', c.customer_name)}
        ${iRow('상태', c.contract_status)}
      `) : ''}
    </div>
  `;

  openBottomSheet(html, {
    title: s.settlement_code || s._key,
    onMount: (sheet) => {
      sheet.querySelectorAll('[data-status]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await updateRecord(`settlements/${s._key}`, settlementStatusPayload(btn.dataset.status));
          showToast(`→ ${btn.dataset.status}`);
        });
      });
      sheet.querySelectorAll('[data-role]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const r = btn.dataset.role;
          const cur = confirms[r] || false;
          await updateRecord(`settlements/${s._key}`, { [`confirms/${r}`]: !cur });
          showToast(!cur ? '확인' : '해제');
        });
      });
    },
  });
}

function cleanup() {
  unsub?.();
  unsub = null;
}

export function unmount() {
  cleanup();
}
