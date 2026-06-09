/**
 * product-detail-render.js — 상품 상세 캐논 렌더러 (영업 데스크톱 · 손님 카탈로그 · 모바일 공용)
 *
 * 데이터는 extractProductDetailRows 단일 소스, 마크업은 ERP 조밀표(.cat-rows/.cat-table)로 통일.
 * audience('customer'|'agent'|'admin')로 수수료·내부코드 노출을 게이팅 (없으면 로그인 role 추론).
 */
import { store } from './store.js';
import { fmtMoney } from './format.js';
import { topBadgesHtml, reviewOverlayHtml } from './product-badges.js';
import { productImages, productExternalImages, supportedDriveSource, toProxiedImage } from './product-photos.js';
import { extractProductDetailRows } from './product-detail-rows.js';

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
 * 자연스러운 차량명 — "현대 쏘렌토 MQ4 가솔린 1.6 T 시그니처" (제조사 세부모델 파워트레인 트림).
 * 손님 화면은 5단계를 쪼개지 않고 이 한 줄로. 중복(모델⊂세부모델, 트림 중복) 제거.
 */
export function composeVehicleName(p) {
  if (!p) return '';
  const seg = [];
  if (p.maker) seg.push(String(p.maker).trim());
  const model = String(p.model || '').trim();
  const sub = String(p.sub_model || '').trim();
  if (sub) { if (model && !sub.includes(model)) seg.push(model); seg.push(sub); }
  else if (model) seg.push(model);
  if (p.variant) seg.push(String(p.variant).trim());
  const trim = String(p.trim_name || p.trim || '').trim();
  if (trim && trim !== '(기본)' && !seg.join(' ').includes(trim)) seg.push(trim);
  return seg.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 상품 상세 패널 렌더 (캐논)
 * @param {HTMLElement} container - innerHTML 을 덮어쓸 컨테이너
 * @param {object} product - 상품 데이터 (allProducts 한 건)
 * @param {object} [options]
 * @param {'customer'|'agent'|'admin'} [options.audience] - 노출 범위 (없으면 로그인 role 추론)
 * @param {(idx:number)=>void} [options.onGalleryNav] - 갤러리 이동 콜백
 * @param {()=>boolean} [options.shouldRerender] - Drive 폴더 해석 후 재렌더 가드
 * @param {Array<{icon,label,tone,action}>} [options.actionButtons] - 헤드 액션 버튼
 * @param {HTMLElement} [options.actionsContainer] - 액션 버튼 컨테이너 (기본 #srchDetailActions)
 * @param {boolean} [options.showActions=true] - 액션 영역 표시 여부
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
    audience,            // 'customer' | 'agent' | 'admin' — 없으면 로그인 role 추론
  } = options;

  const p = product;

  // 이미지 (외부호스트 → /api/img 프록시). Drive 폴더면 서버 해석 후 재렌더.
  const imgList = [...new Set([...productImages(p), ...productExternalImages(p)])].map(toProxiedImage);
  const driveSource = supportedDriveSource(p);
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

  // ── 데이터 단일화 — extractProductDetailRows (영업데스크톱·손님카탈로그·모바일 공용) ──
  const role = store.currentUser?.role;
  const aud = audience || (role === 'admin' ? 'admin'
    : (role === 'agent' || role === 'agent_admin' ? 'agent' : 'customer'));
  const isAdmin = aud === 'admin';
  const canSeeFee = aud === 'admin' || aud === 'agent';
  const D = extractProductDetailRows(p, { canSeeFee, isAdmin, policies: store.policies || [] });

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const ok = v => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '-';
  const lvRows = rows => `<div class="cat-rows">${rows.filter(r => ok(r[1])).map(([l, v]) => `<div class="cat-row"><span class="cat-row-label">${esc(l)}</span><span class="cat-row-value">${esc(v)}</span></div>`).join('')}</div>`;
  const lvSection = (icon, title, rows, hint = '') => {
    const f = rows.filter(r => ok(r[1]));
    if (!f.length) return '';
    return `<div class="cat-section"><div class="cat-section-title"><i class="ph ph-${icon}"></i> ${title}${hint ? `<span class="cat-section-hint">${hint}</span>` : ''}</div>${lvRows(f)}</div>`;
  };

  // 차량명 — 자연스러운 한 줄. 차량정보 표 = 이름 구성요소 제외 나머지 스펙 (다 매칭 + 중복 제거).
  const vehName = composeVehicleName(p);
  const NAME_LABELS = new Set(['제조사', '모델', '세부모델', '파워트레인', '세부트림', '차량번호', '차량상태']);
  const infoRows = [...D.basic, ...D.spec].filter(([l]) => !NAME_LABELS.has(l));
  if (D.options.length) infoRows.push(['선택옵션', D.options.join(' · ')]);

  const empty = msg => `<div style="font-size:var(--fs-xs);color:var(--c-text-muted);padding:var(--sp-2) 0;">${msg}</div>`;

  container.innerHTML = `
    <div class="srch-detail-inner">
      ${renderGallery(imgList, { overlayBadges, reviewTag })}

      <div class="cat-vehicle-head" style="padding:var(--sp-2) 0 var(--sp-3);border-bottom:1px solid var(--c-border);margin-bottom:var(--sp-3);">
        <div style="font-size:var(--fs-md);font-weight:var(--fw-bold);color:var(--c-text);line-height:1.4;">${esc(vehName) || '-'}</div>
        ${(p.car_number || p.vehicle_status) ? `<div style="margin-top:4px;font-size:var(--fs-xs);color:var(--c-text-muted);">${esc(p.car_number || '')}${p.car_number && p.vehicle_status ? ' · ' : ''}${p.vehicle_status ? `<span style="color:var(--c-accent);font-weight:var(--fw-medium);">${esc(p.vehicle_status)}</span>` : ''}</div>` : ''}
      </div>

      ${lvSection('car-simple', '차량정보', infoRows)}

      <div class="cat-section">
        <div class="cat-section-title"><i class="ph ph-currency-krw"></i> 기간별 대여료 · 보증금</div>
        ${D.price.length ? `
        <table class="cat-table">
          <thead><tr><th>기간</th><th>대여료</th><th>보증금</th></tr></thead>
          <tbody>${D.price.map(r => `<tr><td>${r.m}개월</td><td class="cat-price-cell">${fmtMoney(r.rent)}</td><td>${fmtMoney(r.dep)}</td></tr>`).join('')}</tbody>
        </table>` : empty('가격 미입력')}
      </div>

      ${D.ins.length ? `
      <div class="cat-section">
        <div class="cat-section-title"><i class="ph ph-shield-check"></i> 보험 내용</div>
        <table class="cat-table">
          <thead><tr><th>항목</th><th>한도</th><th>면책금</th></tr></thead>
          <tbody>${D.ins.map(([l, lim, ded]) => `<tr><td>${esc(l)}</td><td>${esc(lim) || '-'}</td><td>${esc(ded) || '-'}</td></tr>`).join('')}</tbody>
        </table>
      </div>` : ''}

      ${lvSection('list-checks', '대여 조건', D.cond)}
      ${lvSection('note', '기타 정보', D.etc)}

      ${canSeeFee && D.fee.length ? `
      <div class="cat-section cat-section-fee">
        <div class="cat-section-title"><i class="ph ph-percent"></i> 수수료 <span class="cat-section-hint">내부용</span></div>
        <table class="cat-table">
          <thead><tr><th>기간</th><th>수수료</th></tr></thead>
          <tbody>${D.fee.map(r => `<tr><td>${r.m}개월</td><td class="cat-price-cell">${fmtMoney(r.fee)}</td></tr>`).join('')}</tbody>
        </table>
      </div>` : ''}
    </div>
  `;

  // 갤러리 바인딩
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
        actsEl.innerHTML = '';
      }
      // actionButtons === undefined 이면 손대지 않음
    }
  }
}
