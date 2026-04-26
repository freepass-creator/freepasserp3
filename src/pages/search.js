/**
 * pages/search.js — 상품 찾기 페이지 (v3 ERP)
 *
 * Export:
 *   - calibrateSearchCols(products)
 *   - renderSearchTable(products)
 *   - renderSearchDetail(p, targetCard, options)  // workspace 등 다른 페이지도 호출
 *   - bindSearchInteractions()  // 헤더 필터 popover, row 클릭, chip 필터
 *   - bindSearchSelection()     // Ctrl/Shift 다중 선택 (toggleSearchSelection 은 별도 모듈)
 *   - applySearchFilter()       // 외부에서 검색어 갱신 후 호출
 *   - setSearchCallbacks({ onCreateRoom })  // 의존성 주입 — workspace 가 createRoomFromProduct 주입
 *
 *   - _searchFilter (외부 모듈에서 검색 input → 필터 갱신용 export)
 */
import { store } from '../core/store.js';
import { productImages, productExternalImages, supportedDriveSource, toProxiedImage } from '../core/product-photos.js';
import { extractProductDetailRows } from '../core/product-detail-rows.js';
import {
  esc, shortStatus, mapStatusDot, fmtMileage,
} from '../core/ui-helpers.js';

/* 외부 주입 콜백 — workspace 가 createRoomFromProduct 를 setSearchCallbacks 로 주입 */
let _onCreateRoom = null;
export function setSearchCallbacks({ onCreateRoom }) {
  _onCreateRoom = onCreateRoom;
}

/* search 페이지 필터 상태 — bindGlobalSearch 등 외부 모듈에서 search 만 갱신 */
export const _searchFilter = { chip: 'all', search: '', column: {} };
let _activeFtTh = null;

/* ──────── A. 표 렌더 + 컬럼 폭 자동 산출 ──────── */

/* 컬럼 폭 자동 — 한글 11px, ASCII 6.5px (11px system font 추정) */
export function calibrateSearchCols(products) {
  const cols = document.querySelectorAll('[data-page="search"] table.table-fixed colgroup col');
  if (!cols.length || !products.length) return;

  const charPx = (s) => {
    if (s == null || s === '') return 0;
    let w = 0;
    for (const c of String(s)) w += /[가-힣]/.test(c) ? 11 : 6.5;
    return w;
  };

  const getters = [
    p => p.car_number,
    p => shortStatus(p.vehicle_status || ''),
    p => p.product_type,
    p => p.maker,
    p => p.model,
    p => p.sub_model,
    p => p.trim_name || p.trim,
    p => Array.isArray(p.options) ? p.options.join('·') : p.options,
    p => String(p.year || ''),
    p => fmtMileage(p.mileage),
    p => p.fuel_type,
    p => p.ext_color,
    p => (p._policy && (p._policy.credit_grade || p._policy.screening_criteria)) || p.credit_grade,
    p => p._policy && p._policy.basic_driver_age,
  ];
  const HEADER_LABELS = ['차량번호','상태','구분','제조사','모델명','세부모델','세부트림','선택옵션','연식','주행','연료','색상','심사','연령'];
  const HAS_FILTER = [false, true, true, true, true, true, true, true, true, true, true, true, true, true];
  const STATUS_DOT = 10;
  const MIN_WIDTHS = [70, 48, 44, 44, 56, 60, 56, 80, 40, 48, 48, 40, 44, 40];

  const widths = getters.map((get, idx) => {
    let sum = 0, n = 0;
    products.forEach(p => {
      const v = get(p);
      if (v == null || v === '') return;
      sum += charPx(v);
      n++;
    });
    const avgContent = n ? sum / n : 0;
    const headerW = charPx(HEADER_LABELS[idx]);
    const baseW = Math.max(avgContent, headerW);
    const extra = 16 + (HAS_FILTER[idx] ? 14 : 0) + (idx === 1 ? STATUS_DOT : 0);
    return Math.max(MIN_WIDTHS[idx], Math.ceil(baseW + extra));
  });
  // 옵션 (idx 7) — outlier 영향 줄이려고 세부트림(6) × 1.3 강제
  widths[7] = Math.round(widths[6] * 1.3);
  widths.forEach((w, idx) => cols[idx]?.style.setProperty('width', w + 'px'));
}

export function renderSearchTable(products) {
  const tbody = document.querySelector('[data-page="search"] .table tbody');
  if (!tbody) return;
  if (!products || !products.length) {
    tbody.innerHTML = '<tr><td colspan="18" class="empty-state" style="text-align:center; padding:24px; color:var(--text-muted);">표시할 상품이 없습니다</td></tr>';
    return;
  }
  tbody.innerHTML = products.map(renderSearchRow).join('');
  const first = tbody.querySelector('tr');
  if (first) {
    first.classList.add('selected');
    const p = products.find(x => x._key === first.dataset.id);
    if (p) renderSearchDetail(p);
  }
}

function renderSearchRow(p) {
  const status = p.vehicle_status || '대기';
  const dot = mapStatusDot(status);
  const stShort = shortStatus(status);
  const credit = (p._policy && (p._policy.credit_grade || p._policy.screening_criteria)) || p.credit_grade || '-';
  const age = (p._policy && p._policy.basic_driver_age) ? p._policy.basic_driver_age : '';
  const opts = Array.isArray(p.options) ? p.options.join('·') : (p.options || '-');
  const maker = p.maker || '-';
  const model = p.model || '-';
  const subModel = p.sub_model || '-';
  const trim = p.trim_name || p.trim || '-';
  return `
    <tr data-id="${p._key}">
      <td class="sticky-col" title="${esc(p.car_number || '')}">${p.car_number || '-'}</td>
      <td class="center" title="${esc(status)}"><span class="status-dot ${dot}"></span>${stShort}</td>
      <td class="center" title="${esc(p.product_type || '')}">${p.product_type || '-'}</td>
      <td title="${esc(maker)}">${maker}</td>
      <td title="${esc(model)}">${model}</td>
      <td title="${esc(subModel)}">${subModel}</td>
      <td title="${esc(trim)}">${trim}</td>
      <td class="dim" title="${esc(opts)}">${opts}</td>
      <td class="center">${p.year || '-'}</td>
      <td class="num">${fmtMileage(p.mileage)}</td>
      <td class="center" title="${esc(p.fuel_type || '')}">${p.fuel_type || '-'}</td>
      <td class="center" title="${esc(p.ext_color || '')}">${p.ext_color || '-'}</td>
      <td class="center" title="${esc(credit)}">${credit}</td>
      <td class="center">${age || '-'}</td>
      <td class="num">${fmtPricePair(p.price?.['24'])}</td>
      <td class="num">${fmtPricePair(p.price?.['36'])}</td>
      <td class="num">${fmtPricePair(p.price?.['48'])}</td>
      <td class="num">${fmtPricePair(p.price?.['60'])}</td>
    </tr>`;
}

function fmtPricePair(v) {
  if (!v || !Number(v.rent)) return '<span style="color:var(--text-muted);">-</span>';
  const r = Math.round(Number(v.rent) / 10000);
  const d = Math.round(Number(v.deposit || 0) / 10000);
  return `<span class="price-pair"><span class="rent">${r}만</span><span class="sep">/</span><span class="dep">${d || 0}만</span></span>`;
}

/* ──────── B. 상세 패널 (다른 페이지에서도 호출됨) ──────── */

/* options.skipHead — 헤드 건드리지 않음 (워크스페이스 차량정보 카드 등) */
export function renderSearchDetail(p, targetCard, options = {}) {
  const card = targetCard || document.querySelectorAll('.pt-page[data-page="search"] .ws4-card')[1];
  if (!card) return;
  const role = store.currentUser?.role;
  const isAdmin = role === 'admin';
  const canSeeFee = isAdmin || role === 'agent' || role === 'agent_admin';
  const pol = p._policy || p.policy || {};
  const policyName = pol.policy_name || p.policy_name || '';

  // 헤더 — search 페이지에서만 갱신
  if (!options.skipHead) {
    const head = card.querySelector('.ws4-head');
    if (head) {
      const canCreateRoom = role === 'agent' || role === 'agent_admin' || isAdmin;
      head.innerHTML = `
        <span style="color: var(--text-main);">${esc(p.car_number || '-')} 상세페이지</span>
        <div class="spacer" style="flex:1;"></div>
        ${canCreateRoom ? `<button class="btn btn-sm btn-primary" id="srchCreateRoom"><i class="ph ph-chat-circle-plus"></i> 대화 생성</button>` : ''}
        <button class="btn btn-sm" id="detailClose" title="패널 닫기"><i class="ph ph-x"></i></button>
      `;
      head.querySelector('#srchCreateRoom')?.addEventListener('click', () => _onCreateRoom?.(p));
    }
  }

  const imgs = [...new Set([...productImages(p), ...productExternalImages(p)])].map(toProxiedImage);
  const driveSrc = supportedDriveSource(p);

  // 6섹션 row 데이터 — 공통 헬퍼
  const rows = extractProductDetailRows(p, { canSeeFee, isAdmin, policies: store.policies });
  const basicRows = rows.basic;
  const specRows  = rows.spec;
  const insRows   = rows.ins;
  const condRows  = rows.cond;
  const adminRows = rows.etc;
  const priceRows = rows.price;
  const feeRows   = rows.fee;
  const opts      = rows.options;

  const filterRows = (r) => r.filter(([, v]) => v != null && v !== '' && v !== '-');
  const renderGrid = (r) => filterRows(r).map(([l, v]) => `<div class="lab">${esc(l)}</div><div>${esc(v)}</div>`).join('');

  const photoHtml = imgs.length ? `
    <img class="detail-photo-main" id="dtlMainImg" src="${esc(imgs[0])}" alt="" loading="lazy"
         onerror="this.style.display='none'; this.parentElement.querySelector('.dtl-photo-fallback').style.display='flex';">
    <div class="dtl-photo-fallback" style="display:none; align-items:center; justify-content:center; width:100%; height:180px; background:var(--bg-stripe); color:var(--text-muted);"><i class="ph ph-image"></i></div>
    ${imgs.length > 1 ? `<div class="detail-photo-thumbs">
      ${imgs.slice(0, 5).map((u, i) => `<div class="detail-photo-thumb${i === 0 ? ' is-active' : ''}" data-img="${esc(u)}"><img src="${esc(u)}" alt="" loading="lazy" onerror="this.style.display='none';"></div>`).join('')}
      ${imgs.length > 5 ? `<div class="detail-photo-thumb more">+${imgs.length - 5}</div>` : ''}
    </div>` : ''}
  ` : `
    <div class="detail-photo-main" style="display:flex; align-items:center; justify-content:center;"><i class="ph ph-image" style="font-size:32px; color:var(--text-muted);"></i></div>
    ${driveSrc ? `<div style="padding:8px; text-align:center; color:var(--text-muted); font-size:11px;">사진 불러오는 중...</div>` : ''}
  `;

  const body = card.querySelector('.ws4-body');
  body.innerHTML = `
    <div class="detail-section">${photoHtml}</div>

    <!-- 1. 기본정보 -->
    <div class="detail-section">
      <div class="detail-section-label">1. 기본정보</div>
      <div class="info-grid">${renderGrid(basicRows)}</div>
    </div>

    <!-- 2. 제조사 스펙 -->
    ${filterRows(specRows).length || opts.length ? `<div class="detail-section">
      <div class="detail-section-label">2. 제조사 스펙</div>
      <div class="info-grid">
        ${renderGrid(specRows)}
        ${opts.length ? `<div class="lab">옵션</div><div class="full chips-wrap">${opts.map(o => `<span class="chip">${esc(o)}</span>`).join('')}</div>` : ''}
      </div>
    </div>` : ''}

    <!-- 3. 기간별 대여료 -->
    ${priceRows.length ? `<div class="detail-section">
      <div class="detail-section-label">3. 기간별 대여료 / 보증금</div>
      <table class="table">
        <thead><tr><th>기간</th><th class="num">대여료</th><th class="num">보증금</th></tr></thead>
        <tbody>${priceRows.map(r => `<tr><td>${r.m}개월</td><td class="num">${r.rent ? Math.round(r.rent/10000) + '만' : '-'}</td><td class="num">${r.dep ? Math.round(r.dep/10000) + '만' : '-'}</td></tr>`).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- 4. 보험 정보 -->
    ${insRows.length ? `<div class="detail-section">
      <div class="detail-section-label">4. 보험 정보</div>
      <table class="table">
        <thead><tr><th>구분</th><th>보장한도</th><th>자기부담금</th></tr></thead>
        <tbody>${insRows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1] || '-')}</td><td>${esc(r[2] || '-')}</td></tr>`).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- 5. 기타 계약 조건 -->
    ${filterRows(condRows).length ? `<div class="detail-section">
      <div class="detail-section-label">5. 기타 계약 조건${policyName ? ` <span style="color:var(--text-muted); font-weight:400;">· ${esc(policyName)}</span>` : ''}</div>
      <div class="info-grid">${renderGrid(condRows)}</div>
    </div>` : ''}

    <!-- 6. 영업 수수료 (agent / admin / agent_admin 만) -->
    ${(canSeeFee && feeRows.length) ? `<div class="detail-section">
      <div class="detail-section-label">6. 영업 수수료</div>
      <table class="table">
        <thead><tr><th>기간</th><th class="num">수수료</th></tr></thead>
        <tbody>${feeRows.map(r => `<tr><td>${r.m}개월</td><td class="num">${Math.round(r.fee/10000)}만</td></tr>`).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- 관리자 정보 (admin only) -->
    ${adminRows.length && filterRows(adminRows).length ? `<div class="detail-section">
      <div class="detail-section-label">관리자 정보</div>
      <div class="info-grid">${renderGrid(adminRows)}</div>
    </div>` : ''}
  `;

  // 썸네일 클릭 → 메인 이미지 교체
  body.querySelectorAll('.detail-photo-thumb[data-img]').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const url = thumb.dataset.img;
      const main = body.querySelector('img.detail-photo-main');
      if (main && url) main.src = url;
      body.querySelectorAll('.detail-photo-thumb').forEach(t => t.classList.remove('is-active'));
      thumb.classList.add('is-active');
    });
  });

  // Drive 폴더면 백그라운드 fetch 후 재렌더
  if (driveSrc && !p._drive_folder_virtual) {
    import('../core/drive-photos.js').then(m => {
      m.fetchDriveFolderImages(driveSrc).then(urls => {
        if (!urls?.length) return;
        const stillCurrent = card.querySelector('.ws4-head span')?.textContent === (p.car_number || '-');
        if (stillCurrent) {
          p.image_urls = urls;
          p._drive_folder_virtual = true;
          renderSearchDetail(p);
        }
      }).catch(() => {});
    });
  }
}

/* ──────── C. 인터랙션 (row 클릭 / 닫기 / 헤더 필터 popover / chip 필터) ──────── */

const SEARCH_COL_FIELD = [
  null,                       // 0 차량번호 (sticky-col, 필터 X)
  'vehicle_status',
  'product_type',
  'maker',
  'model',
  'sub_model',
  'trim_name',
  'options',
  'year',
  'mileage',
  'fuel_type',
  'ext_color',
  '_policy.credit_grade',
  '_policy.basic_driver_age',
  null, null, null, null,     // 가격 4컬럼 (range 미구현)
];

function getColumnVal(p, field) {
  if (!field) return null;
  if (field.startsWith('_policy.')) return p._policy?.[field.slice(8)];
  if (field === 'options' && Array.isArray(p.options)) return p.options.join('·');
  return p[field];
}

export function bindSearchInteractions() {
  const ws4 = document.querySelector('[data-page="search"] .ws4');
  if (!ws4) return;

  ws4.addEventListener('click', (e) => {
    if (e.target.closest('#detailClose')) {
      ws4.classList.add('is-collapsed');
      return;
    }
    const th = e.target.closest('.table thead th');
    if (th && !e.target.closest('.ft-pop')) {
      e.stopPropagation();
      if (th.classList.contains('sticky-col')) return;
      if (_activeFtTh === th) {
        th.querySelector('.ft-pop')?.remove();
        _activeFtTh = null;
      } else {
        _activeFtTh?.querySelector('.ft-pop')?.remove();
        th.appendChild(buildFtPop(th));
        _activeFtTh = th;
      }
      return;
    }
    const tr = e.target.closest('.table tbody tr');
    if (tr && tr.dataset.id) {
      const wasSelected = tr.classList.contains('selected');
      const wasOpen = !ws4.classList.contains('is-collapsed');
      if (wasSelected && wasOpen) {
        ws4.classList.add('is-collapsed');
      } else {
        ws4.querySelectorAll('.table tbody tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');
        ws4.classList.remove('is-collapsed');
        const p = (store.products || []).find(x => x._key === tr.dataset.id);
        if (p) renderSearchDetail(p);
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (_activeFtTh && !e.target.closest('.table thead th')) {
      _activeFtTh.querySelector('.ft-pop')?.remove();
      _activeFtTh = null;
    }
  });

  const tbInner = document.querySelector('.pt-tb-inner[data-tb="search"]');
  tbInner?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    tbInner.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const label = chip.textContent.trim().split(/\s/)[0];
    _searchFilter.chip = { '전체': 'all', '즉시': '즉시', '출고가능': '가능', '출고협의': '협의' }[label] || 'all';
    applySearchFilter();
  });
}

/* search 표 row 클릭 시 Ctrl/Shift 면 선택 모드 (단순 버전 — toggleSearchSelection 은 향후) */
export function bindSearchSelection() {
  const ws4 = document.querySelector('[data-page="search"] .ws4');
  if (!ws4) return;
  ws4.addEventListener('click', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tr = e.target.closest('.table tbody tr');
    if (!tr || !tr.dataset.id) return;
    e.stopPropagation();
    e.preventDefault();
    // toggleSearchSelection — 추후 구현
  }, true);
}

function buildFtPop(th) {
  const idx = Array.from(th.parentElement.children).indexOf(th);
  const field = SEARCH_COL_FIELD[idx];
  const wrap = document.createElement('div');
  wrap.className = 'ft-pop';
  if (!field) {
    wrap.innerHTML = '<div style="padding:12px; color:var(--text-muted); text-align:center;">필터 미지원</div>';
    return wrap;
  }
  const products = filterProductsExcept(field);
  const counts = new Map();
  products.forEach(p => {
    const v = getColumnVal(p, field);
    if (v === undefined || v === null || v === '') return;
    const k = String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const allEntries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  const selected = _searchFilter.column[field];

  wrap.innerHTML = `
    <div class="ft-pop-section ft-pop-sort">
      <div class="ft-pop-row sort-half" data-act="sort-asc"><span class="ft-arrow">↑</span> 오름차순</div>
      <div class="ft-pop-row sort-half" data-act="sort-desc"><span class="ft-arrow">↓</span> 내림차순</div>
    </div>
    <div class="ft-pop-search">
      <input type="search" class="input" placeholder="옵션 검색...">
    </div>
    <div class="ft-pop-section ft-pop-list">
      ${allEntries.map(([k, cnt]) => `<label class="ft-pop-row"><input type="checkbox" data-v="${k.replace(/"/g, '&quot;')}" ${(selected && selected.has(k)) ? 'checked' : ''}> <span class="ft-pop-label">${k}</span><span class="ft-pop-cnt">${cnt}</span></label>`).join('')}
    </div>
    <div class="ft-pop-actions">
      <button class="btn" data-act="reset">초기화</button>
      <button class="btn-primary" data-act="close">닫기</button>
    </div>
  `;

  wrap.querySelectorAll('input[type="checkbox"][data-v]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...wrap.querySelectorAll('input[type="checkbox"][data-v]:checked')].map(i => i.dataset.v);
      if (checked.length === 0) {
        delete _searchFilter.column[field];
        th.classList.remove('has-filter');
      } else {
        _searchFilter.column[field] = new Set(checked);
        th.classList.add('has-filter');
      }
      applySearchFilter();
    });
  });
  wrap.querySelector('.ft-pop-search input').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    wrap.querySelectorAll('.ft-pop-list label').forEach(label => {
      const cb = label.querySelector('input[data-v]');
      if (!cb) return;
      label.style.display = cb.dataset.v.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  wrap.querySelector('[data-act="reset"]').addEventListener('click', (e) => {
    e.stopPropagation();
    delete _searchFilter.column[field];
    th.classList.remove('has-filter');
    wrap.querySelectorAll('input[type="checkbox"][data-v]').forEach(i => i.checked = false);
    applySearchFilter();
  });
  wrap.querySelector('[data-act="close"]').addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.remove();
    _activeFtTh = null;
  });

  return wrap;
}

/* exceptField 컬럼만 제외하고 나머지 모든 필터 적용한 products */
function filterProductsExcept(exceptField) {
  const all = store.products || [];
  const f = _searchFilter;
  return all.filter(p => {
    if (f.chip !== 'all') {
      const s = p.vehicle_status || '';
      if (f.chip === '즉시' && !/즉시/.test(s)) return false;
      if (f.chip === '가능' && !/가능/.test(s)) return false;
      if (f.chip === '협의' && !/협의/.test(s)) return false;
    }
    for (const [field, sel] of Object.entries(f.column)) {
      if (field === exceptField) continue;
      const v = getColumnVal(p, field);
      if (!sel.has(String(v))) return false;
    }
    if (f.search) {
      const opts = Array.isArray(p.options) ? p.options.join(' ') : (p.options || '');
      const hay = [p.car_number, p.maker, p.model, p.sub_model, p.trim_name, p.fuel_type, p.ext_color, opts].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });
}

export function applySearchFilter() {
  const filtered = filterProductsExcept(null);
  renderSearchTable(filtered);
}
