/**
 * 모바일 계약 관리
 * - 카드 목록 (진행률 표시)
 * - 탭 → 풀스크린 상세 (진행상황/상세/고객정보 탭)
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtWon } from '../core/format.js';
import { STEPS, getStepStates, getProgress } from '../core/contract-steps.js';
import { pushMobileView } from '../core/mobile-shell.js';

/** 운전 가능 연령 — 기본 연령 + 하향 연령 포맷 */
function formatDriverAge(pol) {
  if (!pol) return '';
  const base = Number(pol.basic_driver_age) || 0;
  const low = pol.driver_age_lowering;
  const lowNum = Number(low) || 0;
  if (base && lowNum && lowNum < base) return `만 ${base}세 이상 (만 ${lowNum}세 하향 가능)`;
  if (base) return `만 ${base}세 이상${low && typeof low === 'string' && low !== '없음' ? ` · 하향 ${low}` : ''}`;
  return typeof low === 'string' ? low : '';
}

/** 연간 주행거리 — 숫자면 km 단위 포맷 */
function formatAnnualMileage(v) {
  if (!v) return '';
  const n = Number(String(v).replace(/[^0-9]/g, ''));
  if (!n) return String(v);
  return `${n.toLocaleString()}km`;
}

/** 생년월일 정규화 — customer_birth(YYMMDD) 또는 customer_rrn 앞자리+성별코드 모두 지원 → YYYY.MM.DD */
function formatDob(contract) {
  // 1순위: customer_birth (폼에서 저장되는 필드, 6자리 YYMMDD)
  const b = String(contract.customer_birth || '').replace(/[^0-9]/g, '');
  if (b.length >= 6) {
    const yy = b.slice(0, 2);
    const mm = b.slice(2, 4);
    const dd = b.slice(4, 6);
    // YY < 30 이면 20YY, 아니면 19YY (일반적인 휴리스틱)
    const century = Number(yy) < 30 ? '20' : '19';
    return `${century}${yy}.${mm}.${dd}`;
  }
  // 2순위: customer_rrn (주민번호) — 성별코드로 세기 판정
  const r = String(contract.customer_rrn || '').replace(/[^0-9]/g, '');
  if (r.length >= 7) {
    const yy = r.slice(0, 2);
    const mm = r.slice(2, 4);
    const dd = r.slice(4, 6);
    const g = r[6];
    const century = (g === '1' || g === '2' || g === '5' || g === '6') ? '19'
                  : (g === '3' || g === '4' || g === '7' || g === '8') ? '20'
                  : '';
    if (century) return `${century}${yy}.${mm}.${dd}`;
    return `${yy}.${mm}.${dd}`;
  }
  return '';
}

/** 모바일 정보 행 — label + value, value 가 비면 '-' */
function iRow(label, value) {
  const v = value === 0 || value ? String(value) : '';
  const empty = !v;
  return `<div class="m-info-row">
    <span class="m-info-label">${label}</span>
    <span class="m-info-value ${empty ? 'is-empty' : ''}">${empty ? '-' : v}</span>
  </div>`;
}

/** 편집 가능 행 — label + input (blur 에 저장) */
function iRowEdit(label, field, value, opts = {}) {
  const v = value === 0 || value ? String(value) : '';
  const placeholder = opts.placeholder || '';
  const inputMode = opts.inputMode ? `inputmode="${opts.inputMode}"` : '';
  return `<div class="m-info-row-edit">
    <span class="m-info-label">${label}</span>
    <input class="m-info-input" data-ct-customer="${field}" ${inputMode}
           value="${v.replace(/"/g, '&quot;')}" placeholder="${placeholder}">
    <span class="m-state" data-state="${field}"></span>
  </div>`;
}
/** 모바일 정보 섹션 */
function iSection(title, rowsHtml, actionHtml = '') {
  return `<section class="m-info-section">
    <div class="m-info-section-head">
      <span class="m-info-section-title">${title}</span>
      ${actionHtml}
    </div>
    <div class="m-info-body">${rowsHtml}</div>
  </section>`;
}

let unsub = null;
let activeView = null;

export function mount() {
  cleanup();
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="m-shell-page">
      <div class="m-search-head">
        <div class="m-search-bar">
          <i class="ph ph-magnifying-glass"></i>
          <input type="search" id="mctSearch" placeholder="계약코드, 고객명, 차량번호"
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                 enterkeyhint="search">
          <span class="m-search-count" id="mctCount"></span>
          <button class="m-topbar-action" id="mctSearchClear" style="display:none;" aria-label="지우기"><i class="ph ph-x-circle"></i></button>
        </div>
        <div class="m-filter-chips">
          <button class="chip is-active" data-f="all">전체</button>
          <button class="chip" data-f="active">진행중</button>
          <button class="chip" data-f="done">완료</button>
        </div>
      </div>
      <div class="m-page" id="mctList"></div>
    </div>
  `;

  const mctSearchEl = document.getElementById('mctSearch');
  const mctSearchClearEl = document.getElementById('mctSearchClear');
  mctSearchEl?.addEventListener('input', () => {
    if (mctSearchClearEl) mctSearchClearEl.style.display = mctSearchEl.value ? '' : 'none';
    renderList();
  });
  mctSearchClearEl?.addEventListener('click', () => {
    mctSearchEl.value = '';
    mctSearchClearEl.style.display = 'none';
    renderList();
  });
  main.querySelectorAll('.chip[data-f]').forEach(chip => {
    chip.addEventListener('click', () => {
      main.querySelectorAll('.chip[data-f]').forEach(x => x.classList.remove('is-active'));
      chip.classList.add('is-active');
      renderList();
    });
  });

  document.getElementById('mctList').addEventListener('click', (e) => {
    const card = e.target.closest('[data-code]');
    if (card) openContract(card.dataset.code);
  });

  unsub = watchCollection('contracts', (data) => {
    store.contracts = data;
    renderList();
  });
}

function getVisible() {
  const me = store.currentUser || {};
  let list = [...(store.contracts || [])];
  if (me.role === 'agent') list = list.filter(c => c.agent_uid === me.uid || c.agent_code === me.user_code);
  else if (me.role === 'agent_admin') list = list.filter(c => c.agent_channel_code === (me.agent_channel_code || me.channel_code));
  else if (me.role === 'provider') list = list.filter(c => c.provider_uid === me.uid || c.provider_company_code === me.company_code);
  return list;
}

function renderList() {
  const el = document.getElementById('mctList');
  if (!el) return;
  const q = (document.getElementById('mctSearch')?.value || '').toLowerCase();
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || 'all';

  let list = getVisible();
  if (f === 'active') list = list.filter(c => c.contract_status !== '계약완료' && c.contract_status !== '계약취소');
  else if (f === 'done') list = list.filter(c => c.contract_status === '계약완료');
  if (q) {
    const qDigits = q.replace(/\D/g, '');
    list = list.filter(c => {
      const fields = [
        c.contract_code, c.customer_name, c.customer_birth, c.delivery_region,
        c.car_number_snapshot, c.model_snapshot, c.sub_model_snapshot, c.maker_snapshot,
        c.agent_code, c.provider_company_code, c.contract_status,
      ];
      if (fields.some(v => v && String(v).toLowerCase().includes(q))) return true;
      // 전화번호: 하이픈 무시하고 숫자만 매칭
      if (qDigits) {
        const phoneDigits = String(c.customer_phone || '').replace(/\D/g, '');
        if (phoneDigits && phoneDigits.includes(qDigits)) return true;
      }
      return false;
    });
  }
  list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  const countEl = document.getElementById('mctCount');
  if (countEl) countEl.textContent = list.length ? `${list.length}건` : '';

  if (!list.length) {
    el.innerHTML = `<div class="m-empty"><i class="ph ph-file-text"></i><p>계약 없음</p></div>`;
    return;
  }

  el.innerHTML = list.map(c => {
    const prog = getProgress(c);
    const pct = Math.round((prog.done / prog.total) * 100);
    const done = c.contract_status === '계약완료';
    const cancelled = c.contract_status === '계약취소';
    const tone = done ? 'ok' : cancelled ? 'err' : 'info';
    const icon = done ? 'ph-check-circle' : cancelled ? 'ph-x-circle' : 'ph-file-text';
    const avatarLabel = done ? '완료' : cancelled ? '취소' : '진행중';
    const fmtDate = c.contract_date || (c.created_at ? new Date(c.created_at).toLocaleDateString('ko', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '');
    const titleLine = `${c.car_number_snapshot || ''} ${c.sub_model_snapshot || c.model_snapshot || ''}`.trim() || c.contract_code;
    // 2줄: 공급사 · 영업채널 · 영업자 · 계약코드
    const meta = [c.provider_company_code, c.agent_channel_code, c.agent_code, c.contract_code].filter(Boolean).join(' · ');
    // 3줄: [진행률 뱃지] 계약자명 · 생년월일 · 연락처
    const dob = formatDob(c);
    const customerLine = [
      c.customer_name ? `<b class="m-customer">${c.customer_name}</b>` : '',
      dob,
      c.customer_phone,
    ].filter(Boolean).join(' · ');
    const progressColor = prog.done === prog.total ? 'var(--c-ok)' : prog.done > 0 ? 'var(--c-info)' : 'var(--c-text-muted)';
    return `
      <article class="m-card-contract" data-code="${c.contract_code}">
        <div class="m-card-icon-wrap is-${tone}">
          <i class="ph ${icon}"></i>
          <span class="m-avatar-label">${avatarLabel}</span>
        </div>
        <div class="m-card-contract-body">
          <div class="m-room-item-top">
            <span class="m-room-item-name">${titleLine}</span>
            <span class="m-room-item-time">${fmtDate}</span>
          </div>
          <div class="m-room-item-msg">
            <span>${meta}</span>
          </div>
          <div class="m-room-item-sub">
            <span class="sb-badge is-visible" style="background:${progressColor};">${prog.done}/${prog.total}</span>
            ${customerLine ? `<span>${customerLine}</span>` : '<span></span>'}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function openContract(code) {
  const c = (store.contracts || []).find(x => x.contract_code === code);
  if (!c) return;

  const body = `
    <div class="m-ct-layout">
      <div class="m-tab-panels">
        <div class="m-tab-panel is-active" data-panel="progress">${renderProgressPanel(c)}</div>
        <div class="m-tab-panel" data-panel="customer">${renderCustomerPanel(c)}</div>
        <div class="m-tab-panel" data-panel="detail">${renderDetailPanel(c)}</div>
      </div>
      <nav class="m-tabs m-tabs-bottom">
        <button class="m-tab-btn is-active" data-tab="progress"><i class="ph ph-list-checks"></i><span>진행</span></button>
        <button class="m-tab-btn" data-tab="customer"><i class="ph ph-user"></i><span>고객</span></button>
        <button class="m-tab-btn" data-tab="detail"><i class="ph ph-info"></i><span>상세</span></button>
      </nav>
    </div>
  `;

  const title = [c.car_number_snapshot, c.sub_model_snapshot || c.model_snapshot]
    .filter(Boolean).join(' ') || c.contract_code;
  activeView = pushMobileView(body, {
    title,
    onMount: (view) => bindContractView(view, c),
    onClose: () => { activeView = null; },
  });
}

function bindContractView(view, c) {
  // 탭 전환
  view.querySelector('.m-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    view.querySelectorAll('.m-tab-btn').forEach(x => x.classList.remove('is-active'));
    btn.classList.add('is-active');
    view.querySelectorAll('.m-tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === btn.dataset.tab));
  });

  // 진행 스텝 토글
  view.querySelector('[data-panel="progress"]').addEventListener('click', async (e) => {
    const cell = e.target.closest('.ct-step-cell[data-clickable]');
    if (!cell) return;
    const key = cell.dataset.key;
    if (!key) return;
    const cur = c[key] === true || c[key] === 'yes';
    try {
      await updateRecord(`contracts/${c.contract_code}`, { [key]: !cur });
      c[key] = !cur;
      showToast(cur ? '해제' : '완료');
      const panel = view.querySelector('[data-panel="progress"]');
      panel.innerHTML = renderProgressPanel(c);
    } catch (err) {
      console.error('[contract.step]', err);
      showToast('저장 실패', 'error');
    }
  });

  // 드롭다운 선택
  view.querySelector('[data-panel="progress"]').addEventListener('change', async (e) => {
    const sel = e.target.closest('.ct-step-select');
    if (!sel) return;
    try {
      await updateRecord(`contracts/${c.contract_code}`, { [sel.dataset.key]: sel.value });
      c[sel.dataset.key] = sel.value;
      showToast(sel.value || '해제');
      const panel = view.querySelector('[data-panel="progress"]');
      panel.innerHTML = renderProgressPanel(c);
    } catch (err) {
      console.error('[contract.step-select]', err);
      showToast('저장 실패', 'error');
    }
  });

  // 기간 칩 선택 → rent_month 업데이트 + 상품 price 에서 대여료/보증금 자동 반영
  view.querySelector('[data-panel="progress"]').addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-ct-period]');
    if (!chip) return;
    const m = Number(chip.dataset.ctPeriod);
    // 상품 가격 조회 (contract 의 product_uid / seed_product_key 로)
    const productKey = c.product_uid || c.seed_product_key;
    const product = productKey ? (store.products || []).find(p => p._key === productKey || p.product_uid === productKey) : null;
    const price = product?.price?.[m] || {};
    const rent = Number(price.rent) || 0;
    const deposit = Number(price.deposit) || 0;
    const updates = { rent_month: m };
    if (rent) updates.rent_amount = rent;
    if (deposit) updates.deposit_amount = deposit;
    try {
      await updateRecord(`contracts/${c.contract_code}`, updates);
      Object.assign(c, updates);
      showToast(`${m}M${rent ? ` · ${rent.toLocaleString()}원` : ''}`);
      const panel = view.querySelector('[data-panel="progress"]');
      panel.innerHTML = renderProgressPanel(c);
    } catch (err) {
      console.error('[contract.period]', err);
      showToast('저장 실패', 'error');
    }
  });

  // 대여료 / 보증금 직접 수정 (blur 에 저장)
  // 경합 방지: dataset.saving 플래그로 저장 중 입력 처리 차단 + 저장 후 재포커스 상태면 value 덮어쓰지 않음
  view.querySelector('[data-panel="progress"]').addEventListener('focusout', async (e) => {
    const inp = e.target.closest('[data-ct-field]');
    if (!inp) return;
    if (inp.dataset.saving === '1') return; // 이미 저장 중
    const field = inp.dataset.ctField;
    const raw = String(inp.value || '').replace(/[^0-9]/g, '');
    const num = raw ? Number(raw) : 0;
    const prev = Number(c[field]) || 0;
    if (num === prev) return;
    const stateEl = view.querySelector(`[data-state="${field}"]`);
    inp.dataset.saving = '1';
    try {
      await updateRecord(`contracts/${c.contract_code}`, { [field]: num });
      c[field] = num;
      // 저장 완료 시점에 사용자가 다시 포커스 잡고 있으면 값 덮어쓰지 않음 (경합 방지)
      if (document.activeElement !== inp) {
        inp.value = num ? num.toLocaleString() : '';
      }
      if (stateEl) { stateEl.className = 'm-state is-saved'; stateEl.textContent = '저장'; setTimeout(() => { stateEl.className = 'm-state'; stateEl.textContent = ''; }, 1200); }
    } catch (err) {
      if (stateEl) { stateEl.className = 'm-state is-error'; stateEl.textContent = '실패'; }
      showToast('저장 실패', 'error');
    } finally {
      inp.dataset.saving = '';
    }
  });

  // 입력 중 숫자 외 문자 제거 + 천단위 콤마
  view.querySelector('[data-panel="progress"]').addEventListener('input', (e) => {
    const inp = e.target.closest('[data-ct-field]');
    if (!inp) return;
    if (inp.dataset.saving === '1') return; // 저장 중엔 덮어쓰지 않음
    const clean = String(inp.value || '').replace(/[^0-9]/g, '');
    inp.value = clean ? Number(clean).toLocaleString() : '';
    try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch {}
  });

  // 고객 패널 — 정보 편집 + 면허증 + 첨부서류
  const customerPanel = view.querySelector('[data-panel="customer"]');
  const refreshCustomer = () => { if (customerPanel) customerPanel.innerHTML = renderCustomerPanel(c); };

  customerPanel?.addEventListener('click', async (e) => {
    // 면허증 업로드 / 교체 버튼
    if (e.target.closest('#ctLicenseBtn')) {
      view.querySelector('#ctLicenseInput')?.click();
      return;
    }
    // 면허증 삭제
    if (e.target.closest('#ctLicenseDel')) {
      if (!confirm('운전면허증을 삭제하시겠습니까?')) return;
      try {
        await updateRecord(`contracts/${c.contract_code}`, { customer_license_url: '', customer_license_at: 0 });
        c.customer_license_url = '';
        c.customer_license_at = 0;
        refreshCustomer();
        showToast('면허증 삭제됨');
      } catch (err) {
        console.error('[contract.license-del]', err);
        showToast('삭제 실패', 'error');
      }
      return;
    }
    // 일반 첨부서류 추가
    if (e.target.closest('#ctDocAddBtn')) {
      view.querySelector('#ctDocInput')?.click();
      return;
    }
    // 첨부서류 개별 삭제
    const delBtn = e.target.closest('[data-doc-del]');
    if (delBtn) {
      if (!confirm('첨부 파일을 삭제하시겠습니까?')) return;
      const key = delBtn.dataset.docDel;
      try {
        await updateRecord(`contracts/${c.contract_code}/customer_docs/${key}`, { _deleted: true });
        c.customer_docs = c.customer_docs || {};
        if (c.customer_docs[key]) c.customer_docs[key]._deleted = true;
        refreshCustomer();
        showToast('삭제됨');
      } catch (err) {
        console.error('[contract.doc-del]', err);
        showToast('삭제 실패', 'error');
      }
    }
  });

  customerPanel?.addEventListener('change', async (e) => {
    // 면허증 파일 선택 시
    const licInput = e.target.closest('#ctLicenseInput');
    if (licInput) {
      const file = licInput.files?.[0];
      licInput.value = '';
      if (!file) return;
      try {
        const { uploadImage, uploadFile } = await import('../firebase/storage-helper.js');
        const safe = sanitizeFileName(file.name);
        const path = `chat-files/contract-${c.contract_code}/license_${Date.now()}_${safe}`;
        const isImage = (file.type || '').startsWith('image/');
        const { url } = isImage ? await uploadImage(path, file) : await uploadFile(path, file);
        const now = Date.now();
        await updateRecord(`contracts/${c.contract_code}`, { customer_license_url: url, customer_license_at: now });
        c.customer_license_url = url;
        c.customer_license_at = now;
        refreshCustomer();
        showToast('면허증 등록됨');
      } catch (err) {
        console.error('[ctLicense]', err);
        showToast(`면허증 업로드 실패: ${err?.code || err?.message || ''}`, 'error');
      }
      return;
    }
    // 일반 첨부서류 파일 선택
    const docInput = e.target.closest('#ctDocInput');
    if (docInput) {
      const files = Array.from(docInput.files || []);
      docInput.value = '';
      if (!files.length) return;
      await uploadCustomerDocs(c, files);
      const latest = (store.contracts || []).find(x => x.contract_code === c.contract_code);
      if (latest?.customer_docs) c.customer_docs = latest.customer_docs;
      refreshCustomer();
    }
  });

  // 고객 정보 필드 blur 자동 저장
  customerPanel?.addEventListener('focusout', async (e) => {
    const inp = e.target.closest('[data-ct-customer]');
    if (!inp) return;
    const field = inp.dataset.ctCustomer;
    const val = String(inp.value || '').trim();
    const prev = String(c[field] || '');
    if (val === prev) return;
    const stateEl = customerPanel.querySelector(`[data-state="${field}"]`);
    try {
      await updateRecord(`contracts/${c.contract_code}`, { [field]: val });
      c[field] = val;
      if (stateEl) {
        stateEl.className = 'm-state is-saved';
        stateEl.textContent = '저장';
        setTimeout(() => { stateEl.className = 'm-state'; stateEl.textContent = ''; }, 1200);
      }
    } catch (err) {
      if (stateEl) { stateEl.className = 'm-state is-error'; stateEl.textContent = '실패'; }
      showToast('저장 실패', 'error');
    }
  });
}

function renderProgressPanel(c) {
  const role = store.currentUser?.role || 'agent';
  const isAdmin = role === 'admin';
  const states = getStepStates(c);
  const prog = getProgress(c);

  // 기본 정보 (차량번호 / 기간 선택 / 대여료 / 보증금)
  const periods = [12, 24, 36, 48, 60];
  const curMonth = Number(c.rent_month) || 36;
  const periodChips = periods.map(m =>
    `<button class="chip chip-xs ${m === curMonth ? 'is-active' : ''}" data-ct-period="${m}">${m}M</button>`
  ).join('');
  const infoBlock = `
    <section class="m-info-section">
      <div class="m-info-section-head">
        <span class="m-info-section-title">계약 기본</span>
      </div>
      <div class="m-info-row">
        <span class="m-info-label">차량번호</span>
        <span class="m-info-value">${c.car_number_snapshot || '-'}</span>
      </div>
      <div class="m-info-row">
        <span class="m-info-label">대여기간</span>
        <span class="m-info-value" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${periodChips}</span>
      </div>
      <div class="m-info-row-split">
        <div class="m-info-row-edit">
          <span class="m-info-label">월대여료</span>
          <input class="m-info-input" data-ct-field="rent_amount" type="text" inputmode="numeric"
                 value="${c.rent_amount ? Number(c.rent_amount).toLocaleString() : ''}" placeholder="0">
          <span class="m-info-suffix">원</span>
        </div>
        <div class="m-info-row-edit">
          <span class="m-info-label">보증금</span>
          <input class="m-info-input" data-ct-field="deposit_amount" type="text" inputmode="numeric"
                 value="${c.deposit_amount ? Number(c.deposit_amount).toLocaleString() : ''}" placeholder="0">
          <span class="m-info-suffix">원</span>
        </div>
      </div>
    </section>
  `;

  const rows = STEPS.map(step => {
    const st = states[step.id];
    const agentKey = step.agent?.key;
    const respKey = step.provider?.key || step.admin?.key;
    const respRole = step.admin ? 'admin' : 'provider';
    const choices = step.provider?.choices || step.admin?.choices || null;
    const agentDone = agentKey ? (c[agentKey] === true || c[agentKey] === 'yes') : false;
    const respVal = respKey ? c[respKey] : null;
    const respDone = respVal === true || respVal === 'yes' || respVal === '출고 가능' || respVal === '출고 협의' || respVal === '서류 승인';
    const rejected = respVal === '출고 불가' || respVal === '서류 부결';
    const locked = st?.locked;
    const canClickAgent = isAdmin || (!locked && role === 'agent' && !agentDone);
    const canClickResp = isAdmin || (agentDone && !locked && role === respRole && !respDone && !rejected);

    const agentClass = locked ? 'is-locked' : agentDone ? 'is-done' : 'is-pending';
    const respClass = !agentDone && !isAdmin ? 'is-locked' : rejected ? 'is-rejected' : respDone ? 'is-done' : 'is-pending';

    return `
      <div class="ct-step-row">
        <div class="ct-step-cell ${agentClass}" data-key="${agentKey || ''}" ${canClickAgent && agentKey ? 'data-clickable' : ''}>
          <i class="ph ${agentDone ? 'ph-check-circle' : 'ph-circle'}"></i>
          <span>${step.agent?.label || ''}</span>
        </div>
        <div class="ct-step-arrow"><i class="ph ph-arrow-right"></i></div>
        <div class="ct-step-cell ${respClass}" data-key="${respKey || ''}" ${!choices && canClickResp && respKey ? 'data-clickable' : ''}>
          <i class="ph ${rejected ? 'ph-x-circle' : respDone ? 'ph-check-circle' : 'ph-circle'}"></i>
          ${choices && canClickResp ? `<select class="ct-step-select" data-key="${respKey}">
            <option value="">${step.provider?.label || step.admin?.label || ''}</option>
            ${choices.map(ch => `<option value="${ch}" ${respVal === ch ? 'selected' : ''}>${ch}</option>`).join('')}
          </select>` : `<span>${respDone && respVal && respVal !== 'yes' && respVal !== true ? respVal : rejected ? respVal : step.provider?.label || step.admin?.label || ''}</span>`}
        </div>
      </div>
    `;
  }).join('');

  const progressColor = prog.done === prog.total ? 'var(--c-ok)' : prog.done > 0 ? 'var(--c-info)' : 'var(--c-text-muted)';

  return `
    <div class="m-info-page">
      ${infoBlock}
      <section class="m-info-section">
        <div class="m-info-section-head">
          <span class="m-info-section-title">진행 단계</span>
          <span class="sb-badge is-visible" style="background:${progressColor};">${prog.done}/${prog.total}</span>
        </div>
        <div class="ct-steps" style="padding:var(--sp-3);">
          <div class="ct-step-row" style="font-size:var(--fs-2xs);color:var(--c-text-muted);">
            <div style="text-align:center;">영업자</div><div></div><div style="text-align:center;">공급사</div>
          </div>
          ${rows}
        </div>
      </section>
    </div>
  `;
}

function renderDetailPanel(c) {
  const rentAmt = c.rent_amount ? fmtWon(c.rent_amount) : '';
  const depAmt = c.deposit_amount ? fmtWon(c.deposit_amount) : '';
  const contractDeposit = c.contract_deposit ? fmtWon(c.contract_deposit) : '';
  const balance = c.balance_amount ? fmtWon(c.balance_amount) : '';
  const pol = c._policy || {};
  const prod = (store.products || []).find(p => p._key === c.product_uid || p.product_uid === c.product_uid || p._key === c.seed_product_key) || {};

  const signedUrl = c.signed_pdf_url || c.signed_pdf_data_url || '';
  const unsignedUrl = c.unsigned_pdf_url || '';
  const pdfBlock = (signedUrl || unsignedUrl) ? `
    <section class="m-info-section">
      <div class="m-info-section-head"><span class="m-info-section-title">계약서</span></div>
      ${signedUrl ? `
        <div class="m-info-row">
          <span class="m-info-label">서명 완료본</span>
          <a href="${signedUrl}" target="_blank" rel="noopener" class="m-info-value" style="color:var(--c-accent);"><i class="ph ph-file-pdf"></i> PDF 열기</a>
        </div>` : ''}
      ${unsignedUrl ? `
        <div class="m-info-row">
          <span class="m-info-label">서명 요청본</span>
          <a href="${unsignedUrl}" target="_blank" rel="noopener" class="m-info-value" style="color:var(--c-accent);"><i class="ph ph-file-pdf"></i> PDF 열기</a>
        </div>` : ''}
    </section>
  ` : '';

  return `
    <div class="m-info-page">
      ${iSection('계약 정보', `
        ${iRow('계약코드', c.contract_code)}
        ${iRow('계약상태', c.contract_status)}
        ${iRow('계약일', c.contract_date)}
        ${iRow('대여기간', c.rent_month ? c.rent_month + '개월' : '')}
        ${iRow('월대여료', rentAmt)}
        ${iRow('보증금', depAmt)}
        ${iRow('계약금', contractDeposit)}
        ${iRow('잔금',   balance)}
      `)}
      ${iSection('차량 스냅샷', `
        ${iRow('차량번호', c.car_number_snapshot)}
        ${iRow('세부모델', c.sub_model_snapshot || c.model_snapshot)}
        ${iRow('제조사',   c.maker_snapshot || prod.maker)}
        ${iRow('연식',     prod.year ? `${prod.year}년` : '')}
        ${iRow('주행거리', prod.mileage ? `${Number(prod.mileage).toLocaleString()}km` : '')}
        ${iRow('연료',     prod.fuel_type)}
        ${iRow('색상',     [prod.ext_color, prod.int_color].filter(Boolean).join(' / '))}
        ${iRow('공급사',   c.provider_company_code)}
      `)}
      ${iSection('계약 조건', `
        ${iRow('운전 가능 연령', formatDriverAge(pol))}
        ${iRow('심사 기준',      pol.credit_grade || pol.screening_criteria)}
        ${iRow('연간 주행거리',  formatAnnualMileage(pol.annual_mileage))}
        ${iRow('결제 방식',      pol.payment_method)}
      `)}
      ${iSection('영업자', `
        ${iRow('영업채널',   c.agent_channel_code)}
        ${iRow('영업자 코드', c.agent_code)}
      `)}
      ${pdfBlock}
    </div>
  `;
}

function renderCustomerPanel(c) {
  // 첨부서류 (일반)
  const docs = c.customer_docs || {};
  const docList = Object.entries(docs)
    .filter(([, v]) => v && !v._deleted)
    .sort((a, b) => (b[1].uploaded_at || 0) - (a[1].uploaded_at || 0));
  const docBody = docList.length
    ? `<div class="m-doc-list">
        ${docList.map(([key, d]) => {
          const isImg = (d.mime || '').startsWith('image/');
          return `<div class="m-doc-item" data-doc="${key}">
            <span class="m-doc-thumb">${isImg ? `<img src="${d.url}" alt="">` : `<i class="ph ph-file-text"></i>`}</span>
            <span class="m-doc-info">
              <a href="${d.url}" target="_blank" rel="noopener" class="m-doc-link">${(d.name || '파일').replace(/</g,'&lt;')}</a>
              <span class="m-doc-meta">${d.size ? `${Math.round(d.size/1024)}KB` : ''}${d.uploaded_at ? ` · ${new Date(d.uploaded_at).toLocaleDateString('ko', { month:'2-digit', day:'2-digit' })}` : ''}</span>
            </span>
            <button class="m-doc-del" data-doc-del="${key}" type="button" aria-label="삭제"><i class="ph ph-trash"></i></button>
          </div>`;
        }).join('')}
        <button class="m-doc-add-row" id="ctDocAddBtn" type="button"><i class="ph ph-plus"></i> 서류 추가</button>
      </div>`
    : `<button class="m-upload-dropzone" id="ctDocAddBtn" type="button">
        <i class="ph ph-paperclip"></i>
        <span class="m-upload-primary">첨부 서류 추가</span>
        <span class="m-upload-hint">신분증 · 인감 · 기타 (10MB 이하)</span>
      </button>`;

  // 면허증 (단일, customer_license_url)
  const licUrl = c.customer_license_url || '';
  const licBody = licUrl
    ? `<div class="m-doc-list">
        <div class="m-doc-item">
          <span class="m-doc-thumb"><img src="${licUrl}" alt="면허증"></span>
          <span class="m-doc-info">
            <a href="${licUrl}" target="_blank" rel="noopener" class="m-doc-link">면허증</a>
            <span class="m-doc-meta">${c.customer_license_at ? new Date(c.customer_license_at).toLocaleDateString('ko', { month:'2-digit', day:'2-digit' }) : ''}</span>
          </span>
          <button class="m-doc-del" id="ctLicenseDel" type="button" aria-label="삭제"><i class="ph ph-trash"></i></button>
        </div>
        <button class="m-doc-add-row" id="ctLicenseBtn" type="button"><i class="ph ph-arrows-clockwise"></i> 면허증 교체</button>
      </div>`
    : `<button class="m-upload-dropzone" id="ctLicenseBtn" type="button">
        <i class="ph ph-identification-card"></i>
        <span class="m-upload-primary">운전면허증 등록</span>
        <span class="m-upload-hint">앞면 사진 · JPG/PNG/PDF (10MB 이하)</span>
      </button>`;

  return `
    <div class="m-info-page">
      <section class="m-info-section">
        <div class="m-info-section-head"><span class="m-info-section-title">고객 정보</span></div>
        ${iRowEdit('고객명',   'customer_name',     c.customer_name,     { placeholder: '홍길동' })}
        ${iRowEdit('생년월일', 'customer_birth',    c.customer_birth,    { placeholder: '830926', inputMode: 'numeric' })}
        ${iRowEdit('연락처',   'customer_phone',    c.customer_phone,    { placeholder: '010-0000-0000', inputMode: 'tel' })}
        ${iRowEdit('인도지역', 'delivery_region',   c.delivery_region,   { placeholder: '예: 서울 강남구' })}
      </section>

      <section class="m-info-section">
        <div class="m-info-section-head">
          <span class="m-info-section-title">운전면허증</span>
          ${licUrl ? `<span class="m-info-section-title" style="text-transform:none;letter-spacing:0;color:var(--c-ok);">등록됨</span>` : ''}
        </div>
        ${licBody}
        <input type="file" id="ctLicenseInput" hidden accept="image/*,.pdf,.jpg,.jpeg,.png,.heic,.webp">
      </section>

      <section class="m-info-section">
        <div class="m-info-section-head">
          <span class="m-info-section-title">첨부 서류</span>
          ${docList.length ? `<span class="m-info-section-title" style="text-transform:none;letter-spacing:0;color:var(--c-text-sub);">${docList.length}건</span>` : ''}
        </div>
        ${docBody}
        <input type="file" id="ctDocInput" multiple hidden accept="image/*,.pdf,.jpg,.jpeg,.png,.heic,.webp">
      </section>
    </div>
  `;
}

/** 파일명에서 storage path 에 안전하지 않은 문자 제거 */
function sanitizeFileName(name) {
  // 한글·영문·숫자·일부 기호만 허용, 나머지는 _ 로 교체. 공백→_
  return String(name).trim().replace(/\s+/g, '_').replace(/[^\w.\-가-힣]/g, '_').slice(0, 120) || 'file';
}

async function uploadCustomerDocs(c, files) {
  const { uploadFile, uploadImage } = await import('../firebase/storage-helper.js');
  const { pushRecord } = await import('../firebase/db.js');
  const MAX = 10 * 1024 * 1024;
  for (const file of files) {
    if (file.size > MAX) {
      showToast(`${file.name} 10MB 초과`, 'error');
      continue;
    }
    try {
      const safe = sanitizeFileName(file.name);
      // chat-files 경로 패턴 재사용 (storage rules 에 이미 허용된 경로)
      const path = `chat-files/contract-${c.contract_code}/${Date.now()}_${safe}`;
      const isImage = (file.type || '').startsWith('image/');
      const { url } = isImage ? await uploadImage(path, file) : await uploadFile(path, file);
      await pushRecord(`contracts/${c.contract_code}/customer_docs`, {
        name: file.name,
        url,
        size: file.size,
        mime: file.type || '',
        uploaded_at: Date.now(),
        uploaded_by: store.currentUser?.uid || '',
      });
      showToast(`${file.name} 첨부됨`);
    } catch (e) {
      console.error('[ctDocUpload]', e);
      showToast(`업로드 실패: ${e?.code || e?.message || '알 수 없음'}`, 'error');
    }
  }
}

function cleanup() {
  unsub?.();
  unsub = null;
  if (activeView) {
    activeView.close?.();
    activeView = null;
  }
}

export function unmount() {
  cleanup();
}
