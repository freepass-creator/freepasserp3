/**
 * 상품관리 — 4패널: 목록 | 등록(폼) | 가격 | 사진
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, setRecord, softDelete } from '../firebase/db.js';
import { uploadImage } from '../firebase/storage-helper.js';
import { showToast } from '../core/toast.js';
import { empty } from '../core/format.js';
import { initWs4Resize } from '../core/resize.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';
import { openContextMenu } from '../core/context-menu.js';
import { firstProductImage, supportedDriveSource } from '../core/product-photos.js';
import { topBadgesHtml, reviewOverlayHtml } from '../core/product-badges.js';
import { getMakers, getModelsByMaker, getSubModels, findCarModel } from '../core/car-models.js';

let unsubProducts = null;
let allProducts = [];
let activeKey = null;
// 신규 상품 draft — 저장 버튼 눌러야 Firebase 커밋, 그 전까진 메모리만
let draftProduct = null;
const DRAFT_KEY = '__draft__';

const WS_KEY = 'fp.prod.widths';

export function mount() {
  unsubProducts?.();
  activeKey = null;

  const shell = document.querySelector('.shell');

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">
          <span>목록</span>
          <button class="btn btn-xs btn-primary" id="pdNew"><i class="ph ph-plus"></i> 새 상품</button>
        </div>
        <div class="ws4-search">
          <input class="input input-sm" id="pdSearch" placeholder="차량번호, 모델..." >
          <div class="pd-status-chips" id="pdStatusChips"></div>
        </div>
        <div class="ws4-body" id="pdList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="asset">
        <div class="ws4-head">
          <span>차량 자산</span>
          <div class="ws4-head-actions" id="pdAssetActions"></div>
        </div>
        <div class="ws4-body" id="pdAsset">
          <div class="srch-empty"><i class="ph ph-car-simple"></i><p>차량을 선택하세요</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>
      <div class="ws4-panel" data-panel="terms">
        <div class="ws4-head">대여조건 · 가격</div>
        <div class="ws4-body" id="pdTerms">
          <div class="srch-empty"><i class="ph ph-list-checks"></i><p>대여조건 · 가격</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="2"></div>
      <div class="ws4-panel" data-panel="photos">
        <div class="ws4-head">사진</div>
        <div class="ws4-body" id="pdPhotos">
          <div class="srch-empty"><i class="ph ph-image"></i><p>사진</p></div>
        </div>
      </div>
    </div>
  `;

  initWs4Resize(WS_KEY);

  // 상태 chip은 동적 생성 → 이벤트 위임
  main.querySelector('#pdStatusChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-status]');
    if (!chip) return;
    main.querySelectorAll('.chip[data-status]').forEach(x => x.classList.remove('is-active'));
    chip.classList.add('is-active');
    renderList();
  });
  document.getElementById('pdSearch')?.addEventListener('input', () => renderList());

  // 새 상품 등록 (빈 카드)
  document.getElementById('pdNew')?.addEventListener('click', async () => {
    await createProduct({});
  });

  // 현재 선택된 상품 복제 — 식별·사진 제외한 모든 필드 복사

  unsubProducts = watchCollection('products', (data) => {
    allProducts = data.filter(p => !p._deleted);
    store.products = allProducts;
    renderList();
    updateBrief();
  });
}

/** 신규 상품 draft 생성 — Firebase 저장은 "저장" 버튼 클릭 시 */
function createProduct(source = {}) {
  const me = store.currentUser || {};
  const thisYear = String(new Date().getFullYear());

  const EXCLUDE = new Set([
    '_key', '_deleted', 'product_uid', 'product_code', 'car_number',
    'image_urls', 'images', 'photos', 'image_url', 'photo_link',
    'doc_images', 'created_at', 'created_by', 'updated_at',
  ]);
  const copied = {};
  for (const [k, v] of Object.entries(source)) {
    if (EXCLUDE.has(k)) continue;
    if (v == null || v === '') continue;
    copied[k] = v;
  }

  draftProduct = {
    _key: DRAFT_KEY,
    product_uid: '',
    product_code: '',
    car_number: '',
    vehicle_status: '출고가능',
    product_type: '중고렌트',
    year: thisYear,
    ...copied,
    provider_company_code: me.company_code || source.provider_company_code || '',
    partner_code: me.partner_code || source.partner_code || '',
    image_urls: [],
    doc_images: [],
  };

  activeKey = DRAFT_KEY;
  renderList();
  loadAll(DRAFT_KEY);
  showToast(Object.keys(source).length ? '복제됨 — 저장 버튼을 눌러야 등록됩니다' : '신규 — 저장 버튼을 눌러야 등록됩니다');
}

/** draft를 Firebase에 커밋 */
async function saveDraft() {
  if (!draftProduct) return;
  const d = draftProduct;
  if (!d.car_number || !d.car_number.trim()) {
    showToast('차량번호를 입력하세요');
    return;
  }
  const uid = `P_${Date.now()}`;
  const me = store.currentUser || {};
  const payload = {
    ...d,
    product_uid: uid,
    product_code: d.product_code || (d.car_number && d.partner_code ? `${d.car_number}_${d.partner_code}` : uid),
    created_at: Date.now(),
    created_by: me.uid || me.user_code || '',
  };
  delete payload._key;
  try {
    await setRecord(`products/${uid}`, payload);
    draftProduct = null;
    activeKey = uid;
    renderList();
    setTimeout(() => loadAll(uid), 300);
    showToast('저장 완료');
  } catch (e) {
    console.error('[saveDraft]', e);
    showToast('저장 실패');
  }
}

/** draft 취소 (저장 안 하고 버림) */
function cancelDraft() {
  draftProduct = null;
  activeKey = null;
  renderList();
  document.getElementById('pdAsset').innerHTML  = '<div class="srch-empty"><i class="ph ph-car-simple"></i><p>차량을 선택하세요</p></div>';
  document.getElementById('pdTerms').innerHTML  = '<div class="srch-empty"><i class="ph ph-list-checks"></i><p>대여조건 · 가격</p></div>';
  document.getElementById('pdPhotos').innerHTML = '<div class="srch-empty"><i class="ph ph-image"></i><p>사진</p></div>';
  const headActions = document.getElementById('pdAssetActions');
  if (headActions) headActions.innerHTML = '';
}

function updateBrief() {
  const counts = {};
  allProducts.forEach(p => { const s = p.vehicle_status || '-'; counts[s] = (counts[s]||0) + 1; });
  const parts = [`총 ${allProducts.length}대`];
  if (counts['즉시출고']) parts.push(`즉시 ${counts['즉시출고']}`);
  if (counts['출고가능']) parts.push(`가능 ${counts['출고가능']}`);
  if (counts['출고불가']) parts.push(`불가 ${counts['출고불가']}`);
  setBreadcrumbBrief(parts.join(' > '));
}

/** 차량상태 필터 칩 — allProducts의 unique vehicle_status 값 기반으로 동적 생성 */
function renderStatusChips() {
  const el = document.getElementById('pdStatusChips');
  if (!el) return;
  const ORDER = ['즉시출고', '출고가능', '상품화중', '출고협의', '출고불가'];
  const SHORT = { '즉시출고': '즉시', '출고가능': '가능', '상품화중': '상품화', '출고협의': '협의', '출고불가': '불가' };
  const present = new Set(allProducts.map(p => p.vehicle_status).filter(Boolean));
  const chips = ORDER.filter(s => present.has(s));
  const cur = el.querySelector('.chip[data-status].is-active')?.dataset.status || 'all';
  el.innerHTML = [
    `<button class="chip ${cur === 'all' ? 'is-active' : ''}" data-status="all">전체 ${allProducts.length}</button>`,
    ...chips.map(s => {
      const n = allProducts.filter(p => p.vehicle_status === s).length;
      return `<button class="chip ${cur === s ? 'is-active' : ''}" data-status="${s}">${SHORT[s] || s} ${n}</button>`;
    }),
  ].join('');
}

function renderList() {
  const el = document.getElementById('pdList');
  if (!el) return;
  const q = (document.getElementById('pdSearch')?.value || '').toLowerCase();
  renderStatusChips();
  const f = document.querySelector('.chip[data-status].is-active')?.dataset.status || 'all';

  let list = [...allProducts];
  if (f !== 'all') list = list.filter(p => p.vehicle_status === f);

  if (q) list = list.filter(p => [
    p.car_number, p.maker, p.model, p.sub_model, p.trim_name,
    p.vehicle_status, p.product_type, p.vehicle_class,
    p.fuel_type, p.ext_color, p.int_color, p.year,
    p.provider_company_code, p.partner_code, p.policy_code,
    p.vin, p.location, p.product_code, p._key,
  ].some(v => v && String(v).toLowerCase().includes(q)));
  list.sort((a,b) => (b.created_at||0) - (a.created_at||0));

  const tone = s => s === '즉시출고' ? 'info' : s === '출고가능' ? 'green' : s === '상품화중' ? 'muted' : s === '출고협의' ? 'purple' : s === '출고불가' ? 'err' : 'muted';

  el.innerHTML = list.map(p => {
    const thumb = firstProductImage(p);
    const driveFolderUrl = !thumb ? supportedDriveSource(p) : '';
    const title = [p.sub_model, p.trim_name || p.trim].filter(v => v && v !== '-').join(' > ') || p.model || '-';
    const color = [p.ext_color, p.int_color].filter(Boolean).join('/');
    const sub = [
      p.provider_company_code,
      p.car_number,
      p.maker,
      p.year ? `${p.year}년` : '',
      p.mileage ? Number(p.mileage).toLocaleString() + 'km' : '',
      p.fuel_type,
      color,
    ].filter(Boolean).join(' · ');
    return `
    <div class="srch-item ${activeKey === p._key ? 'is-active' : ''}" data-key="${p._key}">
      <div class="srch-item-thumb">
        ${thumb
          ? `<img src="${thumb}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
          : driveFolderUrl
            ? `<i class="ph ph-car-simple srch-thumb-placeholder"></i><img data-drive-folder="${driveFolderUrl}" data-drive-mode="thumb" alt="" loading="lazy" decoding="async" hidden onerror="this.remove()">`
            : `<i class="ph ph-car-simple"></i>`}
        ${reviewOverlayHtml(p)}
      </div>
      <div class="srch-item-body">
        <div class="srch-item-name">${topBadgesHtml(p)}<span>${title}</span></div>
        <div class="srch-item-mid"><span>${sub}</span></div>
      </div>
    </div>
  `;}).join('') || empty('차량 없음');

  // 이벤트 위임 — 클릭 + 우클릭
  bindListEvents(el);
}

let _pdListDelegated = null;
function bindListEvents(el) {
  if (_pdListDelegated === el) return;
  _pdListDelegated = el;

  el.addEventListener('click', async (e) => {
    const item = e.target.closest('.srch-item');
    if (!item) return;
    activeKey = item.dataset.key;
    renderList();
    loadAll(item.dataset.key);
    const p = allProducts.find(x => x._key === item.dataset.key);
    if (p) {
      const { setBreadcrumbTail } = await import('../core/breadcrumb.js');
      const name = [p.maker, p.sub_model, p.trim_name || p.trim].filter(Boolean).join(' ');
      setBreadcrumbTail({ icon: 'ph ph-car-simple', label: name || p.car_number || '차량', sub: p.car_number || '' });
    }
  });

  el.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.srch-item');
    if (!item) return;
    const p = allProducts.find(x => x._key === item.dataset.key);
    if (!p) return;
    const role = store.currentUser?.role;
    const items = [
      { icon: 'ph ph-copy', label: '복제', action: () => createProduct(p).then(() => showToast(`${p.model || '상품'} 복제됨`)) },
    ];
    if (role === 'admin' || p.created_by === store.currentUser?.user_code) {
      items.push({ icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!confirm('이 상품을 삭제하시겠습니까?')) return;
        await softDelete(`products/${p._key}`);
        if (activeKey === p._key) activeKey = null;
        showToast('삭제됨');
      }});
    }
    openContextMenu(e, items);
  });
}

function loadAll(key) {
  const p = key === DRAFT_KEY ? draftProduct : allProducts.find(x => x._key === key);
  if (!p) return;
  renderAsset(p, key);
  renderTerms(p, key);
  renderPhotos(p, key);
}

/* ── 등록 폼 ── */
const STATUS_OPTS  = ['즉시출고','출고가능','상품화중','출고협의','출고불가'];
const TYPE_OPTS    = ['중고렌트','신차렌트','중고구독','신차구독'];
const FUEL_OPTS    = ['가솔린','디젤','LPG','하이브리드','전기','수소'];
const CLASS_OPTS   = ['경차','소형','준중형','중형','준대형','대형','SUV','RV','승합','화물','수입'];
const YEAR_OPTS    = Array.from({ length: 12 }, (_, i) => String(2026 - i));

/** car_models RTDB에 stub 등록 — 새로운 maker+model+sub_model 조합 발견 시
 *  deterministic key로 upsert (멱등). 나머지 필드(category 등)는 jpkerp car-master에서 보완. */
function carModelKey(maker, model, sub_model) {
  const clean = s => String(s || '').trim().replace(/[.#$\[\]\/\s]+/g, '_');
  return `${clean(maker)}__${clean(model)}__${clean(sub_model)}`;
}
async function registerCarModelStub(maker, model, sub_model) {
  if (!maker || !model || !sub_model) return;
  const key = carModelKey(maker, model, sub_model);
  try {
    const { ref, get, set } = await import('firebase/database');
    const { db } = await import('../firebase/config.js');
    const r = ref(db, `car_models/${key}`);
    const snap = await get(r);
    if (snap.exists()) return;  // 이미 존재 — 기존 데이터 보존 (덮어쓰지 않음)
    await set(r, {
      maker, model, sub_model,
      status: 'active',
      source: 'freepass',
      created_at: Date.now(),
      created_by: store.currentUser?.user_code || '',
    });
  } catch (e) {
    console.warn('[car_models] stub 등록 실패', e);
  }
}

/** 차종 마스터(car_models) 우선, 없으면 allProducts에서 유도 (이행기 fallback) */
function pickerMakers() {
  const fromMaster = getMakers();
  if (fromMaster.length) return fromMaster;
  const s = new Set();
  for (const p of allProducts) if (p.maker) s.add(p.maker.trim());
  return [...s].filter(Boolean).sort();
}
function pickerModels(maker) {
  if (!maker) return [];
  const fromMaster = getModelsByMaker(maker);
  if (fromMaster.length) return fromMaster;
  const s = new Set();
  for (const p of allProducts) if (p.maker === maker && p.model) s.add(p.model.trim());
  return [...s].filter(Boolean).sort();
}
function pickerSubs(maker, model) {
  if (!maker || !model) return [];
  const fromMaster = getSubModels(maker, model);
  if (fromMaster.length) return fromMaster;
  const s = new Set();
  for (const p of allProducts) if (p.maker === maker && p.model === model && p.sub_model) s.add(p.sub_model.trim());
  return [...s].filter(Boolean).sort();
}

/** 제조사·모델·세부모델 연결 드롭다운 (상위 선택 시 하위 옵션 필터링) */
function renderPicker(p) {
  const curMk = p.maker || '';
  const curMd = p.model || '';
  const curSub = p.sub_model || '';
  const makers = pickerMakers();
  const models = pickerModels(curMk);
  const subs = pickerSubs(curMk, curMd);
  const isAdmin = store.currentUser?.role === 'admin';
  const addOpt = isAdmin ? '<option value="__new__">+ 직접 입력</option>' : '';

  const sel = (label, field, cur, list) => {
    const opts = [...list];
    if (isAdmin) opts.push('+ 직접 입력');
    return fs(label, field, { [field]: cur }, opts);
  };

  return `
    ${sel('제조사','maker',curMk,makers)}
    ${sel('모델','model',curMd,models)}
    ${sel('세부모델','sub_model',curSub,subs)}`;
}

/* ── 패널 2: 차량 자산 (불변 스펙·등록정보) ── */
function renderAsset(p, key) {
  const el = document.getElementById('pdAsset');

  const carNo = p.car_number || '';
  const pathHtml = [
    p.maker ? `<span class="is-filled">${p.maker}</span>` : `<span class="is-empty">제조사</span>`,
    `<i class="ph ph-caret-right"></i>`,
    p.model ? `<span class="is-filled">${p.model}</span>` : `<span class="is-empty">모델</span>`,
    `<i class="ph ph-caret-right"></i>`,
    p.sub_model ? `<span class="is-filled">${p.sub_model}</span>` : `<span class="is-empty">세부모델</span>`,
  ].join('');

  // 공급사·파트너 자동 (현재 유저 기준). 상품코드 = car_number + partner_code 자동 조합
  const providerCode = p.provider_company_code || store.currentUser?.company_code || '';
  const partnerCode  = p.partner_code || store.currentUser?.partner_code || '';
  const productCode  = p.product_code || (carNo && partnerCode ? `${carNo}_${partnerCode}` : '');

  el.innerHTML = `
    <div class="pd-form ${key === DRAFT_KEY ? 'is-draft' : ''}" style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">

      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-identification-card"></i> 기본정보</div>
        <div class="form-section-body">
          ${fi('차량번호','car_number',p)}
          ${fi('차대번호','vin',p)}
          ${fi('공급사코드','provider_company_code',{ provider_company_code: providerCode })}
          ${fi('상품코드','product_code',{ product_code: productCode },{ readonly: true })}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-car-simple"></i> 제조사 및 차량사양</div>
        <div class="form-section-body">
          ${renderPicker(p)}
          ${fi('세부트림','trim_name',p,{ autocomplete: true })}
          ${fi('선택옵션','options',p,{ full: true })}
          ${fs('차종구분','vehicle_class',p,CLASS_OPTS)}
          ${fs('연식','year',p,YEAR_OPTS)}
          ${fs('연료(동력)','fuel_type',p,FUEL_OPTS)}
          ${fi('외장색','ext_color',p,{ autocomplete: true })}
          ${fi('내장색','int_color',p,{ autocomplete: true })}
          ${fs('구동방식','drive_type',p,['전륜(FF)','후륜(FR)','4륜(AWD)','4륜(4WD)'])}
          ${fi('차량가격 (원)','vehicle_price',p,{ num: true })}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-file-text"></i> 등록증 정보</div>
        <div class="form-section-body">
          ${fi('등록증 차종','reg_vehicle_type',p)}
          ${fs('용도','usage',p,['자가용','영업용','관용'])}
          ${fi('배기량 (cc)','engine_cc',p,{ num: true })}
          ${fi('승차정원','seats',p,{ num: true })}
          ${fi('최초등록일','first_registration_date',p)}
          ${fi('제작연월','manufacture_date',p)}
          ${fi('차령만료일','vehicle_age_expiry_date',p)}
          ${fi('형식','model_code',p)}
          ${fi('원동기형식','engine_code',p)}
          ${fi('연비 (km/L)','fuel_efficiency',p,{ num: true })}
          ${fi('총중량 (kg)','total_weight',p,{ num: true })}
          ${fi('길이 (mm)','length',p,{ num: true })}
          ${fi('너비 (mm)','width',p,{ num: true })}
          ${fi('높이 (mm)','height',p,{ num: true })}
          ${fi('기통수','cylinders',p,{ num: true })}
          ${fi('정격출력','rated_power',p)}
          ${fi('제원관리번호','registration_number',p)}
          ${fi('위치','location',p,{ autocomplete: true })}
          ${fta('내부 메모','partner_memo',p,{ rows: 3 })}
        </div>
      </div>

    </div>
  `;

  // 패널 헤드에 액션 버튼 주입 (draft: 저장/취소, 기존: 삭제)
  const headActions = document.getElementById('pdAssetActions');
  if (headActions) {
    headActions.innerHTML = key === DRAFT_KEY
      ? `<button class="btn btn-xs btn-outline" id="pdCancel"><i class="ph ph-x"></i> 취소</button>
         <button class="btn btn-xs btn-primary" id="pdSave"><i class="ph ph-check"></i> 저장</button>`
      : `<button class="btn btn-xs btn-outline" id="pdClone"><i class="ph ph-copy"></i> 복제</button>
         <button class="btn btn-xs btn-outline pd-delete" id="pdDelete" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>`;
  }

  bindPicker(el, p, key);
  bindFormAutoSave(el, (field, value) => saveField(key, field, value));

  // 차량번호·파트너 바뀌면 상품코드 자동 재조합 (기존 상품만)
  if (key !== DRAFT_KEY) {
    el.querySelector('[data-field="car_number"]')?.addEventListener('blur', () => {
      const newCarNo = el.querySelector('[data-field="car_number"]').value.trim();
      const newCode = newCarNo && partnerCode ? `${newCarNo}_${partnerCode}` : '';
      if (newCode && newCode !== p.product_code) {
        updateRecord(`products/${key}`, { product_code: newCode });
      }
    });
  }

  // 저장·취소 (draft) vs 삭제 (기존) — 버튼이 헤드(body 밖)에 있으므로 headActions 기준
  headActions?.querySelector('#pdSave')?.addEventListener('click', () => saveDraft());
  headActions?.querySelector('#pdCancel')?.addEventListener('click', () => {
    if (confirm('저장하지 않은 내용이 사라집니다. 계속할까요?')) cancelDraft();
  });
  headActions?.querySelector('#pdClone')?.addEventListener('click', async () => {
    const src = allProducts.find(x => x._key === key);
    if (!src) return;
    await createProduct(src);
    showToast(`${src.model || '상품'} 복제됨 — 차량번호만 입력하세요`);
  });
  headActions?.querySelector('#pdDelete')?.addEventListener('click', async () => {
    if (!confirm('이 상품을 삭제하시겠습니까?')) return;
    await softDelete(`products/${key}`);
    activeKey = null;
    showToast('삭제됨');
  });
}

/* ── 공용 필드 저장 헬퍼 — draft면 메모리만, 기존 상품이면 Firebase ── */
async function saveField(key, field, value) {
  if (key === DRAFT_KEY) {
    if (draftProduct) draftProduct[field] = value;
  } else {
    await updateRecord(`products/${key}`, { [field]: value });
  }
}

/* ── 공용: focus/blur 자동저장 바인딩 ── */

/* ── 패널 3: 대여조건 · 가격 — 정책 연결 + 기간별 가격만 ── */
const PRICE_PERIODS = ['1','12','24','36','48','60'];

function renderTerms(p, key) {
  const el = document.getElementById('pdTerms');
  const price = p.price || {};

  // 차량의 공급사 정책만 (공급사코드 매칭, admin은 전체)
  const me = store.currentUser || {};
  const allPolicies = store.policies || [];
  const productProvider = p.provider_company_code || me.company_code || '';
  const myPolicies = me.role === 'admin'
    ? allPolicies
    : allPolicies.filter(t => !productProvider || t.provider_company_code === productProvider);
  const curPolicy = p.policy_code || '';
  const curPolicyObj = myPolicies.find(t => (t.policy_code || t._key) === curPolicy);

  // 정책에서 자동 연동되는 값들
  const pol = curPolicyObj || {};
  const autoRows = [
    ['심사여부', pol.screening_criteria || '-'],
    ['심사기준', pol.credit_grade || '-'],
    ['최저운전연령', pol.basic_driver_age || '-'],
    ['운전연령하향', pol.driver_age_lowering || '-'],
    ['연간약정주행거리', pol.annual_mileage || '-'],
    ['보험료', pol.insurance_included || '-'],
    ['보증금분납', pol.deposit_installment || '-'],
    ['대여지역', pol.rental_region || '-'],
  ];

  el.innerHTML = `
    <div class="pd-form ${key === DRAFT_KEY ? 'is-draft' : ''}" style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-scroll"></i> 상태 · 정책</div>
        <div class="form-section-body">
          ${fs('정책','policy_code',p,myPolicies.map(t => t.policy_code || t._key))}
          ${fs('상품구분','product_type',p,TYPE_OPTS)}
          ${fs('차량상태','vehicle_status',p,STATUS_OPTS)}
          ${fi('현재 주행거리','mileage',p,{ num: true })}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">기간별 가격</div>
        <div class="form-section-body">
          <table class="pd-price-table">
            <thead><tr><th>기간</th><th>대여료</th><th>보증금</th></tr></thead>
            <tbody>
              ${PRICE_PERIODS.map(m => {
                const pr = price[m] || {};
                const rentFmt = pr.rent != null && pr.rent !== '' ? Number(pr.rent).toLocaleString('ko-KR') : '';
                const depFmt  = pr.deposit != null && pr.deposit !== '' ? Number(pr.deposit).toLocaleString('ko-KR') : '';
                return `<tr>
                  <td class="pd-price-period">${m}개월</td>
                  <td><input class="input input-sm pd-price-input" data-period="${m}" data-type="rent" value="${rentFmt}" placeholder="-" inputmode="numeric"></td>
                  <td><input class="input input-sm pd-price-input" data-period="${m}" data-type="deposit" value="${depFmt}" placeholder="-" inputmode="numeric"></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          <div class="pd-hint">빈 값/0은 상세에 노출되지 않음</div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">영업수수료 <span class="form-section-hint">(내부용 · 카탈로그 배포 시 제외)</span></div>
        <div class="form-section-body">
          <table class="pd-price-table">
            <thead><tr><th>기간</th><th>수수료</th><th>비고</th></tr></thead>
            <tbody>
              ${PRICE_PERIODS.map(m => {
                const pr = price[m] || {};
                const feeRaw = pr.fee != null && pr.fee !== '' ? pr.fee : (pr.commission || '');
                const feeFmt = feeRaw !== '' ? Number(feeRaw).toLocaleString('ko-KR') : '';
                return `<tr>
                  <td class="pd-price-period">${m}개월</td>
                  <td><input class="input input-sm pd-price-input" data-period="${m}" data-type="fee" value="${feeFmt}" placeholder="-" inputmode="numeric"></td>
                  <td><input class="input input-sm pd-price-memo" data-period="${m}" data-type="fee_memo" value="${pr.fee_memo||''}" placeholder="-"></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-clipboard-text"></i> 정책 연동 <span class="form-section-hint">정책 변경 시 자동 갱신</span></div>
        <div class="form-section-body">
          ${autoRows.map(([l, v]) => `<div class="form-row"><span class="form-row-label">${l}</span><span class="form-row-value">${v}</span></div>`).join('')}
        </div>
      </div>
    </div>
  `;

  bindFormAutoSave(el, (field, value) => saveField(key, field, value));

  // 정책 변경 시 연동값 갱신
  el.querySelector('[data-field="policy_code"]')?.addEventListener('change', () => {
    renderTerms(allProducts.find(x => x._key === key) || p, key);
  });

  // 기간별 가격 셀(대여료/보증금/수수료: 숫자 + 수수료 비고: 문자열)
  el.querySelectorAll('.pd-price-input, .pd-price-memo').forEach(inp => {
    const isMemo = inp.classList.contains('pd-price-memo');
    let originalPrice = inp.value;
    if (!isMemo) {
      // 수정모드 진입: 콤마 제거
      inp.addEventListener('focus', () => {
        inp.value = inp.value.replace(/[^\d]/g, '');
        originalPrice = inp.value;
      });
      // 입력 중엔 숫자만
      inp.addEventListener('input', () => {
        const cleaned = inp.value.replace(/[^\d]/g, '');
        if (cleaned !== inp.value) inp.value = cleaned;
      });
    } else {
      inp.addEventListener('focus', () => { originalPrice = inp.value; });
    }
    inp.addEventListener('blur', async () => {
      const val = inp.value.trim();
      if (val === originalPrice) {
        // 변경 없으면 저장 건너뜀, 포맷만 복구
        if (!isMemo && val !== '') inp.value = Number(val).toLocaleString('ko-KR');
        return;
      }
      const saved = isMemo ? (val || null) : (val ? Number(val) : null);
      const m = inp.dataset.period, t = inp.dataset.type;
      if (key === DRAFT_KEY) {
        if (draftProduct) {
          draftProduct.price = draftProduct.price || {};
          draftProduct.price[m] = draftProduct.price[m] || {};
          draftProduct.price[m][t] = saved;
        }
      } else {
        await updateRecord(`products/${key}`, { [`price/${m}/${t}`]: saved });
      }
      originalPrice = val;
      // 저장 후 콤마 포맷 복구
      if (!isMemo && val !== '') inp.value = Number(val).toLocaleString('ko-KR');
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') inp.blur();
      else if (e.key === 'Escape') { inp.value = originalPrice; inp.blur(); }
    });
  });
}

/* ── 패널 4: 사진 (차량 사진 30장 + 사진링크 + 등록증 OCR) ── */
const MAX_PHOTOS = 30;
const UPLOAD_CONCURRENCY = 6;

/** 파일 시그니처 — 중복 업로드 방지 (name + size + lastModified) */
const fileSig = f => `${f.name}::${f.size}::${f.lastModified}`;

/** 병렬 업로드 (concurrency 제한) */
async function uploadParallel(files, pathFn, concurrency = UPLOAD_CONCURRENCY) {
  const urls = new Array(files.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= files.length) return;
      const file = files[idx];
      try {
        const { url } = await uploadImage(pathFn(file, idx), file);
        urls[idx] = url;
      } catch (e) {
        console.error('[upload]', file.name, e);
      }
    }
  });
  await Promise.all(workers);
  return urls.filter(Boolean);
}

function renderPhotos(p, key) {
  const el = document.getElementById('pdPhotos');

  // draft는 Storage 경로 없음 → 저장 후 업로드 유도
  if (key === DRAFT_KEY) {
    el.innerHTML = `<div class="srch-empty"><i class="ph ph-image"></i><p>먼저 저장한 후 사진을 업로드하세요</p></div>`;
    return;
  }

  const imgs = Array.isArray(p.image_urls) ? p.image_urls.filter(Boolean) : (p.image_urls ? Object.values(p.image_urls).filter(Boolean) : []);
  const photoLink = p.photo_link || '';
  const regImg = p.registration_image || '';

  el.innerHTML = `
    <div class="pd-form ${key === DRAFT_KEY ? 'is-draft' : ''}">
      <!-- 차량 사진 -->
      <div class="form-section">
        <div class="form-section-title">
          차량 사진 <span class="form-section-hint">${imgs.length}/${MAX_PHOTOS}</span>
        </div>
        <div class="form-section-body">
          <label class="pd-dropzone" id="pdDropzone" for="pdPhotoFile">
            <i class="ph ph-upload-simple" aria-hidden="true"></i>
            <div class="pd-dropzone-text">이미지를 끌어놓거나 클릭해서 파일 선택</div>
            <div class="pd-dropzone-hint">최대 ${MAX_PHOTOS}장 · 첫 번째 이미지 = 대표</div>
            <input type="file" id="pdPhotoFile" multiple hidden accept="image/*">
          </label>
          ${imgs.length ? `
            <div class="pd-photo-grid" id="pdPhotoGrid">
              ${imgs.map((url, i) => `
                <div class="pd-photo-item" draggable="true" data-idx="${i}">
                  <img src="${url}" loading="lazy">
                  <button class="pd-photo-del" data-idx="${i}" title="삭제"><i class="ph ph-x"></i></button>
                  ${i === 0 ? '<span class="pd-photo-badge">대표</span>' : ''}
                </div>
              `).join('')}
            </div>` : ''}
        </div>
      </div>

      <!-- 사진 링크 (외부 URL) -->
      <div class="form-section">
        <div class="form-section-title">사진 링크 <span class="form-section-hint">여러 줄 · 콤마 구분</span></div>
        <div class="form-section-body">
          <textarea class="input pd-textarea" data-field="photo_link" rows="3" placeholder="https://... (moderentcar, drive 폴더 등)">${photoLink}</textarea>
        </div>
      </div>

      <!-- 등록증 (OCR) -->
      <div class="form-section">
        <div class="form-section-title">자동차등록증 <span class="form-section-hint">업로드 시 OCR로 기본정보 자동 채움</span></div>
        <div class="form-section-body">
          <div class="pd-reg-wrap">
            ${regImg
              ? `<img src="${regImg}" class="pd-reg-image">
                 <button class="btn btn-xs btn-outline pd-reg-del" id="pdRegDel"><i class="ph ph-x"></i> 제거</button>`
              : `<button class="btn btn-outline btn-sm" id="pdRegUpload"><i class="ph ph-scan"></i> 등록증 첨부하기</button>
                 <input type="file" id="pdRegFile" hidden accept="image/*">
                 <div class="pd-hint">등록증 사진을 찍거나 업로드하면 OCR로 차량번호·제조사·모델·연식을 자동 채웁니다</div>`}
          </div>
        </div>
      </div>
    </div>
  `;

  bindFormAutoSave(el, (field, value) => saveField(key, field, value));   // photo_link textarea

  // ── 차량 사진 업로드 (label for="pdPhotoFile"이 클릭 자동 트리거) ──
  const fileInput = document.getElementById('pdPhotoFile');

  const uploadPhotos = async (files) => {
    const imgFiles = files.filter(f => f.type.startsWith('image/'));
    if (!imgFiles.length) return;

    // 중복 제거 (같은 파일 두 번 드래그된 경우)
    const seen = new Set();
    const unique = imgFiles.filter(f => { const s = fileSig(f); if (seen.has(s)) return false; seen.add(s); return true; });

    const remaining = MAX_PHOTOS - imgs.length;
    if (remaining <= 0) { showToast(`사진 최대 ${MAX_PHOTOS}장`); return; }
    const target = unique.slice(0, remaining);
    if (unique.length > remaining) showToast(`${remaining}장만 업로드됨 (최대 ${MAX_PHOTOS})`);

    const urls = await uploadParallel(
      target,
      (file, i) => `product-images/${key}/car_${Date.now()}_${i}_${file.name}`
    );
    const next = [...imgs, ...urls];
    await updateRecord(`products/${key}`, { image_urls: next });
    showToast(`${urls.length}장 업로드 완료${urls.length !== target.length ? ` (${target.length - urls.length}장 실패)` : ''}`);
  };

  fileInput?.addEventListener('change', async () => {
    await uploadPhotos(Array.from(fileInput.files));
    fileInput.value = '';
  });

  // ── dropzone: 외부 파일 드롭 ──
  const dropzone = document.getElementById('pdDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        dropzone.classList.add('is-drop-target');
      }
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-drop-target'));
    dropzone.addEventListener('drop', async (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      dropzone.classList.remove('is-drop-target');
      await uploadPhotos(Array.from(e.dataTransfer.files));
    });
  }

  // ── 그리드 내부: 순서 변경만 ──
  const grid = document.getElementById('pdPhotoGrid');
  if (grid) {

    let dragIdx = null;
    grid.querySelectorAll('.pd-photo-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        dragIdx = Number(item.dataset.idx);
        item.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => item.classList.remove('is-dragging'));
      item.addEventListener('dragover', (e) => {
        if (dragIdx == null) return;
        e.preventDefault();
        item.classList.add('is-drop-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('is-drop-over'));
      item.addEventListener('drop', async (e) => {
        if (dragIdx == null) return;
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('is-drop-over');
        const to = Number(item.dataset.idx);
        if (to === dragIdx) { dragIdx = null; return; }
        const next = [...imgs];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(to, 0, moved);
        dragIdx = null;
        await updateRecord(`products/${key}`, { image_urls: next });
      });
    });
  }

  el.querySelectorAll('.pd-photo-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      const next = [...imgs];
      next.splice(idx, 1);
      await updateRecord(`products/${key}`, { image_urls: next });
      showToast('삭제됨');
    });
  });

  // ── 등록증 업로드 + OCR ──
  const regInput = document.getElementById('pdRegFile');
  document.getElementById('pdRegUpload')?.addEventListener('click', () => regInput.click());
  regInput?.addEventListener('change', async () => {
    const file = regInput.files[0];
    regInput.value = '';
    if (!file) return;
    showToast('등록증 업로드 중...');
    try {
      const path = `product-images/${key}/reg_${Date.now()}_${file.name}`;
      const { url } = await uploadImage(path, file);
      await updateRecord(`products/${key}`, { registration_image: url });
      showToast('등록증 업로드 완료');

      // OCR — 준비 중 (추후 Firebase Function + Vision API 연결)
      const ocr = await tryOCR(url, file);
      if (ocr && Object.keys(ocr).length) {
        await updateRecord(`products/${key}`, ocr);
        showToast(`OCR: ${Object.keys(ocr).length}개 필드 자동 채움`);
      }
    } catch (e) {
      console.error('[reg upload]', e);
      showToast('등록증 업로드 실패');
    }
  });

  document.getElementById('pdRegDel')?.addEventListener('click', async () => {
    if (!confirm('등록증을 제거할까요?')) return;
    await updateRecord(`products/${key}`, { registration_image: null });
    showToast('등록증 제거됨');
  });
}

/** 등록증 OCR — Google Vision TEXT_DETECTION + 등록증 파서 */
async function tryOCR(_url, file) {
  try {
    const { ocrFile } = await import('../core/ocr.js');
    const { parseVehicleRegistration } = await import('../core/ocr-parsers/vehicle-registration.js');
    showToast('OCR 분석 중...');
    const { text } = await ocrFile(file);
    if (!text || text.length < 20) return null;
    const parsed = parseVehicleRegistration(text);
    // 빈 값 제거
    for (const k of Object.keys(parsed)) if (!parsed[k]) delete parsed[k];
    return Object.keys(parsed).length ? parsed : null;
  } catch (e) {
    console.error('[OCR]', e);
    showToast('OCR 실패 — 수동 입력해주세요');
    return null;
  }
}

/** 제조사/모델/세부모델 select — change 시 저장 + 하위 레벨 초기화 */
function bindPicker(el, p, key) {
  el.querySelectorAll('.pd-hero-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const field = sel.dataset.field;
      let value = sel.value;
      if (value === '__new__') {
        const labels = { maker: '제조사', model: '모델', sub_model: '세부모델' };
        const input = prompt(`새 ${labels[field]} 이름:`);
        if (!input || !input.trim()) { sel.value = p[field] || ''; return; }
        value = input.trim();
      }
      const patch = { [field]: value };
      if (field === 'maker') { patch.model = ''; patch.sub_model = ''; }
      else if (field === 'model') { patch.sub_model = ''; }

      // 세부모델 선택 시 car_models 마스터에서 vehicle_class(category)·fuel_type auto-derive
      //  (이미 값이 있으면 덮어쓰지 않음)
      if (field === 'sub_model' && value) {
        const master = findCarModel({ maker: p.maker, model: p.model, sub_model: value });
        if (master) {
          if (!p.vehicle_class && master.category) patch.vehicle_class = master.category;
          if (!p.fuel_type && master.fuel_type) patch.fuel_type = master.fuel_type;
        } else if (p.maker && p.model) {
          // 마스터에 없는 조합 → stub 등록 (category 등 나머지는 jpkerp car-master에서 보완)
          registerCarModelStub(p.maker, p.model, value);
        }
      }

      Object.assign(p, patch);
      if (key === DRAFT_KEY) {
        Object.assign(draftProduct, patch);
      } else {
        await updateRecord(`products/${key}`, patch);
      }
      renderAsset(p, key);
    });
  });
}

/** hero 차량번호 큰 입력 — 블러/엔터 저장 (draft면 메모리만) */
function bindHeroCarNo(el, p, key) {
  const inp = el.querySelector('.pd-hero-carno');
  if (!inp) return;
  let original = inp.value;
  inp.addEventListener('focus', () => { original = inp.value; });
  inp.addEventListener('blur', async () => {
    const v = inp.value.trim();
    if (v === original) return;
    p.car_number = v;
    if (key === DRAFT_KEY) {
      if (draftProduct) draftProduct.car_number = v;
    } else {
      try {
        await updateRecord(`products/${key}`, { car_number: v });
        showToast('차량번호 저장됨');
      } catch (err) { showToast('저장 실패'); }
    }
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
}

function setState(el, state) {
  if (!el) return;
  el.classList.remove('is-editing', 'is-saved', 'is-error');
  if (state === 'editing')   { el.innerHTML = '<i class="ph ph-pencil-simple"></i> 수정 중'; el.classList.add('is-editing'); }
  else if (state === 'saved'){ el.innerHTML = '<i class="ph ph-check"></i> 저장됨';         el.classList.add('is-saved'); }
  else if (state === 'error'){ el.innerHTML = '<i class="ph ph-warning"></i> 저장 실패';     el.classList.add('is-error'); }
  else                       { el.innerHTML = ''; }
}

/** 기존 products에서 해당 필드의 unique 값 추출 (자동완성 datalist용) */
function uniqueValues(field) {
  const s = new Set();
  for (const p of allProducts) {
    const v = p[field];
    if (v && typeof v === 'string') s.add(v.trim());
  }
  return [...s].filter(Boolean).sort();
}

// fi/fs → 공용 form-fields.js 사용
import { fieldInput as fi, fieldSelect as fs, fieldTextarea as fta, formSection, bindAutoSave as bindFormAutoSave } from '../core/form-fields.js';

export function unmount() {
  unsubProducts?.();
  _pdListDelegated = null;
}
