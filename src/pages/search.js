/**
 * 차량 검색 — 전체 목록 + 조건 필터로 추려짐 + 상세 + 복수 공유
 */
import { store } from '../core/store.js';
import { watchCollection, fetchCollection } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtMoney } from '../core/format.js';
import { setBreadcrumbTail, setBreadcrumbBrief } from '../core/breadcrumb.js';
import { openContextMenu } from '../core/context-menu.js';
import { navigate } from '../core/router.js';
import { downloadExcelWithFilter, PRODUCT_COLS, PRODUCT_FILTER_FIELDS } from '../core/excel-export.js';
import { first, parsePol, findPolicy, enrichProductsWithPolicy } from '../core/policy-utils.js';
import { topBadgesHtml, reviewOverlayHtml, creditOverlayHtml, needsReview } from '../core/product-badges.js';
import { productImages, productExternalImages, firstProductImage, supportedDriveSource } from '../core/product-photos.js';

let unsubProducts = null;
let allProducts = [];
let filteredProducts = [];
let selected = new Set();
let activeFilters = {};
let selectedProductKey = null;
const LIST_PERIODS = [36, 48, 60];
let sortCol = null;
let sortDir = null;
let viewMode = 'card';
let excelSortField = null;
let excelSortDir = null; // 'asc' | 'desc' | null

const FILTERS = {
  rent: {
    label: '대여료', icon: 'ph ph-currency-krw', chips: [
      { id: 'r_d50', label: '50만↓',  match: v => v > 0       && v <= 500000  },
      { id: 'r50',   label: '50만~',  match: v => v > 500000  && v <= 600000  },
      { id: 'r60',   label: '60만~',  match: v => v > 600000  && v <= 700000  },
      { id: 'r70',   label: '70만~',  match: v => v > 700000  && v <= 800000  },
      { id: 'r80',   label: '80만~',  match: v => v > 800000  && v <= 900000  },
      { id: 'r90',   label: '90만~',  match: v => v > 900000  && v <= 1000000 },
      { id: 'r100',  label: '100만~', match: v => v > 1000000 && v <= 1500000 },
      { id: 'r150',  label: '150만~', match: v => v > 1500000 && v <= 2000000 },
      { id: 'r200',  label: '200만↑', match: v => v > 2000000 },
    ]
  },
  deposit: {
    label: '보증금', icon: 'ph ph-coins', chips: [
      { id: 'd_d100', label: '100만↓', match: v => v > 0       && v <= 1000000 },
      { id: 'd100',   label: '100만~', match: v => v > 1000000 && v <= 2000000 },
      { id: 'd200',   label: '200만~', match: v => v > 2000000 && v <= 3000000 },
      { id: 'd300',   label: '300만~', match: v => v > 3000000 && v <= 5000000 },
      { id: 'd500',   label: '500만↑', match: v => v > 5000000 },
    ]
  },
  period: {
    label: '기간', icon: 'ph ph-calendar-blank',
    chips: ['1','12','24','36','48','60'].map(m => ({
      id: `p${m}`, label: `${m}개월`, match: (_, p) => Number(p?.[m]?.rent || 0) > 0
    }))
  },
  maker:    { label: '제조사',  icon: 'ph ph-factory',      chips: [], dynamic: true, field: 'maker' },
  model:    { label: '모델명',  icon: 'ph ph-car-simple',   chips: [], dynamic: true, field: 'model' },
  submodel: { label: '세부모델', icon: 'ph ph-car-profile',  chips: [], dynamic: true, field: 'sub_model' },
  year:     { label: '연식',    icon: 'ph ph-calendar',     chips: [], dynamic: true, field: 'year' },
  mileage: {
    label: '주행거리', icon: 'ph ph-gauge', chips: [
      { id: 'km1',  label: '1만km↓',   match: v => v > 0 && v <= 10000 },
      { id: 'km3',  label: '1~3만',    match: v => v > 10000 && v <= 30000 },
      { id: 'km5',  label: '3~5만',    match: v => v > 30000 && v <= 50000 },
      { id: 'km10', label: '5~10만',   match: v => v > 50000 && v <= 100000 },
      { id: 'km15', label: '10~15만',  match: v => v > 100000 && v <= 150000 },
      { id: 'km99', label: '15만↑',    match: v => v > 150000 },
    ]
  },
  fuel: {
    label: '연료', icon: 'ph ph-gas-pump', chips: [
      { id: 'gas',    label: '가솔린',    match: v => v === '가솔린' || v === 'gasoline' },
      { id: 'diesel', label: '디젤',      match: v => v === '디젤' || v === 'diesel' },
      { id: 'hybrid', label: '하이브리드', match: v => (v||'').includes('하이브리드') || (v||'').includes('hybrid') },
      { id: 'ev',     label: '전기',      match: v => v === '전기' || v === 'electric' },
    ]
  },
  color:    { label: '외부색상', icon: 'ph ph-palette', chips: [], dynamic: true, field: 'ext_color' },
  int_color: { label: '내부색상', icon: 'ph ph-palette', chips: [], dynamic: true, field: 'int_color' },
  vehicle_status: {
    label: '출고상태', icon: 'ph ph-truck',
    chips: ['즉시출고','출고가능','상품화중','출고협의','출고불가'].map(s => ({
      id: `vs_${s}`, label: s, match: v => v === s
    }))
  },
  product_type: {
    label: '상품구분', icon: 'ph ph-tag',
    chips: ['중고렌트','신차렌트','중고구독','신차구독'].map(s => ({
      id: `pt_${s}`, label: s, match: v => v === s
    }))
  },
  vehicle_class: { label: '차종구분', icon: 'ph ph-car', chips: [], dynamic: true, field: 'vehicle_class' },
  review: {
    label: '심사여부', icon: 'ph ph-clipboard-text',
    chips: [
      { id: 'rv_no',  label: '무심사',   match: (_, p) => !needsReview(p) },
      { id: 'rv_yes', label: '심사필요', match: (_, p) => needsReview(p) },
    ]
  },
  age_lowering:    { label: '운전연령하향', icon: 'ph ph-arrow-down', chips: [], dynamic: true, field: '_policy.driver_age_lowering' },
  credit_grade:    { label: '심사기준', icon: 'ph ph-chart-bar', chips: [], dynamic: true, field: '_policy.credit_grade' },
  annual_mileage:  { label: '연간약정주행거리', icon: 'ph ph-road-horizon', chips: [], dynamic: true, field: '_policy.annual_mileage' },
  provider: { label: '공급코드', icon: 'ph ph-buildings', chips: [], dynamic: true, field: 'provider_company_code' },
};

export function mount() {
  unsubProducts?.();
  selected.clear();
  activeFilters = {};
  selectedProductKey = null;

  const main = document.getElementById('mainContent');

  main.innerHTML = `
    <div class="srch">
      <!-- 필터(좌) | 목록(중) | 상세(우) 가로 3패널 -->
      <div class="srch-filter-panel" id="srchFilterPanel">
        <div class="srch-panel-head">
          <span style="display:flex;align-items:center;gap:var(--sp-1);"><span>조건</span><span class="sb-badge" id="srchFilterCount"></span></span>
          <span style="display:flex;gap:var(--sp-1);">
            <button class="btn btn-xs btn-outline" id="srchExcel" title="Excel 다운로드"><i class="ph ph-download-simple"></i> Excel</button>
            <button class="btn btn-xs btn-outline" id="srchPhotoZip" title="사진 ZIP"><i class="ph ph-file-zip"></i> 사진</button>
            <button class="btn btn-xs btn-outline" id="srchViewToggle2" title="엑셀형식 보기"><i class="ph ph-table"></i> 엑셀보기</button>
            <span class="ws4-head-toggle" id="srchFilterToggle" title="조건 접기"><i class="ph ph-caret-left"></i></span>
          </span>
        </div>
        <div class="srch-filter-search">
          <input class="input input-sm" id="srchText" placeholder="차량번호, 모델명, 금액, 무심사 등...">
          <div class="srch-active" id="srchActive"><span style="font-size:var(--fs-2xs);color:var(--c-text-muted);">전체해제</span></div>
        </div>
        <div class="srch-filters" id="srchFilters"></div>
      </div>

      <div class="srch-resize" id="srchResize1"></div>

      <div class="srch-list-wrap">
        <div class="srch-panel-head" id="srchListHead">
          <span style="display:flex;align-items:center;gap:var(--sp-2);flex:1;min-width:0;" id="srchListLeft">
            <span>목록</span>
            <span class="srch-count" id="srchCount">0대</span>
          </span>
          <span style="display:flex;align-items:center;gap:var(--sp-1);">
            <div class="srch-period-head" id="srchPeriodHead">
              <span class="srch-sort-hint" id="srchSortHint">${localStorage.getItem('fp.sort.used') ? '' : '개월수 클릭하면 대여료 정렬'}</span>
              <span class="srch-sort-col" data-sort="36" title="클릭: 낮은순 → 높은순 → 해제">36개월</span><span class="srch-sort-col" data-sort="48" title="클릭: 낮은순 → 높은순 → 해제">48개월</span><span class="srch-sort-col" data-sort="60" title="클릭: 낮은순 → 높은순 → 해제">60개월</span>
            </div>
            <button class="btn btn-xs btn-outline" id="srchDetailOpen" style="display:none;" title="상세 열기"><i class="ph ph-sidebar-simple"></i></button>
          </span>
        </div>
        <div class="srch-list" id="srchList"></div>
        <div class="srch-list-foot" id="srchFoot" style="display:none;">
          <span id="srchSelected">0대 선택</span>
          <button class="btn btn-primary btn-sm" id="srchShare"><i class="ph ph-share-network"></i> 공유</button>
        </div>
      </div>

      <div class="srch-resize" id="srchResize2"></div>

      <div class="srch-detail" id="srchDetail">
        <div class="srch-panel-head"><span>상세</span><span class="ws4-head-toggle" id="srchDetailToggle" title="상세 접기"><i class="ph ph-caret-right"></i></span></div>
        <div class="srch-detail-content">
          <div class="srch-empty"><i class="ph ph-car-simple"></i><p>차량을 선택하세요</p></div>
        </div>
        <div class="srch-detail-actions" id="srchDetailActions" hidden></div>
      </div>
    </div>
  `;

  // Resize handle
  initResize();

  // Load — 콜백 내 오류가 전체 페이지를 깨뜨리지 않도록 보호
  // 정책 미리 로드
  if (!store.policies) {
    fetchCollection('policies').then(p => {
      store.policies = p.map(x => { if (!x.policy_name && x.term_name) x.policy_name = x.term_name; if (!x.policy_code && x.term_code) x.policy_code = x.term_code; return x; });
    }).catch(() => { store.policies = []; });
  }

  unsubProducts = watchCollection('products', (data) => {
    try {
      const policies = store.policies || [];
      allProducts = enrichProductsWithPolicy(
        data.filter(p => !p._deleted && p.status !== 'deleted').map(p => {
          if (!p.model && p.model_name) p.model = p.model_name;
          return p;
        }),
        policies
      );
      store.products = allProducts;
      buildDynamicFilters();
      renderFilters();
      renderActiveChips();
      applyFilters();
      updateBrief();
    } catch (err) {
      console.error('[search] watchCollection(products) 콜백 오류', err);
      showToast('차량 목록을 갱신하지 못했습니다');
    }
  });

  // 뷰 전환 (목록만 카드/엑셀)
  document.getElementById('srchViewToggle2')?.addEventListener('click', () => {
    viewMode = viewMode === 'card' ? 'excel' : 'card';
    const toggleBtn = document.getElementById('srchViewToggle2');
    toggleBtn.innerHTML = viewMode === 'excel' ? '<i class="ph ph-cards"></i> 카드보기' : '<i class="ph ph-table"></i> 엑셀보기';
    toggleBtn.title = viewMode === 'excel' ? '카드뷰로 전환' : '엑셀뷰로 전환';
    const listHead = document.getElementById('srchListHead');
    if (listHead) {
      if (viewMode === 'excel') {
        listHead.className = 'srch-excel-head-bar';
        listHead.style.display = '';
        listHead.innerHTML = `<span>공급사</span><span>차량번호</span><span>제조사</span><span>세부모델</span><span>연식</span><span>연료</span><span>주행</span><span>색상</span><span>상태</span><span>36개월</span><span>48개월</span><span>60개월</span>`;
      } else {
        listHead.className = 'srch-panel-head';
        listHead.style.display = '';
        listHead.innerHTML = `
          <span style="display:flex;align-items:center;gap:var(--sp-2);flex:1;min-width:0;" id="srchListLeft">
            <span>목록</span><span class="srch-count" id="srchCount">${filteredProducts.length}대</span>
          </span>
          <div class="srch-period-head" id="srchPeriodHead">
            <span class="srch-sort-hint" id="srchSortHint"></span>
            <span class="srch-sort-col" data-sort="36">36개월</span><span class="srch-sort-col" data-sort="48">48개월</span><span class="srch-sort-col" data-sort="60">60개월</span>
          </div>`;
      }
    }
    renderList();
  });

  // 조건/상세 패널 접기/열기
  const updatePanelBtns = () => {
    const filterCollapsed = document.getElementById('srchFilterPanel')?.classList.contains('is-collapsed');
    const detailCollapsed = document.getElementById('srchDetail')?.classList.contains('is-collapsed');
    const fb = document.getElementById('srchFilterToggle');
    const db = document.getElementById('srchDetailToggle');
    const fo = document.getElementById('srchFilterOpen');
    const do2 = document.getElementById('srchDetailOpen');
    if (fb) fb.innerHTML = `<i class="ph ph-caret-left"></i>`;
    if (db) db.innerHTML = `<i class="ph ph-caret-right"></i>`;
    if (fo) fo.style.display = filterCollapsed ? '' : 'none';
    if (do2) do2.style.display = detailCollapsed ? '' : 'none';
  };
  document.getElementById('srchFilterToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('srchFilterPanel');
    panel?.classList.toggle('is-collapsed');
    const icon = document.querySelector('#srchFilterToggle i');
    if (icon) icon.className = panel?.classList.contains('is-collapsed') ? 'ph ph-caret-right' : 'ph ph-caret-left';
  });
  document.getElementById('srchDetailToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('srchDetail');
    const resize = document.getElementById('srchResize2');
    panel?.classList.toggle('is-collapsed');
    if (resize) resize.style.display = panel?.classList.contains('is-collapsed') ? 'none' : '';
    const icon = document.querySelector('#srchDetailToggle i');
    if (icon) icon.className = panel?.classList.contains('is-collapsed') ? 'ph ph-caret-left' : 'ph ph-caret-right';
  });
  // 접힌 패널 클릭 시 열기
  document.getElementById('srchFilterPanel')?.addEventListener('click', (e) => {
    const panel = document.getElementById('srchFilterPanel');
    if (panel?.classList.contains('is-collapsed')) {
      panel.classList.remove('is-collapsed');
      const icon = document.querySelector('#srchFilterToggle i');
      if (icon) icon.className = 'ph ph-caret-left';
    }
  });
  document.getElementById('srchDetail')?.addEventListener('click', (e) => {
    const panel = document.getElementById('srchDetail');
    if (panel?.classList.contains('is-collapsed')) {
      panel.classList.remove('is-collapsed');
      const resize = document.getElementById('srchResize2');
      if (resize) resize.style.display = '';
      const icon = document.querySelector('#srchDetailToggle i');
      if (icon) icon.className = 'ph ph-caret-right';
    }
  });

  // Text search
  document.getElementById('srchText')?.addEventListener('input', () => { buildDynamicFilters(); renderFilters(); applyFilters(); });

  // 기간별 정렬
  document.querySelectorAll('.srch-sort-col').forEach(col => {
    col.style.cursor = 'pointer';
    col.addEventListener('click', () => {
      const m = col.dataset.sort;
      if (sortCol === m) {
        if (sortDir === 'asc') sortDir = 'desc';
        else if (sortDir === 'desc') { sortCol = null; sortDir = null; }
      } else {
        sortCol = m; sortDir = 'asc';
      }
      // 색상 + tooltip 업데이트
      document.querySelectorAll('.srch-sort-col').forEach(c => {
        c.classList.remove('is-sort-asc', 'is-sort-desc');
        c.title = '클릭: 낮은순 → 높은순 → 해제';
      });
      if (sortCol === m && sortDir) {
        col.classList.add(sortDir === 'asc' ? 'is-sort-asc' : 'is-sort-desc');
        col.title = sortDir === 'asc' ? `${m}개월 낮은순 정렬 중 (클릭: 높은순)` : `${m}개월 높은순 정렬 중 (클릭: 해제)`;
      }
      // 힌트 한번 쓰면 영구 제거
      const hint = document.getElementById('srchSortHint');
      if (hint) { hint.textContent = ''; localStorage.setItem('fp.sort.used', '1'); }
      applyFilters();
    });
  });

  // Share
  document.getElementById('srchShare')?.addEventListener('click', openShare);

  // Excel (현재 필터된 결과 + 정책 병합 다운로드 — 보험/조건 전부 포함)
  document.getElementById('srchExcel')?.addEventListener('click', async () => {
    const list = filteredProducts.length ? filteredProducts : allProducts;
    if (!list.length) { showToast('다운로드할 차량이 없습니다'); return; }
    try {
      // policies 없으면 한번 로드
      if (!store.policies || !store.policies.length) {
        const { fetchCollection } = await import('../firebase/db.js');
        store.policies = await fetchCollection('policies');
      }
      const enriched = enrichProductsWithPolicy(list, store.policies);
      await downloadExcelWithFilter('차량목록', PRODUCT_COLS, enriched, PRODUCT_FILTER_FIELDS, {
        baseUrl: location.origin,
      });
      showToast(`${list.length}대 Excel 다운로드 · ERP 목록(좌측 필터) + 원본 2탭 구조`);
    } catch (e) {
      console.error(e);
      showToast('다운로드 실패', 'error');
    }
  });

  // 사진 ZIP — 공급사별·차량번호별 선택 팝업
  document.getElementById('srchPhotoZip')?.addEventListener('click', () => openPhotoZipDialog());
}

/** 파일/폴더 이름에 쓸 수 없는 문자 제거 (Windows 기준) */
function fsSafe(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '_';
}

/** 사진 다운로드 선택 팝업 — 탭(자체/외부) + 검색 + 공급사코드·차량번호 트리 */
function openPhotoZipDialog() {
  const list = filteredProducts.length ? filteredProducts : allProducts;
  if (!list.length) { showToast('현재 목록에 차량이 없습니다'); return; }

  // 자체(uploaded) · 외부(external) 두 데이터셋을 각각 빌드 (공급사는 코드 only)
  const buildDataset = (entries) => {
    const groups = {};
    let totalPhotos = 0;
    let totalCars = 0;
    for (const entry of entries) {
      const provider = entry.p.provider_company_code || '미지정';
      groups[provider] ??= [];
      groups[provider].push(entry);
      totalPhotos += entry.imgs.length;
      totalCars++;
    }
    return { groups, totalPhotos, totalCars, withPhotos: entries };
  };

  // 자체사진: productImages만
  const ownEntries = list
    .map(p => ({ p, imgs: productImages(p) }))
    .filter(e => e.imgs.length > 0);

  // 외부사진: productExternalImages(직접URL) + 스크래핑 소스(아직 해석 안됨)
  //  팝업 열린 후 백그라운드로 해석 → 완료되는 대로 각 row count 업데이트
  const extEntries = list.map(p => {
    const direct = productExternalImages(p);
    const driveSrc = supportedDriveSource(p);
    return { p, imgs: direct.slice(), driveSrc, resolved: !driveSrc };
  }).filter(e => e.imgs.length > 0 || e.driveSrc);

  const datasets = {
    own: buildDataset(ownEntries),
    ext: buildDataset(extEntries),
  };

  const dlg = document.createElement('dialog');
  dlg.className = 'pd-zip-dialog';
  dlg.innerHTML = `
    <div class="pd-zip-head">
      <span><i class="ph ph-file-zip"></i> 사진 다운로드</span>
      <button class="pd-zip-close" aria-label="닫기"><i class="ph ph-x"></i></button>
    </div>
    <div class="pd-zip-tabs" role="tablist">
      <button class="pd-zip-tab is-active" data-tab="own" role="tab"><span data-tablabel="own">자체사진 (${datasets.own.totalCars}대 · ${datasets.own.totalPhotos}장)</span></button>
      <button class="pd-zip-tab" data-tab="ext" role="tab"><span data-tablabel="ext">외부사진 (${datasets.ext.totalCars}대 · ${datasets.ext.totalPhotos}장)</span></button>
    </div>
    <div class="pd-zip-toolbar">
      <input type="search" class="input input-sm" id="zipSearch" placeholder="차량번호·공급사코드 검색" autocomplete="off">
      <label class="pd-zip-allcb"><input type="checkbox" id="zipAll"> 전체 선택</label>
    </div>
    <div class="pd-zip-sub-progress" hidden></div>
    <div class="pd-zip-tree" id="zipTree"></div>
    <div class="pd-zip-foot">
      <span class="pd-zip-selinfo" id="zipSelInfo"></span>
      <span style="flex:1;"></span>
      <button class="btn btn-sm btn-outline" id="zipCancel">취소</button>
      <button class="btn btn-sm btn-primary" id="zipDownload"><i class="ph ph-download-simple"></i> 다운로드</button>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();

  const ac = new AbortController();
  let activeTab = 'own';

  const currentDataset = () => datasets[activeTab];
  const byKey = () => new Map(currentDataset().withPhotos.map(x => [x.p._key, x]));

  // 트리 렌더 (현재 탭 기준)
  const renderTree = () => {
    const { groups } = currentDataset();
    const providers = Object.keys(groups).sort();
    const tree = dlg.querySelector('#zipTree');
    if (!providers.length) {
      tree.innerHTML = `<div class="pd-zip-empty">표시할 사진이 없습니다</div>`;
      return;
    }
    tree.innerHTML = providers.map(prov => {
      const cars = groups[prov];
      const provPhotos = cars.reduce((s, c) => s + c.imgs.length, 0);
      return `
        <details class="pd-zip-provider" open data-search="${prov.toLowerCase().replace(/"/g,'&quot;')}">
          <summary>
            <input type="checkbox" class="zip-prov-cb" data-prov="${prov.replace(/"/g,'&quot;')}">
            <span class="pd-zip-prov-name">${prov}</span>
            <span class="pd-zip-prov-meta">${cars.length}대 · ${provPhotos}장</span>
          </summary>
          <div class="pd-zip-cars">
            ${cars.map(({ p, imgs }) => {
              const carNo = p.car_number || p._key;
              const searchKey = (carNo + ' ' + prov).toLowerCase();
              return `
                <label class="pd-zip-car" data-search="${searchKey.replace(/"/g,'&quot;')}">
                  <input type="checkbox" class="zip-car-cb" data-key="${p._key}" data-prov="${prov.replace(/"/g,'&quot;')}">
                  <span class="pd-zip-car-no">${carNo}</span>
                  <span class="pd-zip-car-meta">${imgs.length}장</span>
                </label>
              `;
            }).join('')}
          </div>
        </details>
      `;
    }).join('');
    bindTreeEvents();
    applyFilter();
    updateSelInfo();
  };

  const bindTreeEvents = () => {
    dlg.querySelectorAll('.zip-prov-cb').forEach(provCb => {
      provCb.addEventListener('click', (e) => e.stopPropagation(), { signal: ac.signal });
      provCb.addEventListener('change', (e) => {
        const prov = e.target.dataset.prov;
        dlg.querySelectorAll(`.zip-car-cb[data-prov="${CSS.escape(prov)}"]`).forEach(cb => { cb.checked = e.target.checked; });
        updateSelInfo();
      }, { signal: ac.signal });
    });
    dlg.querySelectorAll('.zip-car-cb').forEach(carCb => {
      carCb.addEventListener('change', () => {
        const prov = carCb.dataset.prov;
        const siblings = [...dlg.querySelectorAll(`.zip-car-cb[data-prov="${CSS.escape(prov)}"]`)];
        const checkedCnt = siblings.filter(c => c.checked).length;
        const provCb = dlg.querySelector(`.zip-prov-cb[data-prov="${CSS.escape(prov)}"]`);
        if (provCb) {
          provCb.checked = checkedCnt === siblings.length;
          provCb.indeterminate = checkedCnt > 0 && checkedCnt < siblings.length;
        }
        const allCars = [...dlg.querySelectorAll('.zip-car-cb')];
        const allChecked = allCars.filter(c => c.checked).length;
        const allCb = dlg.querySelector('#zipAll');
        allCb.checked = allChecked === allCars.length;
        allCb.indeterminate = allChecked > 0 && allChecked < allCars.length;
        updateSelInfo();
      }, { signal: ac.signal });
    });
  };

  // 검색 — 차량번호·공급사(이름/코드) 기준으로 항목 show/hide
  const applyFilter = () => {
    const q = (dlg.querySelector('#zipSearch')?.value || '').trim().toLowerCase();
    dlg.querySelectorAll('.pd-zip-provider').forEach(prov => {
      const cars = [...prov.querySelectorAll('.pd-zip-car')];
      let matched = 0;
      cars.forEach(car => {
        const hit = !q || car.dataset.search.includes(q) || prov.dataset.search.includes(q);
        car.style.display = hit ? '' : 'none';
        if (hit) matched++;
      });
      prov.style.display = (matched > 0 || !q) ? '' : 'none';
    });
  };

  const updateSelInfo = () => {
    const selected = [...dlg.querySelectorAll('.zip-car-cb:checked')];
    const map = byKey();
    let cars = selected.length;
    let photos = 0;
    for (const cb of selected) photos += (map.get(cb.dataset.key)?.imgs.length || 0);
    dlg.querySelector('#zipSelInfo').textContent = `선택: ${cars}대 · ${photos}장`;
    dlg.querySelector('#zipDownload').disabled = cars === 0;
  };

  // 탭 전환
  dlg.querySelectorAll('.pd-zip-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === activeTab) return;
      activeTab = tab.dataset.tab;
      dlg.querySelectorAll('.pd-zip-tab').forEach(t => t.classList.toggle('is-active', t === tab));
      dlg.querySelector('#zipAll').checked = false;
      dlg.querySelector('#zipAll').indeterminate = false;
      renderTree();
    }, { signal: ac.signal });
  });

  // 전체 선택
  dlg.querySelector('#zipAll').addEventListener('change', (e) => {
    const checked = e.target.checked;
    dlg.querySelectorAll('.zip-prov-cb, .zip-car-cb').forEach(cb => { cb.checked = checked; cb.indeterminate = false; });
    updateSelInfo();
  }, { signal: ac.signal });

  // 검색
  dlg.querySelector('#zipSearch').addEventListener('input', applyFilter, { signal: ac.signal });

  const close = () => { if (dlg.open) dlg.close(); };
  dlg.querySelector('.pd-zip-close').addEventListener('click', close, { signal: ac.signal });
  dlg.querySelector('#zipCancel').addEventListener('click', close, { signal: ac.signal });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }, { signal: ac.signal });
  dlg.addEventListener('close', () => { ac.abort(); dlg.remove(); }, { once: true });

  renderTree();

  // 외부 폴더 백그라운드 해석 — 팝업 열린 상태에서 진행, 완료분부터 카운트 업데이트
  const toResolve = extEntries.filter(e => !e.resolved);
  if (toResolve.length) {
    (async () => {
      const { fetchDriveFolderImages } = await import('../core/drive-photos.js');
      const subEl = dlg.querySelector('.pd-zip-sub-progress');
      let done = 0;
      const updateProgress = () => {
        if (!subEl) return;
        if (done < toResolve.length) {
          subEl.innerHTML = `<i class="ph ph-spinner"></i> 외부 폴더 분석 중... ${done}/${toResolve.length}`;
          subEl.hidden = false;
        } else {
          subEl.hidden = true;
        }
      };
      updateProgress();

      const CONCURRENCY = 6;
      let idx = 0;
      const refreshRow = (entry) => {
        // 탭 라벨(외부사진 합계)은 항상 업데이트
        datasets.ext.totalPhotos = datasets.ext.withPhotos.reduce((s, e) => s + e.imgs.length, 0);
        const tabLabel = dlg.querySelector('[data-tablabel="ext"]');
        if (tabLabel) tabLabel.textContent = `외부사진 (${datasets.ext.totalCars}대 · ${datasets.ext.totalPhotos}장)`;

        // 차량 row · 공급사 합계 DOM 업데이트는 "현재 탭이 ext"일 때만
        //  (자체 탭에 렌더된 같은 차량 row를 덮어쓰지 않도록)
        if (activeTab !== 'ext') return;

        const carCb = dlg.querySelector(`.zip-car-cb[data-key="${CSS.escape(entry.p._key)}"]`);
        if (carCb) {
          const metaEl = carCb.closest('.pd-zip-car')?.querySelector('.pd-zip-car-meta');
          if (metaEl) metaEl.textContent = `${entry.imgs.length}장`;
        }
        const prov = entry.p.provider_company_code || '미지정';
        const provEntries = datasets.ext.groups[prov] || [];
        const provPhotos = provEntries.reduce((s, c) => s + c.imgs.length, 0);
        const provMeta = dlg.querySelector(`.zip-prov-cb[data-prov="${CSS.escape(prov)}"]`)?.closest('summary')?.querySelector('.pd-zip-prov-meta');
        if (provMeta) provMeta.textContent = `${provEntries.length}대 · ${provPhotos}장`;

        updateSelInfo();
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY, toResolve.length) }, async () => {
        while (idx < toResolve.length) {
          const e = toResolve[idx++];
          try {
            const urls = await fetchDriveFolderImages(e.driveSrc);
            if (Array.isArray(urls)) for (const u of urls) if (!e.imgs.includes(u)) e.imgs.push(u);
          } catch { /* skip */ }
          e.resolved = true;
          done++;
          if (!ac.signal.aborted) {
            refreshRow(e);
            updateProgress();
          }
        }
      });
      await Promise.all(workers);
    })();
  }

  // 다운로드
  dlg.querySelector('#zipDownload').addEventListener('click', async () => {
    const map = byKey();
    const selected = [...dlg.querySelectorAll('.zip-car-cb:checked')]
      .map(cb => map.get(cb.dataset.key))
      .filter(Boolean);
    if (!selected.length) return;
    const btn = dlg.querySelector('#zipDownload');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner"></i> 준비 중...';
    const resetBtn = () => { btn.disabled = false; btn.innerHTML = '<i class="ph ph-download-simple"></i> 다운로드'; };

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // 모든 (car, url, index) 튜플을 만들고 concurrency 8로 병렬 fetch
      const tasks = [];
      for (const entry of selected) {
        if (!entry.imgs.length) continue;
        const provider = fsSafe(entry.p.provider_company_code || '미지정');
        const carNo = fsSafe(entry.p.car_number || entry.p._key);
        const folder = zip.folder(provider).folder(carNo);
        entry.imgs.forEach((u, i) => tasks.push({ entry, folder, url: u, idx: i }));
      }
      const totalTasks = tasks.length;
      if (!totalTasks) { showToast('선택한 차량에 사진이 없습니다'); resetBtn(); return; }

      let done = 0, ok = 0, fail = 0;
      const carSucceeded = new Set();
      const updateProgress = () => { btn.innerHTML = `<i class="ph ph-spinner"></i> 다운로드 ${done}/${totalTasks}`; };
      updateProgress();

      let taskIdx = 0;
      const CONCURRENCY = 8;
      const workers = Array.from({ length: Math.min(CONCURRENCY, totalTasks) }, async () => {
        while (taskIdx < totalTasks) {
          if (ac.signal.aborted) return;  // 취소 감지 → worker 종료
          const t = tasks[taskIdx++];
          try {
            const res = await fetch(t.url, { signal: ac.signal });
            if (!res.ok) throw new Error('http ' + res.status);
            const blob = await res.blob();
            const ext = blob.type.includes('png') ? '.png'
                     : blob.type.includes('webp') ? '.webp'
                     : blob.type.includes('gif') ? '.gif' : '.jpg';
            t.folder.file(`photo_${String(t.idx+1).padStart(2,'0')}${ext}`, blob);
            ok++;
            carSucceeded.add(t.entry.p._key);
          } catch (e) {
            if (e?.name === 'AbortError' || ac.signal.aborted) return;  // 취소로 인한 실패는 집계 제외
            fail++;
            console.warn('[photo-zip] fetch fail', t.url, e?.message || e);
          }
          done++;
          if (!ac.signal.aborted) updateProgress();
        }
      });
      await Promise.all(workers);

      // 취소됐으면 여기서 중단 (압축·저장 스킵)
      if (ac.signal.aborted) return;

      if (!ok) {
        showToast(`사진 ${fail}장 모두 다운로드 실패 (CORS/네트워크) — 콘솔 확인`, 'error');
        resetBtn();
        return;
      }

      btn.innerHTML = '<i class="ph ph-spinner"></i> 압축 중...';
      const content = await zip.generateAsync({ type: 'blob' });
      if (ac.signal.aborted) return;  // 압축 중에도 취소됐으면 저장 스킵
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      const tag = activeTab === 'own' ? 'own' : 'ext';
      a.download = `freepass_photos_${tag}_${new Date().toISOString().slice(0,10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      const msg = fail
        ? `${carSucceeded.size}대 · ${ok}장 다운로드 (${fail}장 실패)`
        : `${carSucceeded.size}대 · ${ok}장 다운로드 완료`;
      showToast(msg);
      close();
    } catch (e) {
      if (ac.signal.aborted) return;  // 취소로 인한 예외는 무시
      console.error(e);
      showToast('ZIP 생성 실패', 'error');
      resetBtn();
    }
  }, { signal: ac.signal });
}

function updateBrief() {
  if (!allProducts.length) { setBreadcrumbBrief('차량 없음'); return; }

  // 상태별 카운트 (출고불가는 총수에서 제외)
  const counts = {};
  allProducts.forEach(p => {
    const s = p.vehicle_status || '-';
    counts[s] = (counts[s] || 0) + 1;
  });
  const totalActive = allProducts.length - (counts['출고불가'] || 0);

  const parts = [`상품차량 ${totalActive}대`];
  if (counts['즉시출고']) parts.push(`즉시출고 ${counts['즉시출고']}`);
  if (counts['출고가능']) parts.push(`출고가능 ${counts['출고가능']}`);
  if (counts['출고협의']) parts.push(`출고협의 ${counts['출고협의']}`);

  setBreadcrumbBrief(parts.join(' > '));
}

const TOP_N = { maker: 8, model: 12, submodel: 12, year: 10, color: 10, int_color: 10, vehicle_class: 11, provider: 10, policy: 10 };

function matchFilter(p, g, chip) {
  const f = FILTERS[g];
  if (g === 'rent') return Object.values(p.price||{}).some(pr => chip.match(Number(pr.rent)||0));
  if (g === 'deposit') return Object.values(p.price||{}).some(pr => chip.match(Number(pr.deposit)||0));
  if (g === 'period') return chip.match(null, p.price);
  if (g === 'mileage') return chip.match(Number(p.mileage)||0);
  if (g === 'fuel') return chip.match(p.fuel_type);
  if (g === 'vehicle_status') return chip.match(p.vehicle_status);
  if (g === 'product_type') return chip.match(p.product_type);
  if (g === 'review') return chip.match(null, p);
  if (f.dynamic && f.field) return chip.match(getField(p, f.field));
  return true;
}

function passesFiltersExcept(p, skipKey) {
  const q = (document.getElementById('srchText')?.value || '').toLowerCase();
  if (q && !matchesText(p, q)) return false;
  for (const [g, set] of Object.entries(activeFilters)) {
    if (g === skipKey) continue;
    if (!set || !set.size) continue;
    // OR within a group — any selected chip matches passes this group
    const chips = [...set].map(cid => FILTERS[g].chips.find(c => c.id === cid)).filter(Boolean);
    if (!chips.length) continue;
    if (!chips.some(chip => matchFilter(p, g, chip))) return false;
  }
  return true;
}

const COLOR_MAP = {
  '흰':'#f0f0f0','백':'#f0f0f0','화이트':'#f0f0f0','white':'#f0f0f0','아이보리':'#fffff0',
  '검':'#222','블랙':'#222','black':'#222',
  '은':'#b0b0b0','실버':'#b0b0b0','silver':'#b0b0b0',
  '회':'#808080','그레이':'#808080','grey':'#808080','gray':'#808080',
  '빨':'#e03e3e','레드':'#e03e3e','red':'#e03e3e',
  '파':'#3b82f6','블루':'#3b82f6','blue':'#3b82f6',
  '남':'#1e3a5f','네이비':'#1e3a5f','navy':'#1e3a5f',
  '초':'#22c55e','그린':'#22c55e','green':'#22c55e',
  '노':'#eab308','옐로':'#eab308','yellow':'#eab308','골드':'#d4a017',
  '갈':'#8b5e3c','브라운':'#8b5e3c','brown':'#8b5e3c',
  '주':'#f97316','오렌지':'#f97316','orange':'#f97316',
  '분':'#ec4899','핑크':'#ec4899','pink':'#ec4899',
  '베':'#d2c6a5','베이지':'#d2c6a5','beige':'#d2c6a5',
  '하늘':'#87ceeb','스카이':'#87ceeb','sky':'#87ceeb',
  '보라':'#8b5cf6','퍼플':'#8b5cf6','purple':'#8b5cf6',
  '청':'#2563eb','진주':'#e8e0d0','티탄':'#7a7a7a','카키':'#6b6b40',
};
function colorToHex(name) {
  if (!name) return '#ddd';
  const n = name.toLowerCase().replace(/색$/, '');
  for (const [k, v] of Object.entries(COLOR_MAP)) { if (n.includes(k)) return v; }
  return '#ccc';
}
function colorTextContrast(name) {
  const hex = colorToHex(name);
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*0.299 + g*0.587 + b*0.114) > 150 ? '#222' : '#fff';
}

function matchesText(p, q) {
  const fields = [
    // 상품 기본
    p.car_number, p.maker, p.model, p.sub_model, p.trim_name,
    p.vehicle_status, p.product_type, p.vehicle_class,
    p.fuel_type, p.ext_color, p.int_color, p.year,
    p.location, p.provider_company_code, p.policy_code,
    p.partner_code, p.vin, p.usage, p.product_code, p._key,
    p.partner_memo, p.options,
  ];
  // 정책
  const pol = p._policy || {};
  fields.push(
    pol.policy_name, pol.policy_code, pol.credit_grade, pol.annual_mileage,
    pol.basic_driver_age, pol.driver_age_lowering,
    pol.screening_criteria, pol.payment_method, pol.provider_company_code,
  );
  // 파트너/사용자 이름·회사명 매칭
  const partner = (store.partners || []).find(pt => pt.partner_code === p.partner_code || pt.partner_code === p.provider_company_code);
  if (partner) fields.push(partner.partner_name, partner.manager_name, partner.manager_phone);
  const user = (store.users || []).find(u => u.company_code === p.provider_company_code || u.partner_code === p.partner_code);
  if (user) fields.push(user.name, user.company_name, user.phone, user.email);
  // 심사여부
  fields.push(needsReview(p) ? '심사필요' : '무심사');
  // 금액
  if (p.price) {
    Object.values(p.price).forEach(pr => {
      if (pr.rent) fields.push(String(pr.rent), String(Math.round(pr.rent / 10000)) + '만');
      if (pr.deposit) fields.push(String(pr.deposit), String(Math.round(pr.deposit / 10000)) + '만');
    });
  }
  if (p.mileage) fields.push(String(p.mileage), String(Math.round(p.mileage / 10000)) + '만km', String(Math.round(p.mileage / 10000)) + '만');
  return fields.some(v => v && String(v).toLowerCase().includes(q));
}

function getField(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function buildDynamicFilters() {
  Object.entries(FILTERS).forEach(([key, f]) => {
    if (!f.dynamic) return;
    const scope = allProducts.filter(p => passesFiltersExcept(p, key));
    const counts = {};
    scope.forEach(p => {
      const v = getField(p, f.field);
      if (v !== undefined && v !== null && v !== '') counts[String(v)] = (counts[String(v)]||0) + 1;
    });
    let sorted;
    if (key === 'year') sorted = Object.entries(counts).sort((a,b) => Number(b[0]) - Number(a[0]));
    else sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);

    const mkChip = ([v, cnt]) => ({ id: `${key}_${v}`, label: `${v}(${cnt})`, match: x => String(x) === v });
    const limit = TOP_N[key] || 10;
    f.popular = sorted.slice(0, limit).map(mkChip);
    f.others  = sorted.slice(limit).map(mkChip);
    f.chips   = [...f.popular, ...f.others];
  });
}

const dynExpanded = {};

function renderFilters() {
  const el = document.getElementById('srchFilters');
  if (!el) return;

  el.innerHTML = Object.entries(FILTERS).map(([key, f]) => {
    const set = activeFilters[key];
    const chip = c => `<button class="chip ${set && set.has(c.id) ? 'is-active' : ''}" data-g="${key}" data-c="${c.id}">${c.label}</button>`;
    let chipsHtml = '';

    if (f.dynamic) {
      const popular = f.popular || [];
      const others  = f.others  || [];
      const open    = !!dynExpanded[key];
      chipsHtml = popular.map(chip).join('');
      if (others.length) {
        chipsHtml += `<div class="srch-maker-more ${open ? 'is-open' : ''}">
          ${open ? others.map(chip).join('') : ''}
          <button class="btn btn-sm srch-more-btn" data-more="${key}" style="font-size:var(--fs-2xs);color:var(--c-text-muted);width:100%;margin-top:2px;">
            ${open ? '접기' : `더보기 (${others.length})`}
          </button>
        </div>`;
      }
    } else {
      chipsHtml = f.chips.map(chip).join('');
    }

    const activeCount = set ? set.size : 0;
    return `
      <details class="srch-accordion ${activeCount ? 'has-active' : ''}" open>
        <summary class="srch-accordion-sum">
          <i class="${f.icon || 'ph ph-funnel'} srch-acc-icon"></i>
          <span class="srch-acc-label">${f.label}</span><span class="sb-badge ${activeCount ? 'is-visible' : ''}">${activeCount || ''}</span>
          <i class="ph ph-caret-down srch-acc-caret"></i>
        </summary>
        <div class="srch-accordion-body">${chipsHtml}</div>
      </details>
    `;
  }).join('');

  // Chip clicks — toggle without full re-render
  el.querySelectorAll('.chip').forEach(chipEl => {
    chipEl.addEventListener('click', () => {
      const g = chipEl.dataset.g, c = chipEl.dataset.c;
      if (!activeFilters[g]) activeFilters[g] = new Set();
      const s = activeFilters[g];
      if (s.has(c)) { s.delete(c); chipEl.classList.remove('is-active'); }
      else { s.add(c); chipEl.classList.add('is-active'); }
      if (!s.size) delete activeFilters[g];

      // 해당 아코디언 뱃지만 업데이트
      const accordion = chipEl.closest('.srch-accordion');
      const badge = accordion?.querySelector('.sb-badge');
      const cnt = s?.size || 0;
      if (badge) {
        if (cnt) { badge.textContent = cnt; badge.classList.add('is-visible'); }
        else { badge.textContent = ''; badge.classList.remove('is-visible'); }
      }
      if (accordion) accordion.classList.toggle('has-active', cnt > 0);

      renderActiveChips();
      applyFilters();
    });
  });

  // Dynamic filter "더보기" toggles
  el.querySelectorAll('[data-more]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.more;
      dynExpanded[k] = !dynExpanded[k];
      renderFilters();
    });
  });
}

function renderActiveChips() {
  const el = document.getElementById('srchActive');
  if (!el) return;
  const entries = Object.entries(activeFilters);
  const total = entries.reduce((n, [, s]) => n + (s?.size || 0), 0);

  // 조건 헤더 뱃지 업데이트
  const countEl = document.getElementById('srchFilterCount');
  if (countEl) {
    if (total) { countEl.textContent = total; countEl.classList.add('is-visible'); }
    else { countEl.textContent = ''; countEl.classList.remove('is-visible'); }
  }

  if (!total) {
    el.innerHTML = `<span style="font-size:var(--fs-2xs);color:var(--c-text-muted);">전체해제</span>`;
    return;
  }

  el.innerHTML = entries.flatMap(([g, set]) =>
    [...set].map(cid => {
      const c = FILTERS[g].chips.find(x => x.id === cid);
      return `<span class="chip is-active">${c?.label || cid} <span class="chip-remove" data-g="${g}" data-c="${cid}">&times;</span></span>`;
    })
  ).join('') + `<button class="btn btn-sm" style="color:var(--c-accent);font-size:var(--fs-2xs);" id="srchClear">전체해제</button>`;

  el.querySelectorAll('.chip-remove').forEach(x => {
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      const g = x.dataset.g, c = x.dataset.c;
      activeFilters[g]?.delete(c);
      if (!activeFilters[g]?.size) delete activeFilters[g];
      buildDynamicFilters(); renderFilters(); renderActiveChips(); applyFilters();
    });
  });
  document.getElementById('srchClear')?.addEventListener('click', () => { activeFilters = {}; buildDynamicFilters(); renderFilters(); renderActiveChips(); applyFilters(); });
}

function applyFilters() {
  const q = (document.getElementById('srchText')?.value || '').toLowerCase();
  let results = [...allProducts];

  // Text
  if (q) results = results.filter(p => matchesText(p, q)
  );

  // Chips (OR within group, AND across groups)
  for (const [g, set] of Object.entries(activeFilters)) {
    if (!set || !set.size) continue;
    const chips = [...set].map(cid => FILTERS[g].chips.find(c => c.id === cid)).filter(Boolean);
    if (!chips.length) continue;
    results = results.filter(p => chips.some(chip => matchFilter(p, g, chip)));
  }

  // 기간별 정렬 (카드뷰)
  if (sortCol && sortDir) {
    const getRent = p => Number(p.price?.[sortCol]?.rent || 0);
    results.sort((a, b) => {
      const av = getRent(a), bv = getRent(b);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }

  // 엑셀뷰 정렬
  if (excelSortField && excelSortDir) {
    const getVal = p => {
      if (excelSortField.startsWith('rent_')) {
        const m = excelSortField.replace('rent_', '');
        return Number(p.price?.[m]?.rent || 0);
      }
      if (excelSortField === 'mileage' || excelSortField === 'year') return Number(p[excelSortField] || 0);
      return String(p[excelSortField] || '').toLowerCase();
    };
    results.sort((a, b) => {
      const av = getVal(a), bv = getVal(b);
      if (av === bv) return 0;
      const cmp = typeof av === 'number' ? av - bv : av < bv ? -1 : 1;
      return excelSortDir === 'asc' ? cmp : -cmp;
    });
  }

  filteredProducts = results;
  renderList();
}

function renderList() {
  const el = document.getElementById('srchList');
  const countEl = document.getElementById('srchCount');
  if (!el) return;
  if (countEl) countEl.textContent = `${filteredProducts.length}대`;

  const PERIODS = [36, 48, 60];

  if (viewMode === 'excel') {
    el.innerHTML = `
      <table class="srch-excel-table">
        <tbody>${filteredProducts.map(p => {
          const price = p.price || {};
          const priceCell = m => {
            const v = price[m] || {};
            const rent = Number(v.rent) || 0;
            const dep = Number(v.deposit) || 0;
            return `<td class="srch-excel-price">${rent ? fmtMoney(rent) : '-'}${dep ? `<div class="srch-excel-dep">${fmtMoney(dep)}</div>` : ''}</td>`;
          };
          return `<tr class="srch-excel-row ${selectedProductKey === p._key ? 'is-active' : ''}" data-key="${p._key}">
            <td>${p.provider_company_code || ''}</td>
            <td>${p.car_number || ''}</td>
            <td>${p.maker || ''}</td>
            <td>${p.sub_model || p.model || ''}</td>
            <td>${p.year || ''}</td>
            <td>${p.fuel_type || ''}</td>
            <td>${p.mileage ? Number(p.mileage).toLocaleString() : ''}</td>
            <td>${p.ext_color || ''}</td>
            <td>${p.vehicle_status || ''}</td>
            ${priceCell('36')}${priceCell('48')}${priceCell('60')}
          </tr>`;
        }).join('')}</tbody>
      </table>` || `<div class="srch-empty"><i class="ph ph-magnifying-glass"></i><p>조건에 맞는 차량이 없습니다</p></div>`;
    bindListDelegation(el);

    // 패널헤드 span 정렬 클릭
    const cols = ['provider_company_code','car_number','maker','sub_model','year','fuel_type','mileage','ext_color','vehicle_status','rent_36','rent_48','rent_60'];
    document.querySelectorAll('.srch-excel-head-bar > span').forEach((span, i) => {
      span.style.cursor = 'pointer';
      span.addEventListener('click', () => {
        const col = cols[i];
        if (excelSortField === col) {
          if (excelSortDir === 'asc') excelSortDir = 'desc';
          else { excelSortField = null; excelSortDir = null; }
        } else {
          excelSortField = col; excelSortDir = 'asc';
        }
        applyFilters();
      });
      // 정렬 표시
      span.classList.remove('is-sort-asc', 'is-sort-desc');
      if (excelSortField === cols[i] && excelSortDir) {
        span.classList.add(excelSortDir === 'asc' ? 'is-sort-asc' : 'is-sort-desc');
      }
    });
    return;
  }

  el.innerHTML = filteredProducts.map(p => {
    const price = p.price || {};
    const isActive = selectedProductKey === p._key;
    // 메인: 세부모델 + 트림 (한글/영문/숫자 단어 단위로 중복 제거 — 띄어쓰기·대소문자 무관)
    const subModel = (p.sub_model || '').trim();
    const trimRaw  = (p.trim_name || p.trim || '').trim();
    const WORD_RE = /[A-Za-z]+|[0-9]+(?:\.[0-9]+)?|[\uAC00-\uD7AF]+/g;
    const subTokens = new Set((subModel.match(WORD_RE) || []).map(t => t.toLowerCase()));
    const trimTokens = trimRaw.match(WORD_RE) || [];
    const trimClean = trimTokens.filter(t => !subTokens.has(t.toLowerCase())).join(' ');
    const title = [subModel, trimClean].filter(Boolean).join(' ');

    // 뱃지 — 공용 헬퍼
    const topBadges = topBadgesHtml(p);
    const reviewTag = reviewOverlayHtml(p);
    const creditTag = creditOverlayHtml(p);
    // 이미지 — 공용 헬퍼
    const thumb = firstProductImage(p);
    const driveFolderUrl = !thumb ? supportedDriveSource(p) : '';

    // 보조: 차량번호 · 제조사 · 연식 · 주행 · 연료 · 색상(외/내)
    const color = [p.ext_color, p.int_color].filter(Boolean).join('/');
    const sub = [
      p.provider_company_code,
      p.car_number,
      p.maker,
      p.year ? `${p.year}년` : '',
      p.mileage ? Number(p.mileage).toLocaleString()+'km' : '',
      p.fuel_type,
      color,
      p.drive_type,
    ].filter(Boolean).join(' · ');

    // 기간별 대여료 (36/48/60) — rent + deposit
    const priceGrid = `<div class="srch-price-grid">${PERIODS.map(m => {
      const v = price[m] || {};
      const rent = Number(v.rent) || 0;
      const dep  = Number(v.deposit) || 0;
      return `<div class="srch-price-col">
        <div class="srch-price-rent">${rent ? fmtMoney(rent) : '-'}</div>
        <div class="srch-price-dep">${dep ? fmtMoney(dep) : ''}</div>
      </div>`;
    }).join('')}</div>`;

    return `
      <div class="srch-item ${isActive ? 'is-active' : ''}" data-key="${p._key}">
        <div class="srch-item-thumb">
          ${thumb
            ? `<img src="${thumb}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
            : driveFolderUrl
              ? `<i class="ph ph-car-simple srch-thumb-placeholder"></i><img data-drive-folder="${driveFolderUrl}" data-drive-mode="thumb" alt="" loading="lazy" decoding="async" hidden onerror="this.remove()">`
              : `<i class="ph ph-car-simple"></i>`}
          ${reviewTag}
          ${creditTag}
        </div>
        <div class="srch-item-body">
          <div class="srch-item-name">
            ${topBadges}<span>${title || '-'}</span>
          </div>
          <div class="srch-item-mid"><span>${sub}</span></div>
        </div>
        ${priceGrid}
      </div>
    `;
  }).join('') || `<div class="srch-empty"><i class="ph ph-magnifying-glass"></i><p>조건에 맞는 차량이 없습니다</p></div>`;

  // 이벤트 위임 — 컨테이너 하나의 리스너로 전체 카드 처리
  //  카드 수백 개마다 리스너 바인딩하던 방식 제거 → 렌더 빠르고 GC 부담 감소
  bindListDelegation(el);
}

let _listDelegated = null;
function bindListDelegation(el) {
  if (_listDelegated === el) return;
  _listDelegated = el;

  el.addEventListener('click', (e) => {
    const item = e.target.closest('.srch-item');
    if (!item) return;
    selectedProductKey = item.dataset.key;
    renderList();
    renderDetail(item.dataset.key);
    const p = allProducts.find(x => x._key === item.dataset.key);
    if (p) {
      const name = [p.maker, p.sub_model, p.trim_name || p.trim].filter(Boolean).join(' ');
      setBreadcrumbTail({
        icon: 'ph ph-car-simple',
        label: name || '차량',
        sub: p.car_number || '',
      });
    }
  });

  el.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.srch-item');
    if (!item) return;
    const p = allProducts.find(x => x._key === item.dataset.key);
    if (!p) return;
    openContextMenu(e, getActionsFor(p));
  });
}

/* ── 역할별 액션 ──
 * 영업자: 문의·계약 + 공유
 * 공급사: 공유만
 * 관리자: 수정 + 공유
 */
function getActionsFor(product) {
  const role = store.currentUser?.role;
  const acts = [];
  if (role === 'agent' || role === 'admin') {
    acts.push({ icon: 'ph ph-chat-circle', label: '소통', primary: true, action: () => startInquiryContract(product) });
  }
  if (role === 'admin') {
    acts.push({ icon: 'ph ph-pencil-simple', label: '수정', action: () => editProduct(product) });
  }
  acts.push({ icon: 'ph ph-share-network', label: '공유', action: () => shareProduct(product) });
  return acts;
}

async function startInquiryContract(p) {
  // 대화방 생성/열기 → 워크스페이스로 이동 (계약 진행도 같은 페이지에서)
  try {
    const { ensureRoom } = await import('../firebase/collections.js');
    const me = store.currentUser || {};
    const roomId = await ensureRoom({
      productUid: p._key,
      productCode: p.product_code || p._key,
      agentUid: me.uid,
      agentCode: me.company_code || me.user_code || '',
      agentName: me.company_name || me.name || '',
      agentChannelCode: me.channel_code || '',
      providerUid: p.provider_uid || '',
      providerName: p.provider_name || p.provider_company_code || '',
      providerCompanyCode: p.provider_company_code || '',
      vehicleNumber: p.car_number || '',
      modelName: p.model || '',
      subModel: p.sub_model || '',
      providerCode: p.provider_company_code || '',
    });
    store.pendingOpenRoom = roomId;
    navigate('/');
    showToast(`${p.car_number || p.model} 문의·계약 시작`);
  } catch (e) {
    console.error('[startInquiryContract]', e);
    showToast('대화방 생성 실패');
  }
}

function editProduct(p) {
  store.editProductId = p._key;
  navigate('/product');
}

function shareProduct(p) {
  // ERP 엑셀 링크와 동일한 포맷 — 받은 사람이 로그인하면 해당 차량 문의 자동 시작
  const car = p.car_number || '';
  const url = car
    ? `${location.origin}/?car=${encodeURIComponent(car)}`
    : `${location.origin}/?p=${p._key}`;
  navigator.clipboard?.writeText(url).then(() => showToast('링크 복사됨'));
}

let galleryIdx = 0;

function renderDetail(key) {
  const el = document.querySelector('.srch-detail-content') || document.getElementById('srchDetail');
  if (!el) return;
  const p = allProducts.find(x => x._key === key);
  if (!p) return;

  galleryIdx = 0;

  const price = p.price || {};
  // 이미지 — 공용 헬퍼 (업로드 + 외부 URL, Drive 폴더는 별도 비동기 해석)
  const imgList = [...new Set([...productImages(p), ...productExternalImages(p)])];
  const driveSource = supportedDriveSource(p);

  // Drive 폴더/지원 사이트면 서버 API로 해석 후 재렌더
  if (driveSource && !p._drive_folder_virtual) {
    import('../core/drive-photos.js').then(m => {
      m.fetchDriveFolderImages(driveSource).then(urls => {
        if (urls?.length && selectedProductKey === key) {
          p.image_urls = urls;
          p._drive_folder_virtual = true;
          renderDetail(key);
          renderList();
        }
      }).catch(() => {});
    });
  }

  // 뱃지 — 공용 헬퍼
  const overlayBadges = topBadgesHtml(p);
  const reviewTag = reviewOverlayHtml(p);

  // 기간별 가격 행 (대여료 + 보증금)
  const priceRows = Object.entries(price)
    .map(([m, v]) => ({ m: Number(m), rent: v?.rent, dep: v?.deposit }))
    .filter(e => Number.isFinite(e.m) && e.m >= 1 && e.m <= 60 && Number(e.rent || 0) > 0)
    .sort((a, b) => a.m - b.m);

  // 영업수수료 (맨 아래 별도 섹션 — 카탈로그 배포 시 제외할 것)
  const feeRows = Object.entries(price)
    .map(([m, v]) => ({ m: Number(m), fee: v?.fee || v?.commission }))
    .filter(e => Number.isFinite(e.m) && e.m >= 1 && e.m <= 60 && Number(e.fee || 0) > 0)
    .sort((a, b) => a.m - b.m);

  // 보험/조건은 product.policy, product.condition, 정책 문서가 있을 수 있음
  const pol = p.policy || {};
  const cond = p.condition || {};
  const policy = findPolicy(p, store.policies || []); // 정책 문서에서 병합할 수 있는 값
  const bodily   = parsePol(first(policy.injury_limit_deductible,          pol.bodily));
  const property = parsePol(first(policy.property_limit_deductible,        pol.property));
  const selfB    = parsePol(first(policy.personal_injury_limit_deductible, pol.selfBodily));
  const unins    = parsePol(first(policy.uninsured_limit_deductible,       pol.uninsured));
  const own      = parsePol(first(policy.own_damage_limit_deductible,      pol.ownDamage));
  const insRows = [
    ['대인',         first(policy.injury_compensation_limit,          bodily.limit),   first(policy.injury_deductible,          bodily.deductible)],
    ['대물',         first(policy.property_compensation_limit,        property.limit), first(policy.property_deductible,        property.deductible)],
    ['자기신체사고', first(policy.personal_injury_compensation_limit, selfB.limit),    first(policy.personal_injury_deductible, selfB.deductible)],
    ['무보험차상해', first(policy.uninsured_compensation_limit,       unins.limit),    first(policy.uninsured_deductible,       unins.deductible)],
    ['자기차량손해', first(policy.own_damage_compensation,            own.limit),      first(policy.own_damage_min_deductible,  own.deductible)],
    ['긴급출동',     first(policy.roadside_assistance, cond.emergency),                '-'],
  ];

  const condRows = [
    ['1만Km추가비용',     first(policy.mileage_upcharge_per_10000km)],
    ['보증금분납',         first(policy.deposit_installment)],
    ['결제방식',           first(policy.payment_method, pol.paymentMethod)],
    ['위약금',             first(policy.penalty_condition, cond.penaltyRate)],
    ['보증금카드결제',     first(policy.deposit_card_payment)],
    ['대여지역',           first(policy.rental_region, cond.rentalRegion)],
    ['탁송비',             first(policy.delivery_fee, cond.deliveryFee)],
    ['운전연령하향',       first(policy.driver_age_lowering, pol.ageLowering)],
    ['운전연령하향비용',   first(policy.age_lowering_cost, pol.ageLoweringCost)],
    ['개인운전자범위',     first(policy.personal_driver_scope)],
    ['사업자운전자범위',   first(policy.business_driver_scope)],
    ['추가운전자수',       first(policy.additional_driver_allowance_count)],
    ['추가운전자비용',     first(policy.additional_driver_cost)],
    ['정비서비스',         first(policy.maintenance_service, cond.maintenance)],
    ['최소운전연령',       first(policy.basic_driver_age, p.ageText)],
    ['운전연령상한',       first(policy.driver_age_upper_limit, pol.ageUpperLimit)],
    ['연간약정주행거리',   first(policy.annual_mileage, pol.annualMileage)],
  ].filter(([, v]) => v && v !== '-');

  // 대여 기본 (가격표 밑): 연령 / 연간약정주행거리 / 보험포함여부
  const basicRows = [
    ['기본 운전연령',     first(policy.basic_driver_age, p.base_age, p.min_age)],
    ['연간약정주행거리', first(policy.annual_mileage, p.annual_mileage, pol.annualMileage)],
    ['보험 포함 여부',   first(policy.insurance_included, p.insurance_included)],
  ].filter(([, v]) => v && v !== '-');

  // 심사/신용 (심사여부 + 신용등급)
  const reviewRows = [
    ['심사여부',  needsReview(p) ? '심사필요' : '무심사'],
    ['심사기준',  first(policy.credit_grade, policy.screening_criteria, p.credit_grade)],
  ].filter(([, v]) => v && v !== '-');

  const fmtDate = v => { const d = String(v ?? '').replace(/[^\d]/g,''); if (!d) return ''; if (d.length === 8) return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}`; if (d.length === 6) return `20${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`; return String(v ?? '').trim() || ''; };

  // 정책 상세
  const policyDetailRows = [
    ['정책코드',     policy.policy_code || p.policy_code],
    ['정책명',       policy.policy_name || p.policy_name],
    ['정책유형',     policy.policy_type],
    ['심사기준',     first(policy.credit_grade, policy.screening_criteria, p.credit_grade)],
    ['연간약정주행거리', first(policy.annual_mileage, p.annual_mileage)],
    ['운전연령하향', first(policy.driver_age_lowering)],
  ].filter(([, v]) => v && v !== '-');

  // 공급사·코드
  const providerRows = [
    ['공급사',   p.provider_company_code],
    ['파트너',   p.partner_code],
    ['상품코드', p.product_code],
    ...(store.currentUser?.role === 'admin' ? [['상품UID', p._key]] : []),
  ].filter(([, v]) => v && v !== '-');

  // 차량 메타
  const metaRows = [
    ['차종구분',   p.vehicle_class],
    ['인승',       p.seats ? p.seats + '인승' : ''],
    ['배기량',     p.engine_cc ? Number(p.engine_cc).toLocaleString() + 'cc' : ''],
    ['용도',       p.usage],
    ['차대번호',   p.vin],
    ['최초등록일', fmtDate(p.first_registration_date)],
    ['차령만료일', fmtDate(p.vehicle_age_expiry_date)],
    ['차량가격',   p.vehicle_price ? fmtMoney(p.vehicle_price) : ''],
    ['위치',       p.location],
  ].filter(([, v]) => v && v !== '-');

  // 특이사항
  const memoText = (p.partner_memo || p.note || '').trim();

  const modelText = [p.maker, p.model].filter(v => v && v !== '-').join(' ');
  const subText   = [p.sub_model, p.trim || p.trim_name].filter(v => v && v !== '-').join(' > ');
  const tags      = [p.fuel_type, p.year ? `${p.year}년식` : '', p.mileage ? Number(p.mileage).toLocaleString()+'km' : ''].filter(Boolean);

  // 대여조건 — 정책에서 싹 다 가져오기
  const allCondRows = [
    ['심사여부',           needsReview(p) ? '심사필요' : '무심사'],
    ['심사기준',           first(policy.credit_grade, policy.screening_criteria, p.credit_grade)],
    ['정책코드',           policy.policy_code || p.policy_code],
    ['정책명',             policy.policy_name || p.policy_name],
    ['정책유형',           policy.policy_type],
    ['기본 운전연령',      first(policy.basic_driver_age, p.base_age, p.min_age)],
    ['운전연령상한',       first(policy.driver_age_upper_limit)],
    ['운전연령하향',       first(policy.driver_age_lowering)],
    ['운전연령하향비용',   first(policy.age_lowering_cost)],
    ['연간약정주행거리',   first(policy.annual_mileage, p.annual_mileage)],
    ['1만Km추가비용',      first(policy.mileage_upcharge_per_10000km)],
    ['보험 포함 여부',     first(policy.insurance_included, p.insurance_included)],
    ['보증금분납',         first(policy.deposit_installment)],
    ['보증금카드결제',     first(policy.deposit_card_payment)],
    ['결제방식',           first(policy.payment_method)],
    ['위약금',             first(policy.penalty_condition)],
    ['대여지역',           first(policy.rental_region)],
    ['탁송비',             first(policy.delivery_fee)],
    ['개인운전자범위',     first(policy.personal_driver_scope)],
    ['사업자운전자범위',   first(policy.business_driver_scope)],
    ['추가운전자수',       first(policy.additional_driver_allowance_count)],
    ['추가운전자비용',     first(policy.additional_driver_cost)],
    ['정비서비스',         first(policy.maintenance_service)],
  ];

  // 기타사항
  const etcRows = [
    ['차량상태',   p.vehicle_status],
    ['상품구분',   p.product_type],
    ['차종구분',   p.vehicle_class],
    ['인승',       p.seats ? p.seats + '인승' : ''],
    ['배기량',     p.engine_cc ? Number(p.engine_cc).toLocaleString() + 'cc' : ''],
    ['용도',       p.usage],
    ['차대번호',   p.vin],
    ['최초등록일', fmtDate(p.first_registration_date)],
    ['차령만료일', fmtDate(p.vehicle_age_expiry_date)],
    ['차량가격',   p.vehicle_price ? fmtMoney(p.vehicle_price) : ''],
    ['위치',       p.location],
    ['공급사',     p.provider_company_code],
    ['파트너',     p.partner_code],
    ['상품코드',   p.product_code],
    ...(store.currentUser?.role === 'admin' ? [['상품UID', p._key]] : []),
  ].filter(([, v]) => v && v !== '-');

  el.innerHTML = `
    <div class="srch-detail-inner">
      ${renderGallery(imgList, { overlayBadges, reviewTag })}

      <!-- 1. 차량정보 -->
      <div class="cat-hero">
        <div class="cat-section-title"><i class="ph ph-car-simple"></i> ${modelText || '차량'}${p.car_number ? `<span class="cat-carno">${p.car_number}</span>` : ''}</div>
        <div class="cat-rows">
          <div class="cat-row"><span class="cat-row-label">세부모델</span><span class="cat-row-value">${p.sub_model || '-'}</span></div>
          <div class="cat-row"><span class="cat-row-label">세부트림</span><span class="cat-row-value">${((p.trim || p.trim_name || '') && p.sub_model) ? (p.trim || p.trim_name || '').replace(p.sub_model, '').trim() || '-' : (p.trim || p.trim_name || '-')}</span></div>
          <div class="cat-row"><span class="cat-row-label">선택옵션</span><span class="cat-row-value">${p.options || '-'}</span></div>
        </div>
        <div class="cat-spec">
          <span class="cat-spec-item"><i class="ph ph-calendar"></i> ${p.year ? p.year + '년' : '-'}</span>
          <span class="cat-spec-item"><i class="ph ph-gauge"></i> ${p.mileage ? Number(p.mileage).toLocaleString() + 'km' : '-'}</span>
          <span class="cat-spec-item"><i class="ph ph-gas-pump"></i> ${p.fuel_type || '-'}</span>
          <span class="cat-spec-item"><i class="ph ph-palette"></i>
            ${p.ext_color ? `<span class="cat-color-badge" style="background:${colorToHex(p.ext_color)};color:${colorTextContrast(p.ext_color)};">외 ${p.ext_color}</span>` : ''}
            ${p.int_color ? `<span class="cat-color-badge" style="background:${colorToHex(p.int_color)};color:${colorTextContrast(p.int_color)};">내 ${p.int_color}</span>` : ''}
          </span>
          <span class="cat-spec-item"><i class="ph ph-jeep"></i> ${p.drive_type || '-'}</span>
        </div>
      </div>

      <!-- 2. 기간별 대여료, 보증금 -->
      <div class="cat-section">
        <div class="cat-section-title"><i class="ph ph-currency-krw"></i> 기간별 대여료, 보증금</div>
        ${priceRows.length ? `
        <table class="cat-table">
          <thead><tr><th>기간</th><th>대여료</th><th>보증금</th></tr></thead>
          <tbody>${priceRows.map(r => `<tr>
            <td>${r.m}개월</td>
            <td class="cat-price-cell">${fmtMoney(r.rent)}</td>
            <td>${fmtMoney(r.dep)}</td>
          </tr>`).join('')}</tbody>
        </table>` : `<div style="font-size:var(--fs-xs);color:var(--c-text-muted);padding:var(--sp-2) 0;">가격 미입력</div>`}
      </div>

      <!-- 3. 보험한도 및 면책금 -->
      <div class="cat-section">
        <div class="cat-section-title"><i class="ph ph-shield-check"></i> 보험한도 및 면책금</div>
        <table class="cat-table">
          <thead><tr><th>항목</th><th>한도</th><th>면책금</th></tr></thead>
          <tbody>${insRows.map(([l, lim, ded]) => `<tr><td>${l}</td><td>${lim || '-'}</td><td>${ded || '-'}</td></tr>`).join('')}</tbody>
        </table>
      </div>

      <!-- 4. 대여조건 -->
      <div class="cat-section">
        <div class="cat-section-title"><i class="ph ph-list-checks"></i> 대여조건</div>
        <div class="cat-rows">${allCondRows.map(([l, v]) => `<div class="cat-row"><span class="cat-row-label">${l}</span><span class="cat-row-value">${v || '-'}</span></div>`).join('')}</div>
      </div>

      <!-- 5. 기타사항 -->
      <div class="cat-section">
        <div class="cat-section-title"><i class="ph ph-note"></i> 기타사항</div>
        ${etcRows.length ? `<div class="cat-rows">${etcRows.map(([l, v]) => `<div class="cat-row"><span class="cat-row-label">${l}</span><span class="cat-row-value">${v}</span></div>`).join('')}</div>` : ''}
        ${memoText ? `<div class="cat-memo" style="margin-top:var(--sp-2);">${memoText.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>` : ''}
        ${!etcRows.length && !memoText ? `<div style="font-size:var(--fs-xs);color:var(--c-text-muted);">-</div>` : ''}
      </div>

      <!-- 6. 수수료 -->
      <div class="cat-section cat-section-fee">
        <div class="cat-section-title"><i class="ph ph-percent"></i> 수수료 <span class="cat-section-hint">(내부용)</span></div>
        ${feeRows.length ? `
        <table class="cat-table">
          <thead><tr><th>기간</th><th>수수료</th></tr></thead>
          <tbody>${feeRows.map(r => `<tr>
            <td>${r.m}개월</td>
            <td class="cat-price-cell">${fmtMoney(r.fee)}</td>
          </tr>`).join('')}</tbody>
        </table>` : `<div style="font-size:var(--fs-xs);color:var(--c-text-muted);padding:var(--sp-2) 0;">준비중</div>`}
      </div>

    </div>
  `;

  bindGallery(el, imgList);

  // 하단 고정 액션바 — content 밖 별도 컨테이너에 주입
  const actions = getActionsFor(p);
  const actionsEl = document.getElementById('srchDetailActions');
  if (actionsEl) {
    actionsEl.hidden = false;
    actionsEl.innerHTML = actions.map((a, i) => `
      <button class="btn ${a.primary ? 'btn-primary' : 'btn-outline'} btn-sm" data-act="${i}">
        <i class="${a.icon}"></i> ${a.label}
      </button>`).join('');
    actionsEl.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => actions[+btn.dataset.act]?.action());
    });
  }
}

function renderGallery(imgList, { overlayBadges = '', reviewTag = '' } = {}) {
  const total = imgList.length;
  if (!total) {
    return `
      <div class="srch-gallery-empty">
        <i class="ph ph-image"></i>
        ${overlayBadges ? `<div class="srch-gallery-badges">${overlayBadges}</div>` : ''}
        ${reviewTag}
      </div>`;
  }
  return `
    <div class="srch-gallery" id="srchGallery">
      <img src="${imgList[0]}" class="srch-gallery-img" id="srchGalleryImg" alt="">
      ${overlayBadges ? `<div class="srch-gallery-badges">${overlayBadges}</div>` : ''}
      ${reviewTag}
      ${total > 1 ? `
        <button class="srch-gallery-nav srch-gallery-prev" id="srchGalleryPrev" aria-label="이전"><i class="ph ph-caret-left"></i></button>
        <button class="srch-gallery-nav srch-gallery-next" id="srchGalleryNext" aria-label="다음"><i class="ph ph-caret-right"></i></button>
        <div class="srch-gallery-counter" id="srchGalleryCtr">1 / ${total}</div>
      ` : ''}
    </div>
  `;
}

function bindGallery(root, imgList) {
  const img = root.querySelector('#srchGalleryImg');
  // 메인 이미지 클릭 → 풀스크린 (단일 이미지여도 확대 가능)
  img?.addEventListener('click', () => openFullscreen(imgList, galleryIdx));
  if (imgList.length <= 1) return;
  const ctr = root.querySelector('#srchGalleryCtr');
  const update = () => {
    if (img) img.src = imgList[galleryIdx];
    if (ctr) ctr.textContent = `${galleryIdx + 1} / ${imgList.length}`;
  };
  root.querySelector('#srchGalleryPrev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    galleryIdx = (galleryIdx - 1 + imgList.length) % imgList.length;
    update();
  });
  root.querySelector('#srchGalleryNext')?.addEventListener('click', (e) => {
    e.stopPropagation();
    galleryIdx = (galleryIdx + 1) % imgList.length;
    update();
  });
}

function openFullscreen(imgList, startIdx = 0) {
  // 전체 이미지 즉시 병렬 prefetch — 스크롤할 때 끊김 제거
  imgList.forEach(url => { const i = new Image(); i.decoding = 'async'; i.src = url; });

  // 네이티브 <dialog> — Escape 처리·backdrop·포커스 트랩 자동
  const overlay = document.createElement('dialog');
  overlay.className = 'srch-fullscreen srch-fullscreen--scroll';
  overlay.innerHTML = `
    <button class="srch-fs-close" aria-label="닫기"><i class="ph ph-x"></i></button>
    <div class="srch-fs-counter" id="srchFsCounter">${startIdx + 1} / ${imgList.length}</div>
    <div class="srch-fs-scroll" id="srchFsScroll">
      ${imgList.map((u, i) => `<img class="srch-fs-img" src="${u}" data-idx="${i}" loading="eager" decoding="async">`).join('')}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.showModal();  // 모달 모드 — 자동 backdrop + 포커스 트랩 + Escape 지원

  const scroller = overlay.querySelector('#srchFsScroll');
  const counter = overlay.querySelector('#srchFsCounter');

  // 시작 이미지로 즉시 스크롤
  requestAnimationFrame(() => {
    const imgs = scroller.querySelectorAll('.srch-fs-img');
    if (imgs[startIdx]) scroller.scrollTop = imgs[startIdx].offsetTop;
  });

  // viewport 중앙에 걸친 이미지가 곧 현재 이미지 → IntersectionObserver가 직접 감지
  //  scroll 이벤트보다 월등히 효율적 (브라우저 네이티브 관찰, CPU/배터리 절감)
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const idx = Number(e.target.dataset.idx) || 0;
        counter.textContent = `${idx + 1} / ${imgList.length}`;
      }
    }
  }, {
    root: scroller,
    rootMargin: '-50% 0px -50% 0px',  // viewport 중앙 가로선에 닿는 이미지
    threshold: 0,
  });
  scroller.querySelectorAll('.srch-fs-img').forEach(img => observer.observe(img));

  // <dialog>가 Escape 처리 → 'close' 이벤트만 듣고 정리
  const ac = new AbortController();
  const close = () => { if (overlay.open) overlay.close(); };
  overlay.addEventListener('close', () => {
    ac.abort();
    observer.disconnect();
    overlay.remove();
  }, { once: true });
  overlay.querySelector('.srch-fs-close').addEventListener('click', close, { signal: ac.signal });
  // backdrop 클릭 시 닫기 (dialog 자체를 클릭하면 e.target === overlay)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { signal: ac.signal });
}

function updateFoot() {
  const foot = document.getElementById('srchFoot');
  const selEl = document.getElementById('srchSelected');
  if (selected.size > 0) {
    foot.style.display = '';
    selEl.textContent = `${selected.size}대 선택`;
  } else {
    foot.style.display = 'none';
  }
}

async function openShare() {
  if (selected.size === 0) { showToast('차량을 선택하세요'); return; }
  const products = allProducts.filter(p => selected.has(p._key));
  const id = 'prop_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  const data = {
    products: products.map(p => p._key),
    agent: store.currentUser?.user_code || '',
    agent_uid: store.currentUser?.uid || '',
    created: Date.now(),
  };
  try {
    const { setRecord } = await import('../firebase/db.js');
    await setRecord(`proposals/${id}`, data);
    window.open(`/proposal.html?id=${id}`, '_blank');
  } catch (e) {
    console.error('[proposal] 저장 실패', e);
    showToast('제안서 저장 실패', 'error');
  }
}

const SRCH_STORAGE_KEY = 'fp.srch.widths';

function saveSrchWidths(panels) {
  const widths = panels.map(p => p.style.width || '');
  localStorage.setItem(SRCH_STORAGE_KEY, JSON.stringify(widths));
}

function restoreSrchWidths(panels) {
  try {
    const saved = JSON.parse(localStorage.getItem(SRCH_STORAGE_KEY));
    if (!saved || !Array.isArray(saved)) return;
    saved.forEach((w, i) => {
      if (w && panels[i]) { panels[i].style.width = w; panels[i].style.flex = 'none'; }
    });
  } catch (e) { /* ignore */ }
}

function initResize() {
  const container = document.querySelector('.srch');
  if (!container) return;

  const panels = [
    container.querySelector('.srch-filter-panel'),
    container.querySelector('.srch-list-wrap'),
    container.querySelector('.srch-detail'),
  ];

  // 저장된 폭 복원
  restoreSrchWidths(panels);

  [document.getElementById('srchResize1'), document.getElementById('srchResize2')].forEach((handle, idx) => {
    if (!handle) return;

    // 더블클릭 → 원래 비율 복원 (1:2:1) + 저장 삭제
    handle.addEventListener('dblclick', () => {
      panels.forEach(p => { p.style.width = ''; p.style.flex = ''; });
      localStorage.removeItem(SRCH_STORAGE_KEY);
    });

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const leftPanel = panels[idx];
      const startW = leftPanel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const newW = Math.max(160, Math.min(startW + dx, container.offsetWidth - 400));
        leftPanel.style.width = `${newW}px`;
        leftPanel.style.flex = 'none';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveSrchWidths(panels);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}


export function unmount() {
  unsubProducts?.();
  selected.clear();
  activeFilters = {};
  _listDelegated = null;  // 이벤트 위임 리스너는 DOM과 함께 사라짐
  // 중분류 패널 복원
  const shell = document.querySelector('.shell');
}
