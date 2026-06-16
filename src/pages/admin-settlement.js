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
const PRODUCT_OPTS = ['무보증', '일반', '무심사'];

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

/* ──────── 유틸 ──────── */
const num = (v) => Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')) || 0;
const won = (v) => num(v).toLocaleString('ko-KR');
const man = (v) => { const n = num(v); return n ? Math.round(n / 10000).toLocaleString('ko-KR') + '만' : '-'; };

/** 자동계산 — 부가세 10%, 합계, 청구/지급, 당월수익.
 *  인라인 등록에서 provider_bill / agency_pay 직접 입력 시 그 값이 우선.
 *  (sale_fee/incentive 같은 base 필드가 없을 때 직접 입력값 사용)
 */
function compute(d) {
  const providerFeeSum = num(d.sale_fee) + num(d.provider_incentive);
  const providerVat = Math.round(providerFeeSum * 0.1);
  const providerBillCalc = providerFeeSum + providerVat;
  const agencyFeeSum = num(d.delivery_fee) + num(d.agency_incentive) + num(d.doc_agency_fee);
  const agencyVat = Math.round(agencyFeeSum * 0.1);
  const agencyPayCalc = agencyFeeSum + agencyVat;
  // 직접 입력값 우선 (인라인 입력)
  const providerBill = d.provider_bill != null && d.provider_bill !== '' ? num(d.provider_bill) : providerBillCalc;
  const agencyPay = d.agency_pay != null && d.agency_pay !== '' ? num(d.agency_pay) : agencyPayCalc;
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

/* ──────── 드롭다운 소스 (기존 데이터 기반) ──────── */
function activePartnerNames(type) {
  return [...new Set((store.partners || []).filter(p => {
    if (p._deleted || p.is_active === false) return false;
    const pt = p.partner_type || '공급사';
    if (type === '공급사') return pt === '공급사' || pt === 'provider';
    if (type === '영업채널') return pt === '영업채널' || pt === 'sales_channel';
    return pt === type;
  }).map(p => p.partner_name || p.company_name || p.partner_code || p._key).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
}
const providerNames = () => activePartnerNames('공급사');
const channelNames = () => activePartnerNames('영업채널');

/** select 셀 — 현재값이 옵션에 없으면 맨 앞에 보존 */
function selectCell(field, value, options) {
  const opts = [...options];
  if (value && !opts.includes(value)) opts.unshift(value);
  return `<select class="input input-sm" data-f="${field}">
    <option value="">—</option>
    ${opts.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
  </select>`;
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
                <th style="text-align:left;">상태</th>
                <th style="text-align:left;">차량번호</th>
                <th style="text-align:left;">모델명</th>
                <th style="text-align:left;">고객</th>
                <th style="text-align:left;">연락처</th>
                <th style="text-align:left;">상품구분</th>
                <th style="text-align:left;">기간</th>
                <th style="text-align:right;">대여료</th>
                <th style="text-align:right;">보증금</th>
                <th style="text-align:left;">공급사</th>
                <th style="text-align:left;">영업채널</th>
                <th style="text-align:left;">담당자</th>
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
    tbody.innerHTML = `<tr><td colspan="17" style="text-align:center;padding:32px;color:var(--text-muted);">${esc(periodLabel())} 정산 내역이 없습니다. 하단 [정산 등록]으로 추가하세요.</td></tr>`;
    return;
  }

  tbody.innerHTML = all.map(s => rowHtml(s)).join('');
  bindRowEvents(tbody);
}

/** 행 1개 HTML — 인라인 편집 가능 */
function rowHtml(s) {
  const c = compute(s);
  const editing = s._editing;
  const month = s.settle_month || defaultMonth();
  const statusOptionsHtml = STATUS_OPTS.map(o =>
    `<option value="${esc(o)}" ${o === (s.settle_status || '계약완료') ? 'selected' : ''}>${esc(o)}</option>`
  ).join('');

  if (editing) {
    return `<tr data-key="${esc(s._key)}" data-edit="1">
      <td><input type="month" class="input input-sm" data-f="settle_month" value="${esc(month)}"></td>
      <td><select class="input input-sm" data-f="settle_status">${statusOptionsHtml}</select></td>
      <td><input class="input input-sm" data-f="car_number" value="${esc(s.car_number || '')}" placeholder="차량번호"></td>
      <td><input class="input input-sm" data-f="model_name" value="${esc(s.model_name || '')}" placeholder="모델명"></td>
      <td><input class="input input-sm" data-f="customer_name" value="${esc(s.customer_name || '')}" placeholder="고객명"></td>
      <td><input class="input input-sm" data-f="customer_phone" value="${esc(s.customer_phone || '')}" placeholder="연락처"></td>
      <td>${selectCell('product_type', s.product_type || '', PRODUCT_OPTS)}</td>
      <td><input class="input input-sm" data-f="contract_term" value="${esc(s.contract_term || '')}" placeholder="개월"></td>
      <td style="text-align:right;"><input class="input input-sm" data-f="contract_rent" data-num="1" value="${esc(s.contract_rent != null ? won(s.contract_rent) : '')}" style="text-align:right;"></td>
      <td style="text-align:right;"><input class="input input-sm" data-f="deposit" data-num="1" value="${esc(s.deposit != null ? won(s.deposit) : '')}" style="text-align:right;"></td>
      <td>${selectCell('provider_name', s.provider_name || '', providerNames())}</td>
      <td>${selectCell('agency', s.agency || '', channelNames())}</td>
      <td><input class="input input-sm" data-f="writer" value="${esc(s.writer || '')}" placeholder="담당자"></td>
      <td style="text-align:right;"><input class="input input-sm" data-f="provider_bill" data-num="1" value="${esc(s.provider_bill != null ? won(s.provider_bill) : '')}" style="text-align:right;"></td>
      <td style="text-align:right;"><input class="input input-sm" data-f="agency_pay" data-num="1" value="${esc(s.agency_pay != null ? won(s.agency_pay) : '')}" style="text-align:right;"></td>
      <td style="text-align:right;color:var(--text-muted);" data-calc="monthly_profit">${man(c.monthly_profit)}</td>
      <td style="text-align:center;white-space:nowrap;">
        <button class="btn btn-sm btn-primary" data-save="${esc(s._key)}" title="저장"><i class="ph ph-check"></i></button>
        <button class="btn btn-sm btn-ghost" data-cancel="${esc(s._key)}" title="취소"><i class="ph ph-x"></i></button>
      </td>
    </tr>`;
  }

  return `<tr data-key="${esc(s._key)}" style="cursor:pointer;">
    <td>${esc(s.settle_month || '-')}</td>
    <td>${esc(s.settle_status || '-')}</td>
    <td>${esc(s.car_number || '-')}</td>
    <td>${esc(s.model_name || '-')}</td>
    <td>${esc(s.customer_name || '-')}</td>
    <td>${esc(s.customer_phone || '-')}</td>
    <td>${esc(s.product_type || '-')}</td>
    <td>${esc(s.contract_term || '-')}</td>
    <td style="text-align:right;">${man(s.contract_rent)}</td>
    <td style="text-align:right;">${man(s.deposit)}</td>
    <td>${esc(s.provider_name || '-')}</td>
    <td>${esc(s.agency || '-')}</td>
    <td>${esc(s.writer || '-')}</td>
    <td style="text-align:right;">${man(c.provider_bill)}</td>
    <td style="text-align:right;">${man(c.agency_pay)}</td>
    <td style="text-align:right;font-weight:var(--fw-semibold);color:${c.monthly_profit >= 0 ? 'var(--text-main)' : '#dc2626'};">${man(c.monthly_profit)}</td>
    <td style="text-align:center;"><button class="btn btn-sm btn-ghost" data-del="${esc(s._key)}" title="삭제"><i class="ph ph-trash"></i></button></td>
  </tr>`;
}

function bindRowEvents(tbody) {
  // 보기 모드 클릭 → 편집 모드
  tbody.querySelectorAll('tr[data-key]:not([data-edit])').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]') || e.target.closest('button')) return;
      const key = tr.dataset.key;
      const rec = (store.adminSettlements || []).find(x => x._key === key);
      if (rec) { rec._editing = true; drawRows(); }
    });
  });
  // 편집 모드 — 숫자 실시간 자동계산 (monthly_profit)
  tbody.querySelectorAll('tr[data-edit] input[data-num]').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const tr = e.target.closest('tr');
      const bill = num(tr.querySelector('input[data-f="provider_bill"]').value);
      const pay = num(tr.querySelector('input[data-f="agency_pay"]').value);
      const profitEl = tr.querySelector('[data-calc="monthly_profit"]');
      const p = bill - pay;
      profitEl.textContent = man(p);
      profitEl.style.color = p >= 0 ? 'var(--text-main)' : '#dc2626';
    });
  });
  // 저장
  tbody.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = btn.dataset.save;
      const tr = btn.closest('tr');
      const patch = {};
      tr.querySelectorAll('[data-f]').forEach(inp => {
        const f = inp.dataset.f;
        if (f.startsWith('_')) return;  // 메타 필드 제외
        patch[f] = inp.dataset.num ? num(inp.value) : inp.value.trim();
      });
      patch.updated_at = Date.now();
      try {
        const rec = (store.adminSettlements || []).find(x => x._key === key);
        const isNew = rec && rec._new;
        if (isNew) {
          // 새 행 — RTDB create
          await createAdminSettlement(patch);
          // 로컬 placeholder 제거 (RTDB watch 가 새로 push)
          store.adminSettlements = (store.adminSettlements || []).filter(x => x._key !== key);
        } else {
          await updateRecord(`admin_settlements/${key}`, patch);
          if (rec) { rec._editing = false; }
        }
        showToast('저장됨');
        drawRows();
      } catch (err) { showToast('저장 실패 — ' + (err.message || err), 'error'); }
    });
  });
  // 취소
  tbody.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.cancel;
      const rec = (store.adminSettlements || []).find(x => x._key === key);
      if (rec) {
        if (rec._new) store.adminSettlements = store.adminSettlements.filter(x => x._key !== key);
        else rec._editing = false;
        drawRows();
      }
    });
  });
  // 삭제
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

/** 정산 등록 버튼 — 테이블 상단에 빈 행 추가 + 인라인 입력 */
function addInlineRow() {
  if (!isAdmin()) return;
  // placeholder 한 건 — _new + _editing
  const placeholder = {
    _key: '_new_' + Date.now(),
    _new: true,
    _editing: true,
    settle_month: defaultMonth(),
    settle_status: '계약완료',
  };
  store.adminSettlements = [placeholder, ...(store.adminSettlements || [])];
  drawRows();
  // 첫 입력 셀에 포커스
  setTimeout(() => {
    document.querySelector(`tr[data-key="${placeholder._key}"] input[data-f="car_number"]`)?.focus();
  }, 0);
}

/* ──────── 하단 액션바 — 기간 네비 + 정산 등록 ──────── */
function buildActions() {
  if (!isAdmin()) { setPageActions({}); return; }
  const reRender = () => { drawRows(); buildActions(); };
  const setMode = (m) => { _pMode = m; reRender(); };
  setPageActions({
    left: [
      { label: '정산 등록', icon: 'ph-plus', primary: true, onClick: () => addInlineRow() },
      { divider: true },
      { chip: true, label: '월',   active: _pMode === 'month',   onClick: () => setMode('month') },
      { chip: true, label: '분기', active: _pMode === 'quarter', onClick: () => setMode('quarter') },
      { chip: true, label: '연',   active: _pMode === 'year',    onClick: () => setMode('year') },
      { divider: true },
      { icon: 'ph-caret-left', title: '이전', onClick: () => { shiftPeriod(-1); reRender(); } },
      { chip: true, label: periodLabel(), active: true, title: '현재 기간' },
      { icon: 'ph-caret-right', title: '다음', onClick: () => { shiftPeriod(1); reRender(); } },
      { label: '당월', icon: 'ph-calendar-dot', title: '현재 월로', onClick: () => { resetPeriodNow(); reRender(); } },
    ],
  });
}
// index.html showPage() → refreshPageActions('admin-settle') 가 호출 (app.js 분기)
if (typeof window !== 'undefined') window.buildAdminSettleActions = buildActions;
