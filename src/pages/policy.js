/**
 * 정책 등록/관리 — 4패널: 목록 | 등록(폼) | 상세 | 보조
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, setRecord, softDelete } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { cField, fmtWon, empty } from '../core/format.js';
import { fieldInput as fi, fieldSelect as fs, fieldView, bindAutoSave as bindFormAutoSave } from '../core/form-fields.js';
import { initWs4Resize } from '../core/resize.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';
import { renderExcelTable } from '../core/excel-table.js';

let unsubPolicies = null;
let allPolicies = [];
let activeCode = null;
let viewMode = 'card';

const WS_KEY = 'fp.policy.widths';

/* ── 드롭다운 옵션 (v1 기반) ── */
const OPTS = {
  screening_criteria: ['무심사','심사필요'],
  credit_grade: ['신용무관','중신용','일반신용'],
  basic_driver_age: ['만 21세 이상','만 22세 이상','만 23세 이상','만 24세 이상','만 25세 이상','만 26세 이상','만 27세 이상','만 28세 이상','만 29세 이상','만 30세 이상'],
  driver_age_upper_limit: ['제한없음','만 60세 이하','만 65세 이하','만 70세 이하','만 75세 이하','만 80세 이하','협의'],
  driver_age_lowering: ['불가','협의','만25세','만24세','만23세','만22세','만21세'],
  personal_driver_scope: ['계약자 본인+직계가족','계약자 본인만','계약자 본인+추가운전자','협의'],
  business_driver_scope: ['계약사업자 임직원 및 관계자','대표자 본인만','대표자 본인+추가운전자','협의'],
  additional_driver_allowance_count: ['불가','1인','2인','3인','무제한'],
  additional_driver_cost: ['없음','월 1만원','월 2만원','월 3만원','월 5만원','협의'],
  age_lowering_cost: ['대여료의 5%','대여료의 7%','대여료의 10%','5만원','7만원','10만원','월15만원 추가'],
  annual_mileage: ['연간 1만Km 주행','연간 2만Km 주행','연간 3만Km 주행','연간 4만Km 주행','연간 5만Km 주행'],
  mileage_upcharge_per_10000km: ['없음','1만원','2만원','3만원','5만원','10만원','협의'],
  deposit_installment: ['불가능','협의','가능'],
  deposit_card_payment: ['가능','협의','불가'],
  rental_region: ['전국','수도권','제주도불가','협의'],
  injury_deductible: ['없음','10만원','20만원','30만원','50만원','100만원'],
  property_compensation_limit: ['2천만원','3천만원','5천만원','1억원','2억원','3억원','5억원','10억원'],
  property_deductible: ['없음','10만원','20만원','30만원','50만원','100만원'],
  self_body_accident: ['1,500만원','3,000만원','5,000만원','1억원'],
  self_body_deductible: ['없음','10만원','30만원','50만원','100만원'],
  uninsured_damage: ['없음','1억원','2억원','3억원'],
  uninsured_deductible: ['없음','10만원','30만원','50만원','100만원'],
  own_damage_compensation: ['차량가액','300만원','500만원','1000만원'],
  own_damage_repair_ratio: ['20%','30%','40%','50%'],
  own_damage_min_deductible: ['없음','30만원','50만원','100만원','200만원','300만원'],
  own_damage_max_deductible: ['없음','50만원','100만원','200만원','300만원','400만원','500만원'],
  maintenance_service: ['불포함','포함','협의'],
  annual_roadside_assistance: ['연간 1회','연간 2회','연간 3회','연간 4회','연간 5회','없음'],
  insurance_included: ['보험료 포함','보험료 별도','보험료 협의'],
};


export function mount() {
  unsubPolicies?.();
  activeCode = null;

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">
          <span>정책 목록</span>
          <span style="display:flex;gap:var(--sp-1);"><button class="btn btn-sm btn-outline" id="plViewToggle"><i class="ph ph-table"></i> 엑셀보기</button><button class="btn btn-sm btn-primary" id="plNewBtn"><i class="ph ph-plus"></i> 새 정책</button></span>
        </div>
        <div class="ws4-search">
          <input class="input input-sm" id="plSearch" placeholder="정책명, 공급사..." >
          <div class="ws4-search-chips">
            <button class="chip is-active" data-f="active">활성</button>
            <button class="chip" data-f="all">전체</button>
          </div>
        </div>
        <div class="ws4-body" id="plList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="form">
        <div class="ws4-head">
          <span style="display:flex;align-items:center;gap:var(--sp-1);">정책 기본정보 <span id="plStatusToggles"></span></span>
          <div style="display:flex;gap:var(--sp-1);" id="plFormActions"></div>
        </div>
        <div class="ws4-body" id="plForm">
          <div class="srch-empty"><i class="ph ph-list-checks"></i><p>정책을 선택하세요</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>
      <div class="ws4-panel" data-panel="insurance">
        <div class="ws4-head">정책 보험·운전자</div>
        <div class="ws4-body" id="plInsurance">
          <div class="srch-empty"><i class="ph ph-shield-check"></i><p>보험/운전자 조건</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="2"></div>
      <div class="ws4-panel" data-panel="etc">
        <div class="ws4-head">정책 기타조건</div>
        <div class="ws4-body" id="plEtc">
          <div class="srch-empty"><i class="ph ph-note"></i><p>기타 대여조건</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="3"></div>
      <div class="ws4-panel" data-panel="linked">
        <div class="ws4-head">정책 연결상품</div>
        <div class="ws4-body" id="plLinked">
          <div class="srch-empty"><i class="ph ph-car-simple"></i><p>연결 상품</p></div>
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

  document.getElementById('plViewToggle')?.addEventListener('click', () => {
    viewMode = viewMode === 'excel' ? 'card' : 'excel';
    const btn = document.getElementById('plViewToggle');
    if (btn) btn.innerHTML = viewMode === 'excel' ? '<i class="ph ph-cards"></i> 카드보기' : '<i class="ph ph-table"></i> 엑셀보기';
    renderList();
  });

  unsubPolicies = watchCollection('policies', (data) => {
    // v1 필드명 폴백 (term_* → policy_*)
    allPolicies = data.map(p => {
      if (!p.policy_name && p.term_name) p.policy_name = p.term_name;
      if (!p.policy_code && p.term_code) p.policy_code = p.term_code;
      return p;
    });
    store.policies = allPolicies;
    renderList();
    const active = data.filter(p => p.status === 'active').length;
    const providers = new Set(data.map(p => p.provider_company_code).filter(Boolean)).size;
    setBreadcrumbBrief(`활성 ${active} > 공급사 ${providers}`);
  });

  watchCollection('products', (data) => { store.products = data; });
}

function renderList() {
  const el = document.getElementById('plList');
  if (!el) return;
  const q = (document.getElementById('plSearch')?.value || '').toLowerCase();
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || 'active';

  let list = [...allPolicies];
  if (f === 'active') list = list.filter(p => p.status !== 'deleted' && p.status !== 'inactive');
  if (q) list = list.filter(p => [
    p.policy_name, p.policy_code, p.provider_company_code,
    p.policy_type, p.status, p.credit_grade, p.annual_mileage,
    p.basic_driver_age, p.screening_criteria, p._key,
  ].some(v => v && String(v).toLowerCase().includes(q)));
  list.sort((a,b) => (b.created_at||0) - (a.created_at||0));

  if (viewMode === 'excel') {
    renderExcelTable(el, {
      cols: [
        { key: 'policy_name', label: '정책명', width: 140, pin: 'left', filter: 'search' },
        { key: 'policy_code', label: '정책코드', width: 100, filter: 'search' },
        { key: 'provider_company_code', label: '공급코드', width: 90, filter: 'check' },
        { key: 'policy_type', label: '유형', width: 80, filter: 'check' },
        { key: 'status', label: '상태', width: 60, filter: 'check', render: (r) => r.status === 'active' ? '활성' : '비활' },
        { key: 'credit_grade', label: '심사기준', width: 80, filter: 'check' },
        { key: 'basic_driver_age', label: '운전연령', width: 100, filter: 'check' },
        { key: 'annual_mileage', label: '연간주행', width: 100, filter: 'check' },
      ],
      data: list,
      activeKey: activeCode,
      keyField: '_key',
      onRowClick: async (p) => {
        activeCode = p._key;
        loadAll(p._key);
        const { setBreadcrumbTail } = await import('../core/breadcrumb.js');
        setBreadcrumbTail({ icon: 'ph ph-scroll', label: p.policy_name || p.policy_code || '정책', sub: p.provider_company_code || '' });
      },
    });
    return;
  }

  /* ── 카드뷰 ── */
  el.innerHTML = list.map(p => {
    const tone = p.status === 'active' ? 'ok' : 'muted';
    const partner = (store.partners || []).find(pt => pt.partner_code === p.provider_company_code);
    const providerName = partner?.partner_name || p.provider_company_code || '';
    const fmtDate = p.created_at ? new Date(p.created_at).toLocaleDateString('ko', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '';
    return `
    <div class="room-item ${activeCode === p._key ? 'is-active' : ''}" data-key="${p._key}">
      <div class="room-item-avatar is-${tone}" style="flex-direction:column;gap:1px;font-size:var(--fs-2xs);"><i class="ph ph-scroll"></i>${p.status === 'active' ? '활성' : '비활'}</div>
      <div class="room-item-body">
        <div class="room-item-top">
          <span class="room-item-name">${providerName} · ${p.policy_name || '-'}</span>
          <span class="room-item-time">${fmtDate}</span>
        </div>
        <div class="room-item-msg">
          <span>${[p.provider_company_code, p.policy_code, p.term_description].filter(Boolean).join(' · ')}</span>
        </div>
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
  renderInsurance(p, key);
  renderEtc(p, key);
  renderLinked(p);
}

function renderForm(p, key) {
  const el = document.getElementById('plForm');
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-info"></i> 기본정보</div>
        <div class="form-section-body">
          ${fieldView('정책코드', p.policy_code)}
          ${fi('정책명','policy_name',p)}
          ${fi('공급사코드','provider_company_code',p)}
          ${fi('정책유형','policy_type',p)}
          ${fi('정책설명','term_description',p)}
          ${fs('심사기준','screening_criteria',p,OPTS.screening_criteria)}
          ${fs('신용등급','credit_grade',p,OPTS.credit_grade)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-list-checks"></i> 대여조건</div>
        <div class="form-section-body">
          ${fs('약정주행거리','annual_mileage',p,OPTS.annual_mileage)}
          ${fs('1만Km추가비용','mileage_upcharge_per_10000km',p,OPTS.mileage_upcharge_per_10000km)}
          ${fs('보증금분납','deposit_installment',p,OPTS.deposit_installment)}
          ${fs('보증금카드결제','deposit_card_payment',p,OPTS.deposit_card_payment)}
          ${fi('결제방식','payment_method',p)}
          ${fi('위약금','penalty_condition',p)}
          ${fs('대여지역','rental_region',p,OPTS.rental_region)}
          ${fi('탁송비','delivery_fee',p)}
          ${fi('수수료환수조건','commission_clawback_condition',p)}
        </div>
      </div>
    </div>
  `;

  // 상태 토글 → 타이틀 옆
  const toggles = document.getElementById('plStatusToggles');
  if (toggles) toggles.innerHTML = ['active','inactive'].map(s => {
    const active = p.status === s;
    return `<div class="status-toggle" data-status="${s}" style="font-size:var(--fs-2xs);padding:2px 6px;border-radius:var(--ctrl-r);cursor:pointer;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : 'color:var(--c-text-muted);'}">${s === 'active' ? '활성' : '비활성'}</div>`;
  }).join('');

  // 복제/삭제 → 우측
  const actions = document.getElementById('plFormActions');
  if (actions) actions.innerHTML = `
    <button class="btn btn-xs btn-outline" id="plCloneBtn"><i class="ph ph-copy"></i> 복제</button>
    <button class="btn btn-xs btn-outline" id="plDeleteBtn" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>
  `;

  // 상태 토글 이벤트
  document.querySelectorAll('#plStatusToggles .status-toggle').forEach(tog => {
    tog.addEventListener('click', async () => {
      await updateRecord(`policies/${key}`, { status: tog.dataset.status });
      showToast(`→ ${tog.dataset.status === 'active' ? '활성' : '비활성'}`);
    });
  });

  // 자동 저장 + 피드백
  bindFormAutoSave(el, (field, value) => updateRecord(`policies/${key}`, { [field]: value }));

  document.getElementById('plDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm('삭제하시겠습니까?')) return;
    await softDelete(`policies/${key}`);
    showToast('삭제됨');
  });

  document.getElementById('plCloneBtn')?.addEventListener('click', async () => {
    const clone = { ...p };
    delete clone._key;
    delete clone._deleted;
    const newCode = `${p.provider_company_code || 'XX'}_P${String(Date.now()).slice(-3)}`;
    clone.policy_code = newCode;
    clone.policy_name = (p.policy_name || '') + ' (복제)';
    clone.created_at = Date.now();
    clone.created_by = store.currentUser?.user_code || '';
    await setRecord(`policies/${newCode}`, clone);
    showToast('정책 복제됨');
  });
}

function renderNewForm() {
  const el = document.getElementById('plForm');
  const empty = {};
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-info"></i> 기본정보</div>
        <div class="form-section-body">
          ${fi('정책명','policy_name',empty)}
          ${fi('공급사코드','provider_company_code',empty)}
          ${fi('정책유형','policy_type',empty)}
          ${fi('정책설명','term_description',empty)}
          ${fs('심사기준','screening_criteria',empty,OPTS.screening_criteria)}
          ${fs('신용등급','credit_grade',empty,OPTS.credit_grade)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-user"></i> 운전자 조건</div>
        <div class="form-section-body">
          ${fs('기본운전자연령','basic_driver_age',empty,OPTS.basic_driver_age)}
          ${fs('운전연령상한','driver_age_upper_limit',empty,OPTS.driver_age_upper_limit)}
          ${fs('운전연령하향','driver_age_lowering',empty,OPTS.driver_age_lowering)}
          ${fs('약정주행거리','annual_mileage',empty,OPTS.annual_mileage)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-shield-check"></i> 보험조건</div>
        <div class="form-section-body">
          ${fs('대물배상','property_compensation_limit',empty,OPTS.property_compensation_limit)}
          ${fs('자기신체사고','self_body_accident',empty,OPTS.self_body_accident)}
          ${fs('무보험차상해','uninsured_damage',empty,OPTS.uninsured_damage)}
          ${fs('자기차량손해','own_damage_compensation',empty,OPTS.own_damage_compensation)}
          ${fs('보험료','insurance_included',empty,OPTS.insurance_included)}
        </div>
      </div>
    </div>
  `;

  // 헤드 액션 버튼
  const actions = document.getElementById('plFormActions');
  if (actions) actions.innerHTML = `<button class="btn btn-xs btn-primary" id="plSaveNew"><i class="ph ph-check"></i> 저장</button>`;

  document.getElementById('plSaveNew')?.addEventListener('click', async () => {
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

function renderInsurance(p, key) {
  const el = document.getElementById('plInsurance');
  const saveFn = (field, value) => updateRecord(`policies/${key}`, { [field]: value });

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-shield-check"></i> 보험조건</div>
        <div class="form-section-body">
          ${fi('대인배상','injury_compensation_limit',{ injury_compensation_limit: p.injury_compensation_limit || '무한' })}
          ${fs('대인면책금','injury_deductible',p,OPTS.injury_deductible)}
          ${fs('대물배상','property_compensation_limit',p,OPTS.property_compensation_limit)}
          ${fs('대물면책금','property_deductible',p,OPTS.property_deductible)}
          ${fs('자기신체사고','self_body_accident',p,OPTS.self_body_accident)}
          ${fs('자손면책금','self_body_deductible',p,OPTS.self_body_deductible)}
          ${fs('무보험차상해','uninsured_damage',p,OPTS.uninsured_damage)}
          ${fs('무보험면책금','uninsured_deductible',p,OPTS.uninsured_deductible)}
          ${fs('자기차량손해','own_damage_compensation',p,OPTS.own_damage_compensation)}
          ${fs('자차수리비율','own_damage_repair_ratio',p,OPTS.own_damage_repair_ratio)}
          ${fs('자차최소면책금','own_damage_min_deductible',p,OPTS.own_damage_min_deductible)}
          ${fs('자차최대면책금','own_damage_max_deductible',p,OPTS.own_damage_max_deductible)}
          ${fs('정비서비스','maintenance_service',p,OPTS.maintenance_service)}
          ${fs('긴급출동','annual_roadside_assistance',p,OPTS.annual_roadside_assistance)}
          ${fs('보험료','insurance_included',p,OPTS.insurance_included)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-user"></i> 운전자 조건</div>
        <div class="form-section-body">
          ${fs('기본운전자연령','basic_driver_age',p,OPTS.basic_driver_age)}
          ${fs('운전연령상한','driver_age_upper_limit',p,OPTS.driver_age_upper_limit)}
          ${fs('운전연령하향','driver_age_lowering',p,OPTS.driver_age_lowering)}
          ${fs('운전연령하향비용','age_lowering_cost',p,OPTS.age_lowering_cost)}
          ${fs('개인운전자범위','personal_driver_scope',p,OPTS.personal_driver_scope)}
          ${fs('사업자운전자범위','business_driver_scope',p,OPTS.business_driver_scope)}
          ${fs('추가운전자허용인원수','additional_driver_allowance_count',p,OPTS.additional_driver_allowance_count)}
          ${fs('추가운전자1인당비용','additional_driver_cost',p,OPTS.additional_driver_cost)}
        </div>
      </div>
    </div>
  `;
  bindFormAutoSave(el, saveFn);
}

function renderEtc(p, key) {
  const el = document.getElementById('plEtc');
  const saveFn = (field, value) => updateRecord(`policies/${key}`, { [field]: value });

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-note"></i> 정책 요약</div>
        <div class="form-section-body">
          ${fieldView('정책코드', p.policy_code)}
          ${fieldView('정책명', p.policy_name)}
          ${fieldView('공급사', p.provider_company_code)}
          ${fieldView('심사기준', p.screening_criteria)}
          ${fieldView('신용등급', p.credit_grade)}
          ${fieldView('상태', p.status === 'active' ? '활성' : p.status || '-')}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-warning-circle"></i> 기타</div>
        <div class="form-section-body">
          ${fi('수수료환수조건','commission_clawback_condition',p)}
          ${fi('정책설명','term_description',p)}
        </div>
      </div>
    </div>
  `;
  bindFormAutoSave(el, saveFn);
}

function renderLinked(p) {
  const el = document.getElementById('plLinked');
  const products = (store.products || []).filter(x => x.policy_code === p.policy_code);

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-2);overflow-y:auto;height:100%;">
      <div style="font-size:var(--fs-xs);color:var(--c-text-muted);">${products.length}대 연결</div>
      ${products.map(pr => `
        <div class="room-item">
          <div class="room-item-body">
            <div class="room-item-name">${pr.car_number || ''} · ${pr.model || pr.model_name || ''}</div>
            <div class="room-item-msg"><span>${pr.vehicle_status || ''} · ${pr.product_type || ''}</span></div>
          </div>
        </div>
      `).join('') || '<div style="color:var(--c-text-muted);font-size:var(--fs-xs);">연결된 상품 없음</div>'}
    </div>
  `;
}

export function unmount() {
  unsubPolicies?.();
  activeCode = null;
}
