/**
 * freepasserp v3 — 진입점
 * UI: index.html (prototype 마크업)
 * 기능: Firebase auth + 사용자 hydration (필요 시 점진 추가)
 */

/* CSS — index.html 의 <link> + 인라인 <style> 만 사용 (Vite override 방지)
   phosphor 폰트는 public/phosphor/ 에 복사한 파일을 <link> 로 직접 로드 (vite 의존 X) */

// 모바일 유틸 (isMobile / haptic) — 부팅 직후 동기 감지 위해 정적 import
import { isMobile as isMobileUA, bindGlobalHaptic } from './core/mobile-shell.js';

// 환경별 CSS 분리 — tokens.css 와 base.css 는 index.html <link> 로 항상 로드.
// 모바일일 때만 mobile.css (mobile partials) 비동기 로드 — fire-and-forget (부팅 차단 X)
//  base.css 가 우선 적용되므로 mobile.css 늦게 와도 시각적 깨짐 없음
if (isMobileUA()) {
  import('./styles/mobile.css');   // await 제거 — 부팅 차단 방지
}

import { initAuth, login as fbLogin, logout as fbLogout } from './firebase/auth.js';
import { watchCollection, pushRecord, updateRecord, softDelete, fetchRecord, setRecord } from './firebase/db.js';
import { store } from './core/store.js';
import { matchRecord } from './core/search-match.js';
// 삭제 + 권한 체크 — app.js 에서 분리 (canDelete + 6개 delete 함수)
import {
  canDelete, deleteProduct, deletePolicy, deletePartner, deleteRoom, deleteContract, deleteSettlement,
} from './core/delete-actions.js';
// 신규 draft 자동 정리 — app.js 에서 분리
import {
  trackDraft, discardIncompleteDrafts, isDraftSaveBlocked, missingRequiredFields,
  untrackDraft, isDraftPending, hasDraftStarted,
} from './core/draft-tracking.js';
// 커스텀 확인 다이얼로그 (Windows native confirm 대체) — 가운데 정렬, 분위기 통일
import { customConfirm } from './core/confirm.js';
// 관리자 ↔ 비admin 1:1 소통 페이지 (사이드바 [관리자 소통] 버튼 + 페이지 렌더)
import { bindAdminChatButton, renderAdminChat } from './admin/admin-chat.js';
window.renderAdminChat = renderAdminChat;
import { productImages, productExternalImages, supportedDriveSource } from './core/product-photos.js';
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
import { POLICY_OPTS, renderPolicyList, renderPolicyDetail } from './pages/policy.js';
import { renderPartnerList, renderPartnerDetail } from './pages/partner.js';
import { renderUserList, renderUserDetail, userFilter } from './pages/user.js';
import { renderSettlementList, renderSettlementDetail } from './pages/settlement.js';
import {
  CONTRACT_STATUSES, renderContractList, renderContractDetail,
  renderContractWorkV2, bindContractWorkV2,
  createContractFromRoomLocal, makeTempContractCode, allocateRealContractCode,
} from './pages/contract.js';
import { pickAgent, pickPartner, pickOrCreateCustomer, normalizePhone } from './core/dialogs.js';
import { getProviderTel, getAdminTels, notifyProviderAndAdmin, notifyAdmins } from './core/notify.js';
import {
  calibrateSearchCols, renderSearchTable, renderSearchDetail,
  bindSearchInteractions, bindSearchSelection, applySearchFilter,
  setSearchCallbacks, _searchFilter,
  getActiveSearchProduct, searchActionChat, searchActionContract, searchActionShare,
  searchToggleQuickFilter, isQuickFilterActive, clearAllSearchFilters,
  searchTogglePeriod, isPeriodVisible,
  searchExportExcel, searchDownloadPhotoZip,
  openSearchFilterSheet,
} from './pages/search.js';
import {
  renderRoomList, selectRoom, renderRoomDetail, renderChatMessages,
  bindChatInput, bindRoomCreate, createRoomFromProduct,
  getActiveRoomId, getCurrentMessages, getPrevPeerReadAt, setPrevPeerReadAt,
} from './pages/workspace.js';
import {
  PRODUCT_OPTS, PRODUCT_TERMS,
  renderProductList, renderProductDetail,
} from './pages/product.js';
import { enrichProductsWithPolicy } from './core/policy-utils.js';
import { filterByRole, roleScope } from './core/roles.js';
import { renderChatMessages as v2RenderChatMessages, getPeerReadAt } from './core/chat-render.js';
import { markRoomRead } from './firebase/collections.js';
import { STEPS as CONTRACT_STEPS_V2, getStepStates, getProgress } from './core/contract-steps.js';
// vehicle_master Firebase 컬렉션 폐기 — catalog (public/data/car-master) 단일 진실원
// findCarModel/inferCarModel 은 호출처(product.js, vehicle-ocr.js) 에서 직접 import
import { renderSettings } from './pages/settings.js';
import { renderDev } from './pages/dev.js';
import { renderAdminOps } from './pages/admin-ops.js';
import { renderAdminSettlement } from './pages/admin-settlement.js';
import { isSystemAdmin } from './core/admin-access.js';
import { setPageActions } from './core/page-actions.js';
// index.html 의 non-module <script> 가 호출할 수 있도록 window 에 노출
window.renderSettings = renderSettings;
window.renderDev = renderDev;
window.renderAdminOps = renderAdminOps;
window.renderAdminSettlement = renderAdminSettlement;

/* ── 페이지별 하단 액션바 — index.html showPage() 에서 호출 ── */
let _productClipboard = null;
let _policyClipboard = null;


/* 페이지별 필터 상태 — 하단바 chip 으로 토글, watchCollection 이 적용 후 render */
const _pageFilters = {
  contract:  { status: 'all', company_code: 'all' },   // all / progress / done / cancel
  settle:    { status: 'all', company_code: 'all' },   // all / pending / done
  product:   { status: 'all', company_code: 'all' },   // all / 즉시 / 가능 / 협의 / 불가
  policy:    { status: 'all', company_code: 'all' },   // all / active / inactive
  partners:  { type: 'all' },                          // all / 공급사 / 영업채널 / 운영사
  workspace: { unread: 'all', company_code: 'all' },   // all / unread
};

function getCompanyOptions() {
  const codes = new Set();
  (store.partners || []).filter(p => !p._deleted).forEach(p => {
    const code = p.partner_code || p.company_code;
    if (code) codes.add(code);
  });
  return [...codes].sort();
}
function partnerNameOf(code) {
  const pa = (store.partners || []).find(p => (p.partner_code === code || p.company_code === code) && !p._deleted);
  return pa?.partner_name || pa?.company_name || code;
}
function buildCompanyDropdownChip(curCompany, setter) {
  const opts = getCompanyOptions();
  return {
    chip: true,
    label: curCompany === 'all' ? '소속 전체 ▾' : `${partnerNameOf(curCompany)} (${curCompany}) ▾`,
    onClick: (e) => {
      import('./core/context-menu.js').then(({ openContextMenu }) => {
        openContextMenu(e, [
          { label: '소속 전체', active: curCompany === 'all', action: () => setter('all') },
          { divider: true },
          ...opts.map(code => ({
            label: `${partnerNameOf(code)} (${code})`,
            active: curCompany === code,
            action: () => setter(code),
          })),
        ]);
      });
    },
  };
}

/* 페이지 이탈 시 — 활성 페이지의 변경 사항을 먼저 flush 후 draft 정리.
 *  ([저장] 버튼만 저장하는 spec 의 예외 — 사용자가 [수정] → 입력 → 저장 안 누르고 다른 메뉴로 가는
 *  실수로 신규 draft 가 통째로 삭제되는 회귀 방지) */
window.addEventListener('hashchange', async () => {
  try { await window.flushActivePageSaves?.(); } catch (_) {}
  discardIncompleteDrafts();
});

/* 신규 draft 입력 감지 — 첫 키 입력 시 액션바 [취소] → [저장] 자동 전환.
 *  데스크톱 활성 페이지의 input 변경 → debounce 150ms 후 refreshPageActions 호출 */
let _draftInputT = null;
document.addEventListener('input', (e) => {
  if (!e.target.matches?.('.pt-page.active [data-f]')) return;
  clearTimeout(_draftInputT);
  _draftInputT = setTimeout(() => window.refreshPageActions?.(), 150);
});

/* ── 전역 ESC 키 핸들러 ── 우선순위 순으로 처리 (한 번에 한 동작):
 *  1. 활성 모달 / 시트 / 컨텍스트 메뉴 / 갤러리 등은 자체 ESC 핸들러 보유 → 여기 도달 X
 *  2. 활성 페이지 detail 패널 (.ws4-detail) 이 펼쳐져 있으면 collapse
 *  3. 검색 페이지의 상세 패널 (.ws4) 이 열려있으면 collapse (기존 검색 페이지 한정)
 *  4. 편집 모드 ON 이면 OFF (입력칸 탈출)
 *  5. 활성 리스트 항목 선택 해제
 *
 *  Enter 는 입력칸 / 검색바 / 명령어팔레트 등 컨텍스트별 핸들러가 이미 처리 (전역 추가 X) */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (e.defaultPrevented) return;
  // 입력칸 안에서 ESC 는 blur 만 (Tab 처럼) — 페이지 액션은 안 건드림
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (typeof e.target.blur === 'function') e.target.blur();
    return;
  }
  // 1. 모달/시트/메뉴/갤러리 활성 시 자체 처리됨 — 별도 동작 안 함
  if (document.querySelector('.confirm-overlay, .pick-overlay, .m-sheet, .m-view, .ctx-menu, .srch-fs-overlay')) return;

  const activePage = document.querySelector('.pt-page.active');
  if (!activePage) return;

  // 2. 검색 페이지 상세 (.ws4 collapse 토글) — 이미 열려있으면 닫기
  const searchWs4 = activePage.querySelector('.ws4');
  if (activePage.dataset.page === 'search' && searchWs4 && !searchWs4.classList.contains('is-collapsed')) {
    searchWs4.classList.add('is-collapsed');
    e.preventDefault();
    return;
  }

  // 3. 일반 detail 패널 — collapse
  const detail = activePage.querySelector('.ws4-detail:not(.is-collapsed)');
  if (detail) {
    detail.classList.add('is-collapsed');
    e.preventDefault();
    return;
  }

  // 4. 편집 모드 ON → OFF (입력 중이 아니면)
  if (document.body.classList.contains('is-edit-mode')) {
    window.toggleEditMode?.(false);
    e.preventDefault();
    return;
  }

  // 5. 활성 리스트 선택 해제
  const activeItem = activePage.querySelector('.ws4-list .room-item.active');
  if (activeItem) {
    activeItem.classList.remove('active');
    window.refreshPageActions?.();
    e.preventDefault();
    return;
  }
});

/* ── 페이지별 필터 적용 후 render 호출 — watchCollection 콜백·chip toggle 양쪽에서 사용 ── */
function renderFilteredContracts() {
  let list = (store.contracts || []).filter(c => !c._deleted);
  const f = _pageFilters.contract;
  // 단계 매핑 — 대기(요청) / 진행(대기·발송·진행) / 완료
  if (f.status === 'pending')      list = list.filter(c => /(요청)/.test(c.contract_status || ''));
  else if (f.status === 'progress') list = list.filter(c => /(대기|발송|진행)/.test(c.contract_status || '') && !/(요청|완료|취소)/.test(c.contract_status || ''));
  else if (f.status === 'done')    list = list.filter(c => /(완료)/.test(c.contract_status || ''));
  if (f.company_code !== 'all')    list = list.filter(c => c.partner_code === f.company_code || c.provider_company_code === f.company_code);
  renderContractList(list);
}
function renderFilteredSettlements() {
  let list = (store.settlements || []).filter(s => !s._deleted);
  const f = _pageFilters.settle;
  if (f.status === 'pending')   list = list.filter(s => /(미정산|대기)/.test(s.settlement_status || s.status || ''));
  else if (f.status === 'done') list = list.filter(s => /(완료)/.test(s.settlement_status || s.status || ''));
  if (f.company_code !== 'all') list = list.filter(s => s.partner_code === f.company_code || s.provider_company_code === f.company_code);
  renderSettlementList(list);
}
function renderFilteredProducts() {
  let list = (store.products || []).filter(p => !p._deleted && p.status !== 'deleted');
  const f = _pageFilters.product;
  if (f.status === '즉시')      list = list.filter(p => /즉시/.test(p.vehicle_status || ''));
  else if (f.status === '가능') list = list.filter(p => /가능/.test(p.vehicle_status || '') && !/즉시/.test(p.vehicle_status || ''));
  else if (f.status === '협의') list = list.filter(p => /협의/.test(p.vehicle_status || ''));
  else if (f.status === '불가') list = list.filter(p => /(불가|완료)/.test(p.vehicle_status || ''));
  if (f.company_code !== 'all') list = list.filter(p => p.provider_company_code === f.company_code || p.partner_code === f.company_code);
  renderProductList(list);
}
function renderFilteredPolicies() {
  let list = (store.policies || []).filter(p => !p._deleted);
  const f = _pageFilters.policy;
  if (f.status === 'active')         list = list.filter(p => p.is_active !== false && p.status !== '중단');
  else if (f.status === 'inactive')  list = list.filter(p => p.is_active === false || p.status === '중단');
  if (f.company_code !== 'all')      list = list.filter(p => p.provider_company_code === f.company_code);
  renderPolicyList(list);
}
function renderFilteredPartners() {
  let list = (store.partners || []).filter(p => !p._deleted);
  const f = _pageFilters.partners;
  if (f.type === 'inactive') {
    // 비활성 탭 — type 무관, is_active === false 만
    list = list.filter(p => p.is_active === false);
  } else {
    // 그 외 (전체/공급사/영업채널/운영사) — 활성만
    list = list.filter(p => p.is_active !== false);
    if (f.type !== 'all') list = list.filter(p => p.partner_type === f.type);
  }
  renderPartnerList(list);
}
function renderFilteredRooms() {
  let list = (store.rooms || []).filter(r => !r._deleted);
  const f = _pageFilters.workspace;
  if (f.unread === 'unread' || f.unread === 'read') {
    const role = store.currentUser?.role;
    const key = role === 'agent' || role === 'agent_admin' ? 'unread_for_agent'
              : role === 'provider' ? 'unread_for_provider' : 'unread_for_admin';
    list = list.filter(r => {
      const u = Number(r[key] || 0);
      return f.unread === 'unread' ? u > 0 : u === 0;
    });
  }
  if (f.company_code !== 'all') list = list.filter(r => r.provider_company_code === f.company_code || r.agent_channel_code === f.company_code);
  renderRoomList(list);
}

window.refreshPageActions = function(pageName) {
  const p = pageName || document.querySelector('.pt-page.active')?.dataset.page;
  // 검색창 옆 필터 아이콘 — search 페이지가 아니면 항상 숨김 (search 분기에서 다시 켬)
  const filterBtn = document.getElementById('ptTbFilterBtn');
  if (filterBtn && p !== 'search') {
    filterBtn.hidden = true;
    filterBtn.classList.remove('is-active');
    const dot = document.getElementById('ptTbFilterDot');
    if (dot) dot.hidden = true;
  }
  if (!p) { setPageActions({}); return; }

  const activeItem = document.querySelector(`.pt-page[data-page="${p}"] .ws4-list .room-item.active`);
  const activeId = activeItem?.dataset.id;
  const ctx = pageStatusText(p);

  // 수정/저장/취소 3-mode 토글 — 폼 있는 페이지 공통.
  //  [수정]  보기 → 편집모드 ON (기존 record 편집)
  //  [취소]  편집 + 신규 draft + 아무 입력 없음 → 신규 record 폐기 + 보기 복귀
  //  [저장]  편집 + 입력 있음 → flushActivePageSaves + 편집모드 OFF
  const isEditing = document.body.classList.contains('is-edit-mode');
  const collMap = { product: 'products', policy: 'policies', partners: 'partners' };
  const coll = collMap[p];
  const isNewDraft = isEditing && coll && activeId && isDraftPending(coll, activeId);
  const draftStarted = isNewDraft && hasDraftStarted(coll, activeId);
  // body.is-draft-mode — 신규 draft 활성 시 시각 구분 (하늘색). 편집모드 OFF / 다른 매물 선택 시 자동 제거
  document.body.classList.toggle('is-draft-mode', !!isNewDraft);

  // 신규 등록 폐기
  const _discardDraft = {
    label: '취소',
    icon: 'ph-x',
    title: '신규 등록 취소 — 입력 안 한 항목 폐기',
    onClick: async () => {
      if (!await customConfirm({ message: '입력하신 내용을 폐기하고 신규 등록을 취소할까요?', danger: true, okLabel: '폐기', cancelLabel: '계속 입력' })) return;
      await updateRecord(`${coll}/${activeId}`, { _deleted: true, updated_at: Date.now() }, { silent: true });
      untrackDraft(coll, activeId);
      window.toggleEditMode?.(false);
      showToast('신규 등록 취소됨');
    },
  };
  // 수정 취소 (기존 record) — 편집 모드만 끔
  const _exitEdit = {
    label: '취소',
    icon: 'ph-x',
    title: '수정 취소 — 편집 모드 끄기',
    onClick: () => { window.toggleEditMode?.(false); showToast('수정 취소'); },
  };
  // 저장 — 검증 후 flush + 편집 모드 끔
  const _saveEdit = {
    label: '저장',
    icon: 'ph-check',
    primary: true,
    title: '변경 사항 저장 + 편집 모드 끄기',
    onClick: async () => {
      // 신규 draft 가 활성이면 필수 필드 검증 — 미입력 시 저장 차단
      if (coll && activeId && isDraftSaveBlocked(coll, activeId)) {
        const missing = missingRequiredFields(coll, activeId);
        const labels = { car_number: '차량번호', provider_company_code: '공급사', policy_name: '정책명', partner_name: '파트너명' };
        const missLabels = missing.map(f => labels[f] || f).join(', ');
        showToast(`필수 정보 미입력: ${missLabels}`, 'error');
        return;
      }
      const n = await window.flushActivePageSaves?.();
      if (coll && activeId) untrackDraft(coll, activeId);
      window.toggleEditMode?.(false);
      if (n > 0) showToast(`저장됨 (${n}건)`, 'success');
      else showToast('변경사항 없음', 'info');
    },
  };
  // 보기:[수정] / 수정모드:[취소][저장] / 신규 draft 미입력:[취소]
  const editActions = (isNewDraft && !draftStarted)
    ? [_discardDraft]
    : isEditing
      ? [(isNewDraft ? _discardDraft : _exitEdit), _saveEdit]
      : [{ label: '수정', icon: 'ph-pencil-simple', title: '편집 모드 켜기', onClick: () => { window.toggleEditMode?.(true); } }];

  if (p === 'product') {
    const hasSelection = !!activeId;
    const product = hasSelection ? (store.products || []).find(x => x._key === activeId) : null;
    const f = _pageFilters.product;
    const setS = (v) => { f.status = v; renderFilteredProducts(); window.refreshPageActions?.('product'); };
    const setC = (v) => { f.company_code = v; renderFilteredProducts(); window.refreshPageActions?.('product'); };
    setPageActions({
      left: [
        { chip: true, label: '전체', active: f.status === 'all',  onClick: () => setS('all') },
        { chip: true, label: '즉시', active: f.status === '즉시', onClick: () => setS('즉시') },
        { chip: true, label: '가능', active: f.status === '가능', onClick: () => setS('가능') },
        { chip: true, label: '협의', active: f.status === '협의', onClick: () => setS('협의') },
        { chip: true, label: '불가', active: f.status === '불가', onClick: () => setS('불가') },
        { divider: true },
        buildCompanyDropdownChip(f.company_code, setC),
      ],
      right: [
        { label: '신규등록', icon: 'ph-plus', primary: !isEditing, onClick: () => createNewProduct() },
        ...editActions,
        { divider: true },
        { label: '복사', icon: 'ph-copy', disabled: !hasSelection,
          title: '현재 차량 정보 복사', onClick: () => copyProduct(product) },
        { label: '붙여넣기', icon: 'ph-clipboard-text', disabled: !hasSelection || !_productClipboard,
          title: '복사된 정보를 현재 차량에 적용 (차량번호 제외)',
          onClick: () => pasteToProduct(product) },
        { label: '초기화', icon: 'ph-arrow-counter-clockwise', disabled: !hasSelection,
          title: '입력값 모두 비움 (차량번호/공급코드 유지)',
          onClick: () => resetProduct(product) },
        { label: '삭제', icon: 'ph-trash', disabled: !hasSelection, danger: true,
          onClick: () => deleteProduct(product) },
      ],
    });
  } else if (p === 'policy') {
    const hasSelection = !!activeId;
    const policy = hasSelection ? (store.policies || []).find(x => x._key === activeId) : null;
    const f = _pageFilters.policy;
    const setS = (v) => { f.status = v; renderFilteredPolicies(); window.refreshPageActions?.('policy'); };
    const setC = (v) => { f.company_code = v; renderFilteredPolicies(); window.refreshPageActions?.('policy'); };
    setPageActions({
      left: [
        { chip: true, label: '전체',   active: f.status === 'all',      onClick: () => setS('all') },
        { chip: true, label: '활성',   active: f.status === 'active',   onClick: () => setS('active') },
        { chip: true, label: '비활성', active: f.status === 'inactive', onClick: () => setS('inactive') },
        { divider: true },
        buildCompanyDropdownChip(f.company_code, setC),
      ],
      right: [
        { label: '신규등록', icon: 'ph-plus', primary: !isEditing, onClick: () => createNewPolicy() },
        ...editActions,
        { divider: true },
        { label: '복사', icon: 'ph-copy', disabled: !hasSelection,
          title: '현재 정책 조건/보험/운전자 정보 복사', onClick: () => copyPolicy(policy) },
        { label: '붙여넣기', icon: 'ph-clipboard-text', disabled: !hasSelection || !_policyClipboard,
          title: '복사된 정보를 현재 정책에 적용 (정책명/코드 제외)',
          onClick: () => pastePolicy(policy) },
        { label: '삭제', icon: 'ph-trash', disabled: !hasSelection, danger: true,
          onClick: () => deletePolicy(activeId) },
      ],
    });
  } else if (p === 'partners') {
    const hasSelection = !!activeId;
    const f = _pageFilters.partners;
    const setT = (v) => { f.type = v; renderFilteredPartners(); window.refreshPageActions?.('partners'); };
    setPageActions({
      left: [
        { chip: true, label: '전체',     active: f.type === 'all',      onClick: () => setT('all') },
        { chip: true, label: '공급사',   active: f.type === '공급사',   onClick: () => setT('공급사') },
        { chip: true, label: '영업채널', active: f.type === '영업채널', onClick: () => setT('영업채널') },
        { chip: true, label: '운영사',   active: f.type === '운영사',   onClick: () => setT('운영사') },
        { divider: true },
        { chip: true, label: '비활성',   active: f.type === 'inactive', onClick: () => setT('inactive') },
      ],
      right: [
        { label: '신규등록', icon: 'ph-plus', primary: !isEditing, onClick: () => createNewPartner() },
        ...editActions,
        { divider: true },
        { label: '삭제', icon: 'ph-trash', disabled: !hasSelection, danger: true,
          onClick: () => deletePartner(activeId) },
      ],
    });
  } else if (p === 'workspace') {
    const ws4 = document.getElementById('workspaceWs4');
    const chatHidden = ws4?.classList.contains('is-chat-hidden');
    const hasSelection = !!activeId;
    const f = _pageFilters.workspace;
    const setU = (v) => { f.unread = v; renderFilteredRooms(); window.refreshPageActions?.('workspace'); };
    const setC = (v) => { f.company_code = v; renderFilteredRooms(); window.refreshPageActions?.('workspace'); };
    setPageActions({
      left: [
        { chip: true, label: '전체',   active: f.unread === 'all',    onClick: () => setU('all') },
        { chip: true, label: '읽음',   active: f.unread === 'read',   onClick: () => setU('read') },
        { chip: true, label: '안읽음', active: f.unread === 'unread', onClick: () => setU('unread') },
        { divider: true },
        buildCompanyDropdownChip(f.company_code, setC),
      ],
      right: [
        ...editActions,
        { divider: true },
        { label: chatHidden ? '채팅 보이기' : '채팅 숨기기',
          icon:  chatHidden ? 'ph-eye' : 'ph-eye-slash',
          onClick: () => { ws4?.classList.toggle('is-chat-hidden'); window.refreshPageActions?.('workspace'); } },
        { divider: true },
        { label: '삭제', icon: 'ph-trash', disabled: !hasSelection, danger: true,
          onClick: () => deleteRoom(activeId) },
      ],
    });
  } else if (p === 'contract') {
    const hasSelection = !!activeId;
    const f = _pageFilters.contract;
    const setS = (v) => { f.status = v; renderFilteredContracts(); window.refreshPageActions?.('contract'); };
    const setC = (v) => { f.company_code = v; renderFilteredContracts(); window.refreshPageActions?.('contract'); };
    setPageActions({
      left: [
        { chip: true, label: '전체', active: f.status === 'all',      onClick: () => setS('all') },
        { chip: true, label: '대기', active: f.status === 'pending',  onClick: () => setS('pending') },
        { chip: true, label: '진행', active: f.status === 'progress', onClick: () => setS('progress') },
        { chip: true, label: '완료', active: f.status === 'done',     onClick: () => setS('done') },
        { divider: true },
        buildCompanyDropdownChip(f.company_code, setC),
      ],
      right: [
        ...editActions,
        { divider: true },
        { label: '삭제', icon: 'ph-trash', disabled: !hasSelection, danger: true,
          onClick: () => deleteContract(activeId) },
      ],
    });
  } else if (p === 'settle') {
    const hasSelection = !!activeId;
    const f = _pageFilters.settle;
    const setS = (v) => { f.status = v; renderFilteredSettlements(); window.refreshPageActions?.('settle'); };
    const setC = (v) => { f.company_code = v; renderFilteredSettlements(); window.refreshPageActions?.('settle'); };
    setPageActions({
      left: [
        { chip: true, label: '전체',   active: f.status === 'all',     onClick: () => setS('all') },
        { chip: true, label: '미정산', active: f.status === 'pending', onClick: () => setS('pending') },
        { chip: true, label: '완료',   active: f.status === 'done',    onClick: () => setS('done') },
        { divider: true },
        buildCompanyDropdownChip(f.company_code, setC),
      ],
      right: [
        ...editActions,
        { divider: true },
        { label: '삭제', icon: 'ph-trash', disabled: !hasSelection, danger: true,
          onClick: () => deleteSettlement(activeId) },
      ],
    });
  } else if (p === 'admin-settle') {
    window.buildAdminSettleActions?.();
  } else if (p === 'users') {
    const hasSelection = !!activeId;
    // 좌측 빠른필터 — 전체/승인/대기 (userFilter.status) + 소속코드 dropdown
    const curStatus = userFilter.status;
    const curCompany = userFilter.company_code;
    // 소속코드 옵션 — partners 전체 + users 에서 보이는 company_code 합집합
    const companyCodes = new Set();
    (store.partners || []).filter(x => !x._deleted).forEach(p => {
      const code = p.partner_code || p.company_code;
      if (code) companyCodes.add(code);
    });
    (store.users || []).forEach(u => { if (u.company_code) companyCodes.add(u.company_code); });
    const companyList = [...companyCodes].sort();
    const partnerNameOf = (code) => {
      const pa = (store.partners || []).find(p => (p.partner_code === code || p.company_code === code) && !p._deleted);
      return pa?.partner_name || pa?.company_name || code;
    };
    const setStatusFilter = (v) => {
      userFilter.status = v;
      applyGlobalSearch();   // userFilter + 상단 검색어 동시 반영 (검색 유지)
      window.refreshPageActions?.('users');
    };
    const setCompanyFilter = (v) => {
      userFilter.company_code = v;
      applyGlobalSearch();   // userFilter + 상단 검색어 동시 반영 (검색 유지)
      window.refreshPageActions?.('users');
    };
    setPageActions({
      left: [
        { chip: true, label: '전체', active: curStatus === 'all',  onClick: () => setStatusFilter('all') },
        { chip: true, label: '승인', active: curStatus === 'active', onClick: () => setStatusFilter('active') },
        { chip: true, label: '대기', active: curStatus === 'pending', onClick: () => setStatusFilter('pending') },
        { divider: true },
        // 소속코드 — 칩 드롭다운 (전체 + 각 코드)
        { chip: true, label: curCompany === 'all' ? '소속 전체' : `${partnerNameOf(curCompany)} (${curCompany})`,
          icon: 'ph-caret-down',
          onClick: (e) => {
            import('./core/context-menu.js').then(({ openContextMenu }) => {
              openContextMenu(e, [
                { label: '소속 전체', active: curCompany === 'all', action: () => setCompanyFilter('all') },
                { divider: true },
                ...companyList.map(code => ({
                  label: `${partnerNameOf(code)} (${code})`,
                  active: curCompany === code,
                  action: () => setCompanyFilter(code),
                })),
              ]);
            });
          },
        },
      ],
      right: [
        ...editActions,
        { divider: true },
        { label: '삭제', icon: 'ph-trash', disabled: !hasSelection, danger: true,
          onClick: () => deleteUser(activeId) },
      ],
    });
  } else if (p === 'search') {
    const role = store.currentUser?.role;
    const isAgent = role === 'agent' || role === 'agent_admin' || role === 'admin';
    const product = getActiveSearchProduct();
    const hasSelection = !!product;

    const requireSelect = (fn) => () => {
      const cur = getActiveSearchProduct();
      if (!cur) { showToast('차량을 먼저 선택해주세요', 'info'); return; }
      fn(cur);
    };

    // 좌: 퀵 필터 — [전체] / 신차 / 중고 / 만26세
    //   ([퀵필터] 시트는 검색창 우측 아이콘 #ptTbFilterBtn 으로 이동)
    const QUICK = [
      { v: 'new', l: '신차' },
      { v: 'used', l: '중고' },
      { v: 'age26', l: '만26세 이하' },
    ];
    const sheetCount = Object.values(_searchFilter.activeFilters || {})
      .reduce((n, set) => n + (set?.size || 0), 0);
    const providerActive = !!(_searchFilter.provider && _searchFilter.provider !== 'all');
    const anyActive = QUICK.some(q => isQuickFilterActive(q.v)) || sheetCount > 0 || providerActive;
    // 공급사 드롭다운 — 매물 보유 공급사 + 대수 표시, 대수 많은 순
    const provCount = {};
    let provTotal = 0;
    for (const pr of (store.products || [])) {
      if (pr._deleted || pr.status === 'deleted') continue;
      const st = String(pr.vehicle_status || '').replace(/\s+/g, '');
      if (st !== '출고가능' && st !== '즉시출고') continue;   // 출고가능 매물만 카운트
      provTotal++;
      const code = pr.provider_company_code || pr.partner_code;
      if (code) provCount[code] = (provCount[code] || 0) + 1;
    }
    const provNameOf = (code) => {
      const pt = (store.partners || []).find(x => (x.partner_code === code || x.company_code === code || x._key === code) && !x._deleted);
      return pt?.partner_name || pt?.company_name || code;
    };
    const providerOpts = [
      { value: 'all', label: `공급사 전체 (${provTotal}대)` },
      ...Object.entries(provCount)
        .sort((a, b) => b[1] - a[1] || provNameOf(a[0]).localeCompare(provNameOf(b[0]), 'ko'))
        .map(([code, n]) => ({ value: code, label: `${provNameOf(code)} (${n}대)` })),
    ];
    const left = [
      { chip: true, label: '전체', active: !anyActive,
        title: '모든 필터 해제',
        onClick: () => clearAllSearchFilters() },
      ...QUICK.map(q => ({
        chip: true, label: q.l, active: isQuickFilterActive(q.v),
        onClick: (e) => searchToggleQuickFilter(q.v, e.currentTarget),
      })),
      { select: true, value: _searchFilter.provider || 'all', active: providerActive,
        title: '공급사로 필터', options: providerOpts,
        onChange: (v) => { _searchFilter.provider = v; applySearchFilter(); window.refreshPageActions?.('search'); } },
    ];

    // 검색창 우측 필터 아이콘 — search 페이지에서만 노출, dot 으로 활성 상태 표시
    const filterBtn = document.getElementById('ptTbFilterBtn');
    if (filterBtn) {
      filterBtn.hidden = false;
      filterBtn.classList.toggle('is-active', sheetCount > 0);
      const dot = document.getElementById('ptTbFilterDot');
      if (dot) dot.hidden = sheetCount === 0;
    }

    // 중: 출력(엑셀/사진)만. 소통/공유/계약은 상세 패널 하단 틀고정 액션바로 이동(매물 액션이라 상세에 귀속).
    const center = [
      { label: '엑셀', icon: 'ph-file-xls', title: '필터된 차량 엑셀 다운로드', onClick: () => searchExportExcel() },
      { label: '사진', icon: 'ph-file-zip', title: '필터된 차량 사진 ZIP', onClick: () => searchDownloadPhotoZip() },
    ];

    // 우: 기간 컬럼 토글
    const PERIODS = ['1m', '12m', '24m', '36m', '48m', '60m'];
    const right = PERIODS.map(pd => ({
      chip: true, label: pd.toUpperCase(), active: isPeriodVisible(pd),
      title: `${pd.toUpperCase()} 컬럼 표시/숨김`,
      onClick: () => searchTogglePeriod(pd),
    }));

    setPageActions({ left, center, right });
  } else {
    setPageActions({});
  }
};

/* 토픽바 — 페이지 제목 옆 상태 카운트 (search 외 모든 페이지에도 적용).
 *  search 페이지는 search.js 의 updateSearchStats() 가 별도 처리 (출고불가 제외 등 특수 로직). */
window.updatePageStats = function(name) {
  const el = document.getElementById('ptTbSearchStats');
  if (!el) return;
  if (name === 'search') { window.updateSearchStats?.(); return; }
  const html = pageStatsHtml(name);
  el.innerHTML = html || '';
};

function pageStatsHtml(p) {
  if (p === 'product') {
    const me = store.currentUser;
    const ps = (store.products || []).filter(x => !x._deleted);
    const visible = me?.role === 'provider'
      ? ps.filter(x => x.provider_company_code === me.company_code || x.partner_code === me.company_code)
      : ps;
    const cnt = (s) => visible.filter(x => x.vehicle_status === s).length;
    return `<span class="stat-total">총 ${visible.length}대</span>
      <span class="stat-즉시">즉시 ${cnt('즉시출고')}</span>
      <span class="stat-가능">가능 ${cnt('출고가능')}</span>
      <span class="stat-협의">협의 ${cnt('출고협의')}</span>`;
  }
  if (p === 'workspace') {
    const list = (store.rooms || []).filter(x => !x._deleted);
    const role = store.currentUser?.role;
    const unreadKey = role === 'agent' ? 'unread_for_agent' : role === 'provider' ? 'unread_for_provider' : 'unread_for_admin';
    const unread = list.reduce((sum, r) => sum + Number(r[unreadKey] || 0), 0);
    return `<span class="stat-total">총 ${list.length}개</span>
      ${unread ? `<span class="stat-협의">안읽음 ${unread}</span>` : ''}`;
  }
  if (p === 'contract') {
    const list = (store.contracts || []).filter(x => !x._deleted);
    const wait = list.filter(x => x.contract_status === '계약요청' || x.contract_status === '진행중' || x.contract_status === '대기').length;
    const done = list.filter(x => x.contract_status === '계약완료' || x.contract_status === '완료').length;
    return `<span class="stat-total">총 ${list.length}건</span>
      <span class="stat-가능">진행 ${list.length - done}</span>
      <span class="stat-즉시">완료 ${done}</span>
      ${wait ? `<span class="stat-협의">대기 ${wait}</span>` : ''}`;
  }
  if (p === 'settle') {
    const list = (store.settlements || []).filter(x => !x._deleted);
    const wait = list.filter(x => (x.settlement_status || x.status) === '미정산' || (x.settlement_status || x.status) === '정산대기').length;
    const done = list.filter(x => (x.settlement_status || x.status) === '정산완료').length;
    return `<span class="stat-total">총 ${list.length}건</span>
      ${wait ? `<span class="stat-협의">미정산 ${wait}</span>` : ''}
      <span class="stat-즉시">완료 ${done}</span>`;
  }
  if (p === 'policy') {
    const list = (store.policies || []).filter(x => !x._deleted);
    const active = list.filter(x => x.is_active !== false && x.status !== '중단').length;
    return `<span class="stat-total">총 ${list.length}개</span>
      <span class="stat-즉시">활성 ${active}</span>`;
  }
  if (p === 'partners') {
    const list = (store.partners || []).filter(x => !x._deleted);
    const active = list.filter(x => x.is_active !== false).length;
    return `<span class="stat-total">총 ${list.length}개</span>
      <span class="stat-즉시">활성 ${active}</span>`;
  }
  if (p === 'users') {
    const list = (store.users || []).filter(x => !x._deleted);
    const pending = list.filter(x => x.status === 'pending' || x.is_active === false || x.status === 'rejected').length;
    const approved = list.length - pending;
    return `<span class="stat-total">총 ${list.length}명</span>
      <span class="stat-즉시">승인 ${approved}</span>
      <span class="stat-협의">대기 ${pending}</span>`;
  }
  return '';
}

/* 하단바 좌측 컨텍스트 — 비움 (페이지 상태는 토픽바로 이전됨). 향후 선택된 항목 표시용으로 활용 가능. */
function pageStatusText(_p) { return ''; }

/* 임시 차량번호 — `100신0001`, `100신0002` 형식. 출고예정/구매예정/번호등록예정 차량용.
 *  store.products 에서 같은 prefix 의 최대값 +1 (deleted 포함하여 충돌 방지). */
function nextTempCarNumber() {
  const PREFIX = '100신';
  const PAD = 4;
  const max = (store.products || [])
    .map(p => String(p.car_number || ''))
    .filter(n => n.startsWith(PREFIX))
    .map(n => parseInt(n.slice(PREFIX.length), 10))
    .filter(n => Number.isFinite(n))
    .reduce((m, n) => Math.max(m, n), 0);
  return `${PREFIX}${String(max + 1).padStart(PAD, '0')}`;
}

/* 신규 상품 등록 — 빈 레코드 즉시 생성 + 우측 자산정보 폼이 빈 입력칸으로 전환.
 *  - 차량번호: 자동 `100신XXXX` 임시번호 (실번호 받으면 사용자가 덮어씀)
 *  - 공급/영업: 본인 회사로 자동 고정 (수정 불가)
 *  - 관리자: 공급코드 빈 값 → 폼 드롭다운에서 직접 선택 */
async function createNewProduct() {
  const me = store.currentUser;
  const role = me?.role;
  if (!(role === 'admin' || role === 'provider')) {
    showToast('차량 등록은 공급사·관리자 전용', 'error');
    return;
  }
  // 신규 등록 진입 직전 — 다른 미입력 draft 자동 폐기
  await discardIncompleteDrafts();
  // 이미 입력 중인 빈 draft 있으면 그쪽으로 이동 (중복 신규등록 방지)
  const pendingDraft = (store.products || []).find(p => isDraftPending('products', p._key));
  if (pendingDraft) {
    const item = document.querySelector(`.pt-page[data-page="product"] .ws4-list .room-item[data-id="${pendingDraft._key}"]`);
    if (item) {
      document.querySelectorAll('.pt-page[data-page="product"] .room-item').forEach(r => r.classList.remove('active'));
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    }
    const m = await import('./pages/product.js');
    m.renderProductDetail(pendingDraft);
    showToast('이미 입력 중인 신규 매물이 있습니다', 'info');
    return;
  }
  let providerCode = '';
  let partnerCode = '';
  if (role === 'provider') {
    providerCode = me.company_code || me.partner_code || '';
    partnerCode = providerCode;
    if (!providerCode) { showToast('소속 공급사 정보가 없습니다 — 관리자 문의', 'error'); return; }
  }
  const { allocateManualProductUid } = await import('./firebase/collections.js');
  const uid = await allocateManualProductUid();
  const newRec = {
    _key: uid,
    product_uid: uid,
    product_code: uid,
    car_number: '',
    provider_company_code: providerCode,
    partner_code: partnerCode,
    vehicle_status: '상품화중',
    product_type: '중고렌트',
    is_active: true,
    created_at: Date.now(),
    created_by: me.uid,
  };
  // Optimistic — store 즉시 갱신 + 우측 자산 폼이 빈 입력칸으로 렌더
  store.products = [newRec, ...(store.products || [])];
  const m = await import('./pages/product.js');
  m.renderProductList(store.products);
  const item = document.querySelector(`.pt-page[data-page="product"] .ws4-list .room-item[data-id="${uid}"]`);
  if (item) {
    document.querySelectorAll('.pt-page[data-page="product"] .room-item').forEach(r => r.classList.remove('active'));
    item.classList.add('active');
  }
  m.renderProductDetail(newRec);
  window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage);
  // 필수 필드 — admin 은 차량번호 + 공급사 (admin 은 빈 공급사로 시작)
  // 그 외 (provider) 는 차량번호만 (provider 는 본인 회사 자동 채워짐)
  trackDraft('products', uid, role === 'admin' ? ['car_number', 'provider_company_code'] : 'car_number');
  // 신규 등록 → 즉시 편집 모드 ON (드롭다운 잠금 해제 필요).
  // 사용자가 [수정] 별도 클릭 안 해도 바로 입력 가능.
  window.toggleEditMode?.(true);
  // 관리자는 공급사 미선택 상태 → 안내 토스트 + 공급코드 드롭다운 포커스
  if (role === 'admin') {
    showToast('공급사를 먼저 선택하세요', 'info');
    setTimeout(() => {
      const sel = document.querySelector('.pt-page[data-page="product"] select[data-f="provider_company_code"]');
      if (sel) {
        sel.focus();
        sel.click();   // 드롭다운 자동 펼침 (브라우저별 동작 차이 있을 수 있음)
      }
    }, 100);
  }
  setRecord(`products/${uid}`, newRec).catch(e => {
    console.error('[product create]', e);
    showToast('등록 실패 — ' + (e.message || e), 'error');
  });
}

function copyProduct(p) {
  if (!p) return;
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
  showToast(`${p.car_number || '차량'} 정보 복사됨 — 다른 차량 선택 후 붙여넣기`);
  window.refreshPageActions?.('product');
}

async function pasteToProduct(p) {
  if (!p || !_productClipboard) return;
  if (!await customConfirm({ title: '붙여넣기', message: '복사된 차량 정보를 현재 차량에 적용합니다.\n차량번호/차대번호는 유지됩니다.\n계속할까요?', okLabel: '적용' })) return;
  try {
    await updateRecord(`products/${p._key}`, { ..._productClipboard });
    showToast('붙여넣기 완료');
  } catch (e) {
    console.error('[paste]', e);
    showToast('붙여넣기 실패', 'error');
  }
}

function copyPolicy(pol) {
  if (!pol) return;
  // 식별 필드(코드/키)·메타·연결상품은 제외 — 조건/보험/운전자만 복사
  const EXCLUDE = new Set([
    '_key', '_deleted', 'policy_code', 'term_code', 'policy_name', 'term_name',
    'created_at', 'created_by', 'updated_at',
  ]);
  const snap = {};
  for (const [k, v] of Object.entries(pol)) {
    if (EXCLUDE.has(k)) continue;
    if (v == null || v === '') continue;
    snap[k] = v;
  }
  _policyClipboard = snap;
  showToast(`${pol.policy_name || '정책'} 정보 복사됨 — 다른 정책 선택 후 붙여넣기`);
  window.refreshPageActions?.('policy');
}

/* 정책 신규등록 — 빈 레코드 + 즉시 편집 모드 + draft tracking */
/* 파트너 신규등록 — admin 만 가능. createNewPolicy 와 동일 패턴.
 *  중복 신규 draft 방지 + PT-XXXX 코드 발급 + 즉시 편집 모드 진입. */
async function createNewPartner() {
  const me = store.currentUser;
  const role = me?.role;
  if (role !== 'admin') {
    showToast('파트너 등록은 관리자 전용', 'error');
    return;
  }
  // 신규 등록 진입 직전 — 다른 미입력 draft 자동 폐기
  await discardIncompleteDrafts();
  // 중복 draft 방지 — 이미 입력 중인 빈 draft 활성화
  const pendingDraft = (store.partners || []).find(p => isDraftPending('partners', p._key));
  if (pendingDraft) {
    const item = document.querySelector(`.pt-page[data-page="partners"] .ws4-list .room-item[data-id="${pendingDraft._key}"]`);
    if (item) {
      document.querySelectorAll('.pt-page[data-page="partners"] .room-item').forEach(r => r.classList.remove('active'));
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    }
    const m = await import('./pages/partner.js');
    m.renderPartnerDetail(pendingDraft);
    showToast('이미 입력 중인 신규 파트너가 있습니다', 'info');
    return;
  }
  const { allocatePartnerCode } = await import('./firebase/collections.js');
  const code = await allocatePartnerCode();
  const newRec = {
    _key: code,
    partner_code: code,
    partner_name: '',
    status: 'active',
    created_at: Date.now(),
    created_by: me.uid,
  };
  store.partners = [newRec, ...(store.partners || [])];
  const m = await import('./pages/partner.js');
  m.renderPartnerList(store.partners);
  const item = document.querySelector(`.pt-page[data-page="partners"] .ws4-list .room-item[data-id="${code}"]`);
  if (item) {
    document.querySelectorAll('.pt-page[data-page="partners"] .room-item').forEach(r => r.classList.remove('active'));
    item.classList.add('active');
    item.scrollIntoView({ block: 'nearest' });
  }
  m.renderPartnerDetail(newRec);
  // 신규 draft 모드 — 편집모드 진입 + 필수필드 추적
  if (typeof window.toggleEditMode === 'function') window.toggleEditMode(true);
  trackDraft('partners', code, 'partner_name');
  window.refreshPageActions?.();
}

async function createNewPolicy() {
  const me = store.currentUser;
  const role = me?.role;
  if (!(role === 'admin' || role === 'provider')) {
    showToast('정책 등록은 관리자·공급사 전용', 'error');
    return;
  }
  // 신규 등록 진입 직전 — 다른 미입력 draft 자동 폐기
  await discardIncompleteDrafts();
  // 중복 신규등록 방지 — 이미 입력 중인 빈 draft 있으면 그쪽 활성화
  const pendingDraft = (store.policies || []).find(p => isDraftPending('policies', p._key));
  if (pendingDraft) {
    const item = document.querySelector(`.pt-page[data-page="policy"] .ws4-list .room-item[data-id="${pendingDraft._key}"]`);
    if (item) {
      document.querySelectorAll('.pt-page[data-page="policy"] .room-item').forEach(r => r.classList.remove('active'));
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    }
    const m = await import('./pages/policy.js');
    m.renderPolicyDetail(pendingDraft);
    showToast('이미 입력 중인 신규 정책이 있습니다', 'info');
    return;
  }
  let providerCode = '';
  if (role === 'provider') {
    providerCode = me.company_code || me.partner_code || '';
    if (!providerCode) { showToast('소속 공급사 정보가 없습니다 — 관리자 문의', 'error'); return; }
  }
  const { allocatePolicyCode } = await import('./firebase/collections.js');
  const { POLICY_DEFAULTS } = await import('./pages/policy.js');
  const code = await allocatePolicyCode();
  const newRec = {
    ...POLICY_DEFAULTS,                      // 표준 기본값 미리 박음 (사용자는 편집만)
    _key: code,
    policy_code: code,
    policy_name: '',
    term_description: '',
    provider_company_code: providerCode,
    status: 'active',
    created_at: Date.now(),
    created_by: me.uid,
  };
  store.policies = [newRec, ...(store.policies || [])];
  // 전체 레코드를 Firebase 에 즉시 저장 — policy_code·기본값 영속화 (createNewProduct 와 동일 패턴).
  //   누락 시: policy_code(readonly·data-f 없음)가 flush 에 안 실려 정책이 저장 안 되던 버그.
  setRecord(`policies/${code}`, newRec).catch(e => {
    console.error('[policy create]', e);
    showToast('정책 등록 실패 — ' + (e.message || e), 'error');
  });
  const m = await import('./pages/policy.js');
  m.renderPolicyList(store.policies);
  const item = document.querySelector(`.pt-page[data-page="policy"] .ws4-list .room-item[data-id="${code}"]`);
  if (item) {
    document.querySelectorAll('.pt-page[data-page="policy"] .room-item').forEach(r => r.classList.remove('active'));
    item.classList.add('active');
    item.scrollIntoView({ block: 'nearest' });
  }
  m.renderPolicyDetail(newRec);
  window.refreshPageActions?.();
  // 정책명 + (admin 인 경우) 공급코드 필수
  trackDraft('policies', code, role === 'admin' ? ['policy_name', 'provider_company_code'] : 'policy_name');
  window.toggleEditMode?.(true);
  // 정책명 input 포커스
  setTimeout(() => {
    document.querySelector('.pt-page[data-page="policy"] [data-f="policy_name"]')?.focus();
  }, 50);
}

/* 재고관리 매물 초기화 — 입력값 모두 비움. 차량번호/공급코드/시스템 메타는 유지. */
async function resetProduct(p) {
  if (!p) return;
  const ok = await customConfirm({
    title: '매물 초기화',
    message: `${p.car_number || p.product_code} 의 입력값을 모두 비웁니다.\n차량번호 / 공급코드 / 상품코드는 유지됩니다.`,
    okLabel: '초기화', danger: true,
  });
  if (!ok) return;
  try {
    const reset = {
      maker: '', model: '', sub_model: '', trim_name: '',
      cert_car_name: '', vin: '', type_number: '', engine_type: '',
      year: null, engine_cc: null, seats: null, fuel_type: '',
      first_registration_date: '', vehicle_class: '', usage: '',
      ext_color: '', int_color: '', drive_type: '',
      vehicle_price: null, vehicle_age_expiry_date: '', location: '',
      options: [], fp_options: [],
      image_urls: [], registration_image: null, registration_type: null,
      photo_link: '', partner_memo: '',
      price: null,
      updated_at: Date.now(),
    };
    await updateRecord(`products/${p._key}`, reset);
    showToast('매물 초기화 완료', 'success');
  } catch (e) {
    console.error('[reset product]', e);
    showToast('초기화 실패: ' + (e.message || e), 'error');
  }
}

async function pastePolicy(pol) {
  if (!pol || !_policyClipboard) return;
  if (!await customConfirm({ title: '붙여넣기', message: '복사된 정책 정보를 현재 정책에 적용합니다.\n정책명/코드는 유지됩니다.\n계속할까요?', okLabel: '적용' })) return;
  try {
    await updateRecord(`policies/${pol._key}`, { ..._policyClipboard });
    showToast('붙여넣기 완료');
  } catch (e) {
    console.error('[paste policy]', e);
    showToast('붙여넣기 실패', 'error');
  }
}


/* ── 모바일 4탭 SPA — 찾기/소통/계약/설정 ──
 *  isMobile() (UA 폰 감지) 시 데스크톱 SPA 숨기고 #mobileApp 활성화.
 *  하단 탭 클릭 → 해당 mobile-*.js mount() 호출, 이전 탭 unmount().
 *  ?mobile=1 URL 파라미터로 데스크톱에서도 강제 활성화 가능 (개발용).
 */
async function initMobileShell() {
  if (!isMobileUA()) return;
  // body.is-mobile / #mobileApp 표시는 boot 단계에서 이미 동기로 처리됨
  bindGlobalHaptic();

  // 4개 탭 정의 — route → dynamic import 한 모듈
  const TABS = {
    '/search':    () => import('./pages/mobile-search.js'),
    '/workspace': () => import('./pages/mobile-workspace.js'),
    '/contract':  () => import('./pages/mobile-contract.js'),
    '/settings':  () => import('./pages/mobile-settings.js'),
  };

  let currentMod = null;
  let currentRoute = null;

  async function navigateTo(route) {
    if (route === currentRoute) return;
    if (!TABS[route]) route = '/search';
    // 이전 탭 언마운트
    try { currentMod?.unmount?.(); } catch (e) { console.warn('[mobile unmount]', e); }
    currentMod = null;
    // 새 탭 마운트
    const mod = await TABS[route]();
    try { mod.mount?.(); } catch (e) { console.error('[mobile mount]', e); }
    currentMod = mod;
    currentRoute = route;
    // 탭 활성화 표시 + 주소창 sync
    document.querySelectorAll('.m-tabbar .m-tab').forEach(a => {
      a.classList.toggle('is-active', a.dataset.route === route);
    });
    if (location.pathname !== route) history.pushState(null, '', route);
  }

  // router.js 의 navigate 헬퍼와 wire — mobile-*.js 가 다른 탭 호출할 때 사용
  const { defineRoutes, setNavigateCallback } = await import('./core/router.js');
  defineRoutes(Object.fromEntries(Object.keys(TABS).map(r => [r, () => navigateTo(r)])));
  setNavigateCallback(() => null);

  // 탭바 클릭 핸들러
  document.querySelectorAll('.m-tabbar .m-tab').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(a.dataset.route);
    });
  });
  // 뒤로가기 처리
  window.addEventListener('popstate', () => {
    const route = TABS[location.pathname] ? location.pathname : '/search';
    navigateTo(route);
  });

  // 초기 라우트 — URL 경로 우선, 없으면 /search
  const initial = TABS[location.pathname] ? location.pathname : '/search';
  navigateTo(initial);
}

async function deleteUser(id) {
  if (!id) return;
  const u = (store.users || []).find(x => x._key === id);
  if (!u) return;
  if (store.currentUser?.role !== 'admin') { showToast('admin 만 가능합니다', 'error'); return; }
  if (!await customConfirm({ message: `${u.name || u.email || '이 사용자'} 를 삭제하시겠습니까?`, danger: true, okLabel: '삭제' })) return;
  try {
    await updateRecord(`users/${id}`, { _deleted: true, updated_at: Date.now() });
    showToast('삭제됨');
  } catch (e) { showToast('삭제 실패', 'error'); }
}

// 모듈 로드 직후 한 번 — 인라인 showPage(초기) 가 refreshPageActions 정의 전에 호출됐을 수 있으므로 재호출
window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage);

/* ── Boot ── */
async function boot() {
  // 모바일 감지 → body.is-mobile + #mobileApp 표시 (auth 이전, FOUC 회피)
  if (isMobileUA()) {
    document.body.classList.add('is-mobile');
    const shell = document.getElementById('mobileApp');
    if (shell) shell.removeAttribute('hidden');
  }

  // 저장된 폰트/다크모드 즉시 적용 (FOUC 방지)
  try {
    const { applyStoredFont, applyStoredTheme } = await import('./pages/settings.js');
    applyStoredFont();
    applyStoredTheme();
  } catch (_) {}

  // 샘플 데이터 즉시 정리 — auth/hydration 동안에도 샘플이 보이지 않게
  clearSampleData();

  let user = null;
  try {
    user = await initAuth();
  } catch (e) {
    console.error('[auth] init failed', e);
  }

  // 유효한 역할을 가진 사용자만 진입 — 그 외(미가입/role 없음/비활성/대기/거부) 모두 로그인 화면
  const VALID_ROLES = ['admin', 'agent', 'agent_admin', 'agent_manager', 'provider'];
  const status = user?.status || 'active';
  const hasValidRole = user && VALID_ROLES.includes(user.role);
  const isBlocked = user && (user.is_active === false || status === 'pending' || status === 'rejected');

  if (user && hasValidRole && !isBlocked) {
    document.body.classList.remove('is-login');
    hydrateUser(user);
    startHydration();
    // 모바일(폰) UA → 4탭 SPA 활성화
    initMobileShell();
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

  // 모든 디테일 패널 (.ws4-detail .ws4-head) 우측에 닫기 버튼 자동 주입 (모르는 사용자도 발견 가능)
  ensureDetailCloseButtons();

  // 모든 초기 셋업 끝난 후 visibility 해제 (한 프레임 양보 — paint 가 동기적으로 끝나도록)
  requestAnimationFrame(() => document.body.classList.remove('is-loading'));
}

/* 디테일 패널 닫기 버튼 자동 주입 — index.html prototype 의 .ws4-detail .ws4-head 마다
 *  X 버튼 추가. 클릭 시 부모 .ws4-detail 에 .is-collapsed 토글 (CSS 로 폭 0 숨김). */
function ensureDetailCloseButtons() {
  document.querySelectorAll('.ws4-detail').forEach(panel => {
    const head = panel.querySelector(':scope > .ws4-head');
    if (!head) return;
    if (head.querySelector('.ws4-detail-close')) return;   // 이미 있음
    // index.html 에 spacer 가 있는 검색 페이지 #detailClose 같은 명시적 버튼은 건너뜀
    if (head.querySelector('#detailClose')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ws4-detail-close';
    btn.title = '패널 닫기';
    btn.setAttribute('aria-label', '패널 닫기');
    btn.innerHTML = '<i class="ph ph-x"></i>';
    btn.addEventListener('click', () => {
      panel.classList.toggle('is-collapsed');
    });
    head.appendChild(btn);
  });
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
      applySearchFilter();   // 필터 경유 — 출고불가/삭제 매물 기본 숨김 (raw 렌더 X)
      renderFilteredProducts();
    }
    renderFilteredPolicies();
    updateSidebarCounts();
    window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage);
  });
  // 상품 — search + 재고관리 양쪽 갱신
  watchCollection('products', (list) => {
    store.products = enrichProductsWithPolicy(list || [], store.policies || []);
    calibrateSearchCols(store.products);
    applySearchFilter();   // 필터 경유 — 출고불가/삭제 매물 기본 숨김 (raw 렌더 X)
    renderFilteredProducts();
    updateSidebarCounts();
    window.updateSearchStats?.();   // 토픽바 상품찾기 카운트 갱신
    window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage);
  });
  // 대화방 (업무소통) + 계약 + 정산 + 파트너 + 사용자
  watchCollection('rooms',       (list) => {
    store.rooms = list || [];
    renderFilteredRooms();
    updateSidebarCounts();
    window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage);
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
  // 역할별 서버 스코프 — 비관리자는 자기 것만 다운로드 (서버측 read 보호의 클라이언트 절반)
  const _dataScope = roleScope(store.currentUser);
  watchCollection('contracts',   (list) => { store.contracts   = list || []; renderFilteredContracts();      updateSidebarCounts(); window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage); }, { scope: _dataScope });
  watchCollection('settlements', (list) => { store.settlements = list || []; renderFilteredSettlements();    updateSidebarCounts(); window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage); }, { scope: _dataScope });
  // admin_settlements 는 관리자 전용 (read rule 도 admin) — 비관리자는 watch 안 함 (PERMISSION_DENIED 방지)
  if (store.currentUser?.role === 'admin') {
    watchCollection('admin_settlements', (list) => { store.adminSettlements = list || [];
      if (document.querySelector('.pt-page[data-page="admin-settle"]')?.classList.contains('active')) window.renderAdminSettlement?.(); });
  }
  // partners 갱신 시 dependent list 재렌더는 디바운스 (연속 변경 시 1번만)
  let _partnersRefreshT;
  const refreshPartnersDependents = () => {
    if (Array.isArray(store.products))    renderFilteredProducts();
    if (Array.isArray(store.contracts))   renderFilteredContracts();
    if (Array.isArray(store.settlements)) renderFilteredSettlements();
  };
  watchCollection('partners', (list) => {
    store.partners = list || [];
    renderFilteredPartners();
    updateSidebarCounts();
    clearTimeout(_partnersRefreshT);
    _partnersRefreshT = setTimeout(refreshPartnersDependents, 80);
    window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage);
  });
  watchCollection('users',       (list) => { store.users       = list || [];
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    // users 페이지 활성 시 상단 검색어(_globalSearch)까지 반영해 재렌더 — 데이터 갱신(역할/상태 변경 등) 후 검색 유지
    if (activePage === 'users') applyGlobalSearch(); else renderUserList(store.users);
    updateSidebarCounts(); window.refreshPageActions?.();
    if (activePage) window.updatePageStats?.(activePage); });
  // 고객 PII — 비관리자는 자기가 만든 고객만 (created_by). 전화 중복검색도 자기 고객 내에서.
  const _custScope = (store.currentUser?.role === 'admin') ? null : { field: 'created_by', value: store.currentUser?.uid || '\x00none' };
  watchCollection('customers',   (list) => { store.customers   = list || []; }, { scope: _custScope });
  // vehicle_master Firebase 컬렉션 폐기됨 — 차종 데이터는 catalog (public/data/car-master) 단일 진실원
  // catalog cascade 데이터는 src/core/catalog-source.js 에서 _index.json 로드

  bindSearchInteractions();
  bindGenericListInteractions();
  bindChatInput();
  bindGlobalSearch();
  bindRoomCreate();
  bindDirtyTracking();
  bindPhotoClicks();
  bindSearchSelection();
  setupAutoFitObserver();
  bindAdminChatButton();
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
  window.addEventListener('hashchange', async (e) => {
    if (!hasDirty()) return;
    if (await customConfirm({ title: '저장 안 됨', message: '저장하지 않은 변경이 있습니다.\n페이지를 이동할까요?', danger: true, okLabel: '이동' })) {
      clearDirty();
    } else {
      // hashchange 는 cancel 불가 → 원래 hash 로 복귀
      const oldUrl = e.oldURL;
      const oldHash = oldUrl.split('#')[1] || '';
      history.replaceState(null, '', '#' + oldHash);
    }
  });

  // 브라우저 닫기 / 새로고침 시 경고 + 미완성 draft 정리
  window.addEventListener('beforeunload', (e) => {
    discardIncompleteDrafts();   // 신규 draft 중 필수 미입력은 _deleted 마킹 (best effort)
    if (hasDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  // 브라우저 뒤로가기 / 페이지 외부 이동 시에도 정리 (popstate)
  window.addEventListener('popstate', () => { discardIncompleteDrafts(); });
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
  if (!await customConfirm({ message: '정말 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
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
    // (a) 명시적 [data-fullscreen-img] 마커 — 채팅 이미지 등 단일 이미지 풀스크린
    const directImg = e.target.closest('[data-fullscreen-img]');
    if (directImg) {
      const url = directImg.dataset.fullscreenImg;
      if (url) { openFullscreen([url], 0); return; }
    }
    // (b) 상품 상세 갤러리 메인/썸네일 — 같은 패널의 모든 사진 모아서 풀스크린
    const img = e.target.closest('img.detail-photo-main, .detail-photo-thumb img');
    if (!img) return;
    if (img.closest('.srch-fullscreen, .lightbox-overlay')) return;
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

  // 모든 페이지 공통 규격 — 레코드 전체 값 + 공급사 회사·담당자명 + 연결 정책 자동 검색 (search-match.js)
  const M = (item) => matchRecord(item, q, store);
  if (page === 'workspace')     { if (store.rooms)       renderRoomList(store.rooms.filter(M)); }
  else if (page === 'contract') { if (store.contracts)   renderContractList(store.contracts.filter(M)); }
  else if (page === 'settle')   { if (store.settlements) renderSettlementList(store.settlements.filter(M)); }
  else if (page === 'product')  { if (store.products)    renderProductList(store.products.filter(M)); }
  else if (page === 'policy')   { if (store.policies)    renderPolicyList(store.policies.filter(M)); }
  else if (page === 'partners') { if (store.partners)    renderPartnerList(store.partners.filter(M)); }
  else if (page === 'users')    { renderUserList((store.users || []).filter(M)); }
}

function bindGlobalSearch() {
  const sb = document.getElementById('ptTbSearch');
  if (!sb) return;
  // 검색창 우측 필터 아이콘 — search 페이지에서만 노출, 모바일과 동일 sheet 호출
  document.getElementById('ptTbFilterBtn')?.addEventListener('click', () => {
    openSearchFilterSheet();
  });
  // 디바운스 — 키 입력 후 120ms 멈췄을 때만 필터 실행 (타이핑 중 매 키 재렌더 차단)
  let _searchTimer = null;
  sb.addEventListener('input', (e) => {
    _globalSearch = e.target.value || '';
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(applyGlobalSearch, 120);
  });
  // 페이지 전환 시 검색어 초기화 — 이전 페이지 필터가 새 페이지에 잘못 적용되지 않게
  // (액션바는 showPage() 가 window.refreshPageActions 로 알아서 갱신 — 여기서 건드리면 중복 실행 후 빈 footer 가 됨)
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
    // 다른 record 활성화 직전 — 미입력 draft 있으면 자동 폐기 (필수 필드 모두 빈값일 때만)
    discardIncompleteDrafts();
    const list = item.parentElement;
    list.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
    item.classList.add('active');
    // 매물/정책/파트너 등 선택 변경 시 편집모드 자동 종료 — 명시적 [수정] 버튼으로만 진입
    if (document.body.classList.contains('is-edit-mode')) {
      window.toggleEditMode?.(false);
    }
    window.refreshPageActions?.();
    const activePage = document.querySelector('.pt-page.active')?.dataset.page;
    if (activePage) window.updatePageStats?.(activePage);   // 선택 바뀌면 액션바 disabled 상태 갱신

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
  if (specs.length) lines.push(specs.join(' | '));

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

  // 담당자 — 소속 | 이름 직급 | 역할 | 연락처 (현재 로그인 사용자)
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
    lines.push(`담당: ${agentParts.join(' | ')}`);
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
    const role = store.currentUser?.role;
    const isAgent = role === 'agent' || role === 'agent_admin' || role === 'admin';
    return [
      ...(isAgent ? [
        { icon: 'ph ph-chat-circle-dots', label: '소통 (대화방 생성)', action: () => searchActionChat(p) },
        { icon: 'ph ph-file-text', label: '계약 생성', action: () => searchActionContract(p) },
        { divider: true },
      ] : []),
      { icon: 'ph ph-share-network', label: '공유 (카탈로그 링크)', action: () => searchActionShare(p) },
      { icon: 'ph ph-copy', label: '상품 내용 복사', action: () => {
        const text = formatProductForCopy(p);
        navigator.clipboard?.writeText(text).then(() => {
          import('./core/toast.js').then(m => m.showToast(`상품 내용 복사됨 — ${car}`));
        });
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
      { icon: 'ph ph-star', label: '즐겨찾기', action: () => showToast('즐겨찾기 — 추후 지원 예정', 'info') },
      { divider: true },
      { icon: 'ph ph-eye-slash', label: '대화 숨김', action: async () => {
        await updateRecord(`rooms/${id}`, { [hideField]: true, updated_at: Date.now() });
      }},
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!await customConfirm({ message: '이 대화방을 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
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
        if (!await customConfirm({ message: '이 계약을 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
        await updateRecord(`contracts/${c._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'settle') {
    const s = (store.settlements || []).find(x => x._key === id);
    if (!s) return [];
    return [
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!await customConfirm({ message: '이 정산을 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
        await updateRecord(`settlements/${s._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'product') {
    const p = (store.products || []).find(x => x._key === id);
    if (!p) return [];
    const STATUS_OPTS = ['즉시출고', '출고가능', '상품화중', '출고협의', '출고불가'];
    // 정책 후보 — 차량 공급사의 정책만 (회사 일치). 빈 공급사면 disabled
    const productProvider = p.provider_company_code || p.partner_code || '';
    const policyCandidates = (store.policies || [])
      .filter(t => !t._deleted)
      .filter(t => productProvider && t.provider_company_code === productProvider)
      .map(t => ({
        code: t.policy_code || t._key,
        name: t.policy_name || t.term_name || '',
      }));
    const curPol = p.policy_code || '';
    const policyLabel = curPol
      ? `정책: ${(policyCandidates.find(o => o.code === curPol)?.name) || curPol}`
      : '정책: (미배정)';
    const policySubmenu = [
      { label: '(미배정)', active: !curPol, action: async () => {
        await updateRecord(`products/${p._key}`, { policy_code: '', updated_at: Date.now() });
        showToast('정책 미배정');
      }},
      ...(policyCandidates.length ? [{ divider: true }] : []),
      ...policyCandidates.map(o => ({
        label: o.name ? `${o.name} (${o.code})` : o.code,
        active: o.code === curPol,
        action: async () => {
          await updateRecord(`products/${p._key}`, { policy_code: o.code, updated_at: Date.now() });
          showToast(`정책 → ${o.name || o.code}`);
        },
      })),
    ];
    return [
      { icon: 'ph ph-flag', label: `상태: ${p.vehicle_status || '-'}`,
        submenu: STATUS_OPTS.map(s => ({
          label: s, active: p.vehicle_status === s,
          action: async () => {
            await updateRecord(`products/${p._key}`, { vehicle_status: s, updated_at: Date.now() });
            showToast(`상태 → ${s}`);
          },
        })),
      },
      { icon: 'ph ph-scroll', label: policyLabel,
        disabled: !productProvider,
        submenu: policySubmenu,
      },
      { divider: true },
      { icon: 'ph ph-share-network', label: '카탈로그 링크 복사', action: () => {
        // Vercel serverless(api/catalog-share)가 t/img 로 OG 메타 동적 주입
        const car = p.car_number || '';
        const title = `${car} ${p.sub_model || p.model || ''}`.trim() || '차량';
        const firstImg = (Array.isArray(p.image_urls) && p.image_urls[0]) || p.image_url || '';
        const qs = new URLSearchParams();
        if (p._key) qs.set('id', p._key);
        else if (car) qs.set('car', car);
        if (title) qs.set('t', title);
        if (firstImg) qs.set('img', firstImg);
        const url = `${location.origin}/catalog.html?${qs.toString()}`;
        navigator.clipboard?.writeText(url).then(() => {
          import('./core/toast.js').then(m => m.showToast(`상품 카탈로그 링크 복사됨 — ${car}`));
        });
      }},
      { divider: true },
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!await customConfirm({ message: '이 차량을 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
        await updateRecord(`products/${p._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'policy') {
    const pol = (store.policies || []).find(x => x._key === id);
    if (!pol) return [];
    const POLICY_STATUS = ['활성', '비활성', '준비중'];
    return [
      { icon: 'ph ph-flag', label: `상태: ${pol.status || '-'}`,
        submenu: POLICY_STATUS.map(s => ({
          label: s, active: pol.status === s,
          action: async () => {
            await updateRecord(`policies/${pol._key}`, {
              status: s,
              is_active: s === '활성',
              updated_at: Date.now(),
            });
            showToast(`상태 → ${s}`);
          },
        })),
      },
      { divider: true },
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!await customConfirm({ message: '이 정책을 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
        await updateRecord(`policies/${pol._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'partners') {
    const pa = (store.partners || []).find(x => x._key === id);
    if (!pa) return [];
    const PARTNER_TYPES = ['공급사', '영업채널', '운영사'];
    const isActive = pa.is_active !== false;
    return [
      { icon: 'ph ph-tag', label: `유형: ${pa.partner_type || '-'}`,
        submenu: PARTNER_TYPES.map(t => ({
          label: t, active: pa.partner_type === t,
          action: async () => {
            await updateRecord(`partners/${pa._key}`, { partner_type: t, updated_at: Date.now() });
            showToast(`유형 → ${t}`);
          },
        })),
      },
      { icon: isActive ? 'ph ph-pause' : 'ph ph-play', label: isActive ? '비활성화' : '활성화',
        action: async () => {
          await updateRecord(`partners/${pa._key}`, { is_active: !isActive, updated_at: Date.now() });
          showToast(isActive ? '비활성화됨' : '활성화됨');
        } },
      { divider: true },
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!await customConfirm({ message: '이 파트너를 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
        await updateRecord(`partners/${pa._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'users') {
    const u = (store.users || []).find(x => x._key === id);
    if (!u) return [];
    const ROLES = [
      { v: 'admin',       l: '관리자' },
      { v: 'provider',    l: '공급사' },
      { v: 'agent',       l: '영업자' },
    ];
    const STATUS = [
      { v: 'active',  l: '승인' },
      { v: 'pending', l: '대기' },
    ];
    const curStatus = u.status === 'pending' ? 'pending' : (u.is_active === false ? 'pending' : 'active');
    const roleLabel = ROLES.find(r => r.v === u.role)?.l || u.role || '-';
    const statusLabel = STATUS.find(s => s.v === curStatus)?.l || '-';
    return [
      { icon: 'ph ph-user-circle', label: `역할: ${roleLabel}`,
        submenu: ROLES.map(r => ({
          label: r.l, active: u.role === r.v,
          action: async () => {
            await updateRecord(`users/${u._key}`, { role: r.v, updated_at: Date.now() });
            showToast(`역할 → ${r.l}`);
          },
        })),
      },
      { icon: 'ph ph-flag', label: `상태: ${statusLabel}`,
        submenu: STATUS.map(s => ({
          label: s.l, active: curStatus === s.v,
          action: async () => {
            await updateRecord(`users/${u._key}`, {
              status: s.v,
              is_active: s.v === 'active',
              updated_at: Date.now(),
            });
            showToast(`상태 → ${s.l}`);
          },
        })),
      },
      { divider: true },
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!await customConfirm({ message: '이 사용자를 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
        await updateRecord(`users/${u._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  if (page === 'contract') {
    const c = (store.contracts || []).find(x => x.contract_code === id || x._key === id);
    if (!c) return [];
    const CONTRACT_STATUS = ['진행중', '대기', '계약체결', '심사중', '출고대기', '출고완료', '완료', '취소'];
    return [
      { icon: 'ph ph-flag', label: `상태: ${c.status || '-'}`,
        submenu: CONTRACT_STATUS.map(s => ({
          label: s, active: c.status === s,
          action: async () => {
            await updateRecord(`contracts/${c._key}`, { status: s, updated_at: Date.now() });
            showToast(`상태 → ${s}`);
          },
        })),
      },
      { divider: true },
      { icon: 'ph ph-copy', label: '계약코드 복사',
        action: () => navigator.clipboard?.writeText(c.contract_code || '').then(() => showToast('계약코드 복사됨')) },
      { divider: true },
      { icon: 'ph ph-trash', label: '삭제', danger: true, action: async () => {
        if (!await customConfirm({ message: '이 계약을 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
        await updateRecord(`contracts/${c._key}`, { _deleted: true, updated_at: Date.now() });
      }},
    ];
  }
  return [];
}


/* ── 사용자 정보 → 사이드바 brand | bottom + 역할 클래스 ── */
function hydrateUser(user) {
  const brandText = document.querySelector('.pt-sb-brand .sb-brand-text');
  if (brandText) brandText.textContent = user.company_name || 'freepass ERP';
  // user 정보 텍스트만 갱신 (로그아웃 버튼 등 다른 자식은 보존)
  const roleBase = { admin: '관리자', provider: '공급', agent: '영업', agent_admin: '영업' }[user.role] || user.role || '';
  const role = user.role === 'agent_admin' ? `${roleBase} | 관리자` : roleBase;
  const userInfo = document.querySelector('.pt-sb-user-info');
  if (userInfo) {
    userInfo.textContent = `${user.name || user.email || ''}${role ? ' | ' + role : ''}`;
  }
  // 토픽바 우측 사용자 메뉴 — 이름 | 직급 (역할 X)
  const tbUserName = document.querySelector('.pt-tb-user-name');
  if (tbUserName) tbUserName.textContent = user.name || user.email || '사용자';
  const tbUserRole = document.querySelector('.pt-tb-user-role');
  if (tbUserRole) tbUserRole.textContent = user.position || '';
  // body 에 role 클래스 — CSS 가 권한별 메뉴 가시성 처리
  document.body.classList.remove('role-admin', 'role-provider', 'role-agent', 'role-agent_admin', 'role-agent_manager');
  if (user.role) document.body.classList.add(`role-${user.role}`);
  // 시스템 관리자(이메일 화이트리스트) — 개발도구(#dev) 가시성 게이팅
  document.body.classList.toggle('is-sysadmin', isSystemAdmin(user));
}

/* ── 사이드바 카운트 자동 갱신 — "처리 필요"만 카운트. watchCollection 후 호출 ── */
function updateSidebarCounts() {
  // dot 모드 — 카운트 숫자 X, 미처리 항목 있으면 빨간 점만 (Slack/Discord 패턴, 트렌드)
  const setCnt = (page, n) => {
    const el = document.querySelector(`.pt-sb a[data-page="${page}"] .cnt`);
    if (!el) return;
    el.classList.toggle('has-unread', n > 0);
    el.textContent = '';   // textContent 비움 — CSS 가 dot 그림
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

  // 관리자 소통 — 본인 read_by 기준 안읽음 룸 수 (admin: 모든 admin-chat 룸 / 비admin: 본인 룸만).
  //  새 메시지가 도착하면 last_message_at 이 갱신되고, 사용자가 룸을 열면 read_by/${uid} 갱신 → 차이로 판정.
  const me = store.currentUser;
  const myUid = me?.uid;
  let adminChatUnread = 0;
  if (myUid) {
    const adminRooms = (store.rooms || []).filter(r => r.is_admin_chat && !r._deleted);
    const myRooms = role === 'admin' ? adminRooms : adminRooms.filter(r => r._key === `ADMIN_${myUid}`);
    adminChatUnread = myRooms.filter(r => {
      const lastAt = Number(r.last_message_at || 0);
      if (!lastAt) return false;
      // 마지막 메시지를 내가 보낸 거면 안읽음 아님
      if (r.last_sender_uid === myUid) return false;
      const myRead = Number(r.read_by?.[myUid] || 0);
      return lastAt > myRead;
    }).length;
  }
  setCnt('admin-chat', adminChatUnread);

  // 카운트 개념 없는 페이지 — 명시적으로 비움
  setCnt('search', 0);
  setCnt('product', 0);
  setCnt('policy', 0);
  setCnt('partners', 0);
}

/* ── 로그인 / 가입 / 재설정 폼 — v2 패턴 그대로 ── */
// Firebase Auth 에러 코드 → 한글 메시지 (로그인/가입/재설정 공용)
const KOREAN_AUTH_MSG = {
  'auth/invalid-credential':         '이메일 또는 비밀번호가 올바르지 않습니다',
  'auth/wrong-password':             '비밀번호가 올바르지 않습니다',
  'auth/user-not-found':             '등록되지 않은 이메일입니다',
  'auth/invalid-email':              '이메일 형식이 올바르지 않습니다',
  'auth/user-disabled':              '비활성화된 계정입니다 — 관리자에게 문의해주세요',
  'auth/too-many-requests':          '시도가 너무 많아 일시적으로 차단됐습니다. 잠시 후 다시 시도해주세요',
  'auth/network-request-failed':     '네트워크 연결을 확인 후 다시 시도해주세요',
  'auth/internal-error':             '인증 시스템 일시 오류 — 잠시 후 다시 시도해주세요',
  'auth/operation-not-allowed':      '해당 로그인 방식이 비활성화되어 있습니다',
  'auth/email-already-in-use':       '이미 사용 중인 이메일입니다',
  'auth/weak-password':              '비밀번호는 6자 이상이어야 합니다',
  'auth/missing-email':              '이메일을 입력해주세요',
  'auth/missing-password':           '비밀번호를 입력해주세요',
};
function koreanAuthMsg(err, fallbackPrefix) {
  const code = err?.code || '';
  const message = err?.message || String(err);
  return KOREAN_AUTH_MSG[code]
    || (code ? `${fallbackPrefix} — ${code}` : `${fallbackPrefix} — ${message.slice(0, 100)}`);
}

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

  // 사업자번호 자동 포맷팅 + 실시간 partners 매칭
  const bizNoInput = document.getElementById('suBizNo');
  const bizNoMatch = document.getElementById('suBizNoMatch');
  if (bizNoInput) {
    let _partnersCache = null;
    let _matchTimer = null;

    const loadPartners = async () => {
      if (_partnersCache) return _partnersCache;
      try {
        const { ref, get } = await import('firebase/database');
        const { db } = await import('./firebase/config.js');
        const snap = await get(ref(db, 'partners'));
        _partnersCache = snap.val() || {};
      } catch (e) {
        console.warn('[bizNo match] partners 로드 실패', e?.code || e?.message || e);
        _partnersCache = {};
      }
      return _partnersCache;
    };

    const setMatch = (text, cls) => {
      if (!bizNoMatch) return;
      bizNoMatch.textContent = text;
      bizNoMatch.classList.remove('is-ok', 'is-miss');
      if (cls) bizNoMatch.classList.add(cls);
    };

    const ROLE_LABEL = { provider: '공급사', sales_channel: '영업채널', operator: '운영사' };

    const matchBizNo = async (digits) => {
      if (digits.length < 10) { setMatch('', ''); return; }
      const partners = await loadPartners();
      let found = null;
      for (const [k, p] of Object.entries(partners)) {
        if (!p || p._deleted) continue;
        const pn = String(p.business_number || '').replace(/\D/g, '');
        if (pn && pn === digits) { found = { ...p, partner_code: p.partner_code || k }; break; }
      }
      if (!found) { setMatch('일치하는 회사 없음 — 임시소속(SP999)으로 등록됩니다', 'is-miss'); return; }
      const name = found.partner_name || found.company_name || found.partner_code;
      const typeLabel = ROLE_LABEL[found.partner_type] || found.partner_type || '';
      setMatch(`✓ 매칭: ${name} (${found.partner_code})${typeLabel ? ` — ${typeLabel}` : ''}`, 'is-ok');
    };

    bizNoInput.addEventListener('input', (e) => {
      const d = e.target.value.replace(/\D/g, '').slice(0, 10);
      let f = d;
      if (d.length > 5) f = `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}`;
      else if (d.length > 3) f = `${d.slice(0,3)}-${d.slice(3)}`;
      if (f !== e.target.value) e.target.value = f;
      // 매칭 — 10자리 도달 시 디바운스 후 조회
      if (_matchTimer) clearTimeout(_matchTimer);
      _matchTimer = setTimeout(() => matchBizNo(d), 200);
    });
  }

  // 로그인
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;
    const email = document.getElementById('loginEmail').value.trim();
    const pw = document.getElementById('loginPw').value;
    const msg = document.getElementById('loginMsg');
    if (msg) msg.textContent = '';
    if (submitBtn) submitBtn.disabled = true;
    try {
      await fbLogin(email, pw);
      location.hash = 'search';
      location.reload();
    } catch (err) {
      console.error('[login fail]', err);
      if (msg) msg.textContent = koreanAuthMsg(err, '로그인 실패');
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
    const submitBtn = signupForm.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;
    const email = document.getElementById('suEmail').value.trim();
    const pw = document.getElementById('suPw').value;
    const msg = document.getElementById('signupMsg');
    if (msg) { msg.style.color = ''; msg.textContent = ''; }
    if (!email || !pw || pw.length < 6) { if (msg) msg.textContent = '이메일·비밀번호(6자 이상) 필수'; return; }
    if (submitBtn) submitBtn.disabled = true;
    try {
      const { signup } = await import('./firebase/auth.js');
      const { saveUserProfile } = await import('./firebase/collections.js');
      const user = await signup(email, pw);
      // role / company_code 는 가입 시 안 받음 — saveUserProfile 이 SP999/agent 로 강제 (admin 승인 시 재지정)
      // 사업자번호(business_no)는 admin 이 승인 시 partner 매칭 참고용
      await saveUserProfile(user.uid, {
        email,
        name: document.getElementById('suName').value.trim(),
        phone: document.getElementById('suPhone').value.trim(),
        company_name: document.getElementById('suCompany').value.trim(),
        business_no: document.getElementById('suBizNo').value.trim().replace(/[^\d]/g, ''),
      });
      // 즉시 로그인 진입 (login 핸들러와 동일 패턴)
      showToast('가입 완료', 'success');
      location.hash = 'search';
      location.reload();
    } catch (err) {
      console.error('[signup]', err);
      if (msg) msg.textContent = koreanAuthMsg(err, '가입 실패');
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // 비밀번호 재설정
  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = resetForm.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;
    const email = document.getElementById('rpEmail').value.trim();
    const msg = document.getElementById('resetMsg');
    if (msg) { msg.style.color = ''; msg.textContent = ''; }
    if (!email) { if (msg) msg.textContent = '이메일을 입력해주세요'; return; }
    if (submitBtn) submitBtn.disabled = true;
    try {
      const { resetPassword } = await import('./firebase/auth.js');
      await resetPassword(email);
      if (msg) { msg.style.color = 'var(--accent-green)'; msg.textContent = '재설정 메일 전송됨. 이메일을 확인하세요.'; }
      // 성공 시 버튼 그대로 disable 유지 (같은 메일 여러번 보내지 않도록)
    } catch (err) {
      console.error('[reset]', err);
      if (msg) msg.textContent = koreanAuthMsg(err, '전송 실패');
      if (submitBtn) submitBtn.disabled = false;
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

  // 사이드바 하단 설정 버튼 — 설정 페이지로 이동
  document.getElementById('btnSettings')?.addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = 'settings';
  });

}

boot();
