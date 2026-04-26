/**
 * freepasserp v3 — 진입점
 * UI: index.html (prototype 마크업)
 * 기능: Firebase auth + 사용자 hydration (필요 시 점진 추가)
 */

/* CSS — index.html 의 <link> + 인라인 <style> 만 사용 (Vite override 방지)
   phosphor 폰트는 public/phosphor/ 에 복사한 파일을 <link> 로 직접 로드 (vite 의존 X) */

import { initAuth, login as fbLogin, logout as fbLogout } from './firebase/auth.js';
import { watchCollection, pushRecord, updateRecord, softDelete, fetchRecord, setRecord } from './firebase/db.js';
import { store } from './core/store.js';
import { productImages, productExternalImages, supportedDriveSource, toProxiedImage } from './core/product-photos.js';
import { openFullscreen } from './core/product-detail-render.js';
import { extractProductDetailRows } from './core/product-detail-rows.js';
import { uploadImage } from './firebase/storage-helper.js';
import { showToast } from './core/toast.js';
import { ocrFile } from './core/ocr.js';
import { parseVehicleRegistration } from './core/ocr-parsers/vehicle-registration.js';
import { sendAlimtalk } from './core/alimtalk.js';
import {
  esc, shortStatus, mapStatusDot, needsReview,
  fmtMileage, fmtDate, fmtMoney, fmtTime, fmtFullTime,
  listBody, emptyState, renderRoomItem,
  ffi, ffs, setHeadSave, flashSaved, bindFormSave,
} from './core/ui-helpers.js';
import { POLICY_OPTS, renderPolicyList, renderPolicyDetail, bindPolicyCreate } from './pages/policy.js';
import { renderPartnerList, renderPartnerDetail, bindPartnerCreate } from './pages/partner.js';
import { renderUserList, renderUserDetail } from './pages/user.js';
import { renderSettlementList, renderSettlementDetail, bindSettlementCreate } from './pages/settlement.js';
import {
  CONTRACT_STATUSES, renderContractList, renderContractDetail,
  renderContractWorkV2, bindContractWorkV2,
  createContractFromRoomLocal, makeTempContractCode, allocateRealContractCode,
} from './pages/contract.js';
import { pickAgent, pickPartner, pickOrCreateCustomer, normalizePhone } from './core/dialogs.js';
import { getProviderTel, getAdminTels, notifyProviderAndAdmin } from './core/notify.js';
import {
  calibrateSearchCols, renderSearchTable, renderSearchDetail,
  bindSearchInteractions, bindSearchSelection, applySearchFilter,
  setSearchCallbacks, _searchFilter,
} from './pages/search.js';
import {
  renderRoomList, selectRoom, renderRoomDetail, renderChatMessages,
  bindChatInput, bindRoomCreate, createRoomFromProduct,
  getActiveRoomId, getCurrentMessages, getPrevPeerReadAt, setPrevPeerReadAt,
} from './pages/workspace.js';
import {
  PRODUCT_OPTS, PRODUCT_TERMS,
  renderProductList, renderProductDetail, bindProductCreate,
} from './pages/product.js';
import { enrichProductsWithPolicy } from './core/policy-utils.js';
import { filterByRole } from './core/roles.js';
import { renderChatMessages as v2RenderChatMessages, getPeerReadAt } from './core/chat-render.js';
import { markRoomRead } from './firebase/collections.js';
import { STEPS as CONTRACT_STEPS_V2, getStepStates, getProgress } from './core/contract-steps.js';
import { getMakers, getModelsByMaker, getSubModels, findCarModel } from './core/car-models.js';
import { inferCarModel } from './core/car-model-infer.js';

/* ── Boot ── */
async function boot() {
  // v2 잔존 Service Worker 강제 정리 — stale 캐시(폰트/CSS) 가로채기 방지
  cleanupStaleServiceWorkers();
  // 샘플 데이터 즉시 정리 — auth/hydration 동안에도 샘플이 보이지 않게
  clearSampleData();

  let user = null;
  try {
    user = await initAuth();
  } catch (e) {
    console.error('[auth] init failed', e);
  }

  if (user) {
    // 승인 대기 / 거부 / 비활성 사용자 진입 차단
    const status = user.status || 'active';
    if (user.is_active === false || status === 'pending' || status === 'rejected') {
      const reason = status === 'rejected' ? '가입이 거부되었습니다' : (user.is_active === false ? '비활성 계정입니다' : '관리자 승인 대기 중입니다');
      await fbLogout();
      document.body.classList.add('is-login');
      // 로그인 폼 메시지에 안내 표시
      setTimeout(() => {
        const msg = document.getElementById('loginMsg');
        if (msg) msg.textContent = reason;
      }, 50);
    } else {
      document.body.classList.remove('is-login');
      hydrateUser(user);
      startHydration();
    }
  } else {
    document.body.classList.add('is-login');
  }

  bindLoginForm();
  bindLogout();

  // search 페이지 → "대화 생성" 버튼 콜백 주입 (workspace 의 createRoomFromProduct)
  setSearchCallbacks({ onCreateRoom: createRoomFromProduct });

  // 모든 초기 셋업 끝난 후 visibility 해제 (한 프레임 양보 — paint 가 동기적으로 끝나도록)
  requestAnimationFrame(() => document.body.classList.remove('is-loading'));
}

/* v2 시절 등록된 sw.js 가 v3 요청 가로채는 문제 해결 — 모두 unregister + 캐시 삭제.
   v3 는 SW 안 씀. localStorage 플래그로 1회만 실행 (재방문 시 매번 안 돌게) */
function cleanupStaleServiceWorkers() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  if (localStorage.getItem('v3-sw-cleaned') === '1') return;
  navigator.serviceWorker.getRegistrations?.().then(regs => {
    if (!regs.length) { localStorage.setItem('v3-sw-cleaned', '1'); return; }
    Promise.all(regs.map(r => r.unregister())).then(() => {
      if (typeof caches !== 'undefined') {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
          .finally(() => {
            localStorage.setItem('v3-sw-cleaned', '1');
            location.reload();   // 캐시 비운 후 1회 새로고침 — 폰트/CSS 신선하게
          });
      } else {
        localStorage.setItem('v3-sw-cleaned', '1');
        location.reload();
      }
    });
  }).catch(() => {});
}

/* prototype 샘플 비움 — head/입력바 외 자식의 INNER 만 비움 */
function clearSampleData() {
  document.querySelectorAll('[data-page="search"] .table tbody').forEach(tb => tb.innerHTML = '');
  // 보존해야 할 자식 (입력창·헤더는 비우면 안 됨)
  const KEEP = new Set(['ws4-head', 'ws-input']);
  ['workspace','contract','settle','product','policy','partners','users'].forEach(page => {
    document.querySelectorAll(`[data-page="${page}"] .ws4-card`).forEach(card => {
      [...card.children].forEach(ch => {
        if ([...ch.classList].some(c => KEEP.has(c))) return;
        ch.innerHTML = '';
      });
    });
  });
}

/* ── Firestore 데이터 → 페이지 hydration ── */
function startHydration() {
  // 정책 — products enrich + 정책 페이지 렌더
  watchCollection('policies', (list) => {
    store.policies = list || [];
    if (store.products?.length) {
      store.products = enrichProductsWithPolicy(store.products, store.policies);
      renderSearchTable(store.products);
      renderProductList(store.products);
    }
    renderPolicyList(store.policies);
    updateSidebarCounts();
  });
  // 상품 — search + 재고관리 양쪽 갱신
  watchCollection('products', (list) => {
    store.products = enrichProductsWithPolicy(list || [], store.policies || []);
    calibrateSearchCols(store.products);
    renderSearchTable(store.products);
    renderProductList(store.products);
    updateSidebarCounts();
  });
  // 대화방 (업무소통) + 계약 + 정산 + 파트너 + 사용자
  watchCollection('rooms',       (list) => {
    store.rooms = list || [];
    renderRoomList(store.rooms);
    updateSidebarCounts();
    // 활성 룸의 상대 read_at 변경 시 메시지 재렌더 → 읽음 표시 자동 갱신 (v2 패턴)
    const activeId = getActiveRoomId();
    if (activeId) {
      const activeRoom = store.rooms.find(r => r._key === activeId);
      const role = store.currentUser?.role;
      const peerReadAt = (role === 'agent' || role === 'agent_admin')
        ? (activeRoom?.read_at_provider || 0)
        : role === 'provider' ? (activeRoom?.read_at_agent || 0) : 0;
      if (peerReadAt !== getPrevPeerReadAt()) {
        setPrevPeerReadAt(peerReadAt);
        const msgs = getCurrentMessages();
        if (msgs.length) renderChatMessages(msgs, activeRoom);
      }
    }
  });
  watchCollection('contracts',   (list) => { store.contracts   = list || []; renderContractList(store.contracts);     updateSidebarCounts(); });
  watchCollection('settlements', (list) => { store.settlements = list || []; renderSettlementList(store.settlements); updateSidebarCounts(); });
  watchCollection('partners',    (list) => { store.partners    = list || []; renderPartnerList(store.partners);       updateSidebarCounts(); });
  watchCollection('users',       (list) => { store.users       = list || []; renderUserList(store.users);             updateSidebarCounts(); });
  watchCollection('customers',   (list) => { store.customers   = list || []; });
  // 차종 마스터 (vehicle_master) — 제조사·모델·세부모델 cascade picker 데이터원
  watchCollection('vehicle_master', (data) => {
    store.carModels = (data || [])
      .filter(m => m && m.status !== 'deleted')
      .map(m => ({
        ...m,
        sub_model: m.sub_model || m.sub || '',
        vehicle_class: m.vehicle_class || m.category || '',
      }));
    // 재고 페이지가 활성이면 picker 옵션 갱신 위해 자산정보 재렌더
    if (document.querySelector('.pt-page.active')?.dataset.page === 'product') {
      const activeId = document.querySelector('.pt-page[data-page="product"] .room-item.is-active')?.dataset.id;
      const target = (store.products || []).find(x => x._key === activeId) || (store.products || [])[0];
      if (target) renderProductDetail(target);
    }
  });

  bindSearchInteractions();
  bindGenericListInteractions();
  bindChatInput();
  bindGlobalSearch();
  bindPolicyCreate();
  bindRoomCreate();
  bindPartnerCreate();
  bindProductCreate();
  bindSettlementCreate();
  bindDirtyTracking();
  bindDeleteButtons();
  bindPhotoClicks();
  bindSearchSelection();
  setupAutoFitObserver();
}

/* 패널 안의 라벨 길이 변화 감지 → 자동 폰트 축소 (모든 페이지 일괄) */
function setupAutoFitObserver() {
  let scheduled = false;
  const sweep = () => {
    scheduled = false;
    document.querySelectorAll('.pt-page.active').forEach(p => autoFitLabels(p));
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sweep);
  };
  const obs = new MutationObserver(() => schedule());
  document.querySelectorAll('.pt-page .ws4-body').forEach(b => {
    obs.observe(b, { childList: true, subtree: true, characterData: false });
  });
  // 페이지 전환 시에도 한 번 실행
  window.addEventListener('hashchange', () => requestAnimationFrame(sweep));
  schedule();
}


/* 라벨 호버 툴팁만 — 폰트 축소 X (CSS word-break 가 자연스럽게 줄바꿈 처리) */
function autoFitLabels(root) {
  if (!root) return;
  root.querySelectorAll('.form-grid .ff > label, .info-grid > .lab').forEach(el => {
    el.title = el.textContent.trim();
  });
}

/* POLICY_OPTS → pages/policy.js (import) */



/* fmtDate/fmtMoney/fmtTime/renderRoomItem/listBody/emptyState/needsReview → ui-helpers.js (import) */


/* ── Dirty 입력 추적 — 헤더 저장 패턴 패널에서 미저장 변경 경고 ── */
function bindDirtyTracking() {
  // form-grid 안 [data-f] input 변경 시 가장 가까운 .ws4-card 에 .is-dirty 마크
  document.body.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.matches('.form-grid [data-f]')) return;
    const card = el.closest('.ws4-card');
    if (!card) return;
    // 헤더 저장 버튼이 있는 카드만 추적 (panel-scoped 헤더 저장 패턴 = setHeadSave 호출된 카드)
    if (!card.querySelector('[data-save-form]')) return;
    card.classList.add('is-dirty');
    // 헤더 저장 버튼에 강조 (저장하라는 시각 신호)
    card.querySelector('[data-save-form]')?.classList.add('is-pulse');
  });

  // 페이지 전환 시 dirty 카드 있으면 경고
  window.addEventListener('hashchange', (e) => {
    if (!hasDirty()) return;
    if (confirm('저장하지 않은 변경이 있습니다. 페이지를 이동할까요?')) {
      clearDirty();
    } else {
      // hashchange 는 cancel 불가 → 원래 hash 로 복귀
      const oldUrl = e.oldURL;
      const oldHash = oldUrl.split('#')[1] || '';
      history.replaceState(null, '', '#' + oldHash);
    }
  });

  // 브라우저 닫기 / 새로고침 시 경고 (브라우저 표준 다이얼로그)
  window.addEventListener('beforeunload', (e) => {
    if (hasDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function hasDirty() {
  return !!document.querySelector('.ws4-card.is-dirty');
}
function clearDirty(card) {
  const targets = card ? [card] : document.querySelectorAll('.ws4-card.is-dirty');
  targets.forEach(c => {
    c.classList.remove('is-dirty');
    c.querySelectorAll('[data-save-form]').forEach(b => b.classList.remove('is-pulse'));
  });
}





/* ⑥ 정책 관리 — pages/policy.js 로 분리 (renderPolicyList / renderPolicyDetail / bindPolicyCreate) */


/* 항목 삭제 — admin only, soft delete (deleted_at 만 표시) */
async function deleteRecord(collection, key) {
  if (store.currentUser?.role !== 'admin') return alert('관리자만 삭제할 수 있습니다');
  if (!confirm('정말 삭제하시겠습니까?')) return;
  try {
    await softDelete(`${collection}/${key}`);
  } catch (e) {
    alert('삭제 실패 — ' + (e.message || e));
  }
}





/* ──────── D. 사진 풀스크린 갤러리 (lightbox) ──────── */
function openLightbox(imgs, startIdx = 0) {
  if (!imgs?.length) return;
  document.querySelector('.lightbox-overlay')?.remove();
  let idx = startIdx;
  const wrap = document.createElement('div');
  wrap.className = 'lightbox-overlay';
  wrap.innerHTML = `
    <div class="lightbox-stage"><img src="${esc(imgs[idx])}" alt=""></div>
    <button class="lightbox-close" title="닫기"><i class="ph ph-x"></i></button>
    ${imgs.length > 1 ? `
      <button class="lightbox-prev" title="이전"><i class="ph ph-caret-left"></i></button>
      <button class="lightbox-next" title="다음"><i class="ph ph-caret-right"></i></button>
      <div class="lightbox-count">${idx + 1} / ${imgs.length}</div>
    ` : ''}
  `;
  document.body.appendChild(wrap);

  const update = () => {
    wrap.querySelector('img').src = imgs[idx];
    const cnt = wrap.querySelector('.lightbox-count');
    if (cnt) cnt.textContent = `${idx + 1} / ${imgs.length}`;
  };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && imgs.length > 1) { idx = (idx - 1 + imgs.length) % imgs.length; update(); }
    else if (e.key === 'ArrowRight' && imgs.length > 1) { idx = (idx + 1) % imgs.length; update(); }
  };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.lightbox-close').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.lightbox-prev')?.addEventListener('click', () => { idx = (idx - 1 + imgs.length) % imgs.length; update(); });
  wrap.querySelector('.lightbox-next')?.addEventListener('click', () => { idx = (idx + 1) % imgs.length; update(); });
}

/* 사진 클릭 → 풀스크린 (search detail / product detail 양쪽) — body 위임 */
function bindPhotoClicks() {
  document.body.addEventListener('click', (e) => {
    // 메인 사진 또는 썸네일 클릭
    const img = e.target.closest('img.detail-photo-main, .detail-photo-thumb img');
    if (!img) return;
    if (img.closest('.lightbox-overlay')) return;   // lightbox 안의 이미지 무시
    // 현재 열린 detail 의 모든 사진 수집
    const card = img.closest('.ws4-card, .ws4-body');
    if (!card) return;
    const all = [...card.querySelectorAll('.detail-photo-thumb img, img.detail-photo-main')]
      .map(i => i.src).filter(Boolean);
    const unique = [...new Set(all)];
    const startIdx = unique.indexOf(img.src);
    openLightbox(unique, Math.max(0, startIdx));
  });
}

/* ──────── E. 다중 선택 + 제안서 / 비교 / 엑셀 ──────── */
const _searchSelected = new Set();   // selected product keys (search 페이지)

function toggleSearchSelection(key, exclusive = false) {
  if (exclusive) _searchSelected.clear();
  if (_searchSelected.has(key)) _searchSelected.delete(key);
  else _searchSelected.add(key);
  document.querySelectorAll('[data-page="search"] .table tbody tr').forEach(tr => {
    tr.classList.toggle('is-checked', _searchSelected.has(tr.dataset.id));
  });
  renderSelectionBar();
}

function renderSelectionBar() {
  let bar = document.getElementById('selBar');
  const count = _searchSelected.size;
  if (count === 0) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'selBar';
    bar.style.cssText = 'position:fixed; bottom:16px; left:50%; transform:translateX(-50%); z-index:1000; background:var(--text-main); color:var(--text-inverse); padding:6px 12px; border-radius:4px; display:flex; align-items:center; gap:8px; font-size:11px; box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `
    <span><b id="selCount">0</b>대 선택</span>
    <button class="btn btn-sm" data-act="proposal"><i class="ph ph-paper-plane-tilt"></i> 제안서</button>
    <button class="btn btn-sm" data-act="compare"><i class="ph ph-rows"></i> 비교</button>
    <button class="btn btn-sm" data-act="excel"><i class="ph ph-microsoft-excel-logo"></i> 엑셀</button>
    <button class="btn btn-sm" data-act="clear" title="선택 해제"><i class="ph ph-x"></i></button>
  `;
  bar.querySelector('#selCount').textContent = count;
  bar.querySelectorAll('button[data-act]').forEach(btn => {
    btn.onclick = () => onSelectionAction(btn.dataset.act);
  });
}

async function onSelectionAction(act) {
  const products = (store.products || []).filter(p => _searchSelected.has(p._key));
  if (!products.length) return;
  if (act === 'clear') {
    _searchSelected.clear();
    document.querySelectorAll('[data-page="search"] .table tbody tr.is-checked').forEach(tr => tr.classList.remove('is-checked'));
    renderSelectionBar();
  } else if (act === 'proposal') {
    // /proposal.html 에 선택 키 전달 — Firebase 에 임시 proposal 레코드 생성
    try {
      const ref = await pushRecord('proposals', {
        products: products.map(p => p._key),
        agent_uid: store.currentUser?.uid || '',
        agent_code: store.currentUser?.user_code || '',
        created_at: Date.now(),
      });
      const id = ref?.key || ref;
      window.open(`/proposal.html?id=${id}`, '_blank');
    } catch (e) {
      alert('제안서 생성 실패 — ' + (e.message || e));
    }
  } else if (act === 'compare') {
    openCompareModal(products);
  } else if (act === 'excel') {
    try {
      const { downloadExcel, PRODUCT_COLS } = await import('./core/excel-export.js');
      await downloadExcel('차량목록', PRODUCT_COLS, products);
    } catch (e) {
      alert('엑셀 내보내기 실패 — ' + (e.message || e));
    }
  }
}

/* 차량 비교 모달 — 핵심 스펙 + 가격 옆으로 나열 */
function openCompareModal(products) {
  document.querySelector('.compare-modal')?.remove();
  const dlg = document.createElement('dialog');
  dlg.className = 'compare-modal';
  dlg.style.cssText = 'border:1px solid var(--border); border-radius:4px; padding:0; max-width:90vw; max-height:90vh;';
  const SPEC_ROWS = [
    ['차량번호', p => p.car_number],
    ['제조사', p => p.maker],
    ['모델', p => [p.model, p.sub_model].filter(Boolean).join(' ')],
    ['트림', p => p.trim_name || p.trim],
    ['연식', p => p.year],
    ['주행', p => p.mileage ? Number(p.mileage).toLocaleString() + 'km' : ''],
    ['연료', p => p.fuel_type],
    ['색상', p => p.ext_color],
    ['상태', p => p.vehicle_status],
    ['24개월', p => p.price?.['24']?.rent ? Math.round(p.price['24'].rent/10000) + '만/' + Math.round((p.price['24'].deposit||0)/10000) + '만' : '-'],
    ['36개월', p => p.price?.['36']?.rent ? Math.round(p.price['36'].rent/10000) + '만/' + Math.round((p.price['36'].deposit||0)/10000) + '만' : '-'],
    ['48개월', p => p.price?.['48']?.rent ? Math.round(p.price['48'].rent/10000) + '만/' + Math.round((p.price['48'].deposit||0)/10000) + '만' : '-'],
    ['60개월', p => p.price?.['60']?.rent ? Math.round(p.price['60'].rent/10000) + '만/' + Math.round((p.price['60'].deposit||0)/10000) + '만' : '-'],
    ['심사', p => p._policy?.credit_grade || p.credit_grade || '-'],
    ['연주행', p => p._policy?.annual_mileage || p.annual_mileage || '-'],
  ];
  dlg.innerHTML = `
    <div style="padding:8px 12px; border-bottom:1px solid var(--border); background:var(--bg-header); display:flex; align-items:center;">
      <span style="color:var(--text-main);">차량 비교 (${products.length}대)</span>
      <div class="spacer" style="flex:1;"></div>
      <button class="btn btn-sm" id="compareClose"><i class="ph ph-x"></i></button>
    </div>
    <div style="overflow:auto; max-height:80vh;">
      <table class="table" style="margin:0;">
        <thead><tr>
          <th style="width:90px; position:sticky; left:0; background:var(--bg-header); z-index:1;">항목</th>
          ${products.map(p => `<th style="min-width:120px;">${esc(p.car_number || '-')}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${SPEC_ROWS.map(([label, getter]) => `<tr>
            <td class="lab" style="background:var(--bg-stripe); position:sticky; left:0;">${esc(label)}</td>
            ${products.map(p => `<td>${esc(String(getter(p) || '-'))}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('#compareClose').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) { dlg.close(); dlg.remove(); } });
}


/* 우측 detail 카드 헤드에 삭제 버튼 추가 — admin only, 페이지/key 는 위임 클릭 시 결정 */
function bindDeleteButtons() {
  // hover 시 .ws4-detail .ws4-head 우측에 X 버튼 표시 (admin)
  if (store.currentUser?.role !== 'admin') return;
  document.querySelectorAll('.ws4-detail .ws4-head').forEach(head => {
    if (head.querySelector('.dtl-delete')) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm dtl-delete';
    btn.title = '삭제';
    btn.style.cssText = 'margin-left:auto; color: var(--alert-red-text);';
    btn.innerHTML = '<i class="ph ph-trash"></i>';
    head.appendChild(btn);
    btn.addEventListener('click', () => {
      const page = head.closest('.pt-page')?.dataset.page;
      const activeItem = head.closest('.pt-page')?.querySelector('.ws4-list .room-item.active');
      const id = activeItem?.dataset.id;
      if (!page || !id) return;
      const collectionMap = { contract: 'contracts', settle: 'settlements', product: 'products', policy: 'policies', partners: 'partners', users: 'users', workspace: 'rooms' };
      const collection = collectionMap[page];
      if (collection) deleteRecord(collection, id);
    });
  });
}

/* bindFormSave → ui-helpers.js (import) */

/* 글로벌 검색 — 토픽바 input → 현재 페이지 list 필터 (search 페이지는 별도 처리) */
let _globalSearch = '';
function applyGlobalSearch() {
  const q = _globalSearch.trim().toLowerCase();
  const page = document.querySelector('.pt-page.active')?.dataset.page;
  if (!page) return;

  // search 페이지는 _searchFilter.search 로 별도 처리 (이미 작동)
  if (page === 'search') {
    _searchFilter.search = q;
    applySearchFilter();
    return;
  }

  // 다른 페이지 — store 데이터 필터 후 재렌더
  const matches = (haystack) => !q || haystack.toLowerCase().includes(q);
  if (page === 'workspace') {
    const filtered = (store.rooms || []).filter(r => matches([r.car_number, r.maker, r.model, r.last_message_text, r.partner_name].filter(Boolean).join(' ')));
    renderRoomList(filtered);
  } else if (page === 'contract') {
    const filtered = (store.contracts || []).filter(c => matches([c.contract_id, c.customer_name, c.car_number, c.maker, c.model, c.agent_name].filter(Boolean).join(' ')));
    renderContractList(filtered);
  } else if (page === 'settle') {
    const filtered = (store.settlements || []).filter(s => matches([s.contract_id, s.customer_name, s.car_number, s.maker, s.model, s.agent_name].filter(Boolean).join(' ')));
    renderSettlementList(filtered);
  } else if (page === 'product') {
    const filtered = (store.products || []).filter(p => matches([p.car_number, p.maker, p.model, p.sub_model, p.trim_name, Array.isArray(p.options) ? p.options.join(' ') : p.options].filter(Boolean).join(' ')));
    renderProductList(filtered);
  } else if (page === 'policy') {
    const filtered = (store.policies || []).filter(p => matches([p.policy_name, p.policy_code, p.provider_company_code, p.provider_name, p.credit_grade].filter(Boolean).join(' ')));
    renderPolicyList(filtered);
  } else if (page === 'partners') {
    const filtered = (store.partners || []).filter(p => matches([p.partner_name, p.partner_code, p.company_name, p.company_code, p.contact_name, p.phone, p.email, p.partner_type].filter(Boolean).join(' ')));
    renderPartnerList(filtered);
  } else if (page === 'users') {
    const filtered = (store.users || []).filter(u => matches([u.name, u.email, u.company_name, u.role, u.phone].filter(Boolean).join(' ')));
    renderUserList(filtered);
  }
}

function bindGlobalSearch() {
  const sb = document.getElementById('ptTbSearch');
  if (!sb) return;
  sb.addEventListener('input', (e) => {
    _globalSearch = e.target.value || '';
    applyGlobalSearch();
  });
  // 페이지 전환 시 검색어 초기화 — 이전 페이지 필터가 새 페이지에 잘못 적용되지 않게
  window.addEventListener('hashchange', () => {
    _globalSearch = '';
    sb.value = '';
    _searchFilter.search = '';
  });
}

/* 모든 페이지 .room-item 클릭 → 활성 토글 + 페이지별 상세 갱신 */
function bindGenericListInteractions() {
  document.body.addEventListener('click', (e) => {
    const item = e.target.closest('.ws4-list .room-item');
    if (!item) return;
    const list = item.parentElement;
    list.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
    item.classList.add('active');

    const id = item.dataset.id;
    const page = item.closest('.pt-page')?.dataset.page;
    if (!id || !page) return;

    if (page === 'contract') {
      const c = (store.contracts || []).find(x => x.contract_code === id || x._key === id);
      if (c) renderContractDetail(c);
    } else if (page === 'workspace') {
      selectRoom(id);
    } else if (page === 'settle') {
      const s = (store.settlements || []).find(x => x._key === id);
      if (s) renderSettlementDetail(s);
    } else if (page === 'product') {
      const pr = (store.products || []).find(x => x._key === id);
      if (pr) renderProductDetail(pr);
    } else if (page === 'policy') {
      const pol = (store.policies || []).find(x => x._key === id);
      if (pol) renderPolicyDetail(pol);
    } else if (page === 'partners') {
      const pa = (store.partners || []).find(x => x._key === id);
      if (pa) renderPartnerDetail(pa);
    } else if (page === 'users') {
      const u = (store.users || []).find(x => x._key === id);
      if (u) renderUserDetail(u);
    }
  });
}


/* ── 사용자 정보 → 사이드바 brand · bottom + 역할 클래스 ── */
function hydrateUser(user) {
  const brandText = document.querySelector('.pt-sb-brand .sb-brand-text');
  if (brandText) brandText.textContent = user.company_name || 'freepass ERP';
  const bottom = document.querySelector('.pt-sb-bottom');
  if (bottom) {
    const roleBase = { admin: '관리자', provider: '공급', agent: '영업', agent_admin: '영업' }[user.role] || user.role || '';
    // 영업관리자는 "영업 · 관리자" 처럼 두 가지 다 표시
    const role = user.role === 'agent_admin' ? `${roleBase} · 관리자` : roleBase;
    bottom.textContent = `${user.name || user.email || ''}${role ? ' · ' + role : ''}`;
  }
  // body 에 role 클래스 — CSS 가 권한별 메뉴 가시성 처리
  document.body.classList.remove('role-admin', 'role-provider', 'role-agent', 'role-agent_admin');
  if (user.role) document.body.classList.add(`role-${user.role}`);
}

/* ── 사이드바 카운트 자동 갱신 — 모든 watchCollection 후 호출 ── */
function updateSidebarCounts() {
  const setCnt = (page, n) => {
    const el = document.querySelector(`.pt-sb a[data-page="${page}"] .cnt`);
    if (el) el.textContent = n > 0 ? String(n) : '';
  };
  // 상품 찾기 — 즉시 출고 가능
  setCnt('search', (store.products || []).filter(p => /즉시/.test(p.vehicle_status || '')).length);
  // 업무 소통 — 안읽음 룸
  setCnt('workspace', (store.rooms || []).filter(r => r.unread > 0).length);
  // 계약 관리 — 진행중 (만기 제외)
  setCnt('contract', (store.contracts || []).filter(c => (c.stage || c.status || '접수') !== '만기').length);
  // 정산 관리 — 미정산
  setCnt('settle', (store.settlements || []).filter(s => (s.settlement_status || s.status || '미정산') === '미정산').length);
  // 재고/정책/파트너/사용자 — 전체 수
  setCnt('product', (store.products || []).length);
  setCnt('policy', (store.policies || []).length);
  setCnt('partners', (store.partners || []).length);
  setCnt('users', (store.users || []).length);
}

/* ── 로그인 / 가입 / 재설정 폼 — v2 패턴 그대로 ── */
function bindLoginForm() {
  const loginForm  = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const resetForm  = document.getElementById('resetForm');

  // 카드 토글 — login / signup / reset 한 번에 하나만 표시
  const showCard = (which) => {
    [loginForm, signupForm, resetForm].forEach(el => { if (el) el.hidden = true; });
    const target = { login: loginForm, signup: signupForm, reset: resetForm }[which];
    if (target) target.hidden = false;
  };

  // 로그인
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const pw = document.getElementById('loginPw').value;
    const msg = document.getElementById('loginMsg');
    if (msg) msg.textContent = '';
    try {
      await fbLogin(email, pw);
      location.reload();
    } catch (err) {
      if (msg) msg.textContent = '로그인 실패 — ' + (err.code || err.message || err);
    }
  });

  document.getElementById('signupLink')?.addEventListener('click', (e) => { e.preventDefault(); showCard('signup'); });
  document.getElementById('resetLink')?.addEventListener('click', (e) => { e.preventDefault(); showCard('reset'); });
  document.getElementById('suBackLink')?.addEventListener('click', (e) => { e.preventDefault(); showCard('login'); });
  document.getElementById('rpBackLink')?.addEventListener('click', (e) => { e.preventDefault(); showCard('login'); });

  // 가입
  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('suEmail').value.trim();
    const pw = document.getElementById('suPw').value;
    const msg = document.getElementById('signupMsg');
    if (msg) msg.textContent = '';
    if (!email || !pw || pw.length < 6) { if (msg) msg.textContent = '이메일·비밀번호(6자 이상) 필수'; return; }
    try {
      const { signup } = await import('./firebase/auth.js');
      const { saveUserProfile } = await import('./firebase/collections.js');
      const user = await signup(email, pw);
      await saveUserProfile(user.uid, {
        email,
        name: document.getElementById('suName').value.trim(),
        phone: document.getElementById('suPhone').value.trim(),
        company_name: document.getElementById('suCompany').value.trim(),
        role: document.getElementById('suRole').value,
      });
      showToast('가입 완료. 관리자 승인 후 이용 가능합니다.', 'success');
      // 로그아웃 후 로그인 화면으로 (대기 상태라 ERP 진입 차단)
      const { logout } = await import('./firebase/auth.js');
      await logout();
      showCard('login');
    } catch (err) {
      console.error('[signup]', err);
      if (msg) msg.textContent = '가입 실패 — ' + (err.code || err.message || err);
    }
  });

  // 비밀번호 재설정
  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('rpEmail').value.trim();
    const msg = document.getElementById('resetMsg');
    if (msg) msg.textContent = '';
    if (!email) return;
    try {
      const { resetPassword } = await import('./firebase/auth.js');
      await resetPassword(email);
      if (msg) { msg.style.color = 'var(--accent-green)'; msg.textContent = '재설정 메일 전송됨. 이메일을 확인하세요.'; }
    } catch (err) {
      if (msg) msg.textContent = '전송 실패 — ' + (err.code || err.message || err);
    }
  });
}

/* ── 로그아웃 (사이드바 또는 어디든 #btnLogout 있으면) ── */
function bindLogout() {
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await fbLogout();
    location.reload();
  });
}

boot();
