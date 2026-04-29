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
import { downloadExcelWithFilter, PRODUCT_COLS, PRODUCT_FILTER_FIELDS, enrichProductsWithPolicy } from '../core/excel-export.js';
import { showToast } from '../core/toast.js';
import {
  esc, shortStatus, mapStatusDot, fmtMileage,
  providerNameByCode,
} from '../core/ui-helpers.js';

/* 외부 주입 콜백 — workspace 가 createRoomFromProduct 를 setSearchCallbacks 로 주입 */
let _onCreateRoom = null;
export function setSearchCallbacks({ onCreateRoom }) {
  _onCreateRoom = onCreateRoom;
}

/* search 페이지 필터 상태 — bindGlobalSearch 등 외부 모듈에서 search 만 갱신 */
export const _searchFilter = {
  chip: 'all',
  search: '',
  column: {},
  quick: new Set(),                  // 하단 퀵필터 (new/used/age26)
  rentRange: { min: null, max: null },
  depositRange: { min: null, max: null },
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
  ];
  const HEADER_LABELS = ['차량번호','상태','구분','제조사','모델명','세부모델','세부트림','선택옵션','연식','주행','연료','색상','심사'];
  const HAS_FILTER = [false, true, true, true, true, true, true, true, true, true, true, true, true];
  const STATUS_DOT = 10;
  // 차량번호(idx 0): max 포맷 "000가0000" (7 ASCII + 1 한글) bold = ~64px + padding 16 → 80px 면 충분
  const MIN_WIDTHS = [80, 48, 44, 44, 56, 60, 56, 80, 40, 48, 48, 40, 44];
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
  // 옵션 (idx 7) — outlier 영향 줄이려고 세부트림(6) × 1.3 강제
  widths[7] = Math.round(widths[6] * 1.3);
  // 차량번호 (idx 0) — 최대 포맷 "000가0000" 고정. 데이터가 짧아도 길어도 80 고정
  widths[0] = 80;
  widths.forEach((w, idx) => cols[idx]?.style.setProperty('width', w + 'px'));
}

export function renderSearchTable(products) {
  const tbody = document.querySelector('[data-page="search"] .table tbody');
  if (!tbody) return;
  if (!products || !products.length) {
    tbody.innerHTML = '<tr><td colspan="21" class="empty-state" style="text-align:center; padding:24px; color:var(--text-muted);">표시할 상품이 없습니다</td></tr>';
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
    const p = products.find(x => x._key === target.dataset.id);
    // detail 패널이 열려있을 때만 재렌더 (closed 상태에서 reset 방지)
    const ws4 = document.querySelector('[data-page="search"] .ws4');
    const isOpen = ws4 && !ws4.classList.contains('is-collapsed');
    if (p && (isOpen || !restored)) renderSearchDetail(p);
  }
  // 2줄 초과 셀 → 글씨 축소 (.is-cramped). 가독성 보조용이라 idle 에 늦게 적용해도 무방.
  // 직전 호출 취소 (검색 디바운스 중 빠른 재실행 시 누적 방지)
  if (_crampPassHandle) {
    (window.cancelIdleCallback || clearTimeout)(_crampPassHandle);
  }
  const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 80));
  _crampPassHandle = schedule(() => {
    const cells = tbody.querySelectorAll('td');
    if (!cells.length) return;
    const lh = parseFloat(getComputedStyle(cells[0]).lineHeight) || 16;
    const threshold = lh * 2 + 1;
    const overflow = new Array(cells.length);
    for (let i = 0; i < cells.length; i++) overflow[i] = cells[i].scrollHeight > threshold;
    for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('is-cramped', overflow[i]);
  });
}
let _crampPassHandle = null;

function renderSearchRow(p) {
  const status = p.vehicle_status || '대기';
  const stShort = shortStatus(status);
  const credit = (p._policy && (p._policy.credit_grade || p._policy.screening_criteria)) || p.credit_grade || '-';
  const opts = Array.isArray(p.options) ? p.options.join('·') : (p.options || '-');
  const maker = p.maker || '-';
  const model = p.model || '-';
  const subModel = p.sub_model || '-';
  const trim = p.trim_name || p.trim || '-';
  const fuelB = fuelBadge(p.fuel_type);
  const providerName = providerNameByCode(p.provider_company_code || p.partner_code, store) || '-';
  return `
    <tr data-id="${p._key}">
      <td class="sticky-col" title="${esc(p.car_number || '')}">${p.car_number || '-'}</td>
      <td class="center" title="${esc(status)}"><span class="status-chip ${esc(stShort)}">${esc(stShort)}</span></td>
      <td class="center" title="${esc(p.product_type || '')}">${p.product_type || '-'}</td>
      <td title="${esc(maker)}">${makerBadge(maker)}</td>
      <td title="${esc(model)}">${model}</td>
      <td title="${esc(subModel)}">${subModel}</td>
      <td title="${esc(trim)}">${trim}</td>
      <td class="dim" title="${esc(opts)}">${opts}</td>
      <td class="center">${p.year || '-'}</td>
      <td class="num">${fmtMileage(p.mileage)}</td>
      <td class="center col-tight" title="${esc(p.fuel_type || '')}">${fuelB}</td>
      <td class="center col-tight" title="${esc(p.ext_color || '')}">${colorBadge(p.ext_color)}</td>
      <td class="center col-tight" title="${esc(p.int_color || '')}">${colorBadge(p.int_color)}</td>
      <td class="center" title="${esc(credit)}">${credit}</td>
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
      // 헤더 — 정보만 (토글 + 차량번호 + 모델 라벨)
      head.innerHTML = `
        <button class="pt-sb-toggle" id="detailClose" title="상세 패널 접기"><i class="ph ph-caret-right"></i></button>
        <span style="color: var(--text-main);">${esc(p.car_number || '-')}</span>
        <span class="text-sub">${esc([p.maker, p.model, p.sub_model].filter(Boolean).join(' '))}</span>
      `;
      head.querySelector('#detailClose')?.addEventListener('click', () => {
        document.querySelector('[data-page="search"] .ws4')?.classList.toggle('is-collapsed');
      });

      // 하단바 — 역할별 액션 버튼 (agent/agent_admin/admin: 소통·계약·공유 / provider: 공유만)
      const foot = card.querySelector('.ws4-foot[data-foot="search-detail"]');
      if (foot) {
        const canChat = role === 'agent' || role === 'agent_admin' || isAdmin;
        const canContract = canChat;
        foot.innerHTML = `
          <div class="spacer" style="flex:1;"></div>
          ${canChat ? `<button class="btn" id="srchChat"><i class="ph ph-chat-circle"></i> 소통</button>` : ''}
          ${canContract ? `<button class="btn" id="srchContract"><i class="ph ph-file-text"></i> 계약</button>` : ''}
          <button class="btn" id="srchShare"><i class="ph ph-share-network"></i> 공유</button>
        `;
        foot.querySelector('#srchChat')?.addEventListener('click', () => _onCreateRoom?.(p));
        foot.querySelector('#srchContract')?.addEventListener('click', async () => {
          const me = store.currentUser || {};
          // 사전 점검 — Firebase rule 통과 조건 미리 검증
          if (!me.uid) {
            showToast('계약 생성 실패: 로그인 정보 없음 — 새로고침 후 재시도', 'error');
            return;
          }
          if (!(me.role === 'admin' || me.role === 'agent' || me.role === 'agent_admin')) {
            showToast(`계약 생성 권한 없음 (현재 역할: ${me.role || '미지정'})`, 'error');
            return;
          }

          // 디버그 — store.currentUser.uid 와 Firebase Auth 의 실제 auth.uid 가 일치하는지
          //  Firebase rule 의 auth.uid 는 토큰에서 오므로, 둘이 다르면 PERMISSION_DENIED 의 진짜 원인
          try {
            const { auth } = await import('../firebase/config.js');
            const realAuthUid = auth.currentUser?.uid;
            console.log('[contract-debug] store.uid=', me.uid, ' auth.uid=', realAuthUid, ' role=', me.role);
            if (realAuthUid && realAuthUid !== me.uid) {
              showToast(`UID 불일치 — store=${me.uid?.slice(0, 8)} / auth=${realAuthUid.slice(0, 8)} (재로그인 필요)`, 'error');
              return;
            }
          } catch (_) {}
          const { pickOrCreateCustomer } = await import('../core/dialogs.js');
          const r = await pickOrCreateCustomer(p);
          if (!r) return;

          let step = 'init';
          try {
            const { pushRecord } = await import('../firebase/db.js');
            const { makeTempContractCode } = await import('./contract.js');
            // 1) 신규 고객이면 customer 생성
            let customerKey = r._key;
            if (!r._existing) {
              step = 'customer';
              customerKey = await pushRecord('customers', {
                name: r.name,
                phone: r.phone,
                birth: r.birth,
                is_business: !!r.is_business,
                business_number: r.business_number || '',
                company_name: r.company_name || '',
                created_by: me.uid,
              });
            }
            if (!customerKey) throw new Error('customerKey 발급 실패');

            // 2) 가계약 생성 — 임시 코드, 완료 시 실코드 부여
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
              // 차량 스냅샷
              product_uid: p._key,
              product_code: p.product_code || '',
              car_number_snapshot: p.car_number || '',
              maker_snapshot: p.maker || '',
              model_snapshot: p.model || '',
              sub_model_snapshot: p.sub_model || '',
              fuel_type_snapshot: p.fuel_type || '',
              year_snapshot: p.year || '',
              ext_color_snapshot: p.ext_color || '',
              // 대여 조건
              rent_month_snapshot: Number(r.contract_period) || 0,
              rent_amount_snapshot: r.contract_rent || 0,
              deposit_amount_snapshot: r.contract_deposit || 0,
              policy_code: p.policy_code || (p._policy?.policy_code) || '',
              policy_name_snapshot: p._policy?.policy_name || p.policy_name || '',
              provider_company_code: p.provider_company_code || '',
              partner_code: p.partner_code || p.provider_company_code || '',
              // 영업자 — Firebase rule 이 newData.agent_uid === auth.uid 체크
              agent_uid: me.uid,
              agent_name: me.name || '',
              agent_code: me.user_code || '',
              agent_channel_code: me.agent_channel_code || me.channel_code || me.company_code || '',
              created_by: me.uid,
            });
            showToast(`가계약 생성됨 — ${tempCode} (완료 시 실코드 부여)`, 'success');
            // 계약 페이지로 이동 — 방금 만든 계약 자동 선택되도록 hash 변경
            location.hash = 'contract';
          } catch (e) {
            console.error(`[contract create:${step}]`, e);
            const errMsg = e.code === 'PERMISSION_DENIED'
              ? `권한 거부 (${step} 단계) — Firebase rule 확인 필요`
              : `${step} 실패: ${e.code || e.message || e}`;
            showToast('계약 생성 실패 — ' + errMsg, 'error');
          }
        });
        foot.querySelector('#srchShare')?.addEventListener('click', async () => {
          // 카탈로그 단일 상품 링크 — 영업자 추적 코드 포함
          const me = store.currentUser || {};
          const agentQS = me.user_code ? `&a=${encodeURIComponent(me.user_code)}` : '';
          const car = p.car_number || '';
          const url = car
            ? `${location.origin}/catalog.html?car=${encodeURIComponent(car)}${agentQS}`
            : `${location.origin}/catalog.html?pid=${encodeURIComponent(p._key)}${agentQS.replace(/^&/, '?')}`;
          try {
            const { showToast } = await import('../core/toast.js');
            try {
              await navigator.clipboard.writeText(url);
              showToast(`상품 카탈로그 링크 복사됨 — ${car || p._key}`, 'success');
            } catch {
              // 클립보드 차단 환경 — prompt 로 fallback
              prompt('아래 링크를 복사하세요 (Ctrl+C):', url);
            }
          } catch {
            // toast 모듈 fail — 그냥 alert
            alert('카탈로그 링크: ' + url);
          }
        });
      }
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
  // 단일 행 — 라벨 1칸 + 값 3칸 spanning (4컬럼 grid 에서)
  const renderGrid = (r) => filterRows(r).map(([l, v]) => `<div class="lab">${esc(l)}</div><div class="full">${esc(v)}</div>`).join('');
  // 좌우 쌍 — [라벨1][값1][라벨2][값2]. 값이 없는 라벨은 '-'
  const pair = (l1, v1, l2, v2) => `
    <div class="lab">${esc(l1)}</div><div>${esc(v1 || '-')}</div>
    <div class="lab">${esc(l2)}</div><div>${esc(v2 || '-')}</div>
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
  const providerName = providerNameByCode(p.provider_company_code || p.partner_code, store) || '';

  const body = card.querySelector('.ws4-body');
  body.innerHTML = `
    <div class="detail-section">${photoHtml}</div>

    <!-- 1. 차량정보 — 4컬럼 표 형식. 단독행: 차량번호·세부모델·세부트림·선택옵션 -->
    <div class="detail-section">
      <div class="detail-section-label">1. 차량정보</div>
      <div class="info-grid">
        <div class="lab">차량번호</div><div class="full">${esc(p.car_number || '-')}</div>
        ${pair('제조사', basicByLabel['제조사'], '모델명', basicByLabel['모델'])}
        <div class="lab">세부모델</div><div class="full">${esc(basicByLabel['세부모델'] || '-')}</div>
        <div class="lab">세부트림</div><div class="full">${esc(specByLabel['트림'] || '-')}</div>
        <div class="lab">선택옵션</div><div class="full ${opts.length ? 'chips-wrap' : ''}">${opts.length ? opts.map(o => `<span class="chip">${esc(o)}</span>`).join('') : '-'}</div>
        ${pair('연식', specByLabel['연식'], '주행거리', specByLabel['주행'])}
        ${pair('연료', specByLabel['연료'], '구동방식', specByLabel['구동'])}
        ${pair('외부색상', specByLabel['외장색'], '내부색상', specByLabel['내장색'])}
      </div>
    </div>

    <!-- 2. 기간별 대여료 구성표 -->
    ${priceRows.length ? `<div class="detail-section">
      <div class="detail-section-label">2. 기간별 대여료</div>
      <table class="table">
        <thead><tr><th>기간</th><th class="num">대여료</th><th class="num">보증금</th></tr></thead>
        <tbody>${priceRows.map(r => `<tr><td>${r.m}개월</td><td class="num">${r.rent ? Math.round(r.rent/10000) + '만' : '-'}</td><td class="num">${r.dep ? Math.round(r.dep/10000) + '만' : '-'}</td></tr>`).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- 3. 운전 가능 범위·연령·보험료 -->
    ${(condByLabel['기본연령'] || condByLabel['개인범위'] || insRows.length) ? `<div class="detail-section">
      <div class="detail-section-label">3. 운전 가능 범위 / 연령 / 보험</div>
      <div class="info-grid">
        ${pair('기본 연령', condByLabel['기본연령'], '연령 상한', condByLabel['연령상한'])}
        ${pair('연령 하향', condByLabel['연령하향'], '연령 하향비', condByLabel['연령하향비'])}
        ${pair('개인 범위', condByLabel['개인범위'], '사업자 범위', condByLabel['사업자범위'])}
        ${pair('추가 인원', condByLabel['추가인원'], '추가 운전비', condByLabel['추가운전비'])}
      </div>
      ${insRows.length ? `
        <div style="color:var(--text-sub); margin: 8px 0 4px; font-size: 11px;">보험 한도</div>
        <table class="table">
          <thead><tr><th>구분</th><th>보장한도</th><th>자기부담금</th></tr></thead>
          <tbody>${insRows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1] || '-')}</td><td>${esc(r[2] || '-')}</td></tr>`).join('')}</tbody>
        </table>
      ` : ''}
    </div>` : ''}

    <!-- 4. 대여 조건 -->
    ${(condByLabel['심사여부'] || condByLabel['연간약정주행'] || condByLabel['정비서비스']) ? `<div class="detail-section">
      <div class="detail-section-label">4. 대여 조건${policyName ? ` <span style="color:var(--text-muted); font-weight:400;">· ${esc(policyName)}</span>` : ''}</div>
      <div class="info-grid">
        ${pair('심사 여부', condByLabel['심사여부'], '심사 기준', condByLabel['심사기준'])}
        ${pair('결제 방식', condByLabel['결제방식'], '위약금', condByLabel['위약금'])}
        ${pair('보증금 분납', condByLabel['보증금분납'], '보증 카드', condByLabel['보증카드'])}
        ${pair('연간 주행', condByLabel['연간약정주행'], '1만km 추가', condByLabel['1만km추가'])}
        ${pair('대여 지역', condByLabel['대여지역'], '탁송비', condByLabel['탁송비'])}
        ${pair('정비 서비스', condByLabel['정비서비스'], '보험 포함', condByLabel['보험 포함'])}
      </div>
    </div>` : ''}

    <!-- 5. 기타 정보 -->
    ${(providerName || policyName || specByLabel['최초등록일']) ? `<div class="detail-section">
      <div class="detail-section-label">5. 기타 정보</div>
      <div class="info-grid">
        ${providerName ? `<div class="lab">공급사</div><div class="full">${esc(providerName)}</div>` : ''}
        ${policyName ? `<div class="lab">정책명</div><div class="full">${esc(policyName)}</div>` : ''}
        ${pair('차종', specByLabel['차종'], '인승', specByLabel['인승'])}
        ${pair('배기량', specByLabel['배기량'], '용도', specByLabel['용도'])}
        ${pair('등록일', specByLabel['최초등록일'], '차령만료', specByLabel['차령만료일'])}
        ${pair('상품구분', specByLabel['상품구분'], '위치', specByLabel['위치'])}
        ${pair('차량가격', specByLabel['차량가격'], '차대번호', specByLabel['차대번호'])}
        ${isAdmin ? `
          ${pair('공급코드', p.provider_company_code, '영업코드', p.partner_code)}
          ${pair('상품코드', p.product_code, '정책코드', p._policy?.policy_code || p.policy_code)}
          ${p._key ? `<div class="lab">상품UID</div><div class="full">${esc(p._key)}</div>` : ''}
          ${p._policy?.policy_type ? `<div class="lab">정책유형</div><div class="full">${esc(p._policy.policy_type)}</div>` : ''}
          ${p._policy?.commission_clawback_condition ? `<div class="lab">수수료환수</div><div class="full">${esc(p._policy.commission_clawback_condition)}</div>` : ''}
          ${(p.partner_memo || p.note) ? `<div class="lab">특이사항</div><div class="full">${esc(p.partner_memo || p.note)}</div>` : ''}
        ` : ''}
      </div>
    </div>` : ''}

    <!-- 6. 영업 수수료 (영업자/관리자만 — 기간별 수수료 + 비고) -->
    ${(canSeeFee && feeRows.length) ? `<div class="detail-section">
      <div class="detail-section-label">6. 영업 수수료 <span style="color:var(--text-muted); font-weight:400; font-size:11px;">(내부용)</span></div>
      <table class="table">
        <thead><tr><th>기간</th><th class="num">수수료</th><th>비고</th></tr></thead>
        <tbody>${feeRows.map(r => `<tr><td>${r.m}개월</td><td class="num">${Math.round(r.fee/10000)}만</td><td style="color:var(--text-sub);">${esc(r.fee_memo || '')}</td></tr>`).join('')}</tbody>
      </table>
    </div>` : ''}
  `;
  // 새 차량 선택 시 항상 사진부터 보이게 — 스크롤 맨 위로
  body.scrollTop = 0;

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

  // 엑셀 다운로드 — 현재 필터된 결과 + 정책 병합
  document.getElementById('srchExcel')?.addEventListener('click', async () => {
    const list = filterProductsExcept(null);
    if (!list.length) { alert('다운로드할 차량이 없습니다'); return; }
    try {
      const enriched = enrichProductsWithPolicy(list, store.policies || []);
      await downloadExcelWithFilter('차량목록', PRODUCT_COLS, enriched, PRODUCT_FILTER_FIELDS, {
        baseUrl: location.origin,
      });
    } catch (e) {
      console.error('[srchExcel]', e);
      alert('엑셀 다운로드 실패 — ' + (e.message || e));
    }
  });

  // 사진 ZIP 다운로드 — 현재 필터된 차량 사진을 공급사·차량별로 그룹핑하여 ZIP
  document.getElementById('srchPhotoZip')?.addEventListener('click', () => {
    openPhotoZipDialog(filterProductsExcept(null));
  });

  // 하단바 — 기간 컬럼 표시/숨김 (localStorage 영속)
  bindPeriodToggles();
  // 하단바 — 퀵 필터 (신차/중고/26세이하/대여료/보증금)
  bindQuickFilters();
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
      <button class="pd-zip-tab is-active" data-tab="own" role="tab"><span data-tablabel="own">자체사진 (${datasets.own.totalCars}대 · ${datasets.own.totalPhotos}장)</span></button>
      <button class="pd-zip-tab" data-tab="ext" role="tab"><span data-tablabel="ext">외부사진 (${datasets.ext.totalCars}대 · ${datasets.ext.totalPhotos}장)</span></button>
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
    dlg.querySelector('#zipSelInfo').textContent = `선택: ${cars}대 · ${photos}장`;
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
        if (tabLabel) tabLabel.textContent = `외부사진 (${datasets.ext.totalCars}대 · ${datasets.ext.totalPhotos}장)`;
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
        ? `${carSucceeded.size}대 · ${ok}장 다운로드 (${fail}장 실패)`
        : `${carSucceeded.size}대 · ${ok}장 다운로드 완료`;
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

function bindQuickFilters() {
  const foot = document.querySelector('.ws4-foot[data-foot="search-list"]');
  if (!foot) return;
  foot.addEventListener('click', (e) => {
    const chip = e.target.closest('.foot-filter-chip');
    if (!chip) return;
    const key = chip.dataset.footFilter;
    if (key === 'rent' || key === 'deposit') {
      // 구간 필터 — popover 열기 (간단한 min/max 입력)
      openRangePopover(chip, key);
      return;
    }
    // 토글 (신차/중고/26세이하)
    const set = _searchFilter.quick;
    if (set.has(key)) set.delete(key); else set.add(key);
    // 신차 vs 중고 — 상호 배타 (한쪽 켜면 반대쪽 꺼짐)
    if (key === 'new' && set.has('new')) set.delete('used');
    if (key === 'used' && set.has('used')) set.delete('new');
    foot.querySelectorAll('.foot-filter-chip').forEach(c => {
      c.classList.toggle('is-active', set.has(c.dataset.footFilter));
    });
    applySearchFilter();
  });
}

function openRangePopover(chip, key) {
  document.querySelector('.range-pop')?.remove();
  const range = key === 'rent' ? _searchFilter.rentRange : _searchFilter.depositRange;
  const pop = document.createElement('div');
  pop.className = 'range-pop';
  // 단위 분리 — 대여료 10만원 / 보증금 50만원
  const step = key === 'rent' ? 10 : 50;
  const defaultMin = key === 'rent' ? 50 : 0;
  const defaultMax = key === 'rent' ? 100 : 500;
  const minVal = range.min != null ? Math.round(range.min / 10000) : defaultMin;
  const maxVal = range.max != null ? Math.round(range.max / 10000) : defaultMax;
  pop.innerHTML = `
    <div class="range-pop-title">${key === 'rent' ? '대여료' : '보증금'} 구간 (만원, ${step}만원 단위)</div>
    <div class="range-pop-row">
      <input type="number" class="input" id="rngMin" placeholder="최소" value="${minVal}" step="${step}" min="0">
      <span>~</span>
      <input type="number" class="input" id="rngMax" placeholder="최대" value="${maxVal}" step="${step}" min="0">
    </div>
    <div class="range-pop-actions">
      <button class="btn" data-act="reset">초기화</button>
      <button class="btn-primary" data-act="apply">적용</button>
      <button class="btn" data-act="close">닫기</button>
    </div>
  `;
  // 위치 잡기 전에 미리 fixed 로 — append 시 document flow 차지하지 않게
  pop.style.position = 'fixed';
  pop.style.zIndex = '200';
  pop.style.visibility = 'hidden';   // 측정 끝나기 전엔 숨김 (깜빡임 방지)
  document.body.appendChild(pop);

  const foot = chip.closest('.ws4-foot');
  const fr = foot.getBoundingClientRect();
  const cr = chip.getBoundingClientRect();
  const popH = pop.offsetHeight;
  const popW = pop.offsetWidth;

  // 세로 — 하단바 top 에서 4px 위쪽으로 popover bottom 정렬 (top 으로 직접 계산)
  pop.style.top = (fr.top - popH - 4) + 'px';
  pop.style.bottom = 'auto';
  pop.style.right = 'auto';

  // 가로 — chip 좌측 정렬, 화면 우측 넘으면 chip 우측 정렬
  let left = cr.left;
  if (left + popW > window.innerWidth - 8) left = Math.max(8, cr.right - popW);
  pop.style.left = left + 'px';
  pop.style.visibility = 'visible';

  pop.querySelector('[data-act="apply"]').addEventListener('click', (e) => {
    e.stopPropagation();
    const minV = pop.querySelector('#rngMin').value;
    const maxV = pop.querySelector('#rngMax').value;
    range.min = minV ? Number(minV) * 10000 : null;
    range.max = maxV ? Number(maxV) * 10000 : null;
    chip.classList.toggle('is-active', range.min != null || range.max != null);
    pop.remove();
    applySearchFilter();
  });
  pop.querySelector('[data-act="reset"]').addEventListener('click', (e) => {
    e.stopPropagation();
    range.min = null; range.max = null;
    chip.classList.remove('is-active');
    pop.remove();
    applySearchFilter();
  });
  pop.querySelector('[data-act="close"]').addEventListener('click', (e) => {
    e.stopPropagation();
    pop.remove();   // 현재 필터 상태 유지하고 popover 만 닫기
  });
  // 외부 클릭 시 닫기
  setTimeout(() => {
    const onDocClick = (ev) => {
      if (!pop.contains(ev.target) && !chip.contains(ev.target)) {
        pop.remove();
        document.removeEventListener('click', onDocClick);
      }
    };
    document.addEventListener('click', onDocClick);
  }, 0);
}

const PERIOD_KEY = 'srch.period.hidden';
const ALL_PERIODS = ['1m', '12m', '24m', '36m', '48m', '60m'];
const PERIOD_COL_W = 52;  // colgroup 의 기간 컬럼 폭과 동일하게
function bindPeriodToggles() {
  const foot = document.querySelector('.ws4-foot[data-foot="search-list"]');
  const table = document.querySelector('[data-page="search"] table.table-fixed');
  if (!foot || !table) return;

  // 저장된 hidden 상태 복원 (기본: 모두 활성)
  const hidden = new Set(JSON.parse(localStorage.getItem(PERIOD_KEY) || '[]'));
  const applyAll = () => {
    foot.querySelectorAll('.period-chip').forEach(chip => {
      const period = chip.dataset.colPeriod;
      chip.classList.toggle('is-active', !hidden.has(period));
      table.classList.toggle(`hide-period-${period}`, hidden.has(period));
    });
    // 표시된 기간 수에 따라 우측 sticky right 값을 CSS 변수로 (table 에 한 번만 set → 모든 row 자동 적용)
    const visible = ALL_PERIODS.filter(p => !hidden.has(p));
    ALL_PERIODS.forEach(p => {
      const i = visible.indexOf(p);
      const right = i === -1 ? 0 : (visible.length - 1 - i) * PERIOD_COL_W;
      table.style.setProperty(`--right-${p}`, right + 'px');
    });
  };
  applyAll();

  // 토글 — 클릭하면 해당 컬럼 on/off (다중 선택 가능)
  foot.addEventListener('click', (e) => {
    const chip = e.target.closest('.period-chip');
    if (!chip) return;
    const period = chip.dataset.colPeriod;
    if (hidden.has(period)) hidden.delete(period); else hidden.add(period);
    applyAll();
    localStorage.setItem(PERIOD_KEY, JSON.stringify([...hidden]));
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
  return all.filter(p => {
    if (f.chip !== 'all') {
      const s = p.vehicle_status || '';
      // 정규화된 상태로 매칭 (즉시 / 가능 / 협의 / 불가)
      const norm = shortStatus(s);
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
      const hay = [p.car_number, p.maker, p.model, p.sub_model, p.trim_name, p.fuel_type, p.ext_color, opts].filter(Boolean).join(' ').toLowerCase();
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
    // 대여료 / 보증금 구간 — 24개월 기준 (영업자가 가장 많이 보는 기간 — 변경 가능)
    if (f.rentRange.min != null || f.rentRange.max != null) {
      const r = Number(p.price?.['24']?.rent || 0);
      if (f.rentRange.min != null && r < f.rentRange.min) return false;
      if (f.rentRange.max != null && r > f.rentRange.max) return false;
    }
    if (f.depositRange.min != null || f.depositRange.max != null) {
      const d = Number(p.price?.['24']?.deposit || 0);
      if (f.depositRange.min != null && d < f.depositRange.min) return false;
      if (f.depositRange.max != null && d > f.depositRange.max) return false;
    }
    return true;
  });
}

export function applySearchFilter() {
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
      // 숫자면 숫자 비교, 아니면 문자열 비교 (한글 로케일)
      const na = Number(va), nb = Number(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
      return String(va).localeCompare(String(vb), 'ko') * dir;
    });
  }
  renderSearchTable(list);
  // 헤더 정렬 표시 동기화
  document.querySelectorAll('[data-page="search"] table.table-fixed thead th').forEach((th, idx) => {
    th.classList.remove('is-sort-asc', 'is-sort-desc');
    if (SEARCH_COL_FIELD[idx] === _sortState.field && _sortState.dir) {
      th.classList.add(`is-sort-${_sortState.dir}`);
    }
  });
}
