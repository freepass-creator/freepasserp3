/**
 * 상품관리 — 4패널: 목록 | 등록(폼) | 가격 | 사진
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, setRecord, softDelete } from '../firebase/db.js';
import { uploadImage } from '../firebase/storage-helper.js';
import { showToast } from '../core/toast.js';
import { empty, trimMinusSub } from '../core/format.js';
import { initWs4Resize } from '../core/resize.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';
import { openContextMenu } from '../core/context-menu.js';
import { firstProductImage, supportedDriveSource, productImages, productExternalImages } from '../core/product-photos.js';
import { openFullscreen } from '../core/product-detail-render.js';
import { topBadgesHtml, reviewOverlayHtml } from '../core/product-badges.js';
import { getMakers, getModelsByMaker, getSubModels, findCarModel } from '../core/car-models.js';
import { renderExcelTable } from '../core/excel-table.js';
import { normalizeYear, normalizeProductType } from '../core/normalize.js';

let unsubProducts = null;
let allProducts = [];
let activeKey = null;
let viewMode = 'card';
// 상품 복사 클립보드 — 복사 버튼으로 메모리에 담고, 붙여넣기 버튼으로 다른 상품에 적용
let _productClipboard = null;

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
          <span>상품 목록</span>
          <span style="display:flex;gap:var(--sp-1);">
            <button class="btn btn-sm btn-outline" id="pdViewToggle"><i class="ph ph-table"></i> 엑셀보기</button>
            <input type="file" id="pdRegQuickFile" accept="image/*,application/pdf" hidden>
            <button class="btn btn-sm btn-outline" id="pdRegUpload" title="차량등록증으로 자동 등록"><i class="ph ph-identification-card"></i> 등록증</button>
            <button class="btn btn-sm btn-outline" id="pdImport" title="Google Sheets 일괄 임포트"><i class="ph ph-google-logo"></i> 시트</button>
            <button class="btn btn-sm btn-primary" id="pdNew"><i class="ph ph-plus"></i> 신규등록</button>
          </span>
        </div>
        <div class="ws4-search">
          <input class="input input-sm" id="pdSearch" placeholder="차량번호, 모델..." >
          <div class="ws4-search-chips" id="pdStatusChips"></div>
        </div>
        <div class="ws4-body" id="pdList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="asset">
        <div class="ws4-head">
          <span>상품 등록</span>
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
        <div class="ws4-head">상품 사진</div>
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

  document.getElementById('pdViewToggle')?.addEventListener('click', () => {
    viewMode = viewMode === 'excel' ? 'card' : 'excel';
    const btn = document.getElementById('pdViewToggle');
    if (btn) btn.innerHTML = viewMode === 'excel' ? '<i class="ph ph-cards"></i> 카드보기' : '<i class="ph ph-table"></i> 엑셀보기';
    renderList();
  });

  // 새 상품 등록 (빈 카드)
  document.getElementById('pdNew')?.addEventListener('click', async () => {
    await createProduct({});
  });

  // Google Sheets 일괄 임포트
  document.getElementById('pdImport')?.addEventListener('click', async () => {
    const url = prompt('Google Sheets URL을 붙여넣으세요\n(시트는 "링크 있는 사용자 보기" 이상 권한 필요)\n\n헤더 예시: 차량번호, 제조사, 모델명, 세부모델, 연식, 주행, 연료, 24개월대여료, 24개월보증금...');
    if (!url) return;
    const btn = document.getElementById('pdImport');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner"></i> 가져오는 중...';
    btn.disabled = true;
    try {
      const { parseProductsFromSheets } = await import('../core/product-import.js');
      const rows = await parseProductsFromSheets(url);
      if (!rows.length) { showToast('차량번호가 있는 행이 없습니다'); return; }
      if (!confirm(`${rows.length}건의 상품을 등록하시겠습니까?`)) return;
      const me = store.currentUser || {};
      let ok = 0, skip = 0;
      for (const row of rows) {
        try {
          const uid = `P_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const payload = {
            ...row,
            product_uid: uid,
            product_code: row.product_code || (row.car_number && (row.provider_company_code || me.company_code) ? `${row.car_number}_${row.provider_company_code || me.company_code}` : uid),
            vehicle_status: row.vehicle_status || '출고가능',
            product_type: row.product_type || '중고렌트',
            provider_company_code: row.provider_company_code || me.company_code || '',
            created_at: Date.now(),
            created_by: me.uid || '',
          };
          await setRecord(`products/${uid}`, payload);
          ok++;
        } catch (e) { skip++; console.error('[import]', e); }
      }
      showToast(`✓ ${ok}건 등록, ${skip}건 실패`);
    } catch (e) {
      console.error(e);
      showToast(e.message || '임포트 실패', 'error');
    } finally {
      btn.innerHTML = orig;
      btn.disabled = false;
    }
  });

  // 차량등록증 업로드 → OCR → 자동 등록
  const regFileInput = document.getElementById('pdRegQuickFile');
  document.getElementById('pdRegUpload')?.addEventListener('click', () => regFileInput?.click());
  regFileInput?.addEventListener('change', async () => {
    const file = regFileInput.files?.[0];
    if (!file) return;
    regFileInput.value = '';
    const btn = document.getElementById('pdRegUpload');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner"></i> 분석 중...';
    btn.disabled = true;
    try {
      const { ocrVehicleRegistration } = await import('../core/vehicle-ocr.js');
      const { matchFromRegistration } = await import('../core/vehicle-master.js');
      const result = await ocrVehicleRegistration(file);
      const { car_number, year, vin, fuel_type, displacement, registration_date,
              owner, type_number, engine_type, seats, usage_type, matched } = result;
      if (!car_number) {
        showToast('차량번호를 인식하지 못했습니다');
        return;
      }
      // 차종 마스터 매칭 (type_number → car_name → maker+model+기간)
      const masterHit = matchFromRegistration({
        maker: matched?.maker,
        model: matched?.model,
        sub_model: matched?.sub_model,
        type_number,
        engine_type,
        first_registration_date: registration_date,
      }, store.carModels || []);
      await createProduct({
        car_number,
        // 제조사스펙 (매칭된 마스터 우선, 없으면 OCR 결과)
        maker:        masterHit?.maker || matched?.maker || '',
        model:        masterHit?.model || matched?.model || '',
        sub_model:    masterHit?.sub_model || masterHit?.sub || matched?.sub_model || '',
        vehicle_class: masterHit?.vehicle_class || masterHit?.category || '',
        fuel_type:    masterHit?.fuel_type || fuel_type || '',
        engine_cc:    masterHit?.displacement || displacement || '',
        seats:        masterHit?.seats || seats || '',
        drive_type:   masterHit?.drive_type || '',
        transmission: masterHit?.transmission || '',
        // 등록증스펙
        year:         year || '',
        vin:          vin || '',
        registration_date: registration_date || '',
        first_registration_date: registration_date || '',
        model_code:   type_number || masterHit?.type_number_pattern || masterHit?.code || '',
        engine_code:  engine_type || masterHit?.engine_type || '',
        usage:        usage_type || '',
        owner_name:   owner || '',
      });
      showToast(`${car_number} 자동 입력${masterHit ? ` · 차종 매칭: ${masterHit.sub || masterHit.sub_model}` : ''}`);
    } catch (e) {
      console.error(e);
      showToast('OCR 실패 — 수동 입력하세요', 'error');
    } finally {
      btn.innerHTML = original;
      btn.disabled = false;
    }
  });

  // 현재 선택된 상품 복제 — 식별·사진 제외한 모든 필드 복사

  unsubProducts = watchCollection('products', (data) => {
    allProducts = data.filter(p => !p._deleted);
    store.products = allProducts;
    renderList();
    updateBrief();
  });
}

/** 신규 상품 — Firebase 즉시 커밋 (draft 모드 없음, 입력칸은 자동저장) */
async function createProduct(source = {}) {
  const me = store.currentUser || {};
  const thisYear = String(new Date().getFullYear());
  const uid = `P_${Date.now()}`;

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

  const payload = {
    product_uid: uid,
    product_code: uid,                           // 차량번호 입력 후 재계산 (bindHeroCarNo)
    car_number: '',
    vehicle_status: '출고가능',
    product_type: '중고렌트',
    year: thisYear,
    ...copied,
    provider_company_code: me.company_code || source.provider_company_code || '',
    partner_code: me.partner_code || source.partner_code || '',
    image_urls: [],
    doc_images: [],
    created_at: Date.now(),
    created_by: me.uid || me.user_code || '',
  };

  try {
    await setRecord(`products/${uid}`, payload);
    activeKey = uid;
    renderList();
    setTimeout(() => loadAll(uid), 300);
    showToast(Object.keys(source).length ? '복제됨 — 차량번호를 입력하세요' : '신규 등록됨 — 차량번호를 입력하세요');
  } catch (e) {
    console.error('[createProduct]', e);
    showToast('등록 실패');
  }
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

  if (viewMode === 'excel') {
    renderExcelTable(el, {
      cols: [
        { key: 'car_number', label: '차량번호', width: 90, pin: 'left', filter: 'search' },
        { key: 'vehicle_status', label: '상태', width: 72, filter: 'check' },
        { key: 'product_type', label: '구분', width: 72, filter: 'check', render: (r) => normalizeProductType(r.product_type) },
        { key: 'maker', label: '제조사', width: 62, filter: 'check' },
        { key: 'model', label: '모델명', width: 90, filter: 'check' },
        { key: 'sub_model', label: '세부모델', width: 140, filter: 'search' },
        { key: 'trim_name', label: '세부트림', width: 140, filter: 'search', render: (r) => r.trim_name || r.trim || '' },
        { key: 'year', label: '연식', width: 60, filter: 'check', render: (r) => normalizeYear(r.year) },
        { key: 'mileage', label: '주행', width: 70, align: 'right', render: (r) => r.mileage ? Number(r.mileage).toLocaleString() : '' },
        { key: 'fuel_type', label: '연료', width: 52, filter: 'check' },
        { key: 'ext_color', label: '색상', width: 72, filter: 'check', render: (r) => [r.ext_color, r.int_color].filter(Boolean).join('/') },
        { key: 'provider_company_code', label: '공급코드', width: 90, filter: 'check' },
      ],
      data: list,
      activeKey: activeKey,
      keyField: '_key',
      onRowClick: async (p) => {
        activeKey = p._key;
        loadAll(p._key);
        const { setBreadcrumbTail } = await import('../core/breadcrumb.js');
        const name = [p.maker, p.sub_model, trimMinusSub(p.sub_model, p.trim_name || p.trim)].filter(Boolean).join(' ');
        setBreadcrumbTail({ icon: 'ph ph-car-simple', label: name || p.car_number || '차량', sub: p.car_number || '' });
      },
      onContextMenu: (p, e) => openContextMenu(e, buildProductMenu(p)),
    });
    return;
  }

  renderListCards(el, list);
}

/** 상품 우클릭 메뉴 — 엑셀뷰·카드뷰 공통 (상태변경/수정/복제/삭제) */
function buildProductMenu(p) {
  const role = store.currentUser?.role;
  const me = store.currentUser || {};
  const canEdit = role === 'admin' || role === 'provider' && p.provider_company_code === me.company_code;
  const canDelete = role === 'admin' || p.created_by === me.user_code;

  const items = [];

  // 상태변경 — 가장 자주 쓰는 액션, 서브메뉴로 접근
  if (canEdit) {
    items.push({
      icon: 'ph ph-flag',
      label: `상태: ${p.vehicle_status || '-'}`,
      submenu: STATUS_OPTS.map(s => ({
        label: s,
        active: p.vehicle_status === s,
        action: async () => {
          await updateRecord(`products/${p._key}`, { vehicle_status: s });
          showToast(`상태 → ${s}`);
        },
      })),
    });
    items.push({ divider: true });
  }

  items.push(
    { icon: 'ph ph-pencil-simple', label: '수정', action: () => {
      activeKey = p._key;
      loadAll(p._key);
    }},
    { icon: 'ph ph-copy', label: '복제', action: () => createProduct(p).then(() => showToast(`${p.model || '상품'} 복제됨`)) },
  );

  if (canDelete) {
    items.push({ divider: true });
    items.push({ icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
      if (!confirm('이 상품을 삭제하시겠습니까?')) return;
      await softDelete(`products/${p._key}`);
      if (activeKey === p._key) activeKey = null;
      showToast('삭제됨');
    }});
  }

  return items;
}

/** 카드 뷰 렌더링 */
function renderListCards(el, list) {
  const tone = s => s === '즉시출고' ? 'info' : s === '출고가능' ? 'green' : s === '상품화중' ? 'muted' : s === '출고협의' ? 'purple' : s === '출고불가' ? 'err' : 'muted';

  el.innerHTML = list.map(p => {
    const thumb = firstProductImage(p);
    const driveFolderUrl = !thumb ? supportedDriveSource(p) : '';
    const _trim = trimMinusSub(p.sub_model, p.trim_name || p.trim);
    const title = [p.sub_model, _trim].filter(v => v && v !== '-').join(' · ') || p.model || '-';
    const color = [p.ext_color, p.int_color].filter(Boolean).join('/');
    const sub = [
      p.provider_company_code,
      p.car_number,
      p.maker,
      normalizeYear(p.year),
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
      const name = [p.maker, p.sub_model, trimMinusSub(p.sub_model, p.trim_name || p.trim)].filter(Boolean).join(' ');
      setBreadcrumbTail({ icon: 'ph ph-car-simple', label: name || p.car_number || '차량', sub: p.car_number || '' });
    }
  });

  el.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.srch-item');
    if (!item) return;
    const p = allProducts.find(x => x._key === item.dataset.key);
    if (!p) return;
    openContextMenu(e, buildProductMenu(p));
  });
}

function loadAll(key) {
  const p = allProducts.find(x => x._key === key);
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
/* picker 옵션 — 차종 마스터 우선, 폴백으로 products 에서 추출.
 *  정렬: 제조사·모델 → 보유대수 내림차순, 세부모델 → 연식 내림차순 (car-models.js) */
function pickerMakers() {
  const fromMaster = getMakers();
  if (fromMaster.length) return fromMaster;
  const s = new Set();
  for (const p of allProducts) if (p.maker) s.add(p.maker.trim());
  return [...s].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
}
function pickerModels(maker) {
  if (!maker) return [];
  const fromMaster = getModelsByMaker(maker);
  if (fromMaster.length) return fromMaster;
  const s = new Set();
  for (const p of allProducts) if (p.maker === maker && p.model) s.add(p.model.trim());
  return [...s].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
}
function pickerSubs(maker, model) {
  if (!maker || !model) return [];
  const fromMaster = getSubModels(maker, model);
  if (fromMaster.length) return fromMaster;
  const s = new Set();
  for (const p of allProducts) if (p.maker === maker && p.model === model && p.sub_model) s.add(p.sub_model.trim());
  return [...s].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 제조사별/모델별 상품 보유수 — 드롭다운에 (N) 표시 */
function pickerCounts() {
  const byMaker = new Map();
  const byMakerModel = new Map();
  for (const p of allProducts) {
    if (p._deleted || p.status === 'deleted') continue;
    const mk = p.maker || '';
    const md = p.model || '';
    if (mk) byMaker.set(mk, (byMaker.get(mk) || 0) + 1);
    if (mk && md) byMakerModel.set(`${mk}|${md}`, (byMakerModel.get(`${mk}|${md}`) || 0) + 1);
  }
  return { byMaker, byMakerModel };
}

/** 제조사·모델·세부모델 연결 드롭다운 — bindAutoSave 가 아니라 bindPicker 가 직접 제어
 *  정렬: 제조사·모델 → 보유대수 순 (ex: "현대 (42)"), 세부모델 → 최신 연식 순 */
function renderPicker(p) {
  const curMk = p.maker || '';
  const curMd = p.model || '';
  const curSub = p.sub_model || '';
  const makers = pickerMakers();
  const models = pickerModels(curMk);
  const subs = pickerSubs(curMk, curMd);
  const { byMaker, byMakerModel } = pickerCounts();
  const isAdmin = store.currentUser?.role === 'admin';

  const labelOf = (field, o) => {
    if (field === 'maker') {
      const c = byMaker.get(o) || 0;
      return c > 0 ? `${o} (${c})` : o;
    }
    if (field === 'model') {
      const c = byMakerModel.get(`${curMk}|${o}`) || 0;
      return c > 0 ? `${o} (${c})` : o;
    }
    return o;                               // 세부모델은 이름 그대로 (이미 연식 suffix 포함)
  };

  const sel = (label, field, cur, list) => {
    const opts = [...list];
    if (cur && !opts.includes(cur)) opts.unshift(cur);
    return `
      <div class="form-row">
        <span class="form-row-label">${label}</span>
        <div class="form-row-control">
          <select class="contract-field-input pd-picker-select" data-picker-field="${field}">
            <option value="">-</option>
            ${opts.map(o => `<option value="${o}" ${o === cur ? 'selected' : ''}>${labelOf(field, o)}</option>`).join('')}
            ${isAdmin ? `<option value="__new__">+ 직접 입력</option>` : ''}
          </select>
        </div>
      </div>
    `;
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
    <div class="pd-form" style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">

      <div class="form-section">
        <div class="form-section-title">
          <span><i class="ph ph-identification-card"></i> 기본정보</span>
          <span style="display:flex;gap:var(--sp-1);margin-left:auto;">
            ${_productClipboard ? `<button class="btn btn-xs btn-outline" id="pdPaste" title="복사된 차량 정보 붙여넣기 (차량번호 제외)"><i class="ph ph-clipboard-text"></i> 붙여넣기</button>` : ''}
          </span>
        </div>
        <div class="form-section-body">
          ${fi('차량번호','car_number',p)}
          ${fi('차대번호','vin',p)}
          ${fv('공급사코드', providerCode)}
          ${fv('상품코드', productCode)}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-car-simple"></i> 제조사스펙 <span class="form-section-hint">차종 마스터에서 자동 채움</span></div>
        <div class="form-section-body">
          ${renderPicker(p)}
          ${fi('세부트림','trim_name',p,{ autocomplete: true })}
          ${fi('선택옵션','options',p,{ full: true })}
          ${fi('외장색','ext_color',p,{ autocomplete: true })}
          ${fi('내장색','int_color',p,{ autocomplete: true })}
          ${fs('구동방식','drive_type',p,['전륜(FF)','후륜(FR)','4륜(AWD)','4륜(4WD)'])}
          ${fs('차종구분','vehicle_class',p,CLASS_OPTS)}
          ${fi('차량가격 (원)','vehicle_price',p,{ num: true })}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-file-text"></i> 등록증스펙 <span class="form-section-hint">차량등록증 OCR 로 자동 입력 가능</span></div>
        <div class="form-section-body">
          ${fi('차대번호(VIN)','vin',p)}
          ${fs('연식','year',p,YEAR_OPTS)}
          ${fi('배기량 (cc)','engine_cc',p,{ num: true })}
          ${fi('승차정원','seats',p,{ num: true })}
          ${fs('연료(동력)','fuel_type',p,FUEL_OPTS)}
          ${fi('형식번호','model_code',p)}
          ${fi('원동기형식','engine_code',p)}
          ${fi('최초등록일','first_registration_date',p)}
          ${fs('용도','usage',p,['자가용','영업용','관용'])}
          ${fi('소유자명','owner_name',p)}
          ${fi('변속기','transmission',p)}
          ${fi('제작연월','manufacture_date',p)}
          ${fi('차령만료일','vehicle_age_expiry_date',p)}
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

  // 패널 헤드 — 항상 복사/신규/삭제 (저장은 자동, 별도 버튼 없음)
  const headActions = document.getElementById('pdAssetActions');
  if (headActions) {
    headActions.innerHTML = `
      <button class="btn btn-xs btn-outline" id="pdCopy" title="현재 차량 정보 복사 (붙여넣기로 다른 차량에 적용)"><i class="ph ph-copy"></i> 복사</button>
      <button class="btn btn-xs btn-outline" id="pdNewFromHead" title="신규 등록"><i class="ph ph-plus"></i> 신규</button>
      <button class="btn btn-xs btn-outline pd-delete" id="pdDelete" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>
    `;
  }

  bindPicker(el, p, key);
  bindFormAutoSave(el, (field, value) => saveField(key, field, value));

  // 차량번호·파트너 바뀌면 상품코드 자동 재조합
  el.querySelector('[data-field="car_number"]')?.addEventListener('blur', () => {
    const newCarNo = el.querySelector('[data-field="car_number"]').value.trim();
    const newCode = newCarNo && partnerCode ? `${newCarNo}_${partnerCode}` : '';
    if (newCode && newCode !== p.product_code) {
      p.product_code = newCode;
      updateRecord(`products/${key}`, { product_code: newCode });
      const inputs = el.querySelectorAll('input[readonly]');
      inputs.forEach(inp => { if (inp.value.includes('_')) inp.value = newCode; });
    }
  });

  // 복사: 현재 차량 정보를 메모리 클립보드에 저장 (식별자 제외)
  headActions?.querySelector('#pdCopy')?.addEventListener('click', () => {
    const EXCLUDE = new Set([
      '_key', '_deleted', 'product_uid', 'product_code', 'car_number', 'vin',
      'image_urls', 'images', 'photos', 'image_url', 'photo_link',
      'doc_images', 'created_at', 'created_by', 'updated_at',
    ]);
    const snap = {};
    for (const [k, v] of Object.entries(p)) {
      if (EXCLUDE.has(k)) continue;
      if (v == null || v === '') continue;
      snap[k] = v;
    }
    _productClipboard = snap;
    showToast(`${p.car_number || '차량'} 정보 복사됨 — 다른 차량에서 붙여넣기 가능`);
    renderAsset(p, key);   // 붙여넣기 버튼 노출 갱신
  });

  // 붙여넣기: 클립보드 정보를 현재 차량에 적용 (차량번호 등 식별자는 유지)
  el.querySelector('#pdPaste')?.addEventListener('click', async () => {
    if (!_productClipboard) return;
    if (!confirm('복사된 차량 정보를 현재 차량에 적용합니다. 차량번호/차대번호는 유지됩니다. 계속할까요?')) return;
    const patch = { ..._productClipboard };
    Object.assign(p, patch);
    try {
      await updateRecord(`products/${key}`, patch);
      renderAsset(p, key);
      renderTerms(p, key);
      showToast('붙여넣기 완료');
    } catch (e) {
      console.error('[paste]', e);
      showToast('붙여넣기 실패');
    }
  });

  // 신규: 빈 차량 등록 (즉시 Firebase 커밋)
  headActions?.querySelector('#pdNewFromHead')?.addEventListener('click', async () => {
    await createProduct({});
  });

  headActions?.querySelector('#pdDelete')?.addEventListener('click', async () => {
    if (!confirm('이 상품을 삭제하시겠습니까?')) return;
    await softDelete(`products/${key}`);
    activeKey = null;
    showToast('삭제됨');
  });
}

/* ── 공용 필드 저장 헬퍼 — Firebase 즉시 반영 (자동저장) ── */
async function saveField(key, field, value) {
  await updateRecord(`products/${key}`, { [field]: value });
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
    <div class="pd-form" style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
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
        <div class="form-section-title">기간별 가격 <span class="form-section-hint">빈 값/0은 상세 미노출</span></div>
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
      await updateRecord(`products/${key}`, { [`price/${m}/${t}`]: saved });
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

  const imgs = productImages(p);                          // 업로드된 사진 (image_urls 등)
  const extImgs = productExternalImages(p);               // 외부 직접 URL 링크 (바로 img 가능)
  const driveSource = supportedDriveSource(p);            // Drive 폴더·moderentcar (서버 해석 필요)
  const allImgs = [...new Set([...imgs, ...extImgs])];   // 뷰어용 통합 리스트
  const photoLink = p.photo_link || '';
  const regImg = p.registration_image || '';

  el.innerHTML = `
    <div class="pd-form">
      <!-- 차량 사진 -->
      <div class="form-section">
        <div class="form-section-title">
          차량 사진 <span class="form-section-hint">${imgs.length}장 업로드 · ${extImgs.length}개 링크${driveSource ? ' · 폴더 1개' : ''}</span>
        </div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          <label class="pd-dropzone" id="pdDropzone" for="pdPhotoFile">
            <i class="ph ph-upload-simple" aria-hidden="true"></i>
            <div class="pd-dropzone-text">이미지를 끌어놓거나 클릭해서 파일 선택</div>
            <div class="pd-dropzone-hint">최대 ${MAX_PHOTOS}장 · 첫 번째 이미지 = 대표 · 클릭시 크게보기</div>
            <input type="file" id="pdPhotoFile" multiple hidden accept="image/*">
          </label>
          ${imgs.length ? `
            <div class="pd-photo-grid" id="pdPhotoGrid">
              ${imgs.map((url, i) => `
                <div class="pd-photo-item" draggable="true" data-idx="${i}">
                  <img src="${url}" class="pd-photo-thumb" data-view="${i}" loading="lazy" style="cursor:zoom-in;">
                  <button class="pd-photo-del" data-idx="${i}" title="삭제"><i class="ph ph-x"></i></button>
                  ${i === 0 ? '<span class="pd-photo-badge">대표</span>' : ''}
                </div>
              `).join('')}
            </div>` : ''}
          ${extImgs.length ? `
            <div style="margin-top:var(--sp-2);padding-top:var(--sp-2);border-top:1px solid var(--c-border-soft);">
              <div style="font-size:var(--fs-2xs);color:var(--c-text-muted);margin-bottom:var(--sp-1);">외부 링크 사진 (${extImgs.length})</div>
              <div class="pd-photo-grid" id="pdExtPhotoGrid">
                ${extImgs.map((url, i) => `
                  <div class="pd-photo-item">
                    <img src="${url}" class="pd-photo-thumb" data-view-ext="${i}" loading="lazy" style="cursor:zoom-in;">
                    <a href="${url}" target="_blank" class="pd-photo-del" title="원본 링크 열기" style="background:var(--c-overlay-med);"><i class="ph ph-arrow-square-out"></i></a>
                  </div>
                `).join('')}
              </div>
            </div>` : ''}
          ${driveSource ? `
            <div style="margin-top:var(--sp-2);padding:var(--sp-2);background:var(--c-bg-sub);border-radius:var(--ctrl-r);display:flex;align-items:center;gap:var(--sp-2);">
              <i class="ph ph-folder-simple" style="font-size:20px;color:var(--c-text-muted);"></i>
              <div style="flex:1;min-width:0;">
                <div style="font-size:var(--fs-xs);color:var(--c-text);">외부 폴더 · 자동 해석 중...</div>
                <div style="font-size:var(--fs-2xs);color:var(--c-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${driveSource}</div>
              </div>
              <a href="${driveSource}" target="_blank" class="btn btn-xs btn-outline"><i class="ph ph-arrow-square-out"></i> 링크</a>
            </div>` : ''}
        </div>
      </div>

      <!-- 사진 링크 (외부 URL) -->
      <div class="form-section">
        <div class="form-section-title">사진 링크 <span class="form-section-hint">여러 줄 · 콤마 구분</span></div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          <textarea class="input pd-textarea" data-field="photo_link" rows="3" placeholder="https://... (moderentcar, drive 폴더 등)">${photoLink}</textarea>
        </div>
      </div>

      <!-- 차량등록증 (OCR) -->
      <div class="form-section">
        <div class="form-section-title">차량등록증 <span class="form-section-hint">이미지 또는 PDF · Claude Vision OCR 자동 입력</span></div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          ${regImg
            ? `<div style="position:relative;display:inline-block;">
                 ${regImg.toLowerCase().endsWith('.pdf') || (p.registration_type === 'pdf')
                   ? `<a href="${regImg}" target="_blank" style="display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3);border:1px solid var(--c-border);border-radius:var(--ctrl-r);background:var(--c-bg-sub);"><i class="ph ph-file-pdf" style="font-size:32px;color:var(--c-err);"></i>차량등록증.pdf</a>`
                   : `<img src="${regImg}" class="pd-reg-image" style="max-width:100%;border-radius:var(--ctrl-r);border:1px solid var(--c-border);">`}
                 <button class="btn btn-xs btn-outline pd-reg-del" id="pdRegDel" style="position:absolute;top:4px;right:4px;"><i class="ph ph-x"></i> 제거</button>
               </div>`
            : `<label class="pd-dropzone" id="pdRegDropzone" for="pdRegFile">
                 <i class="ph ph-identification-card" aria-hidden="true"></i>
                 <div class="pd-dropzone-text">차량등록증을 끌어놓거나 클릭해서 업로드</div>
                 <div class="pd-dropzone-hint">이미지(JPG/PNG) 또는 PDF · OCR로 차량번호·제조사·모델·연식 자동 채움</div>
                 <input type="file" id="pdRegFile" hidden accept="image/*,application/pdf">
               </label>`}
        </div>
      </div>
    </div>
  `;

  bindFormAutoSave(el, (field, value) => saveField(key, field, value));   // photo_link textarea

  // ── 썸네일 클릭 → 풀스크린 뷰어 (업로드 + 외부 링크 통합) ──
  el.querySelectorAll('.pd-photo-thumb').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      const vi = img.dataset.view != null ? Number(img.dataset.view) : null;       // 업로드 인덱스
      const vx = img.dataset.viewExt != null ? Number(img.dataset.viewExt) : null; // 외부링크 인덱스
      const startIdx = vi != null ? vi : (vx != null ? imgs.length + vx : 0);
      openFullscreen(allImgs, startIdx);
    });
  });

  // ── Drive 폴더 자동 해석 → 썸네일 추가 렌더 ──
  if (driveSource && !p._drive_folder_virtual) {
    import('../core/drive-photos.js').then(m => {
      m.fetchDriveFolderImages(driveSource).then(urls => {
        if (!urls?.length) return;
        // 현재 선택된 상품이 바뀌지 않았을 때만 다시 렌더
        if (activeKey === key) {
          p._drive_folder_virtual = true;
          p.image_urls = [...(imgs || []), ...urls];
          renderPhotos(p, key);
        }
      }).catch(() => {});
    });
  }

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
  el.querySelectorAll('.pd-picker-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const field = sel.dataset.pickerField;
      let value = sel.value;
      // "+ 직접 입력" 선택 시 prompt
      if (value === '__new__') {
        const labels = { maker: '제조사', model: '모델', sub_model: '세부모델' };
        const input = prompt(`새 ${labels[field]} 이름:`);
        if (!input || !input.trim()) { sel.value = p[field] || ''; return; }
        value = input.trim();
      }
      const patch = { [field]: value };
      if (field === 'maker') { patch.model = ''; patch.sub_model = ''; }
      else if (field === 'model') { patch.sub_model = ''; }

      // 세부모델 선택 시 vehicle_master 스펙 auto-fill (빈 필드만)
      if (field === 'sub_model' && value) {
        const master = findCarModel({ maker: p.maker, model: p.model, sub_model: value });
        if (master) {
          // 제조사스펙 필드 일괄 자동 채움 — 이미 값이 있는 필드는 보존
          const autoFields = {
            vehicle_class: master.vehicle_class || master.category,
            fuel_type:     master.fuel_type,
            engine_cc:     master.displacement,
            seats:         master.seats,
            drive_type:    master.drive_type,
            transmission:  master.transmission,
            engine_code:   master.engine_type,
            model_code:    master.type_number_pattern || master.code,
            year:          p.year || (master.year_start ? String(master.year_start) : ''),
          };
          for (const [k, v] of Object.entries(autoFields)) {
            if (v && !p[k]) patch[k] = v;
          }
        } else if (p.maker && p.model) {
          registerCarModelStub(p.maker, p.model, value);
        }
      }

      Object.assign(p, patch);
      await updateRecord(`products/${key}`, patch);
      renderAsset(p, key);
    });
  });
}

/** hero 차량번호 큰 입력 — 블러/엔터 자동저장 */
function bindHeroCarNo(el, p, key) {
  const inp = el.querySelector('.pd-hero-carno');
  if (!inp) return;
  let original = inp.value;
  inp.addEventListener('focus', () => { original = inp.value; });
  inp.addEventListener('blur', async () => {
    const v = inp.value.trim();
    if (v === original) return;
    p.car_number = v;
    try {
      await updateRecord(`products/${key}`, { car_number: v });
      showToast('차량번호 저장됨');
    } catch (err) { showToast('저장 실패'); }
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
import { fieldInput as fi, fieldSelect as fs, fieldTextarea as fta, fieldView as fv, formSection, bindAutoSave as bindFormAutoSave } from '../core/form-fields.js';

export function unmount() {
  unsubProducts?.();
  _pdListDelegated = null;
}
