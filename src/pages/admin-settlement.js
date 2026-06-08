/**
 * pages/admin-settlement.js — 관리자 월별 수수료 정산 (별도 페이지, admin 전용)
 *
 *  정산관리(건별 미정산/완료/환수)는 그대로 두고, 거기서 "정산완료"된 건을 관리자가
 *  실제 월별 수수료 정산(공급사 청구 / 에이전시 지급 / 당월 수익)으로 옮겨 만지는 곳.
 *  - 데이터: RTDB admin_settlements (record = 한 건의 월별 정산)
 *  - 규격: 기존 페이지와 동일 — 토픽바 제목 / ws4 카드 / 하단 액션바(기간 네비 + 정산 등록)
 *  - 기간: 월/분기/연 토글 + ◀▶ 이동 + 당월. settle_month(YYYY-MM) 기준 필터.
 *  - 자동계산: 부가세=합계×10%, 청구/지급=합계+부가세, 당월수익=청구−지급
 *  - 등록 시 "정산완료 건 불러오기"로 A블록 자동 prefill 가능
 *
 *  엑셀 51컬럼 정산표를 ERP로 이식. 컬럼 ↔ 필드 매핑은 BLOCKS 메타 참고.
 */
import { store } from '../core/store.js';
import { updateRecord } from '../firebase/db.js';
import { createAdminSettlement } from '../firebase/collections.js';
import { showToast } from '../core/toast.js';
import { customConfirm } from '../core/confirm.js';
import { setPageActions } from '../core/page-actions.js';
import { esc, providerLabelByCode } from '../core/ui-helpers.js';

/* ──────── 필드 메타 (폼·목록·계산 단일 소스) ──────── */
const STATUS_OPTS = ['계약완료', '정산완료', '진행', '보류', '취소', '환수'];

// type: text | num | date | select   · calc: 자동계산(읽기전용)
const BLOCKS = [
  {
    title: 'A. 계약 · 차량', key: 'A', fields: [
      { k: 'contract_code', label: '계약번호', type: 'text' },
      { k: 'settle_status', label: '상태표기', type: 'select', opts: STATUS_OPTS },
      { k: 'provider_name', label: '업체명(공급사)', type: 'text' },
      { k: 'received_date', label: '접수일', type: 'date' },
      { k: 'delivery_date', label: '인도일', type: 'date' },
      { k: 'rent_type', label: '렌트구분', type: 'text' },
      { k: 'product_type', label: '상품구분', type: 'text' },
      { k: 'car_number', label: '차량번호', type: 'text' },
      { k: 'model_name', label: '모델명', type: 'text' },
      { k: 'customer_name', label: '고객명', type: 'text' },
      { k: 'customer_age', label: '연령', type: 'num' },
      { k: 'customer_phone', label: '연락처', type: 'text' },
      { k: 'contract_term', label: '계약기간', type: 'text' },
      { k: 'deposit', label: '보증금', type: 'num' },
      { k: 'installment', label: '분납여부', type: 'select', opts: ['아니오', '예'] },
      { k: 'contract_form', label: '계약형태', type: 'text' },
      { k: 'rental_fee', label: '렌탈료', type: 'num' },
      { k: 'contract_rent', label: '계약대여료', type: 'num' },
      { k: 'upselling', label: '업셀링', type: 'num' },
      { k: 'vehicle_value', label: '차량가액', type: 'num' },
      { k: 'product_term', label: '상품&기간', type: 'text' },
    ],
  },
  {
    title: 'B. 공급사 수수료 (청구 = 수익 IN)', key: 'B', fields: [
      { k: 'fee_code', label: '수수료 고유코드', type: 'text' },
      { k: 'provider_fee_rate', label: '수수료율(공급사)', type: 'text' },
      { k: 'writer', label: '계약서 작성 담당자', type: 'text' },
      { k: 'sale_fee', label: '판매수수료', type: 'num' },
      { k: 'provider_incentive', label: '추가 인센티브', type: 'num' },
      { k: 'delivery_region', label: '출고지역', type: 'text' },
      { k: 'provider_fee_sum', label: '수수료 합계', type: 'num', calc: true },
      { k: 'provider_vat', label: '부가세', type: 'num', calc: true },
      { k: 'provider_bill', label: '청구 금액', type: 'num', calc: true },
    ],
  },
  {
    title: 'C. 에이전시 지급 (지급 = 비용 OUT)', key: 'C', fields: [
      { k: 'agency', label: '에이전시', type: 'text' },
      { k: 'agent_name', label: '영업자', type: 'text' },
      { k: 'agency_fee_rate', label: '수수료율(에이전시)', type: 'text' },
      { k: 'delivery_fee', label: '출고수수료', type: 'num' },
      { k: 'agency_incentive', label: '추가 인센티브', type: 'num' },
      { k: 'doc_agency_fee', label: '계약서 대행료', type: 'num' },
      { k: 'agency_fee_sum', label: '수수료 합계', type: 'num', calc: true },
      { k: 'agency_vat', label: '부가세', type: 'num', calc: true },
      { k: 'agency_pay', label: '지급액', type: 'num', calc: true },
    ],
  },
];

const FIELD_BY_K = {};
for (const b of BLOCKS) for (const f of b.fields) FIELD_BY_K[f.k] = f;

/* ──────── 유틸 ──────── */
const num = (v) => Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')) || 0;
const won = (v) => num(v).toLocaleString('ko-KR');
const man = (v) => { const n = num(v); return n ? Math.round(n / 10000).toLocaleString('ko-KR') + '만' : '-'; };

/** 자동계산 — 부가세 10%, 합계, 청구/지급, 당월수익 */
function compute(d) {
  const providerFeeSum = num(d.sale_fee) + num(d.provider_incentive);
  const providerVat = Math.round(providerFeeSum * 0.1);
  const providerBill = providerFeeSum + providerVat;
  const agencyFeeSum = num(d.delivery_fee) + num(d.agency_incentive) + num(d.doc_agency_fee);
  const agencyVat = Math.round(agencyFeeSum * 0.1);
  const agencyPay = agencyFeeSum + agencyVat;
  return {
    provider_fee_sum: providerFeeSum,
    provider_vat: providerVat,
    provider_bill: providerBill,
    agency_fee_sum: agencyFeeSum,
    agency_vat: agencyVat,
    agency_pay: agencyPay,
    monthly_profit: providerBill - agencyPay,
  };
}

function isAdmin() {
  return (store.currentUser || {}).role === 'admin';
}

/* ──────── 기간 네비게이터 상태 (월/분기/연) ──────── */
let _pMode = 'month';   // month | quarter | year
let _pY = new Date().getFullYear();
let _pM = new Date().getMonth() + 1;   // 1-12 (분기 anchor 도 월로 보관)

function periodLabel() {
  if (_pMode === 'year') return `${_pY}`;
  if (_pMode === 'quarter') return `${_pY} Q${Math.floor((_pM - 1) / 3) + 1}`;
  return `${_pY}-${String(_pM).padStart(2, '0')}`;
}
function inPeriod(settleMonth) {
  if (!settleMonth) return false;
  const [yy, mm] = String(settleMonth).split('-').map(Number);
  if (!yy || !mm) return false;
  if (_pMode === 'year') return yy === _pY;
  if (_pMode === 'quarter') return yy === _pY && Math.floor((mm - 1) / 3) === Math.floor((_pM - 1) / 3);
  return yy === _pY && mm === _pM;
}
function shiftPeriod(dir) {
  if (_pMode === 'year') { _pY += dir; return; }
  _pM += dir * (_pMode === 'quarter' ? 3 : 1);
  while (_pM < 1) { _pM += 12; _pY -= 1; }
  while (_pM > 12) { _pM -= 12; _pY += 1; }
}
function resetPeriodNow() { const d = new Date(); _pY = d.getFullYear(); _pM = d.getMonth() + 1; }
/** 다이얼로그 기본 정산월 — 현재 기간의 월(연/분기 모드면 anchor 월) */
function defaultMonth() { return `${_pY}-${String(_pM).padStart(2, '0')}`; }

/* ──────── 페이지 렌더 (ws4 규격) ──────── */
export function renderAdminSettlement() {
  const page = document.querySelector('.pt-page[data-page="admin-settle"]');
  if (!page) return;
  if (!isAdmin()) {
    page.innerHTML = `<div style="padding:var(--sp-6);color:var(--text-muted);text-align:center;">관리자만 접근 가능합니다.</div>`;
    setPageActions({});
    return;
  }

  page.innerHTML = `
    <div class="ws4">
      <div class="ws4-card" style="flex:1 1 0;">
        <div class="ws4-body no-pad" style="overflow:auto;">
          <table class="table" style="width:100%;font-size:var(--fs-xs);">
            <thead style="position:sticky;top:0;background:var(--bg-header);z-index:1;">
              <tr>
                <th style="text-align:left;">정산월</th>
                <th style="text-align:left;">계약번호</th>
                <th style="text-align:left;">상태</th>
                <th style="text-align:left;">차량번호</th>
                <th style="text-align:left;">모델명</th>
                <th style="text-align:left;">고객</th>
                <th style="text-align:left;">공급사</th>
                <th style="text-align:left;">영업자</th>
                <th style="text-align:right;">공급사청구</th>
                <th style="text-align:right;">에이전시지급</th>
                <th style="text-align:right;">당월수익</th>
                <th style="text-align:center;width:48px;"></th>
              </tr>
            </thead>
            <tbody id="asRows"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  drawRows();
  buildActions();
}

function drawRows() {
  const tbody = document.getElementById('asRows');
  if (!tbody) return;
  const all = (store.adminSettlements || []).filter(s => !s._deleted && inPeriod(s.settle_month));
  all.sort((a, b) => (b.settle_month || '').localeCompare(a.settle_month || '') || (a.contract_code || '').localeCompare(b.contract_code || ''));

  if (!all.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:var(--text-muted);">${esc(periodLabel())} 정산 내역이 없습니다. 하단 [정산 등록]으로 추가하세요.</td></tr>`;
    return;
  }

  let billSum = 0, paySum = 0, profitSum = 0;
  tbody.innerHTML = all.map(s => {
    const c = compute(s);
    billSum += c.provider_bill; paySum += c.agency_pay; profitSum += c.monthly_profit;
    return `<tr data-key="${esc(s._key)}" style="cursor:pointer;">
      <td>${esc(s.settle_month || '-')}</td>
      <td>${esc(s.contract_code || '-')}</td>
      <td>${esc(s.settle_status || '-')}</td>
      <td>${esc(s.car_number || '-')}</td>
      <td>${esc(s.model_name || '-')}</td>
      <td>${esc(s.customer_name || '-')}</td>
      <td>${esc(s.provider_name || '-')}</td>
      <td>${esc(s.agent_name || '-')}</td>
      <td style="text-align:right;">${man(c.provider_bill)}</td>
      <td style="text-align:right;">${man(c.agency_pay)}</td>
      <td style="text-align:right;font-weight:var(--fw-semibold);color:${c.monthly_profit >= 0 ? 'var(--text-main)' : '#dc2626'};">${man(c.monthly_profit)}</td>
      <td style="text-align:center;"><button class="btn btn-sm btn-ghost" data-del="${esc(s._key)}" title="삭제"><i class="ph ph-trash"></i></button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-key]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      const rec = (store.adminSettlements || []).find(x => x._key === tr.dataset.key);
      if (rec) openSettleDialog(rec);
    });
  });
  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await customConfirm({ message: '이 정산 건을 삭제할까요?', danger: true, okLabel: '삭제' })) return;
      try {
        await updateRecord(`admin_settlements/${btn.dataset.del}`, { _deleted: true, updated_at: Date.now() });
        showToast('삭제됨');
      } catch (err) { showToast('삭제 실패 — ' + (err.message || err), 'error'); }
    });
  });
}

/* ──────── 하단 액션바 — 기간 네비 + 정산 등록 ──────── */
function buildActions() {
  if (!isAdmin()) { setPageActions({}); return; }
  const reRender = () => { drawRows(); buildActions(); };
  const setMode = (m) => { _pMode = m; reRender(); };
  setPageActions({
    left: [
      { chip: true, label: '월',   active: _pMode === 'month',   onClick: () => setMode('month') },
      { chip: true, label: '분기', active: _pMode === 'quarter', onClick: () => setMode('quarter') },
      { chip: true, label: '연',   active: _pMode === 'year',    onClick: () => setMode('year') },
      { divider: true },
      { icon: 'ph-caret-left', title: '이전', onClick: () => { shiftPeriod(-1); reRender(); } },
      { chip: true, label: periodLabel(), active: true, title: '현재 기간' },
      { icon: 'ph-caret-right', title: '다음', onClick: () => { shiftPeriod(1); reRender(); } },
      { label: '당월', icon: 'ph-calendar-dot', title: '현재 월로', onClick: () => { resetPeriodNow(); reRender(); } },
    ],
    right: [
      { label: '정산 등록', icon: 'ph-plus', primary: true, onClick: () => openSettleDialog(null) },
    ],
  });
}
// index.html showPage() → refreshPageActions('admin-settle') 가 호출 (app.js 분기)
if (typeof window !== 'undefined') window.buildAdminSettleActions = buildActions;

/* ──────── 등록/수정 다이얼로그 ──────── */
function fieldInputHtml(f, val) {
  const v = val == null ? '' : val;
  if (f.calc) {
    return `<input class="input" data-k="${f.k}" data-calc="1" readonly value="${esc(v ? won(v) : '')}" style="text-align:right;background:var(--alert-blue-bg);font-weight:var(--fw-semibold);">`;
  }
  if (f.type === 'select') {
    return `<select class="input" data-k="${f.k}">
      ${f.opts.map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    </select>`;
  }
  if (f.type === 'date') {
    return `<input type="date" class="input" data-k="${f.k}" value="${esc(v)}">`;
  }
  const align = f.type === 'num' ? ' style="text-align:right;"' : '';
  const dv = f.type === 'num' ? (v ? won(v) : '') : v;
  return `<input type="text" class="input" data-k="${f.k}" data-type="${f.type}" value="${esc(dv)}"${align}>`;
}

function blockHtml(block, rec) {
  return `
    <fieldset style="border:1px solid var(--border);border-radius:4px;padding:var(--sp-3);margin-bottom:var(--sp-3);">
      <legend style="font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--text-sub);padding:0 6px;">${esc(block.title)}</legend>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-2) var(--sp-3);">
        ${block.fields.map(f => `
          <label style="display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:var(--fs-2xs);color:var(--text-muted);">${esc(f.label)}${f.calc ? ' (자동)' : ''}</span>
            ${fieldInputHtml(f, rec ? rec[f.k] : '')}
          </label>`).join('')}
      </div>
    </fieldset>`;
}

function openSettleDialog(rec) {
  const isEdit = !!rec;
  const month = (rec && rec.settle_month) || defaultMonth();

  const doneSettlements = (store.settlements || []).filter(s =>
    !s._deleted && (s.settlement_status || s.status) === '정산완료');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--c-overlay-dark,rgba(0,0,0,0.4));z-index:9999;display:flex;align-items:center;justify-content:center;padding:var(--sp-4);';
  overlay.innerHTML = `
    <div style="background:var(--bg-card,#fff);border-radius:6px;width:100%;max-width:880px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
      <header style="display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--border);">
        <span style="font-size:var(--fs-md);font-weight:var(--fw-semibold);flex:1;">${isEdit ? '정산 수정' : '정산 등록'}${isEdit ? ` · ${esc(rec.admin_settlement_code || '')}` : ''}</span>
        <button class="btn btn-sm btn-ghost" id="asClose"><i class="ph ph-x"></i></button>
      </header>
      <div style="flex:1;overflow-y:auto;padding:var(--sp-4);">
        <div style="display:flex;gap:var(--sp-3);align-items:flex-end;margin-bottom:var(--sp-3);flex-wrap:wrap;">
          <label style="display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:var(--fs-2xs);color:var(--text-muted);">정산월 *</span>
            <input type="month" class="input" id="asDlgMonth" value="${esc(month)}" style="width:150px;">
          </label>
          ${!isEdit ? `
          <label style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:220px;">
            <span style="font-size:var(--fs-2xs);color:var(--text-muted);">정산완료 건 불러오기 (A블록 자동채움)</span>
            <select class="input" id="asPrefill">
              <option value="">— 직접 입력 —</option>
              ${doneSettlements.map(s => `<option value="${esc(s._key)}">${esc((s.car_number || s.car_number_snapshot || '') + ' · ' + (s.customer_name || '') + ' · ' + (s.contract_code || ''))}</option>`).join('')}
            </select>
          </label>` : ''}
        </div>
        ${BLOCKS.map(b => blockHtml(b, rec)).join('')}
        <label style="display:flex;flex-direction:column;gap:2px;margin-bottom:var(--sp-3);">
          <span style="font-size:var(--fs-2xs);color:var(--text-muted);">비고</span>
          <textarea class="input" data-k="note" style="height:48px;">${esc(rec ? (rec.note || '') : '')}</textarea>
        </label>
      </div>
      <footer style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--border);">
        <span style="font-size:var(--fs-xs);color:var(--text-sub);">
          공급사 청구 <b id="asSumBill">0</b> · 에이전시 지급 <b id="asSumPay">0</b> ·
          <span style="color:var(--text-link);">당월 수익 <b id="asSumProfit">0</b></span>
        </span>
        <button class="btn btn-sm btn-primary" id="asSave" style="margin-left:auto;">${isEdit ? '저장' : '등록'}</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#asClose').addEventListener('click', close);

  const gather = () => {
    const d = {};
    overlay.querySelectorAll('[data-k]').forEach(el => {
      if (el.dataset.calc) return;
      const f = FIELD_BY_K[el.dataset.k];
      let v = el.value;
      if (f && f.type === 'num') v = num(v);
      d[el.dataset.k] = v;
    });
    return d;
  };
  const refreshCalc = () => {
    const c = compute(gather());
    overlay.querySelectorAll('[data-calc]').forEach(el => {
      if (c[el.dataset.k] != null) el.value = won(c[el.dataset.k]);
    });
    overlay.querySelector('#asSumBill').textContent = won(c.provider_bill) + '원';
    overlay.querySelector('#asSumPay').textContent = won(c.agency_pay) + '원';
    overlay.querySelector('#asSumProfit').textContent = won(c.monthly_profit) + '원';
  };

  overlay.querySelectorAll('input[data-type="num"], select[data-k], input[data-type="text"], input[type="date"]').forEach(el => {
    el.addEventListener('input', () => {
      if (el.dataset.type === 'num') el.value = el.value ? won(el.value) : '';
      refreshCalc();
    });
  });

  overlay.querySelector('#asPrefill')?.addEventListener('change', (e) => {
    const s = (store.settlements || []).find(x => x._key === e.target.value);
    if (!s) return;
    const set = (k, v) => { const el = overlay.querySelector(`[data-k="${k}"]`); if (el && v != null && v !== '') el.value = (FIELD_BY_K[k]?.type === 'num') ? won(v) : v; };
    set('contract_code', s.contract_code);
    set('car_number', s.car_number || s.car_number_snapshot);
    set('model_name', s.sub_model_snapshot || s.model_snapshot || s.vehicle_name_snapshot);
    set('customer_name', s.customer_name);
    set('provider_name', providerLabelByCode(s.provider_company_code || s.partner_code, store) || s.provider_name || s.provider_company_code);
    set('agent_name', s.agent_code);
    set('contract_term', s.term ? s.term + '개월' : (s.rent_month ? s.rent_month + '개월' : ''));
    set('deposit', s.deposit_amount);
    set('contract_rent', s.rent_amount);
    set('sale_fee', s.fee_amount);
    const stEl = overlay.querySelector('[data-k="settle_status"]');
    if (stEl) stEl.value = '정산완료';
    refreshCalc();
  });

  overlay.querySelector('#asSave').addEventListener('click', async () => {
    const d = gather();
    d.settle_month = overlay.querySelector('#asDlgMonth').value || defaultMonth();
    if (!d.settle_month) { showToast('정산월을 선택하세요', 'error'); return; }
    const calc = compute(d);
    const payload = { ...d, ...calc, completed: d.settle_status === '정산완료', updated_by: store.currentUser?.email || '', updated_at: Date.now() };

    const btn = overlay.querySelector('#asSave');
    btn.disabled = true;
    try {
      if (isEdit) await updateRecord(`admin_settlements/${rec._key}`, payload);
      else await createAdminSettlement(payload);
      // 등록한 건이 보이도록 기간을 그 월로 이동
      const [yy, mm] = d.settle_month.split('-').map(Number);
      if (yy && mm) { _pY = yy; _pM = mm; }
      showToast(isEdit ? '정산 저장됨' : '정산 등록됨');
      close();
    } catch (err) {
      console.error('[admin-settle] save', err);
      showToast('저장 실패 — ' + (err.message || err), 'error');
      btn.disabled = false;
    }
  });

  refreshCalc();
}
