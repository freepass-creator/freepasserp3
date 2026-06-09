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
import { store, findProduct } from '../core/store.js';
import { productImages, productExternalImages, supportedDriveSource, toProxiedImage } from '../core/product-photos.js';
import { extractProductDetailRows } from '../core/product-detail-rows.js';
import { composeVehicleName } from '../core/product-detail-render.js';
import { downloadExcelWithFilter, PRODUCT_COLS, PRODUCT_FILTER_FIELDS, enrichProductsWithPolicy } from '../core/excel-export.js';
import { showToast } from '../core/toast.js';
import {
  esc, shortStatus, mapStatusDot, fmtMileage, normalizeVehicleStatus,
  providerNameByCode, providerLabelByCode, fmtMoneyMan,
} from '../core/ui-helpers.js';
import { FP_POPULAR_PRIMARY, FP_POPULAR_SECONDARY } from '../core/fp-options-master.js';
import { findCatalog } from '../core/vehicle-matrix.js';
import { FILTERS, matchFilter } from '../core/product-filters.js';
import { creditGradeBadge } from '../core/product-badges.js';

/* 외부 주입 콜백 — workspace 가 createRoomFromProduct 를 setSearchCallbacks 로 주입 */
let _onCreateRoom = null;
export function setSearchCallbacks({ onCreateRoom }) {
  _onCreateRoom = onCreateRoom;
}

/* 토픽바 — 상품찾기 페이지 제목 옆 상태별 카운트 (총/즉시/가능/협의/불가).
 *  filteredList 인자 주면 그 카운트를 "검색결과 N대" 로 추가 표시.
 *  app.js 의 products watcher 에서 호출. showPage('search') 진입 시도 호출.
 *  renderSearchTable 에서 필터된 list 길이와 함께 호출. */
export function updateSearchStats(filteredList) {
  const el = document.getElementById('ptTbSearchStats');
  if (!el) return;
  // 출고불가 제외 — 즉시·가능·협의 만 카운트 (불가는 상품찾기 페이지에서 숨김)
  const products = (store.products || []).filter(p => {
    if (p._deleted || p.status === 'deleted') return false;
    return shortStatus(p.vehicle_status || '') !== '불가';
  });
  const total = products.length;
  const counts = { '즉시': 0, '가능': 0, '협의': 0 };
  for (const p of products) {
    const s = shortStatus(p.vehicle_status || '');
    if (counts[s] !== undefined) counts[s]++;
  }
  // 필터 / 검색어 적용된 결과 카운트 (filteredList 가 store.products 와 다를 때만 표시)
  const isFilteredView = Array.isArray(filteredList) && filteredList.length !== total;
  const filteredHtml = isFilteredView
    ? `<span class="stat-filtered">검색 ${filteredList.length}대</span>`
    : '';
  el.innerHTML = `
    ${filteredHtml}
    <span class="stat-total">총 ${total}대</span>
    <span class="stat-즉시">즉시 ${counts['즉시']}</span>
    <span class="stat-가능">가능 ${counts['가능']}</span>
    <span class="stat-협의">협의 ${counts['협의']}</span>
  `;
}
// 다른 모듈에서 호출하기 쉽게 window 에도 노출 (showPage non-module 스크립트용)
if (typeof window !== 'undefined') window.updateSearchStats = updateSearchStats;

/* search 페이지 필터 상태 — bindGlobalSearch 등 외부 모듈에서 search 만 갱신.
 *  대여료/보증금 구간은 activeFilters['rent'] / ['deposit'] (range 객체) 로 통일됨. */
export const _searchFilter = {
  chip: 'all',
  search: '',
  column: {},
  quick: new Set(),                  // 하단 퀵필터 (new/used/age26)
  fpOptions: new Set(),              // 표준옵션 필수 (예: VENT_SEAT_DR, HUD)
  activeFilters: {},                 // 시트 그룹 필터 — chip(Set) / range({min,max})
};
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
    p => normalizeVehicleStatus(p.vehicle_status || ''),
    p => p.product_type,
    p => p.maker,
    p => p.model,
    p => p.sub_model,
    p => p.variant,
    p => p.trim_name || p.trim,
    p => Array.isArray(p.options) ? p.options.join('·') : p.options,
    p => String(p.year || ''),
    p => fmtMileage(p.mileage),
    p => p.fuel_type,
    p => p.ext_color,
    p => (p._policy && (p._policy.credit_grade || p._policy.screening_criteria)) || p.credit_grade,
  ];
  const HEADER_LABELS = ['차량번호','상태','구분','제조사','모델명','세부모델','파워트레인','세부트림','선택옵션','연식','주행','연료','색상','심사'];
  const HAS_FILTER = [false, true, true, true, true, true, true, true, true, true, true, true, true, true];
  const STATUS_DOT = 10;
  // 차량번호(idx 0): max 포맷 "000가0000" (7 ASCII + 1 한글) bold = ~64px + padding 16 → 80px 면 충분
  const MIN_WIDTHS = [80, 72, 44, 44, 56, 60, 70, 56, 80, 40, 48, 48, 40, 44];
  // 공급사 컬럼은 마지막에 100px 고정 (한글 회사명 4-7자 fit)

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
    // 차량번호(idx 0)는 bold 라 글자폭 ~12% 더 큼 — 보정
    const boldFactor = idx === 0 ? 1.12 : 1;
    const extra = 16 + (HAS_FILTER[idx] ? 14 : 0) + (idx === 1 ? STATUS_DOT : 0);
    return Math.max(MIN_WIDTHS[idx], Math.ceil(baseW * boldFactor + extra));
  });
  // 옵션 (idx 8) — outlier 영향 줄이려고 세부트림(7) × 1.3 강제 (파워트레인 추가로 인덱스 +1)
  widths[8] = Math.round(widths[7] * 1.3);
  // 차량번호 (idx 0) — 최대 포맷 "000가0000" 고정. 데이터가 짧아도 길어도 80 고정
  widths[0] = 80;
  widths.forEach((w, idx) => cols[idx]?.style.setProperty('width', w + 'px'));
}

export function renderSearchTable(products) {
  const tbody = document.querySelector('[data-page="search"] .table tbody');
  if (!tbody) return;
  // 토픽바 카운트 — 필터된 결과 길이 반영
  updateSearchStats(products || []);
  if (!products || !products.length) {
    tbody.innerHTML = '<tr><td colspan="22" class="empty-state" style="text-align:center; padding:24px; color:var(--text-muted);">표시할 상품이 없습니다</td></tr>';
    return;
  }
  // 재렌더 전 현재 선택 row 의 product key 보존 — partners 갱신 등으로 재렌더 시 선택 유지
  const prevSelectedId = tbody.querySelector('tr.selected')?.dataset.id;
  tbody.innerHTML = products.map(renderSearchRow).join('');
  // 이전 선택 복원, 없으면 첫 row
  const restored = prevSelectedId ? tbody.querySelector(`tr[data-id="${prevSelectedId}"]`) : null;
  const target = restored || tbody.querySelector('tr');
  if (target) {
    target.classList.add('selected');
    const p = findProduct(target.dataset.id);
    // detail 패널이 열려있을 때만 재렌더 (closed 상태에서 reset 방지)
    const ws4 = document.querySelector('[data-page="search"] .ws4');
    const isOpen = ws4 && !ws4.classList.contains('is-collapsed');
    if (p && (isOpen || !restored)) renderSearchDetail(p);
  }
  // 선택옵션 셀 cramped 동적 토글 제거 — 매물 수만큼 scrollHeight 측정이 강제 reflow 유발해 페이지 먹통.
  // CSS 의 line-clamp 로 정적 처리 (col-options 셀 안의 chip 들이 N줄 초과하면 자동 잘림).
}

function renderSearchRow(p) {
  const status = p.vehicle_status || '대기';
  const stFull = normalizeVehicleStatus(status);   // 5종 풀 라벨
  const credit = (p._policy && (p._policy.screening_criteria || p._policy.credit_grade)) || p.screening_criteria || p.credit_grade || '-';
  const creditBadge = creditGradeBadge(p) || '<span class="dim">-</span>';
  const optsArr = Array.isArray(p.options)
    ? p.options
    : (p.options ? String(p.options).split(/[,/]+/).map(s => s.trim()).filter(Boolean) : []);   // 콤마·슬래시만
  const opts = optsArr.length ? optsArr.join(' ') : '-';
  const optsHtml = optsArr.length
    ? optsArr.map(o => `<span class="chip">${esc(o)}</span>`).join('')
    : '<span class="dim">-</span>';
  const maker = p.maker || '-';
  const model = p.model || '-';
  const subModel = p.sub_model || '-';
  const variant = p.variant || '-';   // 파워트레인
  const trim = p.trim_name || p.trim || '-';
  const fuelB = fuelBadge(p.fuel_type);
  const providerName = providerNameByCode(p.provider_company_code || p.partner_code, store) || '-';
  return `
    <tr data-id="${p._key}">
      <td class="sticky-col" title="${esc(p.car_number || '')}">${p.car_number || '-'}</td>
      <td class="center" title="${esc(status)}"><span class="status-chip ${esc(stFull)}">${esc(stFull)}</span></td>
      <td class="center" title="${esc(p.product_type || '')}">${p.product_type || '-'}</td>
      <td title="${esc(maker)}">${makerBadge(maker)}</td>
      <td title="${esc(model)}">${model}</td>
      <td title="${esc(subModel)}">${subModel}</td>
      <td title="${esc(variant)}">${variant}</td>
      <td title="${esc(trim)}">${trim}</td>
      <td class="col-options" title="${esc(opts)}">${optsHtml}</td>
      <td class="center">${p.year || '-'}</td>
      <td class="num">${fmtMileage(p.mileage)}</td>
      <td class="center col-tight" title="${esc(p.fuel_type || '')}">${fuelB}</td>
      <td class="center col-tight" title="${esc(p.ext_color || '')}">${colorBadge(p.ext_color)}</td>
      <td class="center col-tight" title="${esc(p.int_color || '')}">${colorBadge(p.int_color)}</td>
      <td class="center" title="${esc(credit)}">${creditBadge}</td>
      <td class="num" data-period="1m">${fmtPricePair(p.price?.['1'])}</td>
      <td class="num" data-period="12m">${fmtPricePair(p.price?.['12'])}</td>
      <td class="num" data-period="24m">${fmtPricePair(p.price?.['24'])}</td>
      <td class="num" data-period="36m">${fmtPricePair(p.price?.['36'])}</td>
      <td class="num" data-period="48m">${fmtPricePair(p.price?.['48'])}</td>
      <td class="num" data-period="60m">${fmtPricePair(p.price?.['60'])}</td>
      <td title="${esc(p.provider_company_code || '')}">${esc(providerName)}</td>
    </tr>`;
}

function fmtPricePair(v) {
  if (!v || !Number(v.rent)) return '<span style="color:var(--text-muted);">-</span>';
  const r = Math.round(Number(v.rent) / 10000);
  const d = Math.round(Number(v.deposit || 0) / 10000);
  return `<span class="price-pair"><span class="rent">${r}<span class="unit">만</span></span><span class="sep">/</span><span class="dep">${d || 0}<span class="unit">만</span></span></span>`;
}

/* 색상명 → [hex, 한글 2자 라벨]. 색칩에 2글자로 표기 */
const COLOR_MAP = {
  '검정':   ['#1a1a1a', '검정'], '검은':   ['#1a1a1a', '검정'], '흑색': ['#1a1a1a', '검정'], '블랙': ['#1a1a1a', '검정'], 'black': ['#1a1a1a', '검정'],
  '흰':     ['#ffffff', '흰색'], '흰색':   ['#ffffff', '흰색'], '백색': ['#ffffff', '흰색'], '화이트': ['#ffffff', '흰색'], 'white': ['#ffffff', '흰색'],
  '회':     ['#9ca3af', '회색'], '회색':   ['#9ca3af', '회색'], '그레이': ['#9ca3af', '회색'], '쥐색': ['#9ca3af', '회색'], 'gray': ['#9ca3af', '회색'], 'grey': ['#9ca3af', '회색'],
  '은':     ['#c0c0c0', '은색'], '은색':   ['#c0c0c0', '은색'], '실버': ['#c0c0c0', '은색'], 'silver': ['#c0c0c0', '은색'],
  '빨강':   ['#dc2626', '빨강'], '적색':   ['#dc2626', '빨강'], '레드': ['#dc2626', '빨강'], '빨간': ['#dc2626', '빨강'], 'red': ['#dc2626', '빨강'],
  '파랑':   ['#2563eb', '파랑'], '청색':   ['#2563eb', '파랑'], '블루': ['#2563eb', '파랑'], '파란': ['#2563eb', '파랑'], 'blue': ['#2563eb', '파랑'],
  '초록':   ['#16a34a', '초록'], '녹색':   ['#16a34a', '초록'], '그린': ['#16a34a', '초록'], 'green': ['#16a34a', '초록'],
  '노랑':   ['#facc15', '노랑'], '황색':   ['#facc15', '노랑'], '옐로우': ['#facc15', '노랑'], '노란': ['#facc15', '노랑'], 'yellow': ['#facc15', '노랑'],
  '주황':   ['#f97316', '주황'], '오렌지': ['#f97316', '주황'], 'orange': ['#f97316', '주황'],
  '갈색':   ['#78350f', '갈색'], '브라운': ['#78350f', '갈색'], '밤색': ['#78350f', '갈색'], 'brown': ['#78350f', '갈색'],
  '베이지': ['#e8d6b3', '베이'], 'beige': ['#e8d6b3', '베이'],
  '아이보리': ['#fffff0', '아이'], 'ivory': ['#fffff0', '아이'],
  '미색':   ['#ffffff', '미색'],
  'cream':  ['#f5e9c8', '미색'],
  '네이비': ['#1e3a8a', '네이'], '남색':   ['#1e3a8a', '남색'], 'navy': ['#1e3a8a', '네이'],
  '보라':   ['#7c3aed', '보라'], '자주':   ['#7c3aed', '자주'], '퍼플': ['#7c3aed', '보라'], 'purple': ['#7c3aed', '보라'],
  '핑크':   ['#ec4899', '핑크'], '분홍':   ['#ec4899', '분홍'], 'pink': ['#ec4899', '핑크'],
  '하늘':   ['#7dd3fc', '하늘'], '스카이': ['#7dd3fc', '하늘'], 'sky': ['#7dd3fc', '하늘'],
  '카키':   ['#84cc16', '카키'], 'khaki': ['#84cc16', '카키'],
  '와인':   ['#7f1d1d', '와인'], 'wine': ['#7f1d1d', '와인'],
  '진주':   ['#f5e6e8', '진주'], '펄':     ['#f5e6e8', '진주'], 'pearl': ['#f5e6e8', '진주'],
};

/* hex 명도 판정 (YIQ) — 텍스트 색을 흰/검으로 자동 결정 */
function isLightHex(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

/* 색상 → 색칩 (배경=실제색, 안에 한글 약어 1자). 연료뱃지 동일 규격
   매칭 안 되면 회색 bg + 입력 첫 1자 fallback. 빈값은 dashed empty */
function colorBadge(name) {
  if (!name) return '<span class="color-badge color-badge-empty"></span>';
  const s = String(name).trim();
  if (!s) return '<span class="color-badge color-badge-empty"></span>';
  let entry = COLOR_MAP[s] || COLOR_MAP[s.toLowerCase()];
  if (!entry) {
    const lower = s.toLowerCase();
    const keys = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      if (lower.includes(k) || s.includes(k)) { entry = COLOR_MAP[k]; break; }
    }
  }
  if (entry) {
    const [hex, lb] = entry;
    const isLight = isLightHex(hex);
    const txtColor = isLight ? '#1a1a1a' : '#ffffff';
    const lightCls = isLight ? ' is-light' : '';
    return `<span class="color-badge${lightCls}" style="background:${hex};color:${txtColor};" title="${esc(s)}">${lb}</span>`;
  }
  // 매핑 실패 — 회색 bg + 입력 첫 2자
  const fallback = esc(s.slice(0, 2));
  return `<span class="color-badge color-badge-text" title="${esc(s)}">${fallback}</span>`;
}

/* 유종 → 알파벳 1자 (박스 없음). G(가솔린) D(디젤) L(LPG) H(하이브리드) E(전기) O(수소) */
function fuelBadge(s) {
  if (!s) return '<span class="fuel-letter" style="color:var(--text-muted);">-</span>';
  const t = String(s);
  let key = '';
  if (/가솔린|gas/i.test(t)) { key = 'G'; }
  else if (/디젤|diesel/i.test(t)) { key = 'D'; }
  else if (/lpg|엘피지/i.test(t)) { key = 'L'; }
  else if (/하이브리드|hybrid/i.test(t)) { key = 'H'; }
  else if (/전기|ev|electric/i.test(t)) { key = 'E'; }
  else if (/수소|hydrogen/i.test(t)) { key = 'O'; }
  return `<span class="fuel-letter" title="${esc(t)}">${key || esc(t.slice(0, 1))}</span>`;
}

/* 제조사 → 풀네임 + 브랜드 색상 hint (굴림 12px 4자도 60px 컬럼 fit) */
const MAKER_MAP = {
  '현대':     { k: '현대',     c: '#0033A0' },
  '기아':     { k: '기아',     c: '#C8102E' },
  '제네시스': { k: '제네시스', c: '#1c1c1c' },
  '쌍용':     { k: '쌍용',     c: '#003a70' },
  'KGM':      { k: 'KGM',      c: '#003a70' },
  'BMW':      { k: 'BMW',      c: '#1c69d4' },
  '벤츠':     { k: '벤츠',     c: '#1c1c1c' },
  '아우디':   { k: '아우디',   c: '#bb0a30' },
  '폭스바겐': { k: '폭스바겐', c: '#001e50' },
  '볼보':     { k: '볼보',     c: '#003057' },
  '렉서스':   { k: '렉서스',   c: '#1c1c1c' },
  '도요타':   { k: '도요타',   c: '#eb0a1e' },
  '혼다':     { k: '혼다',     c: '#cc0000' },
  '닛산':     { k: '닛산',     c: '#c3002f' },
  '포드':     { k: '포드',     c: '#003478' },
  '쉐보레':   { k: '쉐보레',   c: '#d4a017' },
  '지프':     { k: '지프',     c: '#3a5f0b' },
  '미니':     { k: '미니',     c: '#1c1c1c' },
};
function makerBadge(maker) {
  if (!maker || maker === '-') return '<span style="color:var(--text-muted);">-</span>';
  const m = MAKER_MAP[maker];
  if (!m) return esc(maker);
  return `<span class="maker-badge" style="--mc:${m.c};" title="${esc(maker)}">${esc(m.k)}</span>`;
}

/* ──────── B. 상세 패널 (다른 페이지에서도 호출됨) ──────── */

/* options.skipHead — 헤드 건드리지 않음 (워크스페이스 차량정보 카드 등) */
/* 현재 search 페이지에서 선택된 상품 — 하단 액션바가 참조 */
let _activeSearchProduct = null;
export function getActiveSearchProduct() { return _activeSearchProduct; }

/* 소통(채팅방 생성) — 하단 액션바에서 호출 */
export function searchActionChat(p) {
  if (!p) return;
  _onCreateRoom?.(p);
}

/* 계약 생성 — 하단 액션바에서 호출 (가계약 + 계약 페이지로 이동) */
export async function searchActionContract(p) {
  if (!p) return;
  const me = store.currentUser || {};
  if (!me.uid) { showToast('계약 생성 실패: 로그인 정보 없음 — 새로고침 후 재시도', 'error'); return; }
  if (!(me.role === 'admin' || me.role === 'agent' || me.role === 'agent_admin')) {
    showToast(`계약 생성 권한 없음 (현재 역할: ${me.role || '미지정'})`, 'error'); return;
  }
  // store/auth uid 일치 검증 — Firebase rule PERMISSION_DENIED 사전 차단
  try {
    const { auth } = await import('../firebase/config.js');
    const realAuthUid = auth.currentUser?.uid;
    if (realAuthUid && realAuthUid !== me.uid) {
      showToast(`UID 불일치 — 재로그인 필요`, 'error'); return;
    }
  } catch (_) {}
  const { pickOrCreateCustomer, pickAgent } = await import('../core/dialogs.js');

  // 관리자는 영업자 배정 — 어느 영업자의 계약인지 선택
  let assignedAgent = null;
  if (me.role === 'admin') {
    assignedAgent = await pickAgent();
    if (!assignedAgent) return;     // 취소
  }

  const r = await pickOrCreateCustomer(p);
  if (!r) return;

  let step = 'init';
  try {
    const { pushRecord } = await import('../firebase/db.js');
    const { makeTempContractCode } = await import('./contract.js');
    let customerKey = r._key;
    if (!r._existing) {
      step = 'customer';
      customerKey = await pushRecord('customers', {
        name: r.name, phone: r.phone, birth: r.birth,
        is_business: !!r.is_business,
        business_number: r.business_number || '',
        company_name: r.company_name || '',
        created_by: me.uid,
      });
    }
    if (!customerKey) throw new Error('customerKey 발급 실패');

    step = 'contract';
    const tempCode = await makeTempContractCode();
    await pushRecord('contracts', {
      contract_code: tempCode,
      is_draft: true,
      contract_status: '계약요청',
      customer_uid: customerKey,
      customer_name: r.name,
      customer_phone: r.phone,
      customer_birth: r.birth,
      customer_is_business: !!r.is_business,
      product_uid: p._key,
      product_code: p.product_code || '',
      car_number_snapshot: p.car_number || '',
      maker_snapshot: p.maker || '',
      model_snapshot: p.model || '',
      sub_model_snapshot: p.sub_model || '',
      fuel_type_snapshot: p.fuel_type || '',
      year_snapshot: p.year || '',
      ext_color_snapshot: p.ext_color || '',
      rent_month_snapshot: Number(r.contract_period) || 0,
      rent_amount_snapshot: r.contract_rent || 0,
      deposit_amount_snapshot: r.contract_deposit || 0,
      policy_code: p.policy_code || (p._policy?.policy_code) || '',
      policy_name_snapshot: p._policy?.policy_name || p.policy_name || '',
      provider_company_code: p.provider_company_code || '',
      partner_code: p.partner_code || p.provider_company_code || '',
      // 관리자가 만들면 선택된 영업자 정보로, 영업자가 만들면 본인 정보로
      agent_uid: assignedAgent?.uid || me.uid,
      agent_name: assignedAgent?.name || me.name || '',
      agent_code: assignedAgent?.user_code || me.user_code || '',
      agent_channel_code: assignedAgent?.agent_channel_code || assignedAgent?.channel_code || assignedAgent?.company_code
        || me.agent_channel_code || me.channel_code || me.company_code || '',
      created_by: me.uid,
    });
    showToast(`가계약 생성됨 — ${tempCode} (완료 시 실코드 부여)`, 'success');
    location.hash = 'contract';
  } catch (e) {
    console.error(`[contract create:${step}]`, e);
    const errMsg = e.code === 'PERMISSION_DENIED'
      ? `권한 거부 (${step} 단계) — Firebase rule 확인 필요`
      : `${step} 실패: ${e.code || e.message || e}`;
    showToast('계약 생성 실패 — ' + errMsg, 'error');
  }
}

/* 공유(카탈로그 링크 클립보드 복사) — 하단 액션바에서 호출
 * Vercel serverless(api/catalog-share)가 t/img 로 OG 메타 동적 주입 → 카톡 미리보기에 차량명+사진 */
export async function searchActionShare(p) {
  if (!p) return;
  const me = store.currentUser || {};
  const car = p.car_number || '';
  const title = `${car} ${p.sub_model || p.model || ''}`.trim() || '차량';
  const firstImg = (Array.isArray(p.image_urls) && p.image_urls[0]) || p.image_url || '';
  const qs = new URLSearchParams();
  if (me.user_code) qs.set('a', me.user_code);
  if (p._key) qs.set('id', p._key);
  else if (car) qs.set('car', car);
  if (title) qs.set('t', title);
  if (firstImg) qs.set('img', firstImg);
  const url = `${location.origin}/catalog.html?${qs.toString()}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast(`상품 카탈로그 링크 복사됨 — ${car || p._key}`, 'success');
  } catch {
    prompt('아래 링크를 복사하세요 (Ctrl+C):', url);
  }
}

/* 퀵 필터 토글 (신차/중고/만26세) — 하단 액션바에서 호출.
 *  대여료/보증금 구간은 [퀵필터] 시트의 슬라이더에서 처리 (openSearchFilterSheet). */
export function searchToggleQuickFilter(key) {
  const set = _searchFilter.quick;
  if (set.has(key)) set.delete(key); else set.add(key);
  if (key === 'new' && set.has('new')) set.delete('used');
  if (key === 'used' && set.has('used')) set.delete('new');
  applySearchFilter();
  window.refreshPageActions?.('search');
}

/** 퀵 필터 활성 상태 — 액션바에서 chip 의 active 표시용 */
export function isQuickFilterActive(key) {
  return _searchFilter.quick.has(key);
}

/** 모든 필터 일괄 해제 — 전체 chip 클릭 시 호출 */
export function clearAllSearchFilters() {
  _searchFilter.quick.clear();
  if (_searchFilter.fpOptions) _searchFilter.fpOptions.clear();
  // 시트에서 토글한 그룹 필터도 모두 해제 (range 는 객체, chip 그룹은 Set)
  const af = _searchFilter.activeFilters || {};
  for (const k of Object.keys(af)) {
    af[k] = (FILTERS[k]?.type === 'range') ? null : new Set();
  }
  applySearchFilter();
  window.refreshPageActions?.('search');
}

/** 표준옵션 필터 토글 — 외부에서 호출 (예: 액션바 또는 모달) */
export function toggleSearchFpOption(fpId) {
  if (!_searchFilter.fpOptions) _searchFilter.fpOptions = new Set();
  if (_searchFilter.fpOptions.has(fpId)) _searchFilter.fpOptions.delete(fpId);
  else _searchFilter.fpOptions.add(fpId);
  applySearchFilter();
  window.refreshPageActions?.('search');
}
if (typeof window !== 'undefined') window.toggleSearchFpOption = toggleSearchFpOption;

/** 기간 컬럼 표시/숨김 토글 — 하단 액션바에서 호출 */
const PERIOD_KEY_GLOBAL = 'srch.period.hidden';
export function searchTogglePeriod(period) {
  const hidden = new Set(JSON.parse(localStorage.getItem(PERIOD_KEY_GLOBAL) || '[]'));
  if (hidden.has(period)) hidden.delete(period); else hidden.add(period);
  localStorage.setItem(PERIOD_KEY_GLOBAL, JSON.stringify([...hidden]));
  // 컬럼 표시/숨김 적용 (bindPeriodToggles 의 applyAll 과 동일)
  const table = document.querySelector('[data-page="search"] table.table-fixed');
  if (table) {
    const idxOf = (p) => ['1m','12m','24m','36m','48m','60m'].indexOf(p);
    const colIdx = idxOf(period);
    if (colIdx >= 0) {
      const PERIOD_OFFSET = 15;   // 기간 컬럼 시작 위치 (콘텐츠 컬럼 다음 — 파워트레인 추가로 14→15)
      const realIdx = PERIOD_OFFSET + colIdx;
      const cols = table.querySelectorAll('colgroup col');
      const ths = table.querySelectorAll('thead th');
      const trs = table.querySelectorAll('tbody tr');
      const visible = !hidden.has(period);
      if (cols[realIdx]) cols[realIdx].style.width = visible ? '52px' : '0';
      if (ths[realIdx]) ths[realIdx].style.display = visible ? '' : 'none';
      trs.forEach(tr => { const td = tr.children[realIdx]; if (td) td.style.display = visible ? '' : 'none'; });
    }
  }
  window.refreshPageActions?.('search');
}
export function isPeriodVisible(period) {
  const hidden = new Set(JSON.parse(localStorage.getItem(PERIOD_KEY_GLOBAL) || '[]'));
  return !hidden.has(period);
}

/** 엑셀 다운로드 — 현재 필터된 결과 */
export async function searchExportExcel() {
  const list = filterProductsExcept(null);
  if (!list.length) { showToast('다운로드할 차량이 없습니다', 'error'); return; }
  try {
    const enriched = enrichProductsWithPolicy(list, store.policies || []);
    await downloadExcelWithFilter('차량목록', PRODUCT_COLS, enriched, PRODUCT_FILTER_FIELDS, {
      baseUrl: location.origin,
    });
  } catch (e) {
    console.error('[srchExcel]', e);
    showToast('엑셀 다운로드 실패 — ' + (e.message || e), 'error');
  }
}

/** 사진 ZIP 다운로드 — 현재 필터된 결과 */
export function searchDownloadPhotoZip() {
  openPhotoZipDialog(filterProductsExcept(null));
}

export function renderSearchDetail(p, targetCard, options = {}) {
  const card = targetCard || document.querySelectorAll('.pt-page[data-page="search"] .ws4-card')[1];
  if (!card) return;
  _activeSearchProduct = p;                                    // 하단 액션바 참조
  // 액션바 갱신 — 현재 search 페이지에 있을 때만 (다른 페이지 새로고침 시 boot 의 renderSearchTable 가 호출하면 액션바가 search 로 덮어쓰는 버그 방지)
  if (document.querySelector('.pt-page.active')?.dataset.page === 'search') {
    window.refreshPageActions?.('search');
  }
  const role = store.currentUser?.role;
  const isAdmin = role === 'admin';
  const canSeeFee = isAdmin || role === 'agent' || role === 'agent_admin';
  const pol = p._policy || p.policy || {};
  const policyName = pol.policy_name || p.policy_name || '';

  // 헤더 — search 페이지에서만 갱신
  if (!options.skipHead) {
    const head = card.querySelector('.ws4-head');
    if (head) {
      head.innerHTML = `
        <button class="pt-sb-toggle" id="detailClose" title="상세 패널 접기"><i class="ph ph-caret-right"></i></button>
        <span style="color: var(--text-main);">${esc(p.car_number || '-')}</span>
        <span class="text-sub">${esc([p.maker, p.model, p.sub_model].filter(Boolean).join(' '))}</span>
        <button class="ws4-head-close" id="detailCloseX" title="상세 패널 닫기" aria-label="닫기"><i class="ph ph-x"></i></button>
      `;
      const toggleCollapse = () => document.querySelector('[data-page="search"] .ws4')?.classList.toggle('is-collapsed');
      head.querySelector('#detailClose')?.addEventListener('click', toggleCollapse);
      head.querySelector('#detailCloseX')?.addEventListener('click', toggleCollapse);
      // 하단바 액션 — 더 이상 패널 footer 에 박지 않음. 전역 하단 액션바(setPageActions) 사용.
      const foot = card.querySelector('.ws4-foot[data-foot="search-detail"]');
      if (foot) foot.innerHTML = '';
    }
  }

  const imgs = [...new Set([...productImages(p), ...productExternalImages(p)])].map(toProxiedImage);
  const driveSrc = supportedDriveSource(p);
  // 디버그 — 어디서 사진 수가 줄어드는지 확인
  if (typeof window !== 'undefined' && imgs.length === 1 && p._drive_folder_virtual) {
    console.warn('[search-detail] imgs.length=1 but _drive_folder_virtual set!', {
      car: p.car_number,
      image_urls_len: (p.image_urls || []).length,
      productImages_len: productImages(p).length,
      productExternalImages_len: productExternalImages(p).length,
      sample_url: (p.image_urls || [])[0],
    });
  }

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

  // 값에서 라벨과 중복되는 단어 제거 — "연간 주행" 라벨에 "연간 5만Km 주행" 값 → "5만Km"
  //  라벨의 단어들(공백/슬래시 분리)을 값 앞뒤에서 제거
  const cleanVal = (label, value) => {
    if (!value || value === '-') return value || '-';
    let v = String(value).trim();
    const tokens = String(label).split(/[\s\/]+/).filter(t => t.length > 1);
    for (const tok of tokens) {
      // 앞에 있으면 제거
      v = v.replace(new RegExp(`^${tok}\\s*`), '');
      // 뒤에 있으면 제거
      v = v.replace(new RegExp(`\\s*${tok}$`), '');
    }
    return v.trim() || value;
  };
  // 단일 행 — 라벨 1칸 + 값 3칸 spanning. 빈 값은 '-' (필터 안 함, 그냥 보여주는 표)
  const renderGrid = (r) => r.map(([l, v]) => `<div class="lab">${esc(l)}</div><div class="full">${esc(cleanVal(l, v) || '-')}</div>`).join('');
  // 좌우 쌍 — [라벨1][값1][라벨2][값2]. 값이 라벨과 겹치는 부분 자동 제거.
  const pair = (l1, v1, l2, v2) => `
    <div class="lab">${esc(l1)}</div><div>${esc(cleanVal(l1, v1) || '-')}</div>
    <div class="lab">${esc(l2)}</div><div>${esc(cleanVal(l2, v2) || '-')}</div>
  `;

  const photoHtml = imgs.length ? `
    <div class="detail-photo-stage">
      <img class="detail-photo-main" id="dtlMainImg" src="${esc(imgs[0])}" alt="" loading="lazy"
           onerror="this.style.display='none'; this.parentElement.querySelector('.dtl-photo-fallback').style.display='flex';">
      <div class="dtl-photo-fallback" style="display:none; align-items:center; justify-content:center; width:100%; height:180px; background:var(--bg-stripe); color:var(--text-muted);"><i class="ph ph-image"></i></div>
      ${imgs.length > 1 ? `
        <button class="detail-photo-nav detail-photo-prev" aria-label="이전"><i class="ph ph-caret-left"></i></button>
        <button class="detail-photo-nav detail-photo-next" aria-label="다음"><i class="ph ph-caret-right"></i></button>
        <div class="detail-photo-counter"><span id="dtlPhotoIdx">1</span> / ${imgs.length}</div>
      ` : ''}
    </div>
    ${imgs.length > 1 ? `<div class="detail-photo-thumbs-wrap">
      <button class="detail-thumbs-nav detail-thumbs-prev" aria-label="이전 줄"><i class="ph ph-caret-left"></i></button>
      <div class="detail-photo-thumbs">
        ${imgs.map((u, i) => `<div class="detail-photo-thumb${i === 0 ? ' is-active' : ''}" data-img="${esc(u)}" data-idx="${i}"><img src="${esc(u)}" alt="" loading="lazy" onerror="this.style.display='none';"></div>`).join('')}
      </div>
      <button class="detail-thumbs-nav detail-thumbs-next" aria-label="다음 줄"><i class="ph ph-caret-right"></i></button>
    </div>` : ''}
  ` : `
    <div class="detail-photo-main" style="display:flex; align-items:center; justify-content:center;"><i class="ph ph-image" style="font-size:32px; color:var(--text-muted);"></i></div>
    ${driveSrc ? `<div style="padding:8px; text-align:center; color:var(--text-muted); font-size:12px;">사진 불러오는 중...</div>` : ''}
  `;

  const specByLabel = Object.fromEntries(specRows.map(r => [r[0], r[1]]));
  const basicByLabel = Object.fromEntries(basicRows.map(r => [r[0], r[1]]));
  const condByLabel = Object.fromEntries(condRows.map(r => [r[0], r[1]]));
  // 매물 상세의 공급사 row — "회사명 (코드)" 같이 표시 (사용자 요청 — 코드 유지 + 회사명 노출)
  const providerName = providerLabelByCode(p.provider_company_code || p.partner_code, store) || '';

  // ── 캐논 구성 (엑셀 탈피: 자연 차량명 + 가격 하이라이트 + 위계 섹션) ──
  const vehName = composeVehicleName(p);
  // 정보 없어도 항목은 다 노출 — 빈 값은 '-' (전체 필드 구성)
  const kv = (l, v) => `<div class="pd-kv"><span class="k">${esc(l)}</span><span class="v">${(v != null && String(v).trim() && String(v).trim() !== '-') ? esc(v) : '-'}</span></div>`;
  const cheapest = priceRows.length ? priceRows.reduce((a, b) => (b.rent < a.rent ? b : a), priceRows[0]) : null;
  const st = p.vehicle_status || '';
  const stCls = /협의/.test(st) ? 'is-consult' : /계약|예약/.test(st) ? 'is-contract' : /불가/.test(st) ? 'is-blocked' : '';
  // 차량정보 — 주요정보 우선 순서 (선택옵션 → 색상 → 연식·주행·연료 → 부가). 관계는 붙여서(내/외부 인접).
  const infoOrder = [
    ['외부색상', specByLabel['외장색']],
    ['내부색상', specByLabel['내장색']],
    ['연식',     specByLabel['연식']],
    ['주행거리', specByLabel['주행']],
    ['연료',     specByLabel['연료']],
    ['구동방식', specByLabel['구동']],
    ['배기량',   specByLabel['배기량']],
    ['인승',     specByLabel['인승']],
    ['차종',     specByLabel['차종']],
    ['용도',     specByLabel['용도']],
    ['최초등록', specByLabel['최초등록일']],
  ];
  const infoHtml = `<div class="pd-kv full"><span class="k">선택옵션</span><span class="v">${opts.length ? opts.map(o => `<span class="pd-chip">${esc(o)}</span>`).join('') : '-'}</span></div>`
    + infoOrder.map(([l, v]) => kv(l, v)).join('');
  const condHtml = condRows.map(([l, v]) => kv(l, v)).join('');
  const etcHtml = [
    providerName ? kv('공급사', providerName) : '',
    (policyName && !isAdmin) ? kv('정책명', policyName) : '',   // admin 은 adminRows 에 정책명 포함 (중복 방지)
    ...specRows.filter(([l]) => ['차령만료일', '차량가격', '차대번호', '위치'].includes(l)).map(([l, v]) => kv(l, v)),
    ...adminRows.map(([l, v]) => kv(l, v)),
  ].join('');

  const body = card.querySelector('.ws4-body');
  body.innerHTML = `
    <div class="pd-photo">${photoHtml}</div>

    <div class="pd-hero">
      <div class="pd-meta" style="margin:0 0 4px;">
        ${p.car_number ? `<span class="pd-carno" style="font-size:var(--fs-md);font-weight:var(--fw-heavy);color:var(--c-text);">${esc(p.car_number)}</span>` : ''}
        ${p.product_type ? `<span class="pd-tag is-type">${esc(p.product_type)}</span>` : ''}
        ${st ? `<span class="pd-tag ${stCls}">${esc(st)}</span>` : ''}
      </div>
      <div class="pd-name">${esc(vehName) || '-'}</div>
    </div>

    <!-- 차량정보 먼저 (차를 보고) -->
    <div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>차량정보</div>
      ${infoHtml ? `<div class="pd-spec">${infoHtml}</div>` : `<div class="pd-empty">정보 없음</div>`}
    </div>

    <!-- 대여료 관련 (별도 가격 하이라이트 블록 제거 — 기간별 표에 최저 강조) -->
    <div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>기간별 대여료</div>
      ${priceRows.length ? `
      <table class="pd-tbl">
        <thead><tr><th>기간</th><th>월 대여료</th><th>보증금</th></tr></thead>
        <tbody>${priceRows.map(r => `<tr class="${cheapest && r.m === cheapest.m ? 'best' : ''}"><td>${r.m}개월${cheapest && r.m === cheapest.m ? '<span class="pd-best-tag">최저</span>' : ''}</td><td><span class="pd-rent">${fmtMoneyMan(r.rent)}</span></td><td>${fmtMoneyMan(r.dep) || '-'}</td></tr>`).join('')}</tbody>
      </table>
      ${(() => {
        const age = condByLabel['기본연령'];
        const mileage = String(condByLabel['약정 주행거리'] || '').replace(/\s*주행$/, '');
        const insurance = condByLabel['보험 포함'];
        const parts = [age, mileage, insurance].filter(Boolean);
        return parts.length ? `<div class="pd-ins-sub" style="margin-top:6px;text-align:right;">* ${esc(parts.join(' · '))} 기준</div>` : '';
      })()}` : `<div class="pd-empty">가격 미입력</div>`}
    </div>

    <!-- 운전자 연령·범위 → 대여조건에 통합 -->

    <!-- 보험 -->
    <div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>보험</div>
      ${insRows.length ? `
      <table class="pd-tbl">
        <thead><tr><th>항목</th><th>한도</th><th>면책금</th></tr></thead>
        <tbody>${insRows.map(([l, lim, ded]) => `<tr><td>${esc(l)}</td><td>${esc(lim) || '-'}</td><td>${esc(ded) || '-'}</td></tr>`).join('')}</tbody>
      </table>` : `<div class="pd-empty">보험 정보 없음</div>`}
    </div>

    <!-- 대여조건 (운전자 연령·범위 통합) -->
    <div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>대여조건${policyName ? ` <span class="hint">${esc(policyName)}</span>` : ''}</div>
      ${condHtml ? `<div class="pd-spec">${condHtml}</div>` : `<div class="pd-empty">조건 정보 없음</div>`}
    </div>

    <!-- 기타 정보 -->
    ${etcHtml ? `<div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>기타 정보</div>
      <div class="pd-spec">${etcHtml}</div>
    </div>` : ''}

    <!-- 수수료 (영업자/관리자만) -->
    ${canSeeFee ? `<div class="pd-sec is-fee">
      <div class="pd-sec-h"><span class="bar"></span>수수료 <span class="hint">내부용</span></div>
      ${feeRows.length ? `
      <table class="pd-tbl">
        <thead><tr><th>기간</th><th>수수료</th><th>비고</th></tr></thead>
        <tbody>${feeRows.map(r => `<tr><td>${r.m}개월</td><td><span class="pd-rent">${fmtMoneyMan(r.fee)}</span></td><td class="pd-ins-sub">${esc(r.fee_memo || '')}</td></tr>`).join('')}</tbody>
      </table>` : `<div class="pd-empty">등록된 수수료 없음</div>`}
    </div>` : ''}
  `;
  // 새 차량 선택 시 항상 사진부터 보이게 — 스크롤 맨 위로
  body.scrollTop = 0;

  // 표준옵션 인터랙션 — 더보기 토글 + 매트릭스 자세히
  body.querySelectorAll('[data-fp-more]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.fp-popular');
      const extra = wrap?.querySelector('[data-fp-extra]');
      if (extra) {
        const isOpen = extra.style.display !== 'none';
        extra.style.display = isOpen ? 'none' : 'flex';
        btn.style.display = isOpen ? '' : 'none';
      }
    });
  });
  body.querySelectorAll('[data-fp-detail]').forEach(btn => {
    btn.addEventListener('click', async () => {
      // 차량 → catalog 매핑 후 매트릭스 페이지 새 창
      try {
        const cat = await findCatalog(p.maker, p.sub_model, p.model, p);
        const params = new URLSearchParams();
        if (cat?.catalogId) params.set('catalog', cat.catalogId);
        else {
          if (p.maker)     params.set('maker', p.maker);
          if (p.model)     params.set('model', p.model);
          if (p.sub_model) params.set('sub',   p.sub_model);
        }
        window.open(`/vehicle-options-catalog-test.html?${params.toString()}`, '_blank', 'noopener');
      } catch (e) {
        showToast('매트릭스 매핑 실패', 'error');
      }
    });
  });

  const thumbsEl = body.querySelector('.detail-photo-thumbs');

  // 썸네일 클릭 + 메인 prev/next 버튼 → 메인 이미지 교체
  const photoState = { idx: 0 };
  const updateMain = () => {
    const main = body.querySelector('img.detail-photo-main');
    const counter = body.querySelector('#dtlPhotoIdx');
    if (main && imgs[photoState.idx]) main.src = imgs[photoState.idx];
    if (counter) counter.textContent = String(photoState.idx + 1);
    body.querySelectorAll('.detail-photo-thumb').forEach((t, i) => t.classList.toggle('is-active', i === photoState.idx));
    // 활성 썸네일이 화면에 안 보이면 가로로 스크롤하여 보이게
    const active = body.querySelector('.detail-photo-thumb.is-active');
    if (active && thumbsEl) {
      const aLeft = active.offsetLeft;
      const aRight = aLeft + active.offsetWidth;
      const sLeft = thumbsEl.scrollLeft;
      const sRight = sLeft + thumbsEl.clientWidth;
      if (aLeft < sLeft) thumbsEl.scrollTo({ left: aLeft, behavior: 'smooth' });
      else if (aRight > sRight) thumbsEl.scrollTo({ left: aRight - thumbsEl.clientWidth, behavior: 'smooth' });
    }
  };

  // 썸네일 strip 자체 좌우 nav — 한 페이지(컨테이너 폭)씩 이동
  body.querySelector('.detail-thumbs-prev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (thumbsEl) thumbsEl.scrollTo({ left: thumbsEl.scrollLeft - thumbsEl.clientWidth, behavior: 'smooth' });
  });
  body.querySelector('.detail-thumbs-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (thumbsEl) thumbsEl.scrollTo({ left: thumbsEl.scrollLeft + thumbsEl.clientWidth, behavior: 'smooth' });
  });
  body.querySelectorAll('.detail-photo-thumb[data-img]').forEach(thumb => {
    thumb.addEventListener('click', () => {
      photoState.idx = Number(thumb.dataset.idx) || 0;
      updateMain();
    });
  });
  body.querySelector('.detail-photo-prev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    photoState.idx = (photoState.idx - 1 + imgs.length) % imgs.length;
    updateMain();
  });
  body.querySelector('.detail-photo-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    photoState.idx = (photoState.idx + 1) % imgs.length;
    updateMain();
  });

  // Drive 폴더면 백그라운드 fetch 후 재렌더 — 외부사진 다수 + 썸네일 strip
  if (driveSrc && !p._drive_folder_virtual) {
    import('../core/drive-photos.js').then(m => {
      m.fetchDriveFolderImages(driveSrc).then(urls => {
        if (!urls?.length) {
          console.warn('[drive-photos] empty result for', driveSrc, '— DRIVE_API_KEY 미설정 또는 폴더 비공개');
          return;
        }
        // stillCurrent 체크 — 좌측 표에서 현재 선택된 row 의 _key 가 이 product 인지
        const selectedRow = document.querySelector('[data-page="search"] tr.selected');
        const stillCurrent = selectedRow?.dataset.id === p._key;
        if (stillCurrent) {
          // photo_link 의 direct URL 도 같이 합쳐 중복 제거 (Set)
          const externalDirect = productExternalImages(p);
          p.image_urls = [...new Set([...urls, ...externalDirect])];
          p._drive_folder_virtual = true;
          console.log('[drive-photos] loaded', p.image_urls.length, 'photos for', p.car_number);
          renderSearchDetail(p);
        }
      }).catch((e) => { console.error('[drive-photos] failed', e); });
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
  'variant',
  'trim_name',
  'options',
  'year',
  'mileage',
  'fuel_type',
  'ext_color',                // 외부색
  'int_color',                // 내부색
  '_policy.credit_grade',
  null, null, null, null, null, null,  // 가격 6컬럼 (1M/12M/24M/36M/48M/60M, range 미구현)
  '_provider_name',           // 20 공급사 (한글 회사명 — getColumnVal 에서 lookup)
];

/* 컬럼별 정렬 상태 — 한 번에 한 컬럼만 정렬 (asc | desc | null) */
const _sortState = { field: null, dir: null };

function getColumnVal(p, field) {
  if (!field) return null;
  if (field.startsWith('_policy.')) return p._policy?.[field.slice(8)];
  if (field === 'options' && Array.isArray(p.options)) return p.options.join('·');
  // 공급사 — 코드를 한글 회사명으로 변환해서 필터/정렬
  if (field === '_provider_name') {
    return providerNameByCode(p.provider_company_code || p.partner_code, store) || '';
  }
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
    // 메인 목록 표 (.table-fixed) 헤더만 필터 popover 대상.
    //  상세 패널 안의 표(보험·가격·수수료)는 그냥 보여주는 표라 필터 X
    const th = e.target.closest('.table.table-fixed thead th');
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
        // 즉시: 선택 표시 + 패널 열기 (시각 피드백 즉시)
        ws4.querySelectorAll('.table tbody tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');
        ws4.classList.remove('is-collapsed');
        // 다음 프레임에 detail 렌더 (paint 먼저 → 사용자 체감 빠름)
        const p = findProduct(tr.dataset.id);
        if (p) requestAnimationFrame(() => renderSearchDetail(p));
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

  // 엑셀/사진/필터/기간 토글은 모두 하단 액션바(setPageActions)가 처리.
  // 기간 컬럼 표시/숨김 초기 상태만 적용 (localStorage 복원).
  bindPeriodToggles();
}

/* ──────── E. 사진 ZIP 다운로드 다이얼로그 (v2 이식) ──────── */
function fsSafe(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '_';
}

function openPhotoZipDialog(list) {
  if (!list.length) { showToast('현재 목록에 차량이 없습니다'); return; }

  const buildDataset = (entries) => {
    const groups = {};
    let totalPhotos = 0, totalCars = 0;
    for (const entry of entries) {
      const provider = entry.p.provider_company_code || '미지정';
      groups[provider] ??= [];
      groups[provider].push(entry);
      totalPhotos += entry.imgs.length;
      totalCars++;
    }
    return { groups, totalPhotos, totalCars, withPhotos: entries };
  };

  const ownEntries = list
    .map(p => ({ p, imgs: productImages(p) }))
    .filter(e => e.imgs.length > 0);

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
      <button class="pd-zip-tab is-active" data-tab="own" role="tab"><span data-tablabel="own">자체사진 (${datasets.own.totalCars}대 | ${datasets.own.totalPhotos}장)</span></button>
      <button class="pd-zip-tab" data-tab="ext" role="tab"><span data-tablabel="ext">외부사진 (${datasets.ext.totalCars}대 | ${datasets.ext.totalPhotos}장)</span></button>
    </div>
    <div class="pd-zip-toolbar">
      <input type="search" class="input" id="zipSearch" placeholder="차량번호·공급사코드 검색" autocomplete="off">
      <label class="pd-zip-allcb"><input type="checkbox" id="zipAll"> 전체 선택</label>
    </div>
    <div class="pd-zip-sub-progress" hidden></div>
    <div class="pd-zip-tree" id="zipTree"></div>
    <div class="pd-zip-foot">
      <span class="pd-zip-selinfo" id="zipSelInfo"></span>
      <span style="flex:1;"></span>
      <button class="btn" id="zipCancel">취소</button>
      <button class="btn" id="zipDownload" style="background:#1B2A4A;color:#fff;border-color:#1B2A4A;"><i class="ph ph-download-simple"></i> 다운로드</button>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();

  const ac = new AbortController();
  let activeTab = 'own';

  const currentDataset = () => datasets[activeTab];
  const byKey = () => new Map(currentDataset().withPhotos.map(x => [x.p._key, x]));

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
            <span class="pd-zip-prov-meta">${cars.length}대 | ${provPhotos}장</span>
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
    let cars = selected.length, photos = 0;
    for (const cb of selected) photos += (map.get(cb.dataset.key)?.imgs.length || 0);
    dlg.querySelector('#zipSelInfo').textContent = `선택: ${cars}대 | ${photos}장`;
    dlg.querySelector('#zipDownload').disabled = cars === 0;
  };

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

  dlg.querySelector('#zipAll').addEventListener('change', (e) => {
    const checked = e.target.checked;
    dlg.querySelectorAll('.zip-prov-cb, .zip-car-cb').forEach(cb => { cb.checked = checked; cb.indeterminate = false; });
    updateSelInfo();
  }, { signal: ac.signal });

  dlg.querySelector('#zipSearch').addEventListener('input', applyFilter, { signal: ac.signal });

  const close = () => { if (dlg.open) dlg.close(); };
  dlg.querySelector('.pd-zip-close').addEventListener('click', close, { signal: ac.signal });
  dlg.querySelector('#zipCancel').addEventListener('click', close, { signal: ac.signal });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }, { signal: ac.signal });
  dlg.addEventListener('close', () => { ac.abort(); dlg.remove(); }, { once: true });

  renderTree();

  // 외부 폴더(Drive 등) 백그라운드 해석
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

      const refreshRow = (entry) => {
        datasets.ext.totalPhotos = datasets.ext.withPhotos.reduce((s, e) => s + e.imgs.length, 0);
        const tabLabel = dlg.querySelector('[data-tablabel="ext"]');
        if (tabLabel) tabLabel.textContent = `외부사진 (${datasets.ext.totalCars}대 | ${datasets.ext.totalPhotos}장)`;
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
        if (provMeta) provMeta.textContent = `${provEntries.length}대 | ${provPhotos}장`;
        updateSelInfo();
      };

      const CONCURRENCY = 6;
      let idx = 0;
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

  // 다운로드 — JSZip 으로 묶어서 저장
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
          if (ac.signal.aborted) return;
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
            if (e?.name === 'AbortError' || ac.signal.aborted) return;
            fail++;
            console.warn('[photo-zip] fetch fail', t.url, e?.message || e);
          }
          done++;
          if (!ac.signal.aborted) updateProgress();
        }
      });
      await Promise.all(workers);

      if (ac.signal.aborted) return;

      if (!ok) {
        showToast(`사진 ${fail}장 모두 다운로드 실패 (CORS/네트워크) — 콘솔 확인`, 'error');
        resetBtn();
        return;
      }

      btn.innerHTML = '<i class="ph ph-spinner"></i> 압축 중...';
      const content = await zip.generateAsync({ type: 'blob' });
      if (ac.signal.aborted) return;
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      const tag = activeTab === 'own' ? 'own' : 'ext';
      a.download = `freepass_photos_${tag}_${new Date().toISOString().slice(0,10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      const msg = fail
        ? `${carSucceeded.size}대 | ${ok}장 다운로드 (${fail}장 실패)`
        : `${carSucceeded.size}대 | ${ok}장 다운로드 완료`;
      showToast(msg, fail ? 'info' : 'success');
      close();
    } catch (e) {
      if (ac.signal.aborted) return;
      console.error(e);
      showToast('ZIP 생성 실패 — ' + (e.message || e), 'error');
      resetBtn();
    }
  }, { signal: ac.signal });
}

const PERIOD_KEY = 'srch.period.hidden';
const ALL_PERIODS = ['1m', '12m', '24m', '36m', '48m', '60m'];
const PERIOD_COL_W = 52;  // colgroup 의 기간 컬럼 폭과 동일하게
/* 기간 컬럼 표시/숨김 — 초기 렌더 시 저장된 hidden 상태 적용. 토글 핸들러는 하단 액션바가 처리.
 *  searchTogglePeriod() 가 클릭마다 컬럼 가시성 다시 적용. */
function bindPeriodToggles() {
  const table = document.querySelector('[data-page="search"] table.table-fixed');
  if (!table) return;
  const hidden = new Set(JSON.parse(localStorage.getItem(PERIOD_KEY) || '[]'));
  ALL_PERIODS.forEach(p => table.classList.toggle(`hide-period-${p}`, hidden.has(p)));
  const visible = ALL_PERIODS.filter(p => !hidden.has(p));
  ALL_PERIODS.forEach(p => {
    const i = visible.indexOf(p);
    const right = i === -1 ? 0 : (visible.length - 1 - i) * PERIOD_COL_W;
    table.style.setProperty(`--right-${p}`, right + 'px');
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
      <button class="btn-primary" data-act="close">적용</button>
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

  // 정렬 — 같은 방향 다시 누르면 해제
  wrap.querySelector('[data-act="sort-asc"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_sortState.field === field && _sortState.dir === 'asc') {
      _sortState.field = null; _sortState.dir = null;
    } else {
      _sortState.field = field; _sortState.dir = 'asc';
    }
    applySearchFilter();
  });
  wrap.querySelector('[data-act="sort-desc"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_sortState.field === field && _sortState.dir === 'desc') {
      _sortState.field = null; _sortState.dir = null;
    } else {
      _sortState.field = field; _sortState.dir = 'desc';
    }
    applySearchFilter();
  });
  // 현재 정렬 상태를 popover 에 시각 표시
  if (_sortState.field === field) {
    wrap.querySelector(`[data-act="sort-${_sortState.dir}"]`)?.classList.add('is-active');
  }

  return wrap;
}

/* exceptField 컬럼만 제외하고 나머지 모든 필터 적용한 products */
function filterProductsExcept(exceptField) {
  const all = store.products || [];
  const f = _searchFilter;
  const me = store.currentUser || {};
  const role = me.role;
  const myCompany = me.company_code;
  return all.filter(p => {
    if (p._deleted || p.status === 'deleted') return false;   // 삭제 매물은 항상 제외
    const norm = shortStatus(p.vehicle_status || '');
    // 출고불가 가시성 — 역할별 정책:
    //   agent/agent_admin: 출고불가 자동 hide (영업자는 출고가능만)
    //   provider: 본인 회사 매물은 출고불가도 표시
    //   admin: 액션바 chip='불가' 명시 선택 시만 표시
    if (norm === '불가') {
      if (role === 'agent' || role === 'agent_admin') return false;
      if (role === 'provider') {
        if (p.provider_company_code !== myCompany) return false;
      } else {
        // admin 또는 그 외 — chip='불가' 명시일 때만
        if (f.chip !== '불가') return false;
      }
    }
    if (f.chip !== 'all') {
      // 정규화된 상태로 매칭 (즉시 / 가능 / 협의 / 불가)
      if (f.chip === '즉시' && norm !== '즉시') return false;
      if (f.chip === '가능' && norm !== '가능') return false;
      if (f.chip === '협의' && norm !== '협의') return false;
      if (f.chip === '불가' && norm !== '불가') return false;
    }
    for (const [field, sel] of Object.entries(f.column)) {
      if (field === exceptField) continue;
      const v = getColumnVal(p, field);
      if (!sel.has(String(v))) return false;
    }
    if (f.search) {
      const opts = Array.isArray(p.options) ? p.options.join(' ') : (p.options || '');
      // 공급사 코드 → 회사명 lookup (검색어에 회사명 입력해도 매칭되도록)
      const providerCode = p.provider_company_code || p.partner_code || '';
      const providerName = providerCode
        ? ((store.partners || []).find(x => (x.partner_code === providerCode || x.company_code === providerCode) && !x._deleted)?.partner_name || '')
        : '';
      const hay = [
        p.car_number, p.vin, p.product_code,
        p.maker, p.model, p.sub_model, p.trim_name, p.trim,
        p.fuel_type, p.year, p.ext_color, p.int_color,
        p.vehicle_status, p.product_type, p.vehicle_class, p.location,
        opts,
        providerCode, providerName,
        p.policy_code, p._policy?.policy_name, p._policy?.credit_grade,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    // 퀵 필터 (하단바)
    if (f.quick.size) {
      // 신차 — mileage < 5000 (MVP, 룰 변경 가능)
      if (f.quick.has('new') && !(Number(p.mileage) < 5000)) return false;
      // 중고 — mileage >= 5000
      if (f.quick.has('used') && !(Number(p.mileage) >= 5000)) return false;
      // 만 26세 이하 운전 가능
      if (f.quick.has('age26')) {
        const age = Number(p._policy?.basic_driver_age);
        if (!(age && age <= 26)) return false;
      }
    }
    // 표준옵션 필터 — 매물의 fp_options 가 선택된 모든 옵션을 포함해야 함 (AND)
    if (f.fpOptions && f.fpOptions.size) {
      const has = Array.isArray(p.fp_options) ? new Set(p.fp_options) : null;
      if (!has) return false;
      for (const id of f.fpOptions) {
        if (!has.has(id)) return false;
      }
    }
    // (대여료/보증금 구간은 아래 activeFilters 의 range 분기에서 처리됨 — 별도 로직 X)
    // 모바일 시트에서 토글한 그룹 필터 — 그룹 내 OR, 그룹 간 AND. range 타입은 별도.
    if (f.activeFilters && Object.keys(f.activeFilters).length) {
      for (const [g, val] of Object.entries(f.activeFilters)) {
        const ff = FILTERS[g];
        if (ff?.type === 'range') {
          const lo = val?.min ?? 0;
          const hi = val?.max ?? Number.MAX_SAFE_INTEGER;
          if (lo === 0 && hi === Number.MAX_SAFE_INTEGER) continue;
          const v = ff.field(p);
          if (v < lo || v > hi) return false;
          continue;
        }
        if (!val || !val.size) continue;
        const chips = [...val].map(cid => FILTERS[g]?.chips.find(c => c.id === cid)).filter(Boolean);
        if (!chips.length) continue;
        if (!chips.some(chip => matchFilter(p, g, chip))) return false;
      }
    }
    return true;
  });
}

/** 모바일과 동일한 필터 시트를 데스크톱에서도 — mobile.css 가 데스크톱에 미로드라 동적 import.
 *  chip 토글 시 즉시 결과 반영 (사용자 요청 — 모바일과 통일). [적용] 은 시트 닫기. */
let _mobileCssLoaded = false;
export async function openSearchFilterSheet() {
  if (!_mobileCssLoaded) {
    await import('../styles/mobile.css');
    _mobileCssLoaded = true;
  }
  const { openFilterSheet } = await import('../core/filter-sheet.js');
  openFilterSheet({
    products: store.products || [],
    activeFilters: _searchFilter.activeFilters,
    anchor: document.getElementById('ptTbFilterBtn'),   // 데스크톱 dropdown 위치 anchor
    onChange: () => {
      // 즉시 반영 — 매물 리스트 + 액션바 chip 갱신
      applySearchFilter();
      window.refreshPageActions?.('search');
    },
    onApply: () => {
      // [적용] = 시트 닫기 (이미 onChange 가 결과 반영함)
    },
  });
}

// 빠른 클릭 연타 시 테이블 재구성을 1번으로 묶어 체감 속도 향상 (rAF coalesce)
let _applyFilterRaf = null;
export function applySearchFilter() {
  if (_applyFilterRaf) cancelAnimationFrame(_applyFilterRaf);
  _applyFilterRaf = requestAnimationFrame(_doApplySearchFilter);
}
function _doApplySearchFilter() {
  _applyFilterRaf = null;
  let list = filterProductsExcept(null);
  if (_sortState.field) {
    const f = _sortState.field;
    const dir = _sortState.dir === 'desc' ? -1 : 1;
    list = [...list].sort((a, b) => {
      const va = getColumnVal(a, f);
      const vb = getColumnVal(b, f);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const na = Number(va), nb = Number(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
      return String(va).localeCompare(String(vb), 'ko') * dir;
    });
  }
  renderSearchTable(list);
  document.querySelectorAll('[data-page="search"] table.table-fixed thead th').forEach((th, idx) => {
    th.classList.remove('is-sort-asc', 'is-sort-desc');
    if (SEARCH_COL_FIELD[idx] === _sortState.field && _sortState.dir) {
      th.classList.add(`is-sort-${_sortState.dir}`);
    }
  });
}
