/**
 * 모바일 상품 검색
 * - 고정 상단 서치바 + 가로 스크롤 칩 필터
 * - 카드 리스트 (썸네일 + 주요정보)
 * - 카드 탭 → 바텀시트 상세
 * - FAB: 공유
 * - 무한 스크롤
 */
import { store, findProduct } from '../core/store.js';
import { watchCollection } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtMoney, trimMinusSub, mEmpty } from '../core/format.js';
import { firstProductImage, supportedDriveSource, shortImg } from '../core/product-photos.js';
import '../core/drive-photos.js';   // 카드 드라이브 썸네일 lazy 하이드레이션 observer 즉시 시작 (상세 열기 전에도 카드 사진 뜨게)
import { enrichProductsWithPolicy } from '../core/policy-utils.js';
import { renderProductDetail } from '../core/product-detail-render.js';
import { pushMobileView, closeAllMobileViews } from '../core/mobile-shell.js';
import { FILTERS, matchFilter } from '../core/product-filters.js';
import { openFilterSheet } from '../core/filter-sheet.js';
import { normalizeYear } from '../core/normalize.js';

let unsub = null;
let unsubPol = null;
let allProducts = [];
let query = '';
// activeFilters: { [groupKey]: Set<chipId> } — desktop 과 동일 구조
let activeFilters = {};
let renderLimit = 30;

export function mount() {
  unsub?.();
  unsubPol?.();
  renderLimit = 30;

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="m-shell-page">
      <div class="m-search-head">
        <label class="m-search-bar" for="mSearchInput">
          <i class="ph ph-magnifying-glass"></i>
          <input type="search" id="mSearchInput" placeholder="차량번호, 모델명 검색..."
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                 enterkeyhint="search">
          <span class="m-search-count" id="mSearchCount"></span>
          <button type="button" class="m-topbar-action" id="mSearchClear" style="display:none;" aria-label="지우기"><i class="ph ph-x-circle"></i></button>
          <button type="button" class="m-topbar-action" id="mSearchFilterBtn" aria-label="필터"><i class="ph ph-sliders-horizontal"></i><span class="m-filter-dot" id="mSearchFilterDot" hidden></span></button>
        </label>
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
  unsubPol = watchCollection('policies', (data) => {
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

  document.getElementById('mSearchFilterBtn')?.addEventListener('click', openMobileFilterSheet);

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
    const p = findProduct(card.dataset.pkey);
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
      p.options, p.memo, p.notes, p.mission, p.drive_type,
    ].some(v => v && String(v).toLowerCase().includes(query)));
  }

  // 웹과 동일: 그룹 내부는 OR, 그룹 간 AND. range 타입은 별도 분기.
  for (const [g, val] of Object.entries(activeFilters)) {
    const f = FILTERS[g];
    if (f?.type === 'range') {
      const lo = val?.min ?? 0;
      const hi = val?.max ?? Number.MAX_SAFE_INTEGER;
      if (lo === 0 && hi === Number.MAX_SAFE_INTEGER) continue;
      list = list.filter(p => { const v = f.field(p); return v >= lo && v <= hi; });
      continue;
    }
    if (!val || !val.size) continue;
    const chips = [...val].map(cid => FILTERS[g]?.chips.find(c => c.id === cid)).filter(Boolean);
    if (!chips.length) continue;
    list = list.filter(p => chips.some(chip => matchFilter(p, g, chip)));
  }

  // 출고불가 가시성 — 역할별 정책:
  //   agent / agent_admin: 출고불가 자동 hide (영업자는 출고가능만 봄)
  //   provider: 본인 회사 매물은 출고불가도 표시 (차량상태 바꿔서 재사용)
  //   admin: vehicle_status chip 으로 토글 (명시적 '출고불가' 선택 시만 표시)
  // (me 는 위에서 이미 선언됨 — getFiltered 함수 상단)
  const role = me.role;
  const myCompany = me.company_code;
  const vsActive = activeFilters.vehicle_status;
  const explicitOut = vsActive && vsActive.has('vs_출고불가');
  list = list.filter(p => {
    if (p._deleted) return false;
    if (p.vehicle_status !== '출고불가') return true;
    // 출고불가 매물 분기
    if (role === 'agent' || role === 'agent_admin') return false;     // 영업자 차단
    if (role === 'provider') return p.provider_company_code === myCompany;  // 본인 회사만
    return explicitOut;   // admin — chip 명시 선택 시만
  });
  return list;
}

function getFilterCount() {
  let n = 0;
  Object.values(activeFilters).forEach(set => { if (set?.size) n += set.size; });
  return n;
}

/** 필터 시트 열기 — core/filter-sheet.js 의 공용 컴포넌트로 위임.
 *  activeFilters 객체는 lib 가 mutate. chip 토글마다 즉시 결과 반영 (사용자 요청). */
function openMobileFilterSheet() {
  openFilterSheet({
    products: allProducts,
    activeFilters,
    getFilterCount,
    onChange: () => {
      // chip 토글 즉시 결과 반영 — 카운트 + 매물 리스트 + dot 모두 갱신
      renderLimit = 30;
      updateFilterDot();
      render();
    },
    onApply: () => {
      // [적용] 버튼은 시트 닫기로만 — 결과는 이미 onChange 에서 갱신됨 (no-op)
    },
  });
}

function updateFilterDot() {
  const dot = document.getElementById('mSearchFilterDot');
  if (!dot) return;
  dot.hidden = getFilterCount() === 0;
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
    el.innerHTML = mEmpty('일치하는 차량이 없습니다', 'ph-magnifying-glass');
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

  // 메인 (강조) — 월대여료 | 보증금 | 대여기간 + [차량상태][상품구분] 뱃지 2개
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

  // 사양 — 차량번호 | 연식 | 주행거리 | 연료 | 색상
  const color = [p.ext_color, p.int_color].filter(Boolean).join('/');
  const specLine = [
    p.car_number,
    normalizeYear(p.year),
    p.mileage ? `${Number(p.mileage).toLocaleString()}km` : '',
    p.fuel_type,
    color,
  ].filter(Boolean).join(' · ');

  // 썸네일 심사기준 오버레이 — '신용무관' / '신용조회' 2종 정규화
  const creditRaw = p._policy?.screening_criteria || p._policy?.credit_grade || p.screening_criteria || p.credit_grade || '';
  const creditLabel = /저신용|무심사|신용 *무관|소득 *무관/.test(creditRaw) ? '소득무관'
                    : /신용 *필요|신용 *조회|소득 *확인|소득 *조회|등급/.test(creditRaw) ? '소득확인'
                    : (creditRaw || '소득무관');
  const creditTone = /무관|없음|전체/.test(creditLabel) ? 'ok'
                   : /조회|필요|등급|심사|소득/.test(creditLabel) ? 'warn'
                   : 'info';

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
  const isAgent = me.role === 'agent' || me.role === 'agent_admin';
  const isAdmin = me.role === 'admin';

  // 액션 버튼 — 역할별 (모두 하단 액션바로 통일, 상단바는 비움)
  const actionsHtml = store.catalogMode
    ? ''
    : isAgent
    ? `
      <button class="m-action-btn" data-act="inquire"><i class="ph ph-chat-circle"></i><span>소통</span></button>
      <button class="m-action-btn is-primary" data-act="contract"><i class="ph ph-file-text"></i><span>계약</span></button>
      <button class="m-action-btn" data-act="share"><i class="ph ph-paper-plane-tilt"></i><span>공유</span></button>
    `
    : isAdmin
    ? `
      <button class="m-action-btn is-primary" data-act="contract"><i class="ph ph-file-plus"></i><span>계약생성</span></button>
      <button class="m-action-btn" data-act="share"><i class="ph ph-paper-plane-tilt"></i><span>공유</span></button>
    `
    : `
      <button class="m-action-btn" data-act="share"><i class="ph ph-paper-plane-tilt"></i><span>공유</span></button>
    `;

  const body = `
    <div class="m-product-detail" id="mProductDetail"></div>
    ${actionsHtml ? `<div class="m-detail-actions">${actionsHtml}</div>` : ''}
  `;

  pushMobileView(body, {
    title,
    headerRight: '',
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
  // 채팅에서와 동일한 시트 (기간 + 계약자 기본정보 입력)
  const { openContractStartSheet } = await import('./mobile-workspace.js');
  openContractStartSheet({ product: p });
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
    closeAllMobileViews();  // 상품 상세 view 닫고 이동
    const { navigate, getCurrentRoute } = await import('../core/router.js');
    const alreadyOnWorkspace = getCurrentRoute() === '/workspace';
    navigate('/workspace', { transition: false });
    if (alreadyOnWorkspace) {
      // 이미 워크스페이스 탭 — navigate가 mount()를 건너뜀 → 직접 처리
      const { tryOpenPendingRoom } = await import('./mobile-workspace.js');
      setTimeout(() => tryOpenPendingRoom(), 0);
    }
  } catch (e) {
    console.error('[inquireProduct]', e);
    showToast('문의방 열기 실패', 'error');
  }
}

function shareProduct(p) {
  const me = store.currentUser || {};
  // 최대한 짧게 — 차량명(t)+대표사진(img)만. 서버 env 설정되면 id 서버조회가 우선이라 이것도 뺄 수 있음.
  const title = `${p.car_number || ''} ${p.sub_model || p.model || ''}`.trim() || '차량';
  const pid = p._key || p.product_uid || '';
  const qs = new URLSearchParams();
  if (me.user_code) qs.set('a', me.user_code);
  if (pid) qs.set('id', pid);
  else if (p.car_number) qs.set('car', p.car_number);
  if (title) qs.set('t', title);
  const img = shortImg(p);
  if (img) qs.set('img', img);
  const url = `${location.origin}/catalog.html?${qs.toString()}`;
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(
      () => showToast('링크 복사됨'),
      () => showToast('복사 실패', 'error')
    );
  }
}

export function unmount() {
  unsub?.();
  unsub = null;
  unsubPol?.();
  unsubPol = null;
  document.querySelectorAll('.m-fab').forEach(el => el.remove());
}
