/**
 * product-detail-render.js — 상품 상세 캐논 렌더러 (영업 데스크톱 · 손님 카탈로그 · 모바일 공용)
 *
 * 데이터는 extractProductDetailRows 단일 소스, 마크업은 ERP 조밀표(.cat-rows/.cat-table)로 통일.
 * audience('customer'|'agent'|'admin')로 수수료·내부코드 노출을 게이팅 (없으면 로그인 role 추론).
 */
import { store } from './store.js';
import { topBadgesHtml, reviewOverlayHtml } from './product-badges.js';
import { productImages, productExternalImages, supportedDriveSource, toProxiedImage } from './product-photos.js';
import { extractProductDetailRows } from './product-detail-rows.js';
import { fmtMoneyMan, providerLabelByCode } from './ui-helpers.js';

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

function bindGallery(root, imgList, state, onNav, carNumber = '') {
  const img = root.querySelector('#srchGalleryImg');
  img?.addEventListener('click', () => openFullscreen(imgList, state.idx, carNumber));
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

export function openFullscreen(imgList, startIdx = 0, carNumber = '') {
  imgList.forEach(url => { const i = new Image(); i.decoding = 'async'; i.src = url; });

  const overlay = document.createElement('dialog');
  overlay.className = 'srch-fullscreen srch-fullscreen--scroll';
  overlay.innerHTML = `
    <div class="srch-fs-toolbar">
      <div class="srch-fs-counter" id="srchFsCounter">${startIdx + 1} / ${imgList.length}</div>
      <div class="srch-fs-actions">
        <button class="srch-fs-btn" id="srchFsRotate" title="회전"><i class="ph ph-arrow-clockwise"></i></button>
        <button class="srch-fs-btn" id="srchFsZoomIn" title="확대"><i class="ph ph-magnifying-glass-plus"></i></button>
        <button class="srch-fs-btn" id="srchFsZoomOut" title="축소"><i class="ph ph-magnifying-glass-minus"></i></button>
        <button class="srch-fs-btn" id="srchFsDownload" title="전체 다운로드"><i class="ph ph-download-simple"></i> ${imgList.length}장</button>
        <button class="srch-fs-btn srch-fs-close" aria-label="닫기"><i class="ph ph-x"></i></button>
      </div>
    </div>
    <div class="srch-fs-scroll" id="srchFsScroll">
      ${imgList.map((u, i) => `<img class="srch-fs-img" src="${u}" data-idx="${i}" data-rot="0" data-zoom="1" loading="eager" decoding="async">`).join('')}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.showModal();

  const scroller = overlay.querySelector('#srchFsScroll');
  const counter = overlay.querySelector('#srchFsCounter');
  let currentIdx = startIdx;

  requestAnimationFrame(() => {
    const imgs = scroller.querySelectorAll('.srch-fs-img');
    if (imgs[startIdx]) scroller.scrollTop = imgs[startIdx].offsetTop;
  });

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        currentIdx = Number(e.target.dataset.idx) || 0;
        counter.textContent = `${currentIdx + 1} / ${imgList.length}`;
      }
    }
  }, { root: scroller, rootMargin: '-50% 0px -50% 0px', threshold: 0 });
  scroller.querySelectorAll('.srch-fs-img').forEach(img => observer.observe(img));

  const getCurrentImg = () => scroller.querySelectorAll('.srch-fs-img')[currentIdx];
  const applyTransform = (img) => {
    const rot = Number(img.dataset.rot) || 0;
    const zoom = Number(img.dataset.zoom) || 1;
    const tx = Number(img.dataset.tx) || 0;
    const ty = Number(img.dataset.ty) || 0;
    img.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${zoom})`;
    img.style.cursor = zoom > 1 ? 'grab' : '';
  };

  // 확대 시 드래그 이동
  let dragImg = null, dragStart = null;
  scroller.addEventListener('pointerdown', (e) => {
    const img = e.target.closest('.srch-fs-img');
    if (!img || Number(img.dataset.zoom) <= 1) return;
    dragImg = img; dragStart = { x: e.clientX, y: e.clientY, tx: Number(img.dataset.tx) || 0, ty: Number(img.dataset.ty) || 0 };
    img.style.cursor = 'grabbing';
    img.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!dragImg || !dragStart) return;
    dragImg.dataset.tx = dragStart.tx + (e.clientX - dragStart.x);
    dragImg.dataset.ty = dragStart.ty + (e.clientY - dragStart.y);
    applyTransform(dragImg);
  });
  scroller.addEventListener('pointerup', () => {
    if (dragImg) dragImg.style.cursor = 'grab';
    dragImg = null; dragStart = null;
  });

  overlay.querySelector('#srchFsRotate').addEventListener('click', () => {
    const img = getCurrentImg();
    if (!img) return;
    img.dataset.rot = (Number(img.dataset.rot) + 90) % 360;
    applyTransform(img);
  });
  overlay.querySelector('#srchFsZoomIn').addEventListener('click', () => {
    const img = getCurrentImg();
    if (!img) return;
    img.dataset.zoom = Math.min(Number(img.dataset.zoom) + 0.5, 4);
    applyTransform(img);
  });
  overlay.querySelector('#srchFsZoomOut').addEventListener('click', () => {
    const img = getCurrentImg();
    if (!img) return;
    const z = Math.max(Number(img.dataset.zoom) - 0.5, 0.5);
    img.dataset.zoom = z;
    if (z <= 1) { img.dataset.tx = 0; img.dataset.ty = 0; }
    applyTransform(img);
  });
  overlay.querySelector('#srchFsDownload').addEventListener('click', async () => {
    const btn = overlay.querySelector('#srchFsDownload');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner"></i> 압축 중...`;
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let ok = 0, fail = 0;
      await Promise.all(imgList.map(async (url, i) => {
        try {
          const proxyUrl = `/api/img?url=${encodeURIComponent(url)}`;
          const res = await fetch(proxyUrl);
          if (!res.ok) throw new Error('fetch fail');
          const blob = await res.blob();
          const ext = blob.type?.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
          const prefix = carNumber ? `${carNumber}_` : '';
          zip.file(`${prefix}${String(i + 1).padStart(2, '0')}.${ext}`, blob);
          ok++;
        } catch {
          fail++;
        }
      }));
      if (ok === 0) throw new Error('모든 이미지 다운로드 실패 (CORS/네트워크)');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = `${carNumber || 'photos'}_사진_${ok}장.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      if (fail > 0) alert(`${ok}장 다운로드 완료 (${fail}장 실패 — CORS 차단)`);
    } catch (e) {
      console.error('[zip download]', e);
      alert('다운로드 실패 — ' + (e.message || e));
    }
    btn.disabled = false;
    btn.innerHTML = `<i class="ph ph-download-simple"></i> ${imgList.length}장`;
  });

  const ac = new AbortController();
  const close = () => { if (overlay.open) overlay.close(); };
  overlay.addEventListener('close', () => { ac.abort(); observer.disconnect(); overlay.remove(); }, { once: true });
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
 * 상세 섹션 공용 렌더러 (.pd-*) — 영업 데스크톱·손님 카탈로그·모바일 공통.
 * 갤러리는 화면별로 다르므로 제외 — 차량정보·대여료·보험·대여조건·기타·수수료 섹션 HTML 만 반환.
 * @param {object} p - 상품
 * @param {object} [opts]
 * @param {'customer'|'agent'|'admin'} [opts.audience] - 노출범위 (없으면 role 추론)
 */
export function renderDetailSections(p, opts = {}) {
  const st0 = opts.store || store;                          // 카탈로그(별도 엔트리)는 자체 store-유사 객체 전달
  const policies = opts.policies || st0.policies || [];
  const role = st0.currentUser?.role;
  const aud = opts.audience || (role === 'admin' ? 'admin'
    : (role === 'agent' || role === 'agent_admin' ? 'agent' : 'customer'));
  const isAdmin = aud === 'admin';
  const canSeeFee = aud === 'admin';
  const D = extractProductDetailRows(p, { canSeeFee, isAdmin, policies });
  const { spec: specRows, cond: condRows, ins: insRows, etc: adminRows, price: priceRows, fee: feeRows, options: optList } = D;
  const policyName = D.policyName || '';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const specByLabel = Object.fromEntries(specRows.map(r => [r[0], r[1]]));
  const condByLabel = Object.fromEntries(condRows.map(r => [r[0], r[1]]));
  const providerName = providerLabelByCode(p.provider_company_code || p.partner_code, st0) || '';
  const vehName = composeVehicleName(p);
  const kv = (l, v) => `<div class="pd-kv"><span class="k">${esc(l)}</span><span class="v">${(v != null && String(v).trim() && String(v).trim() !== '-') ? esc(v) : '-'}</span></div>`;
  const cheapest = priceRows.length ? priceRows.reduce((a, b) => (b.rent < a.rent ? b : a), priceRows[0]) : null;
  const hasKm = priceRows.some(r => r.km);
  const st = p.vehicle_status || '';
  const stCls = /협의/.test(st) ? 'is-consult' : /계약|예약/.test(st) ? 'is-contract' : /불가/.test(st) ? 'is-blocked' : '';

  // 차량정보 — 5단계는 차량명에 있어 행 중복 없음. 선택옵션(full) → 색상 → 연식·주행·연료 → 부가.
  const infoHtml = `<div class="pd-kv full"><span class="k">선택옵션</span><span class="v">${optList.length ? optList.map(o => `<span class="pd-chip">${esc(o)}</span>`).join('') : '-'}</span></div>`
    + [['외부색상', specByLabel['외장색']], ['내부색상', specByLabel['내장색']], ['연식', specByLabel['연식']], ['주행거리', specByLabel['주행']], ['연료', specByLabel['연료']], ['구동방식', specByLabel['구동']], ['배기량', specByLabel['배기량']], ['인승', specByLabel['인승']], ['차종', specByLabel['차종']], ['용도', specByLabel['용도']], ['최초등록', specByLabel['최초등록일']]].map(([l, v]) => kv(l, v)).join('');
  const condHtml = condRows.map(([l, v]) => kv(l, v)).join('');
  const etcHtml = [
    (providerName && aud !== 'customer') ? kv('공급사', providerName) : '',   // 손님엔 공급사 비공개
    (policyName && aud !== 'customer' && !isAdmin) ? kv('정책명', policyName) : '',
    ...specRows.filter(([l]) => ['차령만료일', '차량가격', '차대번호', '위치'].includes(l)).map(([l, v]) => kv(l, v)),
    ...adminRows.map(([l, v]) => kv(l, v)),
  ].join('');

  return `
    <div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>차량정보</div>
      <div class="pd-meta" style="margin:0 0 4px;">
        ${p.car_number ? `<span class="pd-carno" style="font-size:var(--fs-base);font-weight:var(--fw-heavy);color:var(--c-text);">${esc(p.car_number)}</span>` : ''}
        ${p.product_type ? `<span class="pd-tag is-type">${esc(p.product_type)}</span>` : ''}
        ${st ? `<span class="pd-tag ${stCls}">${esc(st)}</span>` : ''}
      </div>
      <div class="pd-name">${esc(vehName) || '-'}</div>
      <div class="pd-spec" style="margin-top:var(--sp-3); border-top:1px solid var(--c-border-soft); padding-top:var(--sp-3);">${infoHtml}</div>
    </div>

    <div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>기간별 대여료</div>
      ${priceRows.length ? `
      <table class="pd-tbl">
        <thead><tr><th>기간</th><th>연주행</th><th>월 대여료</th><th>보증금</th></tr></thead>
        <tbody>${priceRows.map(r => {
          const isBest = cheapest && r.m === cheapest.m && r.km === cheapest.km;
          return `<tr class="${isBest ? 'best' : ''}"><td>${r.m}개월${isBest ? '<span class="pd-best-tag">최저</span>' : ''}</td><td style="color:var(--text-sub);font-size:12px;">${esc(r.km || '-')}</td><td><span class="pd-rent">${fmtMoneyMan(r.rent)}</span></td><td>${fmtMoneyMan(r.dep) || '-'}</td></tr>`;
        }).join('')}</tbody>
      </table>
      ${(() => {
        const parts = [condByLabel['기본연령'], String(condByLabel['약정 주행거리'] || '').replace(/\s*주행$/, ''), condByLabel['보험 포함']].filter(Boolean);
        return parts.length ? `<div class="pd-ins-sub" style="margin-top:6px;text-align:right;">* ${esc(parts.join(' · '))} 기준</div>` : '';
      })()}` : `<div class="pd-empty">가격 미입력</div>`}
    </div>

    <div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>보험</div>
      ${insRows.length ? `
      <table class="pd-tbl">
        <thead><tr><th>항목</th><th>한도</th><th>면책금</th></tr></thead>
        <tbody>${insRows.map(([l, lim, ded]) => `<tr><td>${esc(l)}</td><td>${esc(lim) || '-'}</td><td>${esc(ded) || '-'}</td></tr>`).join('')}</tbody>
      </table>` : `<div class="pd-empty">보험 정보 없음</div>`}
    </div>

    <div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>대여조건${(policyName && aud !== 'customer') ? ` <span class="hint">${esc(policyName)}</span>` : ''}</div>
      ${condHtml ? `<div class="pd-spec">${condHtml}</div>` : `<div class="pd-empty">조건 정보 없음</div>`}
    </div>

    ${etcHtml ? `<div class="pd-sec">
      <div class="pd-sec-h"><span class="bar"></span>기타 정보</div>
      <div class="pd-spec">${etcHtml}</div>
    </div>` : ''}

    ${canSeeFee ? `<div class="pd-sec is-fee">
      <div class="pd-sec-h"><span class="bar"></span>수수료 <span class="hint">내부용</span></div>
      ${feeRows.length ? `
      <table class="pd-tbl">
        <thead><tr><th>기간</th><th>수수료</th><th>비고</th></tr></thead>
        <tbody>${feeRows.map(r => `<tr><td>${r.m}개월</td><td><span class="pd-rent">${fmtMoneyMan(r.fee)}</span></td><td class="pd-ins-sub">${esc(r.fee_memo || '')}</td></tr>`).join('')}</tbody>
      </table>` : `<div class="pd-empty">등록된 수수료 없음</div>`}
    </div>` : ''}
  `;
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

  // audience (renderDetailSections 게이팅용 — 없으면 role 추론)
  const role = store.currentUser?.role;
  const audienceResolved = audience || (role === 'admin' ? 'admin'
    : (role === 'agent' || role === 'agent_admin' ? 'agent' : 'customer'));

  // 갤러리(화면 공용 .srch-gallery) + 공용 섹션(.pd-*). 모바일·손님·영업 동일 섹션.
  container.innerHTML = `
    <div class="srch-detail-inner pd-detail">
      ${renderGallery(imgList, { overlayBadges, reviewTag })}
      ${renderDetailSections(p, { audience: audienceResolved })}
    </div>
  `;

  // 갤러리 바인딩
  const galleryState = { idx: 0 };
  bindGallery(container, imgList, galleryState, onGalleryNav, p.car_number || '');

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
