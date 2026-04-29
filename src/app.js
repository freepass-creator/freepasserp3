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
import './core/form-fields.js';   // 전역 2-click 수정 모드 핸들러 등록
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
import { renderSettings } from './pages/settings.js';
import { renderDev } from './pages/dev.js';
// index.html 의 non-module <script> 가 호출할 수 있도록 window 에 노출
window.renderSettings = renderSettings;
window.renderDev = renderDev;

/* ── Boot ── */
async function boot() {
  // 저장된 폰트/다크모드 즉시 적용 (FOUC 방지)
  try {
    const { applyStoredFont, applyStoredTheme } = await import('./pages/settings.js');
    applyStoredFont();
    applyStoredTheme();
  } catch (_) {}

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

  // 유효한 역할을 가진 사용자만 진입 — 그 외(미가입/role 없음/비활성/대기/거부) 모두 로그인 화면
  const VALID_ROLES = ['admin', 'agent', 'agent_admin', 'provider'];
  const status = user?.status || 'active';
  const hasValidRole = user && VALID_ROLES.includes(user.role);
  const isBlocked = user && (user.is_active === false || status === 'pending' || status === 'rejected');

  if (user && hasValidRole && !isBlocked) {
    document.body.classList.remove('is-login');
    hydrateUser(user);
    startHydration();
  } else {
    // 인증은 됐지만 진입 자격 없음 → 강제 로그아웃 + 로그인 폼
    if (user) {
      const reason = !hasValidRole ? '권한이 부여되지 않은 계정입니다' :
        (status === 'rejected' ? '가입이 거부되었습니다' :
         user.is_active === false ? '비활성 계정입니다' :
         '관리자 승인 대기 중입니다');
      await fbLogout();
      setTimeout(() => {
        const msg = document.getElementById('loginMsg');
        if (msg) msg.textContent = reason;
      }, 50);
    }
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

/* 목록 패널(.ws4-list) 에만 빈 ws4-foot 자동 주입 — 다른 패널(상세/조건 등)은 제외 */
function ensureWs4Foot() {
  document.querySelectorAll('.ws4-card.ws4-list').forEach(card => {
    if (!card.querySelector(':scope > .ws4-foot')) {
      const foot = document.createElement('div');
      foot.className = 'ws4-foot';
      card.appendChild(foot);
    }
  });
}

/* prototype 샘플 비움 — 모든 페이지의 가짜 샘플을 먼저 정리. 실제 데이터(또는 emptyState)가 자리 차지 */
function clearSampleData() {
  document.querySelectorAll('[data-page="search"] .table tbody').forEach(tb => tb.innerHTML = '');
  // 검색 페이지 우측 상세 패널 — JS 가 선택 시 채우므로 초기엔 완전히 비움
  const searchDetail = document.querySelectorAll('.pt-page[data-page="search"] .ws4-card')[1];
  if (searchDetail) {
    searchDetail.querySelector('.ws4-head')?.replaceChildren();
    searchDetail.querySelector('.ws4-body')?.replaceChildren();
  }
  // 다른 페이지 — head/입력바 외 ws4-card 자식 비움 (실제 데이터 도착하면 render 가 덮어씀)
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
  watchCollection('partners',    (list) => {
    store.partners = list || [];
    renderPartnerList(store.partners);
    updateSidebarCounts();
    // partners 가 늦게 도착했을 때 — providerNameByCode 를 쓰는 다른 리스트들 재렌더
    //  (search/contract/product/settle 메인줄·상세에 한글 회사명 즉시 반영)
    if (Array.isArray(store.products)) renderSearchTable(store.products);
    if (Array.isArray(store.products)) renderProductList(store.products);
    if (Array.isArray(store.contracts)) renderContractList(store.contracts);
    if (Array.isArray(store.settlements)) renderSettlementList(store.settlements);
  });
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





/* 사진 클릭 → 풀스크린 (search detail / product detail 양쪽) — body 위임
   v2 와 동일한 상하 스크롤 방식 (openFullscreen) 사용 — 좌우 prev/next 안 씀 */
function bindPhotoClicks() {
  document.body.addEventListener('click', (e) => {
    // 메인 사진 또는 썸네일 클릭
    const img = e.target.closest('img.detail-photo-main, .detail-photo-thumb img');
    if (!img) return;
    if (img.closest('.srch-fullscreen, .lightbox-overlay')) return;   // 풀스크린 안의 이미지 무시
    // 현재 열린 detail 의 모든 사진 수집
    const card = img.closest('.ws4-card, .ws4-body');
    if (!card) return;
    const all = [...card.querySelectorAll('.detail-photo-thumb img, img.detail-photo-main')]
      .map(i => i.src).filter(Boolean);
    const unique = [...new Set(all)];
    const startIdx = unique.indexOf(img.src);
    openFullscreen(unique, Math.max(0, startIdx));
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

  // 다른 페이지 — store 데이터 필터 후 재렌더.
  // store.X 가 undefined (= watchCollection 콜백 미실행 = 미로드/권한 부족) 면 UI 손대지 않음 (prototype 보존)
  const matches = (haystack) => !q || haystack.toLowerCase().includes(q);
  if (page === 'workspace') {
    if (!store.rooms) return;
    const filtered = store.rooms.filter(r => matches([r.car_number, r.maker, r.model, r.last_message_text, r.partner_name].filter(Boolean).join(' ')));
    renderRoomList(filtered);
  } else if (page === 'contract') {
    if (!store.contracts) return;
    const filtered = store.contracts.filter(c => matches([c.contract_id, c.customer_name, c.car_number, c.maker, c.model, c.agent_name].filter(Boolean).join(' ')));
    renderContractList(filtered);
  } else if (page === 'settle') {
    if (!store.settlements) return;
    const filtered = store.settlements.filter(s => matches([s.contract_id, s.customer_name, s.car_number, s.maker, s.model, s.agent_name].filter(Boolean).join(' ')));
    renderSettlementList(filtered);
  } else if (page === 'product') {
    if (!store.products) return;
    const filtered = store.products.filter(p => matches([p.car_number, p.maker, p.model, p.sub_model, p.trim_name, Array.isArray(p.options) ? p.options.join(' ') : p.options].filter(Boolean).join(' ')));
    renderProductList(filtered);
  } else if (page === 'policy') {
    if (!store.policies) return;
    const filtered = store.policies.filter(p => matches([p.policy_name, p.policy_code, p.provider_company_code, p.provider_name, p.credit_grade].filter(Boolean).join(' ')));
    renderPolicyList(filtered);
  } else if (page === 'partners') {
    if (!store.partners) return;
    const filtered = store.partners.filter(p => matches([p.partner_name, p.partner_code, p.company_name, p.company_code, p.contact_name, p.phone, p.email, p.partner_type].filter(Boolean).join(' ')));
    renderPartnerList(filtered);
  } else if (page === 'users') {
    const filtered = (store.users || []).filter(u => matches([u.name, u.email, u.company_name, u.role, u.phone].filter(Boolean).join(' ')));
    renderUserList(filtered);
  }
}

function bindGlobalSearch() {
  const sb = document.getElementById('ptTbSearch');
  if (!sb) return;
  // 디바운스 — 키 입력 후 120ms 멈췄을 때만 필터 실행 (타이핑 중 매 키 재렌더 차단)
  let _searchTimer = null;
  sb.addEventListener('input', (e) => {
    _globalSearch = e.target.value || '';
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(applyGlobalSearch, 120);
  });
  // 페이지 전환 시 검색어 초기화 — 이전 페이지 필터가 새 페이지에 잘못 적용되지 않게
  window.addEventListener('hashchange', () => {
    if (_searchTimer) clearTimeout(_searchTimer);
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

  // ── 우클릭 컨텍스트 메뉴 (페이지별 항목 액션) ──
  document.body.addEventListener('contextmenu', async (e) => {
    // 1) 사이드바 .ws4-list 의 room-item 우클릭
    let item = e.target.closest('.ws4-list .room-item');
    let id = item?.dataset.id;
    let page = item?.closest('.pt-page')?.dataset.page;

    // 2) 검색 페이지 표 행 우클릭 (tr[data-id])
    if (!item) {
      const tr = e.target.closest('[data-page="search"] table.table-fixed tbody tr[data-id]');
      if (tr) {
        item = tr;
        id = tr.dataset.id;
        page = 'search';
      }
    }
    if (!item || !id || !page) return;
    e.preventDefault();

    const { openContextMenu } = await import('./core/context-menu.js');
    const items = buildContextMenuItems(page, id, item);
    if (items.length) openContextMenu(e, items);
  });
}

/* 상품 내용 → 영업자가 고객에게 보낼 텍스트 (카톡/문자용 깔끔 포맷) */
function formatProductForCopy(p) {
  const lines = [];
  // 헤더 — 차량번호 + 모델
  const carNo = p.car_number || '';
  const maker = p.maker || '';
  const model = [p.maker, p.sub_model || p.model].filter(Boolean).join(' ');
  const trim = p.trim_name || p.trim || '';
  lines.push(`[${carNo}] ${model}${trim ? ' ' + trim : ''}`);

  // 기본 스펙 — 한 줄
  const specs = [];
  if (p.year) specs.push(`${p.year}년`);
  if (p.mileage) specs.push(`${Number(p.mileage).toLocaleString()}km`);
  if (p.fuel_type) specs.push(p.fuel_type);
  if (p.ext_color) specs.push(`외부 ${p.ext_color}`);
  if (p.int_color) specs.push(`내부 ${p.int_color}`);
  if (specs.length) lines.push(specs.join(' · '));

  // 옵션 — 있으면 별도 줄
  const opts = Array.isArray(p.options) ? p.options.join(', ') : (p.options || '');
  if (opts) lines.push(`옵션: ${opts}`);

  // 대여료 / 보증금 — 가격 등록된 기간만
  const PERIODS = ['1', '12', '24', '36', '48', '60'];
  const priceRows = PERIODS
    .filter(m => Number(p.price?.[m]?.rent) > 0)
    .map(m => {
      const r = Math.round(Number(p.price[m].rent) / 10000);
      const d = Math.round(Number(p.price[m].deposit || 0) / 10000);
      return `· ${m}개월: ${r}만 / ${d}만`;
    });
  if (priceRows.length) {
    lines.push('');
    lines.push('대여료 (월 / 보증금)');
    lines.push(...priceRows);
  }

  // 심사
  const credit = (p._policy?.credit_grade || p._policy?.screening_criteria || p.credit_grade || '').trim();
  if (credit) {
    lines.push('');
    lines.push(`심사: ${credit}`);
  }

  // 담당자 — 소속 · 이름 직급 · 역할 · 연락처 (현재 로그인 사용자)
  const me = store.currentUser || {};
  const agentParts = [];
  if (me.company_name) agentParts.push(me.company_name);
  // 이름 + 직급 합쳐서 (e.g., "홍길동 팀장")
  const namePos = [me.name, me.position].filter(Boolean).join(' ');
  if (namePos) agentParts.push(namePos);
  // 역할 (영업/공급/관리)
  const roleLabel = { admin: '관리자', provider: '공급', agent: '영업', agent_admin: '영업 관리자' }[me.role];
  if (roleLabel) agentParts.push(roleLabel);
  if (agentParts.length) {
    lines.push('');
    lines.push(`담당: ${agentParts.join(' · ')}`);
    if (me.phone) lines.push(`연락처: ${me.phone}`);
  }

  return lines.join('\n');
}

/* 페이지별 우클릭 메뉴 빌더 — workspace / contract / settle / product / policy / partners / users / search */
function buildContextMenuItems(page, id, item) {
  if (page === 'search') {
    const p = (store.products || []).find(x => x._key === id);
    if (!p) return [];
    const car = p.car_number || '';
    return [
      { icon: 'ph ph-link', label: '상품 링크 복사', action: () => {
        const url = `${location.origin}/catalog.html?car=${encodeURIComponent(car)}`;
        navigator.clipboard?.writeText(url).then(() => {
          import('./core/toast.js').then(m => m.showToast(`상품 링크 복사됨 — ${car}`));
        });
      }},
      { icon: 'ph ph-copy', label: '상품 내용 복사', action: () => {
        const text = formatProductForCopy(p);
        navigator.clipboard?.writeText(text).then(() => {
          import('./core/toast.js').then(m => m.showToast(`상품 내용 복사됨 — ${car}`));
        });
      }},
      { divider: true },
      { icon: 'ph ph-chat-circle-dots', label: '문의 하기', action: () => {
        const btn = document.querySelector('[data-page="search"] .ws4-card:nth-child(2) #srchChat');
        btn?.click();
      }},
      { icon: 'ph ph-file-text', label: '계약 생성', action: () => {
        const btn = document.querySelector('[data-page="search"] .ws4-card:nth-child(2) #srchContract');
        btn?.click();
      }},
    ];
  }
  if (page === 'workspace') {
    const room = (store.rooms || []).find(r => r._key === id);
    if (!room) return [];
    const role = store.currentUser?.role;
    const hideField = role === 'agent' ? 'hidden_for_agent'
      : role === 'provider' ? 'hidden_for_provider'
      : 'hidden_for_admin';
    return [
      { icon: 'ph ph-eye', label: '읽음 처리', action: async () => {
        const { markRoomRead } = await import('./firebase/collections.js');
        await markRoomRead(id, store.currentUser?.uid);
      }},
      { icon: 'ph ph-star', label: '즐겨찾기', action: () => alert('즐겨찾기 — 준비 중') },
      { divider: true },
      { icon: 'ph ph-eye-slash', label: '대화 숨김', action: async () => {
        await updateRecord(`rooms/${id}`, { [hideField]: true, updated_at: Date.now() });
      }},
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!confirm('이 대화방을 삭제하시겠습니까?')) return;
        await updateRecord(`rooms/${id}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'contract') {
    const c = (store.contracts || []).find(x => x.contract_code === id || x._key === id);
    if (!c) return [];
    return [
      { icon: 'ph ph-copy', label: '계약코드 복사', action: () => navigator.clipboard?.writeText(c.contract_code || '').then(() => {
        import('./core/toast.js').then(m => m.showToast('계약코드 복사됨'));
      })},
      { divider: true },
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!confirm('이 계약을 삭제하시겠습니까?')) return;
        await updateRecord(`contracts/${c._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'settle') {
    const s = (store.settlements || []).find(x => x._key === id);
    if (!s) return [];
    return [
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!confirm('이 정산을 삭제하시겠습니까?')) return;
        await updateRecord(`settlements/${s._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'product') {
    const p = (store.products || []).find(x => x._key === id);
    if (!p) return [];
    return [
      { icon: 'ph ph-share-network', label: '카탈로그 링크 복사', action: () => {
        const car = p.car_number || '';
        const url = `${location.origin}/catalog.html?car=${encodeURIComponent(car)}`;
        navigator.clipboard?.writeText(url).then(() => {
          import('./core/toast.js').then(m => m.showToast(`상품 카탈로그 링크 복사됨 — ${car}`));
        });
      }},
      { divider: true },
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!confirm('이 차량을 삭제하시겠습니까?')) return;
        await updateRecord(`products/${p._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'policy') {
    const pol = (store.policies || []).find(x => x._key === id);
    if (!pol) return [];
    return [
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!confirm('이 정책을 삭제하시겠습니까?')) return;
        await updateRecord(`policies/${pol._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'partners') {
    const pa = (store.partners || []).find(x => x._key === id);
    if (!pa) return [];
    return [
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!confirm('이 파트너를 삭제하시겠습니까?')) return;
        await updateRecord(`partners/${pa._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  return [];
}


/* ── 사용자 정보 → 사이드바 brand · bottom + 역할 클래스 ── */
function hydrateUser(user) {
  const brandText = document.querySelector('.pt-sb-brand .sb-brand-text');
  if (brandText) brandText.textContent = user.company_name || 'freepass ERP';
  // user 정보 텍스트만 갱신 (로그아웃 버튼 등 다른 자식은 보존)
  const roleBase = { admin: '관리자', provider: '공급', agent: '영업', agent_admin: '영업' }[user.role] || user.role || '';
  const role = user.role === 'agent_admin' ? `${roleBase} · 관리자` : roleBase;
  const userInfo = document.querySelector('.pt-sb-user-info');
  if (userInfo) {
    userInfo.textContent = `${user.name || user.email || ''}${role ? ' · ' + role : ''}`;
  }
  // 토픽바 우측 사용자 메뉴 — 이름 · 직급 (역할 X)
  const tbUserName = document.querySelector('.pt-tb-user-name');
  if (tbUserName) tbUserName.textContent = user.name || user.email || '사용자';
  const tbUserRole = document.querySelector('.pt-tb-user-role');
  if (tbUserRole) tbUserRole.textContent = user.position || '';
  // body 에 role 클래스 — CSS 가 권한별 메뉴 가시성 처리
  document.body.classList.remove('role-admin', 'role-provider', 'role-agent', 'role-agent_admin');
  if (user.role) document.body.classList.add(`role-${user.role}`);
}

/* ── 사이드바 카운트 자동 갱신 — "처리 필요"만 카운트. watchCollection 후 호출 ── */
function updateSidebarCounts() {
  const setCnt = (page, n) => {
    const el = document.querySelector(`.pt-sb a[data-page="${page}"] .cnt`);
    if (!el) return;
    el.textContent = n > 0 ? String(n) : '';
  };
  const role = store.currentUser?.role;

  // 업무 소통 — 내 역할 기준 안읽음 룸 수 (workspace.js unreadOf 와 동일)
  const unreadCount = (store.rooms || []).filter(r => {
    if (r._deleted) return false;
    const u = role === 'agent' || role === 'agent_admin'
      ? r.unread_for_agent
      : role === 'provider' ? r.unread_for_provider
      : (r.unread_for_admin || r.unread);
    return Number(u) > 0;
  }).length;
  setCnt('workspace', unreadCount);

  // 계약 관리 — 진행중 (요청/대기/발송). 완료·취소 제외
  const pendingContracts = (store.contracts || []).filter(c => {
    if (c._deleted) return false;
    const s = c.contract_status || '계약요청';
    return s === '계약요청' || s === '계약대기' || s === '계약발송';
  }).length;
  setCnt('contract', pendingContracts);

  // 정산 관리 — 미정산 (정산완료 제외)
  const pendingSettlements = (store.settlements || []).filter(s => {
    if (s._deleted) return false;
    const st = s.settlement_status || s.status || '미정산';
    return st !== '정산완료' && st !== '완료';
  }).length;
  setCnt('settle', pendingSettlements);

  // 사용자 관리 — 가입 대기 (admin 만 의미. role 별 가시성은 CSS 가 처리)
  const pendingUsers = (store.users || []).filter(u => u.status === 'pending').length;
  setCnt('users', pendingUsers);

  // 카운트 개념 없는 페이지 — 명시적으로 비움
  setCnt('search', 0);
  setCnt('product', 0);
  setCnt('policy', 0);
  setCnt('partners', 0);
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
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;          // 중복 submit 방어
    const email = document.getElementById('loginEmail').value.trim();
    const pw = document.getElementById('loginPw').value;
    const msg = document.getElementById('loginMsg');
    if (msg) msg.textContent = '';
    if (submitBtn) submitBtn.disabled = true;
    try {
      await fbLogin(email, pw);
      // 로그인 후 항상 상품찾기로 진입 — hash 먼저 바꾸고 reload 로 auth 재초기화
      location.hash = 'search';
      location.reload();
    } catch (err) {
      if (msg) msg.textContent = '로그인 실패 — ' + (err.code || err.message || err);
      if (submitBtn) submitBtn.disabled = false;
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

/* ── 로그아웃 / 사용자 메뉴 / 설정 / 알림 바인딩 ── */
function bindLogout() {
  // 사이드바 하단 로그아웃 (구버전 호환 — id 가 있으면 동작)
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await fbLogout();
    location.reload();
  });

  // 사이드바 하단 설정 버튼 — 설정 페이지 / 다이얼로그 진입
  document.getElementById('btnSettings')?.addEventListener('click', (e) => {
    e.preventDefault();
    alert('설정 — 준비 중');
  });

  // 토픽바 우측 사용자 메뉴 — 설정 / 계정정보 / 로그아웃 진입점
  document.getElementById('ptTbUserMenu')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const { openContextMenu } = await import('./core/context-menu.js');
    openContextMenu(e, [
      { icon: 'ph ph-user-circle', label: '내 정보', action: () => alert('준비 중') },
      { icon: 'ph ph-gear', label: '설정', action: () => alert('준비 중') },
      { icon: 'ph ph-key', label: '비밀번호 변경', action: () => alert('준비 중') },
      { divider: true },
      { icon: 'ph ph-sign-out', label: '로그아웃', danger: true, action: async () => {
        await fbLogout();
        location.reload();
      }},
    ]);
  });

  // 알림 버튼 — 향후 알림 패널 연결 (현재는 placeholder)
  document.getElementById('ptTbAlert')?.addEventListener('click', () => {
    alert('알림 — 준비 중');
  });
}

boot();
