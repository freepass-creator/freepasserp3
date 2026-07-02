/**
 * pages/contract-rental-send.js — 렌터카 계약서 발송 (데스크톱 사이드바 메뉴 "계약발송")
 *
 * 우리 렌터카 계약서(public/contract-template/rental-contract.html)는 자체 입력 빌더를
 * 가진 완성형이라, iframe 으로 그대로 띄우고 ERP 툴바(검색·신규·저장·PDF·발송)를 얹는다.
 *
 *  워크플로우 — 문서허브 형태:
 *   - 신규: 빈 계약서로 시작
 *   - 검색: 계약(진행중)·재고(상품) 선택 → 차량·정책 스펙 자동 입력
 *   - 저장: 작성 내용을 임시 저장(미발송 draft) — 나중에 불러와 이어쓰기/발송
 *   - PDF 미리보기: 인쇄·PDF (문서허브와 동일하게 window.print)
 *   - 발송: 저장 후 손님 작성·서명 링크(/rental-sign.html?t=token) 생성·복사
 *   - 목록: 작성중(draft) / 발송됨(sent) / 서명완료(signed) 구분 열람·불러오기
 *
 *  저장소: contract_sign/{token} 에 status 필드로 라이프사이클 관리.
 *  showPage('send') → window.renderSend() 로 호출 (index.html).
 */

import { store } from '../core/store.js';
import { providerNameByCode } from '../core/ui-helpers.js';

let built = false;
let currentToken = null;     // 편집 중인 저장본 토큰 (없으면 저장 시 신규 발급)
let currentCode = null;      // 안정적 계약코드 (재저장 시 유지)
let currentCreatedAt = null; // 최초 저장 시각 (재저장 시 보존)
let listTab = 'draft';       // 목록 활성 탭
let listRows = [];           // 마지막으로 불러온 목록 (행 클릭 조회용)

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/* 가격 → 천단위 콤마 문자열 ("3,200만"·"32000000" 등 혼재 입력에서 숫자만 추출, 없으면 '') */
function priceText(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^\d.]/g, ''));
  return n ? n.toLocaleString() : '';
}

/* 계약서의 Contract.loader(code) 가 호출 → setData 로 자동 채움.
   입력값(code)으로 ① 차량번호 → 매물, ② 계약코드 → 계약(+그 차량 매물) 검색. */
function buildFromCode(code) {
  const v = String(code || '').trim();
  if (!v) return null;
  // ① 차량번호로 매물 검색
  let p = (store.products || []).find(x => !x._deleted && String(x.car_number || '').trim() === v);
  if (p) return buildFromProduct(p);
  // ② 계약코드로 계약 검색 → 그 차량번호로 매물 + 계약 스냅샷 overlay
  const c = (store.contracts || []).find(x => !x._deleted && (x.contract_code === v || x._key === v));
  if (c) {
    const cn = String(c.car_number_snapshot || c.car_number || '').trim();
    p = (store.products || []).find(x => !x._deleted && String(x.car_number || '').trim() === cn);
    const base = p ? buildFromProduct(p) : {};
    return {
      ...base,
      contract_code: c.contract_code || v,
      car_number: cn || base.car_number || '',
      vehicle_name: c.vehicle_name_snapshot || base.vehicle_name || '',
      customer_name: c.customer_name || '',
      customer_phone: c.customer_phone || '',
      rent_amount: c.rent_amount_snapshot ? Number(c.rent_amount_snapshot).toLocaleString() : (base.rent_amount || ''),
      deposit_amount: c.deposit_amount_snapshot ? Number(c.deposit_amount_snapshot).toLocaleString() : '',
      rent_month: c.rent_month_snapshot ? `${c.rent_month_snapshot} 개월` : '',
      contract_start: c.contract_date || '',
    };
  }
  try { import('../core/toast.js').then(m => m.showToast('해당 차량번호·계약코드를 찾을 수 없습니다', 'error')); } catch (_) {}
  return null;
}

/* 매물(product) → 정책(policy) → 계약서 data 매핑 */
function buildFromProduct(p) {
  const pol = (store.policies || []).find(t => (t.policy_code || t._key) === p.policy_code) || {};

  // 회사 ↔ 공급사 연동: 손오공/스위치는 내장 프리셋(로고·직인), 그 외 등록 공급사는 'auto'+법인정보 주입
  const provCode = p.provider_company_code || p.partner_code;
  const provName = providerNameByCode(provCode, store) || '';
  let co = 'sonogong', companyInject = {};
  if (/손오공/.test(provName)) co = 'sonogong';
  else if (/스위치/.test(provName)) co = 'switchplan';
  else {
    const partner = (store.partners || []).find(x => !x._deleted && (x.partner_code === provCode || x.company_code === provCode));
    if (partner) {
      co = 'auto';
      companyInject = {
        company_name: partner.partner_name || partner.company_name || provName || '',
        company_ceo: partner.ceo_name || '',
        company_ceo_title: '대표',
        company_biz_no: partner.business_number || '',
        payment_bank: partner.bank_name || '',
        payment_account_no: partner.bank_account || '',
        payment_account_holder: partner.bank_holder || partner.partner_name || partner.company_name || '',
      };
    }
  }
  // 보험 포함/별도(개인보험)
  const ins = /별도|개인/.test(pol.insurance_included || '') ? '별도' : '포함';
  // 차량 풀네임
  const vehicle_name = [p.maker, p.model, p.sub_model, p.variant, p.trim_name || p.trim]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const yr = String(p.model_year || '').trim();

  return {
    // 계약구성 셀렉트 (state 키) + 회사(공급사) 법인정보
    co, ins,
    ...companyInject,
    // 차량 (매물)
    car_number: p.car_number || '',
    vehicle_name,
    fuel: p.fuel_type || p.fuel || '',
    model_year: yr ? (/년식/.test(yr) ? yr : yr + '년식') : '',
    options: Array.isArray(p.options) ? p.options.join(', ') : (p.options || ''),
    vehicle_price: priceText(p.price),
    // 약정·정책 (정책)
    driver_age: pol.basic_driver_age || '',
    annual_mileage: pol.annual_mileage || '',
    maintenance_product: pol.maintenance_service || '',
    deposit_installment: pol.deposit_installment || '',
    // 보험 담보 (정책) — 한도
    coverage_liability_person: pol.injury_compensation_limit || '',
    coverage_liability_property: pol.property_compensation_limit || '',
    coverage_self_injury: pol.self_body_accident || '',
    coverage_uninsured: pol.uninsured_damage || '',
    self_damage_coverage: pol.own_damage_compensation || '',
    emergency_dispatch_limit: pol.annual_roadside_assistance || '',
    // 보험 면책 (정책)
    deductible_liability_person: pol.injury_deductible || '',
    deductible_liability_property: pol.property_deductible || '',
    self_damage_deductible_rate: pol.own_damage_repair_ratio || '',
    self_damage_deductible_min: pol.own_damage_min_deductible || '',
    self_damage_deductible_max: pol.own_damage_max_deductible || '',
  };
}

export function renderSend() {
  const host = document.querySelector('.pt-page[data-page="send"]');
  if (!host) return;
  if (built) { refreshListIfOpen(); return; } // 이미 렌더됨 — iframe 유지(작성 중 내용 보존)
  built = true;

  host.innerHTML = `
    <div class="rsend-root" style="display:flex;flex-direction:column;height:100%;min-height:0;position:relative;">
      <div class="rsend-bar" style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--bg-card);flex:0 0 auto;position:relative;z-index:5;flex-wrap:wrap;">
        <i class="ph ph-magnifying-glass" style="color:var(--text-muted);font-size:16px;"></i>
        <div style="position:relative;flex:1 1 260px;min-width:200px;max-width:460px;">
          <input class="input" id="rsSearch" type="text" autocomplete="off"
                 placeholder="계약·재고 검색 → 차량·정책 자동 입력 (계약코드·차량번호·차명·고객명)" style="width:100%;">
          <div id="rsResults" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;z-index:60;background:var(--bg-card);border:1px solid var(--border-strong);border-radius:var(--radius-sm);box-shadow:0 10px 28px rgba(0,0,0,.16);max-height:340px;overflow:auto;"></div>
        </div>
        <span style="flex:1;"></span>
        <button class="btn btn-outline" id="rsNew" title="빈 계약서로 새로 시작"><i class="ph ph-file-plus"></i> 신규</button>
        <button class="btn btn-outline" id="rsSave" title="작성 내용을 임시 저장 (미발송)"><i class="ph ph-floppy-disk"></i> 저장</button>
        <button class="btn btn-outline" id="rsPdf" title="인쇄 · PDF 저장 (미리보기)"><i class="ph ph-file-pdf"></i> PDF 미리보기</button>
        <button class="btn btn-outline" id="rsList" title="작성·발송한 계약서 목록"><i class="ph ph-list-bullets"></i> 목록</button>
        <button class="btn btn-primary" id="rsSend"><i class="ph ph-paper-plane-tilt"></i> 발송 (서명링크)</button>
      </div>
      <div style="flex:1;min-height:0;overflow:hidden;background:#eef1f5;position:relative;z-index:0;">
        <iframe id="rsIframe"
                src="/contract-template/rental-contract.html"
                title="렌터카 계약서"
                style="width:100%;height:100%;border:0;display:block;background:#eef1f5;"></iframe>
      </div>
      <div id="rsListPanel" style="display:none;flex-direction:column;position:absolute;top:0;right:0;bottom:0;width:400px;max-width:92%;background:var(--bg-card);border-left:1px solid var(--border-strong);box-shadow:-8px 0 24px rgba(0,0,0,.12);z-index:20;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);flex:0 0 auto;">
          <strong>계약서 목록</strong>
          <button class="btn btn-outline btn-sm" id="rsListClose" title="닫기"><i class="ph ph-x"></i></button>
        </div>
        <div id="rsTabs" style="display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--border);flex:0 0 auto;">
          <button class="btn btn-sm" data-tab="draft">작성중</button>
          <button class="btn btn-sm" data-tab="sent">발송됨</button>
          <button class="btn btn-sm" data-tab="pending_review">검토대기</button>
          <button class="btn btn-sm" data-tab="signed">서명완료</button>
        </div>
        <div id="rsListBody" style="flex:1;min-height:0;overflow:auto;"></div>
      </div>
    </div>
  `;

  const iframe = host.querySelector('#rsIframe');

  // iframe 로드 시: 계약서 자체 헤더 전체 숨김(초기화·인쇄PDF·허브 → ERP 툴바로 통합) + loader 연결
  iframe.addEventListener('load', () => {
    try {
      iframe.contentDocument.head.insertAdjacentHTML('beforeend', '<style>.bd-head{display:none!important}.bd-load{display:none!important}</style>');
      const C = iframe.contentWindow.Contract;
      if (C) C.loader = (code) => buildFromCode(code);
      injectFieldAutocomplete(iframe.contentDocument, iframe.contentWindow); // 폼 칸에서 입력 중 자동완성
    } catch (_) { /* cross-origin 등 무시 */ }
  });

  // ── 툴바 버튼 (상단바엔 '계약발송' 제목만, 액션은 본문 바에 — 문서허브 형태) ──
  host.querySelector('#rsNew')?.addEventListener('click', newContract);
  host.querySelector('#rsSave')?.addEventListener('click', () => saveDraft());
  host.querySelector('#rsPdf')?.addEventListener('click', previewPdf);
  host.querySelector('#rsSend')?.addEventListener('click', sendForSign);
  host.querySelector('#rsList')?.addEventListener('click', toggleList);
  host.querySelector('#rsListClose')?.addEventListener('click', () => closeList());

  // 목록 탭 + 행 액션 (이벤트 위임)
  host.querySelector('#rsTabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    listTab = b.dataset.tab; renderList();
  });
  host.querySelector('#rsListBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-key]'); if (!btn) return;
    const r = listRows.find(x => x._key === btn.dataset.key); if (!r) return;
    if (btn.classList.contains('rs-load')) loadEntry(r);
    else if (btn.classList.contains('rs-copy')) copyLink(r._key);
    else if (btn.classList.contains('rs-del')) deleteEntry(r);
    else if (btn.classList.contains('rs-approve')) approveEntry(r);
  });

  // ── 상단 검색 자동완성 — 계약(진행중)·재고(상품) → 선택 시 자동 채움(=그 차량의 새 계약) ──
  const search = host.querySelector('#rsSearch');
  const results = host.querySelector('#rsResults');
  const applyData = (data) => {
    if (!data) return;
    try { const C = iframe.contentWindow.Contract; if (C && C.setData) C.setData(data); } catch (_) {}
    // 검색으로 차량 선택 = 그 차량의 새 계약 → 저장본 연결 해제
    currentToken = null; currentCode = null; currentCreatedAt = null;
  };
  const renderResults = (q) => {
    const hits = searchHits(q);
    if (!hits.length) { results.style.display = 'none'; results.innerHTML = ''; return; }
    results.innerHTML = hits.map((h, i) => `
      <div class="rs-hit" data-i="${i}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:var(--font-size);display:flex;gap:8px;align-items:center;">
        <span class="badge ${h.type === '계약' ? 'badge-blue' : 'badge-green'}" style="flex:0 0 auto;">${h.type}</span>
        <span style="font-weight:600;white-space:nowrap;">${esc(h.cn)}</span>
        <span style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(h.sub)}</span>
      </div>`).join('');
    results.style.display = 'block';
    results.querySelectorAll('.rs-hit').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const h = hits[+el.dataset.i];
        applyData(h.loader());
        search.value = `${h.cn} · ${h.sub}`.trim();
        results.style.display = 'none';
      });
    });
  };
  search.addEventListener('input', () => renderResults(search.value));
  search.addEventListener('focus', () => renderResults(search.value));
  search.addEventListener('blur', () => setTimeout(() => { results.style.display = 'none'; }, 160));
}

/* 검색 — 진행중 계약 + 재고(상품) 에서 계약코드·차량번호·차명·고객명 매칭 */
function searchHits(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  (store.contracts || []).filter(c => !c._deleted).forEach(c => {
    const cn = c.car_number_snapshot || c.car_number || '';
    const name = c.vehicle_name_snapshot || '';
    const hay = [c.contract_code, c.customer_name, cn, name].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) out.push({ type: '계약', cn: c.contract_code || cn, sub: `${c.customer_name || ''} ${name || cn}`.trim(), loader: () => buildFromCode(c.contract_code || cn) });
  });
  (store.products || []).filter(p => !p._deleted && String(p.car_number || '').trim()).forEach(p => {
    const name = [p.maker, p.model, p.sub_model, p.trim_name || p.trim].filter(Boolean).join(' ');
    const hay = [p.car_number, name].join(' ').toLowerCase();
    if (hay.includes(q)) out.push({ type: '재고', cn: String(p.car_number).trim(), sub: name, loader: () => buildFromProduct(p) });
  });
  return out.slice(0, 25);
}

/* 계약(c) → 차량 스펙(매물) + 고객 필드 매핑 (계약자명/연락처 검색 결과 적용용) */
function buildFromContract(c) {
  const cn = String(c.car_number_snapshot || c.car_number || '').trim();
  const p = (store.products || []).find(x => !x._deleted && String(x.car_number || '').trim() === cn);
  const base = p ? buildFromProduct(p) : {};
  return {
    ...base,
    contract_code: c.contract_code || '',
    car_number: cn || base.car_number || '',
    vehicle_name: c.vehicle_name_snapshot || base.vehicle_name || '',
    customer_name: c.customer_name || '',
    customer_phone: c.customer_phone || '',
    rent_amount: c.rent_amount_snapshot ? Number(c.rent_amount_snapshot).toLocaleString() : (base.rent_amount || ''),
    deposit_amount: c.deposit_amount_snapshot ? Number(c.deposit_amount_snapshot).toLocaleString() : '',
    rent_month: c.rent_month_snapshot ? `${c.rent_month_snapshot} 개월` : '',
  };
}

/* 차량 후보 — 재고(상품)에서 차량번호·차명·VIN 매칭 → 선택 시 차량·정책 자동 입력 */
function searchCarCandidates(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  (store.products || []).filter(p => !p._deleted && String(p.car_number || '').trim()).forEach(p => {
    const name = [p.maker, p.model, p.sub_model, p.trim_name || p.trim].filter(Boolean).join(' ');
    const hay = [p.car_number, name, p.vin].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) out.push({ title: String(p.car_number).trim(), sub: name, data: () => buildFromProduct(p) });
  });
  return out.slice(0, 20);
}

/* 고객 후보 — 진행중 계약에서 계약자명·연락처·계약코드 매칭 → 선택 시 차량+고객 자동 입력 */
function searchCustomerCandidates(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  (store.contracts || []).filter(c => !c._deleted && (c.customer_name || c.customer_phone)).forEach(c => {
    const hay = [c.customer_name, c.customer_phone, c.contract_code].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) out.push({
      title: c.customer_name || '(이름없음)',
      sub: [c.customer_phone, c.car_number_snapshot, c.vehicle_name_snapshot].filter(Boolean).join(' · '),
      data: () => buildFromContract(c),
    });
  });
  return out.slice(0, 20);
}

/* 계약서 폼(iframe) 입력 칸에서 입력 중 자동완성 — same-origin 직접 주입.
   차량번호·차대번호 → 재고 검색 / 계약자명·주민번호·연락처 → 고객(계약) 검색.
   (VIN·주민번호는 ERP 미저장 → 데이터 생기면 자동 작동) */
const CAR_FIELDS = new Set(['car_number', 'vin']);
const CUST_FIELDS = new Set(['customer_name', 'customer_id', 'customer_phone']);
function injectFieldAutocomplete(idoc, iwin) {
  let box = idoc.getElementById('rsFieldAC');
  if (!box) {
    box = idoc.createElement('div');
    box.id = 'rsFieldAC';
    box.style.cssText = 'position:absolute;z-index:99999;display:none;background:#fff;border:1px solid #c9d2dd;border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.18);max-height:300px;overflow:auto;font-size:13px;';
    idoc.body.appendChild(box);
  }
  let current = [];
  const hide = () => { box.style.display = 'none'; current = []; };
  const fieldHits = (inp) => {
    const k = inp.getAttribute('data-k');
    if (CAR_FIELDS.has(k)) return searchCarCandidates(inp.value);
    if (CUST_FIELDS.has(k)) return searchCustomerCandidates(inp.value);
    return [];
  };
  const open = (inp) => {
    const hits = fieldHits(inp);
    if (!hits.length) { hide(); return; }
    current = hits;
    box.innerHTML = hits.map((h, i) => `<div data-i="${i}" style="padding:7px 11px;cursor:pointer;border-bottom:1px solid #eef1f5;white-space:nowrap;">
      <b>${esc(h.title)}</b>${h.sub ? ` <span style="color:#7a8694;">${esc(h.sub)}</span>` : ''}</div>`).join('');
    const r = inp.getBoundingClientRect();
    const sx = iwin.scrollX || idoc.documentElement.scrollLeft || 0;
    const sy = iwin.scrollY || idoc.documentElement.scrollTop || 0;
    box.style.left = (r.left + sx) + 'px';
    box.style.top = (r.bottom + sy + 2) + 'px';
    box.style.minWidth = r.width + 'px';
    box.style.display = 'block';
  };
  const isTarget = (t) => t && t.closest && t.closest('#bdGroups input[data-k]');
  idoc.addEventListener('input', (e) => { const inp = isTarget(e.target); if (inp) open(inp); }, true);
  idoc.addEventListener('focusin', (e) => { const inp = isTarget(e.target); if (inp && inp.value.trim()) open(inp); });
  box.addEventListener('mousedown', (e) => {
    const row = e.target.closest('[data-i]'); if (!row) return;
    e.preventDefault();
    const h = current[+row.dataset.i];
    if (h) {
      try { const C = iwin.Contract; if (C && C.setData) C.setData(h.data()); } catch (_) {}
      currentToken = null; currentCode = null; currentCreatedAt = null; // 자동완성 선택 = 새 계약
    }
    hide();
  });
  idoc.addEventListener('scroll', hide, true);
  idoc.addEventListener('click', (e) => { if (!box.contains(e.target) && !isTarget(e.target)) hide(); });
}

/* 계약서 현재 상태 스냅샷 — data-field 전부 + 계약구성 셀렉트(co/pd/ins/ct/car) */
function collectSnapshot(doc) {
  const snap = {};
  doc.querySelectorAll('[data-field]').forEach(n => {
    const k = n.getAttribute('data-field');
    if (k && !(k in snap)) snap[k] = n.textContent.trim();
  });
  ['co', 'pd', 'ins', 'ct', 'car'].forEach(k => {
    const sel = doc.getElementById('sel_' + k);
    if (sel) snap[k] = sel.value;
  });
  return snap;
}

/* 신규 = 빈 계약서로 시작 (계약서 내장 초기화 트리거 + 저장본 연결 해제) */
function newContract() {
  try { document.getElementById('rsIframe')?.contentDocument?.querySelector('.bd-reset')?.click(); } catch (_) {}
  currentToken = null; currentCode = null; currentCreatedAt = null;
}

/* PDF 미리보기 = 인쇄·PDF (문서허브와 동일하게 window.print — @media print 가 빌더 숨김) */
function previewPdf() {
  const iframe = document.getElementById('rsIframe');
  try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (_) {}
}

/* 저장 = 작성 내용을 contract_sign/{token} 에 저장. status='draft'(임시) 또는 'sent'(발송).
   반환: 성공 시 token, 실패 시 null. */
async function saveDraft(opts = {}) {
  const { showToast } = await import('../core/toast.js');
  const status = opts.status || 'draft';
  const doc = document.getElementById('rsIframe')?.contentDocument;
  if (!doc) { showToast('계약서가 아직 로드되지 않았습니다', 'error'); return null; }
  const fld = (k) => doc.querySelector(`[data-field="${k}"]`)?.textContent?.trim() || '';
  const contract_data = collectSnapshot(doc);

  if (!currentToken) currentToken = 'sign_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  if (!currentCreatedAt) currentCreatedAt = Date.now();
  if (!currentCode) currentCode = fld('contract_code') || ('RENT-' + Date.now().toString(36).toUpperCase());

  try {
    const { setRecord } = await import('../firebase/db.js');
    await setRecord(`contract_sign/${currentToken}`, {
      contract_code: currentCode,
      template: 'rental',
      company_name: fld('company_name'),
      car_number: fld('car_number'),
      model_name: fld('vehicle_name'),
      customer_name: fld('customer_name') || '',
      contract_data,
      status,
      created_at: currentCreatedAt,
      expires_at: currentCreatedAt + 30 * 86400 * 1000,
    });
    // 로컬스토리지에 토큰 캐싱 (목록 조회 폴백용 — DB 규칙 미배포 시 개별 조회)
    try {
      const cached = JSON.parse(localStorage.getItem('rs_sign_tokens') || '[]');
      if (!cached.includes(currentToken)) {
        cached.push(currentToken);
        localStorage.setItem('rs_sign_tokens', JSON.stringify(cached));
      }
    } catch (_) {}
    // 계약 레코드에 sign_token 색인 저장 (목록 조회 폴백용)
    const linkedContract = (store.contracts || []).find(c => !c._deleted && c.contract_code === currentCode);
    if (linkedContract?._key) {
      const { updateRecord } = await import('../firebase/db.js');
      updateRecord(`contracts/${linkedContract._key}`, {
        sign_token: currentToken,
        sign_status: status,
        sign_updated_at: Date.now(),
      }).catch(() => null);
    }

    if (!opts.silentToast) showToast(status === 'sent' ? '발송 저장 완료' : '임시 저장됨 (목록에서 이어쓰기 가능)');
    refreshListIfOpen();
    return currentToken;
  } catch (e) {
    console.error('[rental-send] save', e);
    showToast('저장 실패: ' + (e?.message || e), 'error');
    return null;
  }
}

/* 발송 = 저장(status=sent) 후 손님 작성·서명 링크 생성·복사 */
async function sendForSign() {
  const { showToast } = await import('../core/toast.js');
  const doc = document.getElementById('rsIframe')?.contentDocument;
  if (!doc) { showToast('계약서가 아직 로드되지 않았습니다', 'error'); return; }
  const car = doc.querySelector('[data-field="car_number"]')?.textContent?.trim() || '';
  if ((!car || car === '00가0000') && !confirm('차량번호가 비어 있습니다. 빈 계약서로 발송할까요?')) return;

  const btn = document.getElementById('rsSend');
  const original = btn.innerHTML;
  btn.innerHTML = '<i class="ph ph-spinner"></i> 저장중...';
  btn.disabled = true;
  try {
    const token = await saveDraft({ status: 'sent', silentToast: true });
    if (!token) return;
    const link = `${location.origin}/rental-sign.html?t=${token}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    showToast('손님 작성·서명 링크 복사됨 — 고객에게 전달하세요');
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

/* ── 목록 (작성중 / 발송됨 / 서명완료) ── */
function toggleList() {
  const panel = document.getElementById('rsListPanel');
  if (!panel) return;
  if (panel.style.display === 'flex') { closeList(); return; }
  panel.style.display = 'flex';
  renderList();
}
function closeList() {
  const panel = document.getElementById('rsListPanel');
  if (panel) panel.style.display = 'none';
}
function refreshListIfOpen() {
  const panel = document.getElementById('rsListPanel');
  if (panel && panel.style.display === 'flex') renderList();
}

async function renderList() {
  // 탭 활성 표시
  document.querySelectorAll('#rsTabs [data-tab]').forEach(b => {
    const on = b.dataset.tab === listTab;
    b.classList.toggle('btn-primary', on);
    b.classList.toggle('btn-outline', !on);
  });
  const body = document.getElementById('rsListBody');
  if (!body) return;
  body.innerHTML = '<div style="padding:18px;color:var(--text-muted);">불러오는 중…</div>';
  try {
    let all = [];
    try {
      const { fetchCollection } = await import('../firebase/db.js');
      all = await fetchCollection('contract_sign');
    } catch (_permErr) {
      // DB 규칙 미배포 시 폴백: 로컬스토리지 캐시 + contracts 색인 sign_token으로 개별 조회
      const { fetchRecord } = await import('../firebase/db.js');
      let localTokens = [];
      try { localTokens = JSON.parse(localStorage.getItem('rs_sign_tokens') || '[]'); } catch (_) {}
      const contractTokens = (store.contracts || []).filter(c => !c._deleted && c.sign_token).map(c => c.sign_token);
      const tokens = [...new Set([...localTokens, ...contractTokens])];
      all = (await Promise.all(
        tokens.map(t => fetchRecord(`contract_sign/${t}`).then(r => r ? { ...r, _key: t } : null).catch(() => null)),
      )).filter(Boolean);
    }
    listRows = all.filter(r => !r._deleted && (r.template || 'rental') === 'rental' && (r.status || 'draft') === listTab);
    if (!listRows.length) {
      const labels = { draft: '작성중인', sent: '발송한', pending_review: '검토 대기중인', signed: '서명완료된' };
      body.innerHTML = `<div style="padding:28px 16px;text-align:center;color:var(--text-muted);">${labels[listTab]} 계약서가 없습니다</div>`;
      return;
    }
    body.innerHTML = listRows.map(rowHtml).join('');
  } catch (e) {
    console.error('[rental-send] list', e);
    body.innerHTML = `<div style="padding:18px;color:var(--alert-red-text);">목록 조회 실패: ${esc(e?.message || e)}</div>`;
  }
}

function rowHtml(r) {
  const st = r.status || 'draft';
  const badge = st === 'signed' ? '<span class="badge badge-green">서명완료</span>'
    : st === 'pending_review' ? '<span class="badge badge-orange">검토대기</span>'
    : st === 'sent' ? '<span class="badge badge-blue">발송됨</span>'
      : '<span class="badge badge-gray">작성중</span>';
  const title = r.model_name || r.contract_data?.vehicle_name || '(차량 미선택)';
  const sub = [r.car_number, r.customer_name].filter(Boolean).join(' · ') || '—';
  const showCopy = st !== 'draft';
  const showApprove = st === 'pending_review';
  const photos = st === 'pending_review' ? `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      ${r.license_photo ? `<div style="flex:1;"><div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">면허증</div><img src="${r.license_photo}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;border:1px solid var(--border);"></div>` : ''}
      ${r.face_photo ? `<div style="flex:1;"><div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">얼굴확인</div><img src="${r.face_photo}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;border:1px solid var(--border);"></div>` : ''}
    </div>` : '';
  return `<div class="rs-row" style="padding:10px 14px;border-bottom:1px solid var(--border);">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">${badge}
      <strong style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(title)}</strong></div>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:7px;">${esc(sub)} · ${fmtDate(r.created_at)}</div>
    ${photos}
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-sm btn-outline rs-load" data-key="${esc(r._key)}"><i class="ph ph-arrow-square-in"></i> 불러오기</button>
      ${showCopy ? `<button class="btn btn-sm btn-outline rs-copy" data-key="${esc(r._key)}"><i class="ph ph-link"></i> 링크복사</button>` : ''}
      ${showApprove ? `<button class="btn btn-sm btn-primary rs-approve" data-key="${esc(r._key)}"><i class="ph ph-check-circle"></i> 승인</button>` : ''}
      <button class="btn btn-sm btn-outline rs-del" data-key="${esc(r._key)}" style="margin-left:auto;color:var(--alert-red-text);">삭제</button>
    </div>
  </div>`;
}

/* 저장본 불러오기 → 계약서에 주입 + 편집 연결 */
function loadEntry(r) {
  try {
    const C = document.getElementById('rsIframe')?.contentWindow?.Contract;
    if (C && C.setData) C.setData(r.contract_data || {});
    // 서명완료 건이면 손님 서명을 모든 슬롯에 일괄 표시 (계약서·약관·부속서류)
    if (C && C.applySignature && r.signature_png) C.applySignature('customer', r.signature_png);
  } catch (_) {}
  currentToken = r._key;
  currentCode = r.contract_code || null;
  currentCreatedAt = r.created_at || null;
  closeList();
  import('../core/toast.js').then(m => m.showToast('계약서를 불러왔습니다 — 이어서 작성·발송하세요'));
}

function copyLink(key) {
  const link = `${location.origin}/rental-sign.html?t=${key}`;
  navigator.clipboard.writeText(link).catch(() => {});
  import('../core/toast.js').then(m => m.showToast('서명 링크 복사됨'));
}

async function approveEntry(r) {
  if (!confirm(`${r.customer_name || '고객'}님의 면허증·얼굴 사진을 확인했습니까?\n승인하면 계약이 최종 완료 처리됩니다.`)) return;
  try {
    const { updateRecord } = await import('../firebase/db.js');
    await updateRecord(`contract_sign/${r._key}`, { status: 'signed', approved_at: Date.now() });
    if (r.contract_code) {
      const contract = (store.contracts || []).find(c => c.contract_code === r.contract_code);
      if (contract?._key) {
        updateRecord(`contracts/${contract._key}`, { contract_status: '계약완료', signed_at: Date.now() }).catch(() => null);
      }
    }
    import('../core/toast.js').then(m => m.showToast('승인 완료 — 서명완료로 처리됐습니다'));
    renderList();
  } catch (e) {
    console.error('[rental-send] approve', e);
    import('../core/toast.js').then(m => m.showToast('승인 실패: ' + (e?.message || e), 'error'));
  }
}

async function deleteEntry(r) {
  if (!confirm('이 계약서를 목록에서 삭제할까요?')) return;
  try {
    const { softDelete } = await import('../firebase/db.js');
    await softDelete(`contract_sign/${r._key}`);
    if (currentToken === r._key) { currentToken = null; currentCode = null; currentCreatedAt = null; }
    try {
      const cached = JSON.parse(localStorage.getItem('rs_sign_tokens') || '[]');
      localStorage.setItem('rs_sign_tokens', JSON.stringify(cached.filter(t => t !== r._key)));
    } catch (_) {}
    renderList();
  } catch (e) {
    console.error('[rental-send] delete', e);
    import('../core/toast.js').then(m => m.showToast('삭제 실패: ' + (e?.message || e), 'error'));
  }
}
