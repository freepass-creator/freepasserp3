/**
 * 차량 검색 — 전체 목록 + 조건 필터로 추려짐 + 상세 + 복수 공유
 */
import { store } from '../core/store.js';
import { watchCollection, fetchCollection } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtMoney, trimMinusSub } from '../core/format.js';
import { setBreadcrumbTail, setBreadcrumbBrief } from '../core/breadcrumb.js';
import { openContextMenu } from '../core/context-menu.js';
import { navigate } from '../core/router.js';
import { downloadExcelWithFilter, PRODUCT_COLS, PRODUCT_FILTER_FIELDS } from '../core/excel-export.js';
import { first, parsePol, findPolicy, enrichProductsWithPolicy } from '../core/policy-utils.js';
import { topBadgesHtml, reviewOverlayHtml, creditOverlayHtml, needsReview } from '../core/product-badges.js';
import { productImages, productExternalImages, firstProductImage, supportedDriveSource } from '../core/product-photos.js';
import { normalizeYear, normalizeProductType } from '../core/normalize.js';
import { renderProductDetail, colorToHex, colorTextContrast } from '../core/product-detail-render.js';
import { FILTERS, TOP_N, matchFilter, getField, buildDynamicChips } from '../core/product-filters.js';

let unsubProducts = null;
let allProducts = [];
let filteredProducts = [];
let selected = new Set();
let activeFilters = {};
let selectedProductKey = null;
const LIST_PERIODS = [36, 48, 60];
let sortCol = null;
let sortDir = null;
let viewMode = 'excel';

// FILTERS / TOP_N / matchFilter / getField / buildDynamicChips — src/core/product-filters.js 로 이관됨

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
            <button class="btn btn-sm btn-outline" id="srchExcel" title="Excel 다운로드"><i class="ph ph-download-simple"></i> Excel</button>
            <button class="btn btn-sm btn-outline" id="srchPhotoZip" title="사진 ZIP"><i class="ph ph-file-zip"></i> 사진</button>
            <button class="btn btn-sm btn-outline" id="srchViewToggle2" title="${viewMode === 'excel' ? '카드뷰로 전환' : '엑셀뷰로 전환'}"><i class="ph ph-${viewMode === 'excel' ? 'cards' : 'table'}"></i> ${viewMode === 'excel' ? '카드보기' : '엑셀보기'}</button>
            <span class="ws4-head-toggle" id="srchFilterToggle" title="조건 접기"><i class="ph ph-caret-left"></i></span>
          </span>
        </div>
        <div class="srch-filter-search">
          <input class="input input-sm" id="srchText" placeholder="차량번호, 모델명, 금액, 무심사 등...">
          <div class="srch-active" id="srchActive"><span class="srch-active-empty">전체해제</span></div>
        </div>
        <div class="srch-filters" id="srchFilters"></div>
      </div>

      <div class="srch-resize" id="srchResize1"></div>

      <div class="srch-list-wrap">
        <div class="srch-panel-head" id="srchListHead" style="${viewMode === 'excel' ? 'display:none;' : ''}">
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
        <div class="srch-panel-head">
          <span>상품 상세</span>
          <span style="display:flex;align-items:center;gap:var(--sp-1);">
            <span class="srch-detail-actions" id="srchDetailActions"></span>
            <span class="ws4-head-toggle" id="srchDetailToggle" title="상품 상세 접기"><i class="ph ph-caret-right"></i></span>
          </span>
        </div>
        <div class="srch-detail-content">
          <div class="srch-empty"><i class="ph ph-car-simple"></i><p>차량을 선택하세요</p></div>
        </div>
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
        listHead.style.display = 'none';
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

function matchesText(p, q) {
  const fields = [
    // 상품 기본
    p.car_number, p.maker, p.model, p.sub_model, p.trim_name,
    p.vehicle_status, p.product_type, p.vehicle_class,
    p.fuel_type, p.ext_color, p.int_color, p.year,
    p.location, p.provider_company_code, p.policy_code,
    p.partner_code, p.vin, p.usage, p.product_code, p._key,
    p.partner_memo, p.options, p.memo, p.notes, p.mission, p.drive_type,
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

function buildDynamicFilters() {
  // 활성 필터 제외 상호배제 집계 — passesFiltersExcept 를 passFn 으로 전달
  buildDynamicChips(allProducts, (p, key) => passesFiltersExcept(p, key));
}

const dynExpanded = {};

function renderFilters() {
  const el = document.getElementById('srchFilters');
  if (!el) return;

  el.innerHTML = Object.entries(FILTERS).map(([key, f]) => {
    const set = activeFilters[key];
    const isColor = key === 'color' || key === 'int_color';
    const chip = c => {
      if (isColor) {
        // dynamic chip label 형식: "화이트(12)" → 이름과 카운트 분리
        const m = c.label.match(/^(.+?)\((\d+)\)$/);
        const name = m ? m[1] : c.label;
        const cnt  = m ? m[2] : '';
        const hex  = colorToHex(name);
        return `<button class="chip chip-color ${set && set.has(c.id) ? 'is-active' : ''}" data-g="${key}" data-c="${c.id}" title="${name}">
          <span class="chip-swatch" style="background:${hex};"></span>
          <span>${name}${cnt ? ` (${cnt})` : ''}</span>
        </button>`;
      }
      return `<button class="chip ${set && set.has(c.id) ? 'is-active' : ''}" data-g="${key}" data-c="${c.id}">${c.label}</button>`;
    };
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
          <span class="srch-acc-label">${f.label}<span class="sb-badge ${activeCount ? 'is-visible' : ''}">${activeCount || ''}</span></span>
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

  el.innerHTML = entries.flatMap(([g, set]) =>
    [...set].map(cid => {
      const c = FILTERS[g].chips.find(x => x.id === cid);
      return `<span class="chip is-active">${c?.label || cid} <span class="chip-remove" data-g="${g}" data-c="${cid}">&times;</span></span>`;
    })
  ).join('') + `<button class="srch-clear-all ${total ? 'is-active' : ''}" id="srchClear" ${total ? '' : 'disabled'}>전체해제</button>`;

  if (!total) return;

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
    const priceCell = (p, m, cls = '', rightPx = 0) => {
      const v = p.price?.[m] || {};
      const rent = Number(v.rent) || 0;
      const dep = Number(v.deposit) || 0;
      const style = `right:${rightPx}px`;
      if (!rent) return `<td class="excl-price ${cls}" style="${style}">-</td>`;
      return `<td class="excl-price ${cls}" style="${style}"><span class="excl-rent">${fmtMoney(rent)}</span>${dep ? `<br><span class="excl-dep">${fmtMoney(dep)}</span>` : ''}</td>`;
    };
    const pol = p => p._policy || {};
    const cols = [88,64,64,52,76,160,160,140,52,68,52,72,52,52,62,62,62,62];
    const totalW = cols.reduce((s,w) => s+w, 0);
    const colgroup = `<colgroup>${cols.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
    el.innerHTML = `
      <div class="excl-wrap"><table class="excl-table" style="width:${totalW}px">${colgroup}
      <thead><tr>
        <th data-ft="search" data-ci="0" class="excl-sticky-left">차량번호</th><th data-ft="check" data-ci="1">상태</th><th data-ft="check" data-ci="2">구분</th><th data-ft="check" data-ci="3">제조사</th><th data-ft="check" data-ci="4">모델명</th>
        <th data-ft="search" data-ci="5">세부모델</th><th data-ft="search" data-ci="6">세부트림</th><th data-ft="search" data-ci="7">선택옵션</th>
        <th data-ft="check" data-ci="8">연식</th><th data-ft="range" data-rt="mileage" data-ci="9">주행</th><th data-ft="check" data-ci="10">연료</th><th data-ft="check" data-ci="11">색상</th><th data-ft="check" data-ci="12">심사</th><th data-ft="check" data-ci="13">연령</th>
        <th data-ft="range" data-rt="rent" data-ci="14" class="excl-pin-r" style="right:${cols[15]+cols[16]+cols[17]}px">24개월</th><th data-ft="range" data-rt="rent" data-ci="15" class="excl-pin-r" style="right:${cols[16]+cols[17]}px">36개월</th><th data-ft="range" data-rt="rent" data-ci="16" class="excl-pin-r" style="right:${cols[17]}px">48개월</th><th data-ft="range" data-rt="rent" data-ci="17" class="excl-pin-r" style="right:0">60개월</th>
      </tr></thead>
      <tbody>${filteredProducts.map(p => {
        const color = [p.ext_color, p.int_color].filter(Boolean).join('/');
        const credit = pol(p).credit_grade || pol(p).screening_criteria || p.credit_grade || '';
        const age = pol(p).basic_driver_age || '';
        return `<tr class="excl-row ${selectedProductKey === p._key ? 'is-active' : ''}" data-key="${p._key}">
          <td class="excl-sticky-left">${p.car_number || ''}</td>
          <td>${p.vehicle_status || ''}</td>
          <td>${normalizeProductType(p.product_type)}</td>
          <td>${p.maker || ''}</td>
          <td>${p.model || ''}</td>
          <td>${p.sub_model || ''}</td>
          <td>${p.trim_name || p.trim || ''}</td>
          <td>${p.options || ''}</td>
          <td>${normalizeYear(p.year)}</td>
          <td>${p.mileage ? Number(p.mileage).toLocaleString() : ''}</td>
          <td>${p.fuel_type || ''}</td>
          <td>${color}</td>
          <td>${credit}</td>
          <td>${age}</td>
          ${priceCell(p, '24', 'excl-pin-r', cols[15]+cols[16]+cols[17])}${priceCell(p, '36', 'excl-pin-r', cols[16]+cols[17])}${priceCell(p, '48', 'excl-pin-r', cols[17])}${priceCell(p, '60', 'excl-pin-r', 0)}
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    // 셀 hover 툴팁
    let tooltip = null;

    // 행 클릭/우클릭 — 이벤트 위임 (재렌더링 후에도 유지)
    if (!el._exclBound) {
      el._exclBound = true;
      el.addEventListener('click', (e) => {
        const row = e.target.closest('.excl-row');
        if (!row || !el.contains(row)) return;
        if (tooltip) { tooltip.remove(); tooltip = null; }
        el.querySelector('.excl-row.is-active')?.classList.remove('is-active');
        row.classList.add('is-active');
        selectedProductKey = row.dataset.key;
        renderDetail(row.dataset.key);
        const p = allProducts.find(x => x._key === row.dataset.key);
        if (p) {
          const name = [p.maker, p.sub_model, p.trim_name || p.trim].filter(Boolean).join(' ');
          setBreadcrumbTail({ icon: 'ph ph-car-simple', label: name || '차량', sub: p.car_number || '' });
        }
      });
      el.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('.excl-row');
        if (!row || !el.contains(row)) return;
        e.preventDefault();
        const p = allProducts.find(x => x._key === row.dataset.key);
        if (p) openContextMenu(e, getActionsFor(p));
      });
    }

    const exclBody = el.querySelector('.excl-wrap');

    // 헤더 클릭 → 필터 팝업
    let _openFilterTh = null;
    const closeFilter = () => { document.querySelector('.excl-filter')?.remove(); _openFilterTh = null; };

    // 헤더에 필터값 표시
    const setFilterLabel = (th, label) => {
      let tag = th.querySelector('.excl-filter-tag');
      if (!label) { tag?.remove(); return; }
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'excl-filter-tag';
        th.appendChild(tag);
      }
      tag.textContent = label;
    };

    el.querySelectorAll('th[data-ft]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const ft = th.dataset.ft;
        const ci = Number(th.dataset.ci);
        if (ft === 'sort') return;

        // 토글: 같은 헤더 다시 클릭하면 닫기
        if (_openFilterTh === th) { closeFilter(); return; }
        closeFilter();
        _openFilterTh = th;

        const rect = th.getBoundingClientRect();
        const popup = document.createElement('div');
        popup.className = 'excl-filter';
        popup.style.cssText = `position:fixed;top:${rect.bottom+2}px;left:${rect.left}px;z-index:9999;min-width:${Math.max(rect.width,160)}px;max-height:320px;`;

        if (ft === 'search') {
          popup.innerHTML = `<div style="padding:6px 8px;"><input class="input input-sm" placeholder="검색..." autofocus style="width:100%;"></div>
            <div style="display:flex;gap:4px;padding:6px 8px;border-top:1px solid var(--c-border-soft);">
              <button class="btn btn-xs btn-outline" data-a="reset" style="flex:1;">초기화</button>
              <button class="btn btn-xs btn-primary" data-a="apply" style="flex:1;">적용</button>
            </div>`;
          const input = popup.querySelector('input');
          setTimeout(() => input?.focus(), 50);
          input?.addEventListener('keydown', ev => { if (ev.key === 'Enter') popup.querySelector('[data-a="apply"]')?.click(); });
          popup.querySelector('[data-a="reset"]')?.addEventListener('click', () => {
            exclBody.querySelectorAll('.excl-row').forEach(row => { row.style.display = ''; });
            setFilterLabel(th, '');
            closeFilter();
          });
          popup.querySelector('[data-a="apply"]')?.addEventListener('click', () => {
            const q = input?.value?.toLowerCase() || '';
            exclBody.querySelectorAll('.excl-row').forEach(row => {
              const cell = row.children[ci]?.textContent?.toLowerCase() || '';
              row.style.display = !q || cell.includes(q) ? '' : 'none';
            });
            setFilterLabel(th, q ? '1' : '');
            closeFilter();
          });

        } else if (ft === 'check') {
          const vals = {};
          exclBody.querySelectorAll('.excl-row').forEach(row => {
            const v = row.children[ci]?.textContent?.trim() || '';
            if (v) vals[v] = (vals[v]||0) + 1;
          });
          const sorted = Object.entries(vals).sort((a,b) => b[1]-a[1]);
          popup.innerHTML = `
            <div style="flex:1;overflow:auto;padding:4px 0;">${sorted.map(([v,cnt]) => `<label style="display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;white-space:nowrap;"><input type="checkbox" value="${v}" style="accent-color:var(--c-accent);"> ${v} <span style="color:var(--c-text-muted);font-size:10px;margin-left:auto;">${cnt}</span></label>`).join('')}</div>
            <div style="display:flex;gap:4px;padding:6px 8px;border-top:1px solid var(--c-border-soft);">
              <button class="btn btn-xs btn-outline" data-a="reset" style="flex:1;">초기화</button>
              <button class="btn btn-xs btn-primary" data-a="apply" style="flex:1;">적용</button>
            </div>`;
          const applyCheck = () => {
            const checkedArr = [...popup.querySelectorAll('input:checked')].map(c => c.value);
            const checked = new Set(checkedArr);
            exclBody.querySelectorAll('.excl-row').forEach(row => {
              const cell = row.children[ci]?.textContent?.trim() || '';
              row.style.display = !checked.size || checked.has(cell) ? '' : 'none';
            });
            setFilterLabel(th, checkedArr.length ? String(checkedArr.length) : '');
          };
          // 체크박스 변경 즉시 필터 적용
          popup.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', applyCheck));
          popup.querySelector('[data-a="reset"]')?.addEventListener('click', () => {
            popup.querySelectorAll('input:checked').forEach(c => { c.checked = false; });
            exclBody.querySelectorAll('.excl-row').forEach(row => { row.style.display = ''; });
            setFilterLabel(th, '');
          });
          popup.querySelector('[data-a="apply"]')?.addEventListener('click', () => { applyCheck(); closeFilter(); });
        } else if (ft === 'range') {
          const rt = th.dataset.rt;
          const RANGES = rt === 'rent' ? [
            { label: '50만원 미만', min: 0, max: 500000 },
            { label: '50만~60만원', min: 500000, max: 600000 },
            { label: '60만~70만원', min: 600000, max: 700000 },
            { label: '70만~80만원', min: 700000, max: 800000 },
            { label: '80만~90만원', min: 800000, max: 900000 },
            { label: '90만~100만원', min: 900000, max: 1000000 },
            { label: '100만~150만원', min: 1000000, max: 1500000 },
            { label: '150만~200만원', min: 1500000, max: 2000000 },
            { label: '200만원 이상', min: 2000000, max: Infinity },
          ] : [
            { label: '1만Km 미만', min: 0, max: 10000 },
            { label: '1만~2만Km', min: 10000, max: 20000 },
            { label: '2만~3만Km', min: 20000, max: 30000 },
            { label: '3만~5만Km', min: 30000, max: 50000 },
            { label: '5만~7만Km', min: 50000, max: 70000 },
            { label: '7만~10만Km', min: 70000, max: 100000 },
            { label: '10만~15만Km', min: 100000, max: 150000 },
            { label: '15만Km 이상', min: 150000, max: Infinity },
          ];
          // 각 구간별 건수 — 대여료는 row의 실제 데이터에서 값 가져오기
          const rentMonth = rt === 'rent' ? ({14:'24',15:'36',16:'48',17:'60'})[ci] : null;
          const getVal = (row) => {
            const key = row.dataset.key;
            const p = allProducts.find(x => x._key === key);
            if (!p) return 0;
            if (rentMonth) return Number(p.price?.[rentMonth]?.rent || 0);
            return Number(p.mileage || 0);
          };
          const counts = RANGES.map(r => {
            let cnt = 0;
            exclBody.querySelectorAll('.excl-row').forEach(row => {
              const v = getVal(row);
              if (v >= r.min && v < r.max) cnt++;
            });
            return { ...r, cnt };
          }).filter(r => r.cnt > 0);

          popup.innerHTML = `
            <div style="flex:1;overflow:auto;padding:4px 0;">${counts.map((r,i) => `<label style="display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;white-space:nowrap;"><input type="checkbox" data-min="${r.min}" data-max="${r.max}" style="accent-color:var(--c-accent);"> ${r.label} <span style="color:var(--c-text-muted);font-size:10px;margin-left:auto;">${r.cnt}</span></label>`).join('')}</div>
            <div style="display:flex;gap:4px;padding:6px 8px;border-top:1px solid var(--c-border-soft);">
              <button class="btn btn-xs btn-outline" data-a="reset" style="flex:1;">초기화</button>
              <button class="btn btn-xs btn-primary" data-a="apply" style="flex:1;">적용</button>
            </div>`;
          const applyRange = () => {
            const checkedInputs = [...popup.querySelectorAll('input:checked')];
            const selected = checkedInputs.map(c => ({ min: Number(c.dataset.min), max: Number(c.dataset.max) }));
            exclBody.querySelectorAll('.excl-row').forEach(row => {
              if (!selected.length) { row.style.display = ''; return; }
              const v = getVal(row);
              row.style.display = selected.some(r => v >= r.min && v < r.max) ? '' : 'none';
            });
            setFilterLabel(th, selected.length ? String(selected.length) : '');
          };
          popup.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', applyRange));
          popup.querySelector('[data-a="reset"]')?.addEventListener('click', () => {
            popup.querySelectorAll('input:checked').forEach(c => { c.checked = false; });
            exclBody.querySelectorAll('.excl-row').forEach(row => { row.style.display = ''; });
            setFilterLabel(th, '');
          });
          popup.querySelector('[data-a="apply"]')?.addEventListener('click', () => { applyRange(); closeFilter(); });
        }

        document.body.appendChild(popup);
        // 팝업 내부 클릭 이벤트 버블링 차단 (바깥 클릭 감지 리스너가 잡지 않도록)
        popup.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        popup.addEventListener('click', (ev) => ev.stopPropagation());
        // 위치 보정
        requestAnimationFrame(() => {
          const pr = popup.getBoundingClientRect();
          if (pr.right > window.innerWidth) popup.style.left = `${window.innerWidth - pr.width - 8}px`;
          if (pr.bottom > window.innerHeight) popup.style.top = `${rect.top - pr.height - 2}px`;
        });
        // ESC 닫기
        const onKey = ev => { if (ev.key === 'Escape') { closeFilter(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
        // 바깥 클릭 닫기
        setTimeout(() => {
          const onOut = ev => { if (!popup.contains(ev.target) && ev.target !== th) { closeFilter(); document.removeEventListener('pointerdown', onOut); document.removeEventListener('keydown', onKey); } };
          document.addEventListener('pointerdown', onOut);
        });
      });
    });

    // 컬럼 리사이즈 — th 우측 경계 드래그
    el.querySelectorAll('.excl-head th').forEach((th, i) => {
      const handle = document.createElement('div');
      handle.className = 'excl-resize';
      th.style.position = 'relative';
      th.appendChild(handle);
      // 더블클릭 → 내용에 맞춰 넓히기 / 다시 더블클릭 → 원래 폭 복원
      const defaultW = cols[i];
      let isExpanded = false;
      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (!isExpanded) {
          let maxW = th.scrollWidth;
          exclBody.querySelectorAll(`.excl-row td:nth-child(${i+1})`).forEach(td => {
            maxW = Math.max(maxW, td.scrollWidth + 16);
          });
          cols[i] = Math.max(defaultW, maxW);
          isExpanded = true;
        } else {
          cols[i] = defaultW;
          isExpanded = false;
        }
        const tw = cols.reduce((s,w) => s+w, 0);
        el.querySelectorAll('.excl-table').forEach(t => { t.style.width = `${tw}px`; });
        el.querySelectorAll(`.excl-table col:nth-child(${i+1})`).forEach(col => { col.style.width = `${cols[i]}px`; });
      });
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = cols[i];
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        let rafId = 0;
        const tables = el.querySelectorAll('.excl-table');
        const colEls = el.querySelectorAll(`.excl-table col:nth-child(${i+1})`);
        const onMove = (ev) => {
          cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            const newW = Math.max(30, startW + ev.clientX - startX);
            cols[i] = newW;
            const tw = cols.reduce((s,w) => s+w, 0);
            tables.forEach(t => { t.style.width = `${tw}px`; });
            colEls.forEach(col => { col.style.width = `${newW}px`; });
          });
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    // 세부트림(6) · 선택옵션(7) 셀 hover → 차량 상세 툴팁
    let tooltipKey = null;
    const TOOLTIP_COLS = new Set([6, 7]); // 세부트림, 선택옵션 컬럼 인덱스
    exclBody.addEventListener('mouseover', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      const row = td.closest('.excl-row');
      if (!row) return;
      const ci = [...row.children].indexOf(td);
      if (!TOOLTIP_COLS.has(ci)) { if (tooltip) { tooltip.remove(); tooltip = null; tooltipKey = null; } return; }
      if (row.dataset.key === tooltipKey) return;
      if (tooltip) { tooltip.remove(); tooltip = null; }
      tooltipKey = row.dataset.key;
      const p = allProducts.find(x => x._key === tooltipKey);
      if (!p) return;
      const trim = p.trim_name || p.trim || '-';
      const opts = p.options || '-';
      const spec = [normalizeYear(p.year), p.mileage ? `${Number(p.mileage).toLocaleString()}km` : '', p.fuel_type, [p.ext_color, p.int_color].filter(Boolean).join('/')].filter(Boolean).join(' · ');
      tooltip = document.createElement('div');
      tooltip.className = 'excl-tooltip';
      tooltip.innerHTML = `<div style="font-weight:var(--fw-medium);">${trim}</div><div>${opts}</div><div style="color:var(--c-text-muted);margin-top:2px;">${spec}</div>`;
      document.body.appendChild(tooltip);
    });
    exclBody.addEventListener('mousemove', (e) => {
      if (tooltip) { tooltip.style.left = `${e.clientX + 12}px`; tooltip.style.top = `${e.clientY + 16}px`; }
    });
    exclBody.addEventListener('mouseout', (e) => {
      const td = e.target.closest('td');
      const related = e.relatedTarget?.closest?.('td');
      if (td && related) {
        const row = related.closest('.excl-row');
        const ci = row ? [...row.children].indexOf(related) : -1;
        if (TOOLTIP_COLS.has(ci) && row?.dataset.key === tooltipKey) return;
      }
      if (tooltip) { tooltip.remove(); tooltip = null; tooltipKey = null; }
    });

    return;
  }

  el.innerHTML = filteredProducts.map(p => {
    const price = p.price || {};
    const isActive = selectedProductKey === p._key;
    // 메인: 세부모델 + 트림 (한글/영문/숫자 단어 단위로 중복 제거 — 띄어쓰기·대소문자 무관)
    const subModel = (p.sub_model || '').trim();
    const trimRaw  = (p.trim_name || p.trim || '').trim();
    const trimClean = trimMinusSub(subModel, trimRaw);
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
      normalizeYear(p.year),
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
  // 영업자(영업관리자): 소통 · 계약 · 공유
  if (role === 'agent' || role === 'agent_admin') {
    acts.push({ icon: 'ph ph-chat-circle', label: '소통', tone: 'navy', action: () => startInquiryContract(product) });
    acts.push({ icon: 'ph ph-file-text', label: '계약', tone: 'emerald', action: () => startContractFromProduct(product) });
    acts.push({ icon: 'ph ph-share-network', label: '공유', tone: 'rose', action: () => shareProduct(product) });
    return acts;
  }
  // 관리자·공급사·기타: 공유만
  acts.push({ icon: 'ph ph-share-network', label: '공유', tone: 'rose', action: () => shareProduct(product) });
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

function startContractFromProduct(p) {
  // 계약 페이지로 이동 — 선택된 차량 전달
  store.pendingContractProduct = p._key;
  navigate('/contract');
  showToast(`${p.car_number || p.model} 계약 시작`);
}

function shareProduct(p) {
  // ERP 엑셀 링크와 동일한 포맷 — 받은 사람이 로그인하면 해당 차량 문의 자동 시작
  const car = p.car_number || '';
  const url = car
    ? `${location.origin}/?car=${encodeURIComponent(car)}`
    : `${location.origin}/?p=${p._key}`;
  navigator.clipboard?.writeText(url).then(() => showToast('링크 복사됨'));
}

function renderDetail(key) {
  const el = document.querySelector('.srch-detail-content') || document.getElementById('srchDetail');
  if (!el) return;
  const p = allProducts.find(x => x._key === key);
  if (!p) return;

  renderProductDetail(el, p, {
    shouldRerender: () => selectedProductKey === key,
    actionButtons: getActionsFor(p),
  });
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
  _listDelegated = null;
  const shell = document.querySelector('.shell');
}
