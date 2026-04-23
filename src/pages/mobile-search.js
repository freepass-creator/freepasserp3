/**
 * 모바일 상품 검색
 * - 고정 상단 서치바 + 가로 스크롤 칩 필터
 * - 카드 리스트 (썸네일 + 주요정보)
 * - 카드 탭 → 바텀시트 상세
 * - FAB: 공유
 * - 무한 스크롤
 */
import { store } from '../core/store.js';
import { watchCollection } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtMoney, trimMinusSub } from '../core/format.js';
import { firstProductImage, supportedDriveSource } from '../core/product-photos.js';
import { enrichProductsWithPolicy } from '../core/policy-utils.js';
import { renderProductDetail } from '../core/product-detail-render.js';
import { openBottomSheet, openFab, pushMobileView } from '../core/mobile-shell.js';
import { FILTERS, matchFilter, buildDynamicChips } from '../core/product-filters.js';
import { normalizeYear } from '../core/normalize.js';

let unsub = null;
let allProducts = [];
let query = '';
// activeFilters: { [groupKey]: Set<chipId> } — desktop 과 동일 구조
let activeFilters = {};
let renderLimit = 30;

export function mount() {
  unsub?.();
  renderLimit = 30;

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="m-shell-page">
      <div class="m-search-head">
        <div class="m-search-bar">
          <i class="ph ph-magnifying-glass"></i>
          <input type="search" id="mSearchInput" placeholder="차량번호, 모델명 검색..."
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                 enterkeyhint="search">
          <span class="m-search-count" id="mSearchCount"></span>
          <button class="m-topbar-action" id="mSearchClear" style="display:none;" aria-label="지우기"><i class="ph ph-x-circle"></i></button>
          <button class="m-topbar-action" id="mSearchFilterBtn" aria-label="필터"><i class="ph ph-sliders-horizontal"></i><span class="m-filter-dot" id="mSearchFilterDot" hidden></span></button>
        </div>
        <div class="m-search-active" id="mSearchActive"><button class="m-search-clear-all" disabled>전체해제</button></div>
      </div>
      <div class="m-page m-search-list" id="mSearchList"></div>
    </div>
  `;

  bindUI();

  unsub = watchCollection('products', (data) => {
    const visible = (data || [])
      .filter(p => !p._deleted && p.status !== 'deleted')
      .map(p => {
        if (!p.model && p.model_name) p.model = p.model_name;
        return p;
      });
    allProducts = enrichProductsWithPolicy(visible, store.policies || []);
    store.products = allProducts;
    render();
  });

  // policies watcher (enrich 다시)
  watchCollection('policies', (data) => {
    store.policies = data;
    if (allProducts.length) {
      allProducts = enrichProductsWithPolicy(allProducts, data);
      render();
    }
  });
}

function bindUI() {
  const input = document.getElementById('mSearchInput');
  const clear = document.getElementById('mSearchClear');
  input?.addEventListener('input', () => {
    query = input.value.trim().toLowerCase();
    clear.style.display = query ? '' : 'none';
    renderLimit = 30;
    render();
  });
  clear?.addEventListener('click', () => {
    input.value = '';
    query = '';
    clear.style.display = 'none';
    render();
  });

  document.getElementById('mSearchFilterBtn')?.addEventListener('click', openFilterSheet);

  // Active filter chip 클릭 → 해제
  document.getElementById('mSearchActive')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (btn) {
      const [g, c] = btn.dataset.remove.split('::');
      activeFilters[g]?.delete(c);
      if (activeFilters[g] && !activeFilters[g].size) delete activeFilters[g];
      renderActive();
      updateFilterDot();
      renderLimit = 30;
      render();
      return;
    }
    if (e.target.closest('#mSearchClearAll')) {
      activeFilters = {};
      renderActive();
      updateFilterDot();
      renderLimit = 30;
      render();
    }
  });

  // Infinite scroll
  const list = document.getElementById('mSearchList');
  list?.addEventListener('scroll', () => {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) {
      const filtered = getFiltered();
      if (renderLimit < filtered.length) {
        renderLimit = Math.min(filtered.length, renderLimit + 30);
        render();
      }
    }
  });

  // Card click — 바텀시트 상세
  list?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-pkey]');
    if (!card) return;
    const p = allProducts.find(x => x._key === card.dataset.pkey);
    if (p) openProductSheet(p);
  });
}

function getFiltered() {
  let list = [...allProducts];

  // 설정: 공급사가 "내 차량만 보기" ON 이면 자기 회사 상품으로 축소
  const me = store.currentUser || {};
  if (me.role === 'provider' && localStorage.getItem('fp.onlyMine') === '1') {
    list = list.filter(p => p.provider_company_code === me.company_code);
  }

  if (query) {
    list = list.filter(p => [
      p.car_number, p.model, p.sub_model, p.maker, p.trim_name, p.trim,
      p.provider_company_code, p.product_code, p.vehicle_status, p.product_type,
      p.fuel_type, p.ext_color, p.int_color, p.year, p.vehicle_class,
    ].some(v => v && String(v).toLowerCase().includes(query)));
  }

  // 웹과 동일: 그룹 내부는 OR, 그룹 간 AND
  for (const [g, set] of Object.entries(activeFilters)) {
    if (!set || !set.size) continue;
    const chips = [...set].map(cid => FILTERS[g]?.chips.find(c => c.id === cid)).filter(Boolean);
    if (!chips.length) continue;
    list = list.filter(p => chips.some(chip => matchFilter(p, g, chip)));
  }

  // exclude deleted / sold
  list = list.filter(p => !p._deleted && p.vehicle_status !== '출고불가');
  return list;
}

function getFilterCount() {
  let n = 0;
  Object.values(activeFilters).forEach(set => { if (set?.size) n += set.size; });
  return n;
}

// dynamic 필터 "더보기" 펼침 상태 (섹션별)
const mDynExpanded = {};

function openFilterSheet() {
  // dynamic 칩 집계 (전체 allProducts 기준)
  buildDynamicChips(allProducts);

  const ensureSet = (k) => (activeFilters[k] = activeFilters[k] || new Set());

  const chipHtml = (key, c, set) =>
    `<button class="chip ${set?.has(c.id) ? 'is-active' : ''}" data-c="${c.id}">${c.label}</button>`;

  const renderSection = (key, f) => {
    const set = activeFilters[key];
    let chipsHtml = '';

    if (f.dynamic) {
      const popular = f.popular || [];
      const others  = f.others  || [];
      const open = !!mDynExpanded[key];
      chipsHtml = popular.map(c => chipHtml(key, c, set)).join('');
      if (open) chipsHtml += others.map(c => chipHtml(key, c, set)).join('');
      if (others.length) {
        chipsHtml += `<button class="m-filter-more" data-more="${key}">${open ? '접기' : `더보기 (${others.length})`}</button>`;
      }
    } else {
      chipsHtml = f.chips.map(c => chipHtml(key, c, set)).join('');
    }
    if (!chipsHtml) return '';
    const activeCount = set?.size || 0;
    return `
      <div class="m-filter-section ${activeCount ? 'has-active' : ''}">
        <div class="m-filter-section-title">
          <i class="${f.icon}"></i>
          <span>${f.label}</span>
          ${activeCount ? `<span class="sb-badge is-visible">${activeCount}</span>` : ''}
        </div>
        <div class="m-filter-chips" data-g="${key}">${chipsHtml}</div>
      </div>
    `;
  };

  const sectionsHtml = Object.entries(FILTERS).map(([k, f]) => renderSection(k, f)).join('');

  const html = `
    <div class="m-filter-sheet">
      ${sectionsHtml}
      <div class="m-filter-actions">
        <button class="btn btn-outline" id="mFilterReset">초기화</button>
        <button class="btn btn-primary" id="mFilterApply">적용</button>
      </div>
    </div>
  `;

  const totalCount = getFilterCount();
  const sheet = openBottomSheet(html, {
    title: `필터${totalCount ? ` <span class="sb-badge is-visible">${totalCount}</span>` : ''}`,
    onMount: (root) => {
      const bindGroups = () => {
        root.querySelectorAll('[data-g]').forEach(group => {
          const g = group.dataset.g;
          ensureSet(g);
          group.onclick = (e) => {
            // "더보기/접기" 토글
            const moreBtn = e.target.closest('[data-more]');
            if (moreBtn) {
              const k = moreBtn.dataset.more;
              mDynExpanded[k] = !mDynExpanded[k];
              // 해당 섹션만 리렌더
              const section = moreBtn.closest('.m-filter-section');
              const next = document.createElement('div');
              next.innerHTML = renderSection(k, FILTERS[k]).trim();
              const newEl = next.firstElementChild;
              if (newEl && section) {
                section.replaceWith(newEl);
                bindGroups();
              }
              return;
            }
            // 칩 토글
            const btn = e.target.closest('[data-c]');
            if (!btn) return;
            const c = btn.dataset.c;
            const set = activeFilters[g];
            if (set.has(c)) set.delete(c);
            else set.add(c);
            btn.classList.toggle('is-active');
            // 섹션 뱃지 갱신
            const section = btn.closest('.m-filter-section');
            const badge = section?.querySelector('.sb-badge');
            const cnt = set.size;
            if (cnt) {
              if (badge) { badge.textContent = cnt; badge.classList.add('is-visible'); }
              else section?.querySelector('.m-filter-section-title')?.insertAdjacentHTML('beforeend', `<span class="sb-badge is-visible">${cnt}</span>`);
              section?.classList.add('has-active');
            } else {
              badge?.remove();
              section?.classList.remove('has-active');
            }
            // 검색창 뒤 카운트 + 시트 제목 전체 필터 개수 실시간 반영
            updateSearchCount();
            updateSheetTitleBadge(sheet.root);
          };
        });
      };
      bindGroups();
      root.querySelector('#mFilterReset')?.addEventListener('click', () => {
        activeFilters = {};
        root.querySelectorAll('.chip.is-active').forEach(c => c.classList.remove('is-active'));
        root.querySelectorAll('.m-filter-section.has-active').forEach(s => s.classList.remove('has-active'));
        root.querySelectorAll('.m-filter-section .sb-badge').forEach(b => b.remove());
        updateSearchCount();
        updateSheetTitleBadge(sheet.root);
      });
      root.querySelector('#mFilterApply')?.addEventListener('click', () => {
        renderLimit = 30;
        updateFilterDot();
        render();
        sheet.close();
      });
    },
  });
}

function updateFilterDot() {
  const dot = document.getElementById('mSearchFilterDot');
  if (!dot) return;
  dot.hidden = getFilterCount() === 0;
}

/** 검색창 카운트를 현재 필터 상태 기준으로 즉시 갱신 (바텀시트에서 실시간 미리보기용) */
function updateSearchCount() {
  const countEl = document.getElementById('mSearchCount');
  if (!countEl) return;
  const n = getFiltered().length;
  countEl.textContent = n ? `${n}대` : '0대';
}

/** 바텀시트 제목 옆 전체 필터 개수 뱃지 동기화 */
function updateSheetTitleBadge(sheetRoot) {
  if (!sheetRoot) return;
  const title = sheetRoot.querySelector('.m-sheet-title');
  if (!title) return;
  const total = getFilterCount();
  const existing = title.querySelector('.sb-badge');
  if (total) {
    if (existing) existing.textContent = total;
    else title.insertAdjacentHTML('beforeend', ` <span class="sb-badge is-visible">${total}</span>`);
  } else {
    existing?.remove();
  }
}

function renderActive() {
  const el = document.getElementById('mSearchActive');
  if (!el) return;
  const chips = [];
  for (const [g, set] of Object.entries(activeFilters)) {
    if (!set?.size) continue;
    const f = FILTERS[g];
    if (!f) continue;
    [...set].forEach(cid => {
      const chip = f.chips.find(c => c.id === cid);
      if (chip) chips.push({ g, cid, label: chip.label });
    });
  }

  const total = chips.length;
  el.innerHTML = chips.map(c => `
    <span class="chip is-active m-active-chip"><span>${c.label}</span><button class="chip-remove" data-remove="${c.g}::${c.cid}" aria-label="${c.label} 해제">×</button></span>
  `).join('') + `<button class="m-search-clear-all ${total ? 'is-active' : ''}" id="mSearchClearAll" ${total ? '' : 'disabled'}>전체해제</button>`;
}

function render() {
  const el = document.getElementById('mSearchList');
  if (!el) return;
  renderActive();
  const filtered = getFiltered();
  const shown = filtered.slice(0, renderLimit);

  // 검색창 우측 카운트 — 필터 결과 총 건수
  const countEl = document.getElementById('mSearchCount');
  if (countEl) countEl.textContent = filtered.length ? `${filtered.length}대` : '';

  if (!shown.length) {
    el.innerHTML = `<div class="m-empty"><i class="ph ph-magnifying-glass"></i><p>일치하는 차량이 없습니다</p></div>`;
    return;
  }

  el.innerHTML = `
    ${shown.map(p => renderCard(p)).join('')}
    ${filtered.length > shown.length ? `<div class="m-load-more">스크롤하여 더 보기…</div>` : ''}
  `;
}

function renderCard(p) {
  const img = firstProductImage(p);
  const driveFolderUrl = !img ? supportedDriveSource(p) : '';
  // 선택 기간 우선 → 36 → 48 → 60 → 24 → 12 중 첫 유효값
  const periodPick = [...(activeFilters.period || [])]
    .map(cid => FILTERS.period.chips.find(c => c.id === cid)?.label.replace('개월', ''))
    .filter(Boolean)[0];
  const periodPriority = periodPick
    ? [periodPick, '36','48','60','24','12']
    : ['36','48','60','24','12'];
  let bestMonth = '', bestRent = 0, bestDep = 0;
  for (const m of periodPriority) {
    const v = p.price?.[m] || {};
    const r = Number(v.rent) || 0;
    if (r > 0) { bestMonth = m; bestRent = r; bestDep = Number(v.deposit) || 0; break; }
  }

  // 세부모델 + 트림 (중복 토큰 제거 — core/format.js 공용 유틸)
  const subModel = (p.sub_model || '').trim();
  const trimClean = trimMinusSub(subModel, p.trim_name || p.trim);
  const modelLine = [subModel || p.model || '차량', trimClean].filter(Boolean).join(' ');

  // 메인 (강조) — 월대여료 · 보증금 · 대여기간 + [차량상태][상품구분] 뱃지 2개
  const priceHtml = bestRent
    ? `<span class="m-card-price-rent">${fmtMoney(bestRent)}</span>${bestDep ? `<span class="m-card-price-dep">보증 ${fmtMoney(bestDep)}</span>` : ''}<span class="m-card-price-period">${bestMonth}개월</span>`
    : `<span class="m-card-price-ask">가격 문의</span>`;
  const statusTone = p.vehicle_status === '즉시출고' || p.vehicle_status === '출고가능' ? 'ok'
                   : p.vehicle_status === '상품화중' ? 'warn'
                   : p.vehicle_status === '출고협의' ? 'info'
                   : p.vehicle_status === '출고불가' ? 'err' : 'muted';
  // 상품구분: 신차는 진하게, 중고는 같은 계열 연하게
  const typeTone = /신차/.test(p.product_type || '') ? 'type-new'
                 : /중고/.test(p.product_type || '') ? 'type-used'
                 : 'muted';
  const badgesHtml = [
    p.vehicle_status ? `<span class="m-card-pill is-${statusTone}">${p.vehicle_status}</span>` : '',
    p.product_type   ? `<span class="m-card-pill is-${typeTone}">${p.product_type}</span>`   : '',
  ].filter(Boolean).join('');
  const mainLine = `<div class="m-card-main-line">${priceHtml}${badgesHtml}</div>`;

  // 사양 — 차량번호 · 연식 · 주행거리 · 연료 · 색상
  const color = [p.ext_color, p.int_color].filter(Boolean).join('/');
  const specLine = [
    p.car_number,
    normalizeYear(p.year),
    p.mileage ? `${Number(p.mileage).toLocaleString()}km` : '',
    p.fuel_type,
    color,
  ].filter(Boolean).join(' · ');

  // 썸네일 심사기준 오버레이
  const creditGrade = p._policy?.credit_grade || p._policy?.screening_criteria || p.credit_grade || '';
  const creditTone = !creditGrade ? 'ok'
                   : /무관|없음|전체/.test(creditGrade) ? 'ok'
                   : /소득|심사/.test(creditGrade) ? 'warn'
                   : 'info';
  const creditLabel = creditGrade || '무심사';

  return `
    <article class="m-card-product" data-pkey="${p._key}">
      <div class="m-card-thumb">
        ${img
          ? `<img src="${img}" loading="lazy" decoding="async" alt="" onerror="this.remove()">`
          : driveFolderUrl
            ? `<i class="ph ph-car-simple srch-thumb-placeholder"></i><img data-drive-folder="${driveFolderUrl}" data-drive-mode="thumb" alt="" loading="lazy" decoding="async" hidden onerror="this.remove()">`
            : `<i class="ph ph-car-simple"></i>`}
        <span class="m-card-thumb-credit is-${creditTone}">${creditLabel}</span>
      </div>
      <div class="m-card-body">
        ${mainLine}
        <div class="m-card-model">${modelLine}</div>
        ${specLine ? `<div class="m-card-spec">${specLine}</div>` : ''}
      </div>
    </article>
  `;
}

function openProductSheet(p) {
  const title = `${p.car_number || ''} ${p.sub_model || p.model || ''}`.trim() || '차량';
  const me = store.currentUser || {};
  // 웹 규격: 영업자(agent/agent_admin)만 소통·계약·공유, 공급사·관리자·기타는 공유만
  const isAgent = me.role === 'agent' || me.role === 'agent_admin';

  const headerRight = isAgent
    ? `
      <button class="m-topbar-action" data-act="inquire" title="소통"><i class="ph ph-chat-circle"></i></button>
      <button class="m-topbar-action" data-act="contract" title="계약"><i class="ph ph-file-text"></i></button>
      <button class="m-topbar-action" data-act="share" title="공유"><i class="ph ph-paper-plane-tilt"></i></button>
    `
    : `
      <button class="m-topbar-action" data-act="share" title="공유"><i class="ph ph-paper-plane-tilt"></i></button>
    `;

  const body = `<div class="m-product-detail" id="mProductDetail"></div>`;

  pushMobileView(body, {
    title,
    headerRight,
    onMount: (view) => {
      const container = view.querySelector('#mProductDetail');
      renderProductDetail(container, p, { showActions: false });
      view.querySelector('[data-act="inquire"]')?.addEventListener('click', () => inquireProduct(p));
      view.querySelector('[data-act="contract"]')?.addEventListener('click', () => startContractFromProduct(p));
      view.querySelector('[data-act="share"]')?.addEventListener('click', () => shareProduct(p));
    },
  });
}

async function startContractFromProduct(p) {
  store.pendingContractProduct = p._key;
  const { navigate } = await import('../core/router.js');
  navigate('/contract');
  showToast(`${p.car_number || p.model || '차량'} 계약 시작`);
}

async function inquireProduct(p) {
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
      vehicleNumber: p.car_number,
      modelName: p.model || '',
      subModel: p.sub_model || '',
      providerCode: p.provider_company_code || '',
    });
    store.pendingOpenRoom = roomId;
    const { navigate } = await import('../core/router.js');
    navigate('/', { transition: false });
  } catch (e) {
    console.error('[inquireProduct]', e);
    showToast('문의방 열기 실패', 'error');
  }
}

function shareProduct(p) {
  const me = store.currentUser || {};
  const url = `${location.origin}/catalog.html?a=${me.user_code || ''}&car=${encodeURIComponent(p.car_number || '')}`;
  const title = `${p.car_number || ''} ${p.sub_model || p.model || ''}`.trim() || '차량';
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(
      () => showToast('링크 복사됨'),
      () => showToast('복사 실패', 'error')
    );
  }
}

function editProduct(p) {
  store.pendingEditProduct = p._key;
  import('../core/router.js').then(({ navigate }) => navigate('/product'));
}

function shareCatalogLink() {
  const me = store.currentUser || {};
  const url = `${location.origin}/catalog.html?a=${me.user_code || ''}`;
  if (navigator.share) {
    navigator.share({ title: '차량 카탈로그', url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(
      () => showToast('카탈로그 링크 복사됨'),
      () => showToast('복사 실패', 'error')
    );
  }
}

export function unmount() {
  unsub?.();
  unsub = null;
  document.querySelectorAll('.m-fab').forEach(el => el.remove());
}
