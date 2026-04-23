/**
 * 상품 상세 렌더링 — search.js와 workspace.js에서 공유
 * 이미지 갤러리 / 뱃지 / 가격표 / 보험·조건 / 수수료 섹션을 한꺼번에 렌더.
 */
import { store } from './store.js';
import { fmtMoney } from './format.js';
import { first, parsePol, findPolicy } from './policy-utils.js';
import { topBadgesHtml, reviewOverlayHtml, needsReview } from './product-badges.js';
import { productImages, productExternalImages, supportedDriveSource } from './product-photos.js';

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

export function colorToHex(name) {
  if (!name) return '#ddd';
  const n = String(name).toLowerCase().replace(/색$/, '');
  for (const [k, v] of Object.entries(COLOR_MAP)) { if (n.includes(k)) return v; }
  return '#ccc';
}

export function colorTextContrast(name) {
  const hex = colorToHex(name);
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*0.299 + g*0.587 + b*0.114) > 150 ? '#222' : '#fff';
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

function bindGallery(root, imgList, state, onNav) {
  const img = root.querySelector('#srchGalleryImg');
  img?.addEventListener('click', () => openFullscreen(imgList, state.idx));
  if (imgList.length <= 1) return;
  const ctr = root.querySelector('#srchGalleryCtr');
  const update = () => {
    if (img) img.src = imgList[state.idx];
    if (ctr) ctr.textContent = `${state.idx + 1} / ${imgList.length}`;
    if (typeof onNav === 'function') onNav(state.idx);
  };
  root.querySelector('#srchGalleryPrev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.idx = (state.idx - 1 + imgList.length) % imgList.length;
    update();
  });
  root.querySelector('#srchGalleryNext')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.idx = (state.idx + 1) % imgList.length;
    update();
  });
}

export function openFullscreen(imgList, startIdx = 0) {
  // 전체 이미지 즉시 병렬 prefetch
  imgList.forEach(url => { const i = new Image(); i.decoding = 'async'; i.src = url; });

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
  overlay.showModal();

  const scroller = overlay.querySelector('#srchFsScroll');
  const counter = overlay.querySelector('#srchFsCounter');

  requestAnimationFrame(() => {
    const imgs = scroller.querySelectorAll('.srch-fs-img');
    if (imgs[startIdx]) scroller.scrollTop = imgs[startIdx].offsetTop;
  });

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const idx = Number(e.target.dataset.idx) || 0;
        counter.textContent = `${idx + 1} / ${imgList.length}`;
      }
    }
  }, {
    root: scroller,
    rootMargin: '-50% 0px -50% 0px',
    threshold: 0,
  });
  scroller.querySelectorAll('.srch-fs-img').forEach(img => observer.observe(img));

  const ac = new AbortController();
  const close = () => { if (overlay.open) overlay.close(); };
  overlay.addEventListener('close', () => {
    ac.abort();
    observer.disconnect();
    overlay.remove();
  }, { once: true });
  overlay.querySelector('.srch-fs-close').addEventListener('click', close, { signal: ac.signal });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { signal: ac.signal });
}

/**
 * 상품 상세 패널 렌더
 * @param {HTMLElement} container - innerHTML을 덮어쓸 컨테이너 (.srch-detail-content 등)
 * @param {object} product - 상품 데이터 (allProducts 한 건)
 * @param {object} [options]
 * @param {(idx:number)=>void} [options.onGalleryNav] - 갤러리 이동 콜백
 * @param {()=>boolean} [options.shouldRerender] - Drive 폴더 해석 후 재렌더해도 되는지 (선택 변동 감지)
 * @param {Array<{icon,label,tone,action}>} [options.actionButtons] - 헤드 액션 버튼 (패널 헤드 내부 엘리먼트 id=srchDetailActions 주입)
 * @param {HTMLElement} [options.actionsContainer] - 액션 버튼을 렌더할 컨테이너 (기본: #srchDetailActions)
 * @param {boolean} [options.showActions=true] - 액션 버튼 영역 표시 여부
 */
export function renderProductDetail(container, product, options = {}) {
  if (!container || !product) return;
  try {
    _renderProductDetail(container, product, options);
  } catch (e) {
    console.error('[renderProductDetail] 렌더링 실패', e);
    container.innerHTML = `<div style="padding:var(--sp-4);color:var(--c-text-muted);font-size:var(--fs-xs);text-align:center;">
      <i class="ph ph-warning" style="font-size:24px;display:block;margin-bottom:var(--sp-2);"></i>
      상세 정보를 불러오는 중 오류가 발생했습니다
    </div>`;
  }
}

function _renderProductDetail(container, product, options = {}) {
  const {
    onGalleryNav,
    shouldRerender,
    actionButtons,
    actionsContainer,
    showActions = true,
  } = options;

  const p = product;
  const price = p.price || {};

  // 이미지
  const imgList = [...new Set([...productImages(p), ...productExternalImages(p)])];
  const driveSource = supportedDriveSource(p);

  // Drive 폴더/지원 사이트면 서버 API로 해석 후 재렌더
  if (driveSource && !p._drive_folder_virtual) {
    import('./drive-photos.js').then(m => {
      m.fetchDriveFolderImages(driveSource).then(urls => {
        const stillValid = typeof shouldRerender === 'function' ? shouldRerender() : true;
        if (urls?.length && stillValid) {
          p.image_urls = urls;
          p._drive_folder_virtual = true;
          renderProductDetail(container, p, options);
        }
      }).catch(() => {});
    });
  }

  const overlayBadges = topBadgesHtml(p);
  const reviewTag = reviewOverlayHtml(p);

  // 기간별 가격 행 (대여료 + 보증금)
  const priceRows = Object.entries(price)
    .map(([m, v]) => ({ m: Number(m), rent: v?.rent, dep: v?.deposit }))
    .filter(e => Number.isFinite(e.m) && e.m >= 1 && e.m <= 60 && Number(e.rent || 0) > 0)
    .sort((a, b) => a.m - b.m);

  // 영업수수료 (맨 아래 별도 섹션)
  const feeRows = Object.entries(price)
    .map(([m, v]) => ({ m: Number(m), fee: v?.fee || v?.commission }))
    .filter(e => Number.isFinite(e.m) && e.m >= 1 && e.m <= 60 && Number(e.fee || 0) > 0)
    .sort((a, b) => a.m - b.m);

  // 보험/조건
  const pol = p.policy || {};
  const cond = p.condition || {};
  const policy = findPolicy(p, store.policies || []);
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

  const fmtDate = v => { const d = String(v ?? '').replace(/[^\d]/g,''); if (!d) return ''; if (d.length === 8) return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}`; if (d.length === 6) return `20${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`; return String(v ?? '').trim() || ''; };

  const modelText = [p.maker, p.model].filter(v => v && v !== '-').join(' ');

  // 대여조건 — 정책에서 전부 가져오기
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

  // 특이사항
  const memoText = (p.partner_memo || p.note || '').trim();

  container.innerHTML = `
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

  // 갤러리 바인딩 — idx 상태는 모듈 외부가 추적하지 않아도 되도록 로컬 객체
  const galleryState = { idx: 0 };
  bindGallery(container, imgList, galleryState, onGalleryNav);

  // 패널헤드 액션 버튼 주입
  if (showActions) {
    const actsEl = actionsContainer || document.getElementById('srchDetailActions');
    if (actsEl) {
      if (Array.isArray(actionButtons) && actionButtons.length) {
        actsEl.innerHTML = actionButtons.map((a, i) => `
          <button class="btn btn-sm srch-detail-btn srch-detail-btn--${a.tone || 'accent'}" data-act="${i}">
            <i class="${a.icon}"></i> ${a.label}
          </button>`).join('');
        actsEl.querySelectorAll('[data-act]').forEach(btn => {
          btn.addEventListener('click', () => actionButtons[+btn.dataset.act]?.action());
        });
      } else if (actionButtons === null || (Array.isArray(actionButtons) && !actionButtons.length)) {
        // 명시적으로 비우기
        actsEl.innerHTML = '';
      }
      // actionButtons === undefined 이면 손대지 않음 (호출측이 별도로 관리)
    }
  }
}
