/**
 * freepass 카탈로그 — 손님 공개 페이지 (v2 패턴)
 * URL 파라미터:
 *   ?p={partner_code}  → 공급사별 카탈로그 (해당 공급사 차량만 + 브랜드 자동)
 *   ?a={agent_code}    → 영업자 카드 표시 (전화·vCard)
 *   ?id={product_key}  → 단일 차량 모드 (모달 자동 오픈, 그리드 숨김)
 * 정책: 수수료 / 모든 코드 / 계약·정산 일체 비공개. 그 외 모두 공개
 */
import { watchCollection, pushRecord } from './firebase/db.js';
import { auth } from './firebase/config.js';
import { signInAnonymously } from 'firebase/auth';
import { ref as dbRef, get } from 'firebase/database';
import { db } from './firebase/config.js';
import { productImages, productExternalImages, supportedDriveSource, toProxiedImage } from './core/product-photos.js';
import { enrichProductsWithPolicy } from './core/policy-utils.js';
import { extractProductDetailRows } from './core/product-detail-rows.js';

// 익명 인증 — policies 읽기 위해 필요 (auth != null 룰 통과)
signInAnonymously(auth).catch(e => console.warn('[catalog] 익명 인증 실패:', e?.message || e));

// URL 파라미터
const params = new URLSearchParams(location.search);
const providerCode = params.get('p');
const agentCode = params.get('a');
const singleProductId = params.get('id') || params.get('pid');
const singleCarNumber = params.get('car');   // 차량번호로 단일 상품 모드

let _products = [];
let _policies = [];
let _partners = [];
let _agent = null;
let _filter = {
  search: '', status: 'all',
  fuels: new Set(),                                  // 연료 다중 선택
  // 구간 필터 — 다중 선택. preset 인덱스 set 으로 저장. 여러 구간 OR 매칭
  rentIdx: new Set(),
  depositIdx: new Set(),
  yearIdx: new Set(),
  mileageIdx: new Set(),
};

const grid = document.getElementById('catGrid');
const searchEl = document.getElementById('catSearch');
const filtersEl = document.getElementById('catFilters');
const agentEl = document.getElementById('catAgent');

// 단일 차량 모드 — 그리드/필터 숨김 (CSS body.is-single). ?id / ?pid / ?car 모두 지원
if (singleProductId || singleCarNumber) document.body.classList.add('is-single');

// 영업자 정보 로드 (한 번)
if (agentCode) {
  loadAgent().then(renderAgent).catch(e => console.warn('[catalog] 영업자 로드 실패:', e?.message || e));
}

async function loadAgent() {
  const snap = await get(dbRef(db, 'users'));
  const users = snap.val() || {};
  _agent = Object.values(users).find(u => u.user_code === agentCode) || null;
}

function renderAgent() {
  if (!_agent) return;
  const role = _agent.role === 'agent_admin' ? '영업관리' : (_agent.role === 'agent' ? '영업' : (_agent.role || ''));
  // 영업자 회사 이름으로 브랜드 텍스트 갱신 (freepass 노출 X)
  const senderName = _agent.company_name || _agent.name || '';
  if (senderName) {
    const brandText = document.getElementById('catBrandText');
    if (brandText) brandText.textContent = senderName;
    if (!singleProductId && !singleCarNumber) {
      document.title = senderName;
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', senderName);
    }
  }
  // 하단 sticky 탭바 — 영업담당자 이름/직급/회사 + 전화 CTA
  const bbName = document.getElementById('catBbName');
  const bbSub = document.getElementById('catBbSub');
  const bbCta = document.getElementById('catBbCta');
  if (bbName) bbName.textContent = _agent.name || _agent.email || '담당자';
  if (bbSub) bbSub.textContent = [_agent.title || _agent.position, role, _agent.company_name].filter(Boolean).join(' | ') || '전화 문의';
  if (bbCta && _agent.phone) {
    bbCta.href = `tel:${_agent.phone.replace(/[^0-9]/g, '')}`;
  }
  if (!agentEl) return;
  agentEl.innerHTML = `
    <div class="cat-agent">
      <div class="cat-agent-avatar"><i class="ph ph-user"></i></div>
      <div class="cat-agent-info">
        <div class="cat-agent-name">${esc(_agent.name || _agent.email || '-')}</div>
        <div class="cat-agent-sub">${esc([_agent.company_name, role].filter(Boolean).join(' | '))}</div>
      </div>
      <div class="cat-agent-actions">
        ${_agent.phone ? `<a class="cat-agent-btn" href="tel:${esc(_agent.phone)}"><i class="ph ph-phone"></i> 전화</a>` : ''}
        <button class="cat-agent-btn" id="catSaveVcf"><i class="ph ph-address-book"></i> 저장</button>
      </div>
    </div>
  `;
  document.getElementById('catSaveVcf')?.addEventListener('click', () => downloadVcf(_agent));
}

function downloadVcf(a) {
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${a.name||''}\nORG:${a.company_name||''}\nTITLE:${a.title||a.position||''}\nTEL:${a.phone||''}\nEMAIL:${a.email||''}\nEND:VCARD`;
  const blob = new Blob([vcard], { type: 'text/vcard' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${a.name||'contact'}.vcf`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtMileage(m) { return m ? Number(m).toLocaleString() : '-'; }
function fmtMoney(v) {
  const n = Number(v); if (!n) return '';
  return n >= 10000 ? Math.round(n/10000) + '만' : n.toLocaleString();
}
function fmtDate(v) {
  const d = String(v ?? '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.length === 8) return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
  if (d.length === 6) return `20${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`;
  return String(v ?? '').trim();
}
function shortStatus(s) {
  return ({
    '즉시': '즉시', '즉시 가능': '즉시',
    '출고가능': '가능', '출고 가능': '가능', '가능': '가능',
    '출고협의': '협의', '출고 협의': '협의', '협의': '협의',
    '상품화': '상품',
  })[s] || s;
}

/* 공급사 코드 → 회사명 lookup (코드는 노출 X) */
function providerNameOf(code) {
  if (!code) return '';
  const found = (_partners || []).find(p =>
    p.partner_code === code || p.company_code === code || p._key === code
  );
  return found?.partner_name || found?.company_name || code;
}

function applyFilter() {
  const q = _filter.search.toLowerCase();
  return _products.filter(p => {
    if (p._deleted) return false;
    if (_filter.status !== 'all') {
      const s = p.vehicle_status || '';
      if (_filter.status === '즉시' && !/즉시/.test(s)) return false;
      if (_filter.status === '협의' && !/협의/.test(s)) return false;
    }
    if (_filter.fuels.size && !_filter.fuels.has(p.fuel_type)) return false;
    // 다중 선택 구간 매칭 — 선택된 preset 중 하나라도 매치하면 통과
    const matchAnyRange = (idxSet, presetItems, val) => {
      if (!idxSet.size) return true;
      for (const i of idxSet) {
        const it = presetItems[i]; if (!it) continue;
        if (it.min != null && val < it.min) continue;
        if (it.max != null && val > it.max) continue;
        return true;
      }
      return false;
    };
    if (!matchAnyRange(_filter.rentIdx, RANGE_PRESETS.rent.items, Number(p.price?.['24']?.rent || 0) / 10000)) return false;
    if (!matchAnyRange(_filter.depositIdx, RANGE_PRESETS.deposit.items, Number(p.price?.['24']?.deposit || 0) / 10000)) return false;
    if (!matchAnyRange(_filter.yearIdx, RANGE_PRESETS.year.items, Number(p.year || 0))) return false;
    if (!matchAnyRange(_filter.mileageIdx, RANGE_PRESETS.mileage.items, Number(p.mileage || 0))) return false;
    if (q) {
      const hay = [p.car_number, p.maker, p.model, p.sub_model, p.trim_name, p.options].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderGrid() {
  if (!grid) return;
  const list = applyFilter();
  if (!list.length) {
    grid.innerHTML = `<div class="cat-empty"><i class="ph ph-car-simple"></i>조건에 맞는 차량이 없습니다</div>`;
    return;
  }
  grid.innerHTML = list.map(p => {
    const imgs = [...productImages(p), ...productExternalImages(p)].map(toProxiedImage);
    const status = shortStatus(p.vehicle_status || '');
    const carName = `${p.car_number || '-'} ${p.maker || ''} ${p.sub_model || p.model || ''}`.trim();
    const sub = [p.year ? p.year + '년' : '', p.fuel_type, p.mileage ? fmtMileage(p.mileage) + 'km' : ''].filter(Boolean).join(' | ');
    const p36 = p.price?.['36'];
    const priceText = p36?.rent ? `${Math.round(p36.rent/10000)}만 <small>/${Math.round((p36.deposit||0)/10000)}만 | 36개월</small>` : '<small>가격 문의</small>';
    const badges = computeCardBadges(p);
    return `<div class="cat-card" data-key="${esc(p._key)}">
      <div class="cat-card-img">
        ${imgs[0] ? `<img src="${esc(imgs[0])}" alt="" loading="lazy" onload="this.classList.add('is-loaded');this.parentElement.querySelector('.cat-card-img-fallback')?.setAttribute('hidden','')" onerror="this.remove()">` : ''}
        <i class="ph ph-car-simple cat-card-img-fallback"></i>
        ${badges.length ? `<div class="cat-card-badges">${badges.map(b => `<span class="cat-card-badge cat-badge-${b.k}">${b.l}</span>`).join('')}</div>` : ''}
      </div>
      <div class="cat-card-body">
        <div class="cat-card-title">${esc(carName)}</div>
        ${sub ? `<div class="cat-card-sub">${esc(sub)}</div>` : ''}
        <div class="cat-card-price">${priceText}</div>
      </div>
    </div>`;
  }).join('');

  // 카드 클릭 → 상세 페이지
  grid.querySelectorAll('.cat-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.key));
  });

  // 진단 로그 — 사진 없는 상품 통계
  let noPhoto = 0, hasDirectOnly = 0, hasDrive = 0, fetchedOk = 0, fetchedEmpty = 0, fetchErr = 0;
  list.forEach(p => {
    const direct = productImages(p).length + productExternalImages(p).length;
    const driveSrc = supportedDriveSource(p);
    if (!direct && !driveSrc) { noPhoto++; return; }
    if (direct) { hasDirectOnly++; }
    if (!direct && driveSrc) hasDrive++;
  });
  console.log(`[catalog] 사진 통계 — 직접: ${hasDirectOnly}건 / Drive·스크래핑 필요: ${hasDrive}건 / 사진 전혀 없음: ${noPhoto}건 (총 ${list.length})`);

  // Drive 폴더만 있는 상품 — 큐(동시 4개)로 throttle. rate limit 방지
  const driveQueue = [];
  list.forEach(p => {
    if (p._drive_folder_virtual) return;
    const has = productImages(p).length || productExternalImages(p).length;
    if (has) return;
    const driveSrc = supportedDriveSource(p);
    if (!driveSrc) return;
    driveQueue.push({ p, driveSrc });
  });
  runDriveFetchQueue(driveQueue, grid);
}

/* Drive/스크래핑 fetch 큐 — 동시 처리 4개로 제한 + 통계 출력 */
let _driveQueueRunning = 0;
const DRIVE_CONCURRENCY = 4;
function runDriveFetchQueue(queue, grid) {
  if (!queue.length) return;
  const totalQueued = queue.length;
  let okCount = 0, emptyCount = 0, errCount = 0;
  const startTime = Date.now();
  console.log(`[catalog] 외부링크 fetch 시작 — ${totalQueued}건 (동시 ${DRIVE_CONCURRENCY}개)`);

  const m = import('./core/drive-photos.js');
  const next = () => {
    while (_driveQueueRunning < DRIVE_CONCURRENCY && queue.length) {
      const { p, driveSrc } = queue.shift();
      _driveQueueRunning++;
      m.then(mod => mod.fetchDriveFolderImages(driveSrc))
        .then(urls => {
          if (urls?.length) {
            okCount++;
            p.image_urls = urls;
            p._drive_folder_virtual = true;
            updateCardThumbnail(grid, p, urls[0]);
          } else {
            emptyCount++;
          }
        })
        .catch(err => {
          errCount++;
          console.warn('[catalog] fetch 에러:', p.car_number, driveSrc, err?.message || err);
        })
        .finally(() => {
          _driveQueueRunning--;
          // 큐가 다 비고 진행중인 것도 없으면 최종 통계 출력
          if (queue.length === 0 && _driveQueueRunning === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[catalog] 외부링크 fetch 완료 (${elapsed}초): 성공 ${okCount}건 / 빈응답 ${emptyCount}건 / 에러 ${errCount}건`);
          }
          next();
        });
    }
  };
  next();
}

function updateCardThumbnail(grid, p, firstUrl) {
  const card = grid.querySelector(`.cat-card[data-key="${CSS.escape(p._key)}"]`);
  if (!card) return;
  const wrap = card.querySelector('.cat-card-img');
  if (!wrap) return;
  const url = toProxiedImage(firstUrl);
  let img = wrap.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.loading = 'lazy';
    img.onload = () => {
      img.classList.add('is-loaded');
      wrap.querySelector('.cat-card-img-fallback')?.setAttribute('hidden', '');
    };
    img.onerror = () => img.remove();
    wrap.insertBefore(img, wrap.firstChild);
  } else {
    img.classList.remove('is-loaded');
  }
  img.src = url;
}

/* 카드 뱃지 — 즉시 / 신차 / 짧은Km 만, 최대 3개 */
function computeCardBadges(p) {
  const Y = new Date().getFullYear();
  const out = [];
  if (/즉시/.test(p.vehicle_status || '')) out.push({ k: 'now', l: '즉시' });
  if (Number(p.year) >= Y - 1) out.push({ k: 'new', l: '신차' });
  const mi = Number(p.mileage);
  if (mi > 0 && mi < 30000) out.push({ k: 'lowkm', l: '짧은Km' });
  return out;
}

/* 상세 페이지 — 모달이 아니라 SPA 페이지 전환 */
function openDetail(key) {
  const p = _products.find(x => x._key === key);
  if (!p) return;

  const imgs = [...new Set([...productImages(p), ...productExternalImages(p)])].map(toProxiedImage);
  const carName = `${p.car_number || '-'} ${p.maker || ''} ${p.sub_model || p.model || ''}`.trim();

  // 상단바 차량명/세부 갱신
  document.getElementById('catDetailCar').textContent = p.car_number || '-';
  document.getElementById('catDetailSub').textContent = [p.maker, p.sub_model || p.model, p.trim_name].filter(Boolean).join(' ');
  // 페이지 전환 — 본문 영역 detail 모드로
  document.body.classList.add('is-detail');
  // 스크롤 위로
  window.scrollTo(0, 0);
  // history state 추가 (브라우저 뒤로가기 지원)
  if (history.state?.detail !== p._key) {
    history.pushState({ detail: p._key }, '', '#' + (p.car_number || p._key));
  }

  // 6섹션 row — ERP 와 동일 헬퍼 (라벨/매핑/정책 fallback 통일)
  // 카탈로그는 수수료/관리자정보 비공개: canSeeFee=false, isAdmin=false
  const rowData = extractProductDetailRows(p, { canSeeFee: false, isAdmin: false, policies: _policies });
  const pol = rowData.policy;
  const basicRows = rowData.basic;
  const specRows  = rowData.spec;
  const insRows   = rowData.ins;
  const condRows  = rowData.cond;
  const opts      = rowData.options;
  const priceRows = rowData.price;

  const renderRows = (rows) => rows.filter(([, v]) => v != null && v !== '' && v !== '-').map(([l, v, full]) => `<div class="lab">${esc(l)}</div><div class="val${full ? ' full' : ''}">${esc(v)}</div>`).join('');

  // 공급사 정보 (이름만, 코드 X) + 메모
  const providerName = providerNameOf(p.provider_company_code);
  const memo = p.partner_memo || p.note || '';

  // 메인 이미지 + (2장 이상이면) 썸네일 strip. 사진 없는 케이스 별도 시각화
  const driveSrc = supportedDriveSource(p);
  const noPhotoHtml = imgs.length === 0
    ? (driveSrc
        ? `<div class="cat-gallery-empty cat-empty-loading"><i class="ph ph-spinner-gap"></i><span>사진 불러오는 중...</span></div>`
        : `<div class="cat-gallery-empty cat-empty-none"><i class="ph ph-image-square"></i><span>등록된 사진이 없습니다</span></div>`)
    : '';
  const photoHtml = `
    <div class="cat-gallery-stage">
      ${imgs.length ? `<img class="cat-gallery-main" id="catGalleryMain" src="${esc(imgs[0])}" alt="" onload="this.classList.add('is-loaded')" onerror="this.remove()">` : noPhotoHtml}
    </div>
    ${imgs.length > 1 ? `<div class="cat-gallery-thumbs">
      ${imgs.map((u, i) => `<img class="cat-gallery-thumb${i === 0 ? ' is-active' : ''}" src="${esc(u)}" data-img="${esc(u)}" data-idx="${i}" alt="" onerror="console.warn('[catalog] thumb 로드 실패:', '${esc(p.car_number || '')}', this.src);this.style.display='none'">`).join('')}
    </div>` : ''}
  `;

  // 상세 페이지 본문 — #catDetailPage 에 렌더 (모달 X)
  const wrap = document.getElementById('catDetailPage');
  wrap.hidden = false;
  wrap.innerHTML = `
      <div class="cat-modal-body" style="padding:16px 0;">
        <div class="cat-section">${photoHtml}</div>

        <div class="cat-section">
          <div class="cat-section-title"><i class="ph ph-info"></i> 기본정보</div>
          <div class="cat-info-grid">${renderRows(basicRows)}</div>
        </div>

        ${specRows.filter(([,v])=>v != null && v !== '').length || opts.length ? `
        <div class="cat-section">
          <div class="cat-section-title"><i class="ph ph-car-simple"></i> 제조사 스펙</div>
          <div class="cat-info-grid">
            ${renderRows(specRows)}
            ${opts.length ? `<div class="lab">옵션</div><div class="val full"><div class="cat-chips-wrap">${opts.map(o => `<span class="cat-option-chip">${esc(o)}</span>`).join('')}</div></div>` : ''}
          </div>
        </div>` : ''}

        ${priceRows.length ? `
        <div class="cat-section">
          <div class="cat-section-title"><i class="ph ph-currency-krw"></i> 기간별 대여료 / 보증금</div>
          <table class="cat-table">
            <thead><tr><th>기간</th><th class="num">대여료</th><th class="num">보증금</th></tr></thead>
            <tbody>${priceRows.map(r => `<tr>
              <td>${r.m}개월</td>
              <td class="num price-rent">${r.rent ? Math.round(r.rent/10000) + '만' : '-'}</td>
              <td class="num">${r.dep ? Math.round(r.dep/10000) + '만' : '-'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : ''}

        ${insRows.length ? `
        <div class="cat-section">
          <div class="cat-section-title"><i class="ph ph-shield-check"></i> 보험 정보</div>
          <table class="cat-table">
            <thead><tr><th>구분</th><th>보장한도</th><th>자기부담금</th></tr></thead>
            <tbody>${insRows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1] || '-')}</td><td>${esc(r[2] || '-')}</td></tr>`).join('')}</tbody>
          </table>
        </div>` : ''}

        ${condRows.filter(([,v])=>v != null && v !== '').length ? `
        <div class="cat-section">
          <div class="cat-section-title"><i class="ph ph-list-checks"></i> 기타 계약 조건</div>
          <div class="cat-info-grid">${renderRows(condRows)}</div>
        </div>` : ''}

        ${(providerName || memo) ? `
        <div class="cat-section">
          <div class="cat-section-title"><i class="ph ph-buildings"></i> 공급사</div>
          <div class="cat-info-grid">
            ${providerName ? `<div class="lab">공급사</div><div class="val full">${esc(providerName)}</div>` : ''}
            ${memo ? `<div class="lab">특이사항</div><div class="val full">${esc(memo)}</div>` : ''}
          </div>
        </div>` : ''}

      </div>
  `;

  // 썸네일 클릭 → 메인 교체 (썸네일이 IMG 자체)
  wrap.querySelectorAll('.cat-gallery-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const main = wrap.querySelector('#catGalleryMain');
      if (main) {
        main.classList.remove('is-loaded');   // fade 재실행
        main.src = thumb.dataset.img;
      }
      wrap.querySelectorAll('.cat-gallery-thumb').forEach(t => t.classList.remove('is-active'));
      thumb.classList.add('is-active');
    });
  });

  // Drive 폴더면 비동기 fetch 후 갤러리 교체 (driveSrc 는 위에서 이미 선언됨)
  if (driveSrc && !p._drive_folder_virtual) {
    import('./core/drive-photos.js').then(m => {
      m.fetchDriveFolderImages(driveSrc).then(urls => {
        if (!urls?.length) return;
        p.image_urls = urls; p._drive_folder_virtual = true;
        if (document.body.classList.contains('is-detail')) {
          openDetail(key);   // 같은 키로 다시 렌더 (이미지 갱신)
        }
      }).catch(() => {});
    });
  }
}

function closeDetail() {
  document.body.classList.remove('is-detail');
  const wrap = document.getElementById('catDetailPage');
  if (wrap) { wrap.hidden = true; wrap.innerHTML = ''; }
  // history 정리
  if (history.state?.detail) history.back();
  // 단일 차량 모드면 닫을 곳 없음 — is-single 유지
}

// 뒤로가기 버튼 + ESC + popstate
document.getElementById('catBackBtn')?.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('is-detail')) closeDetail();
});
window.addEventListener('popstate', () => {
  if (!history.state?.detail) {
    document.body.classList.remove('is-detail');
    const wrap = document.getElementById('catDetailPage');
    if (wrap) { wrap.hidden = true; wrap.innerHTML = ''; }
  }
});

/* 검색·필터 바인딩 */
searchEl?.addEventListener('input', (e) => {
  _filter.search = e.target.value.trim();
  renderGrid();
});

filtersEl?.querySelectorAll('.cat-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    // 전체 — 모든 필터 해제
    if (chip.dataset.act === 'clear') {
      _filter.status = 'all';
      _filter.fuels.clear();
      _filter.rentIdx.clear(); _filter.depositIdx.clear(); _filter.yearIdx.clear(); _filter.mileageIdx.clear();
      filtersEl.querySelectorAll('.cat-range-btn').forEach(b => b.classList.remove('is-active', 'is-open'));
      const presetsEl = document.getElementById('catPresets');
      if (presetsEl) { presetsEl.hidden = true; presetsEl.innerHTML = ''; }
      _activeRangeKey = null;
      updateCategoryBadges();
      renderGrid();
      return;
    }
    // 구간 / 연료 빠른필터 — 아래로 preset chip 펼치기
    if (chip.dataset.range) { toggleCatPresets(chip, chip.dataset.range); return; }
  });
});

let _activeRangeKey = null;
function toggleCatPresets(anchor, key) {
  const presetsEl = document.getElementById('catPresets');
  if (!presetsEl) return;
  // 같은 카테고리 다시 누르면 접기
  if (_activeRangeKey === key) {
    presetsEl.hidden = true;
    presetsEl.innerHTML = '';
    _activeRangeKey = null;
    filtersEl.querySelectorAll('.cat-range-btn').forEach(b => b.classList.remove('is-open'));
    return;
  }
  _activeRangeKey = key;
  filtersEl.querySelectorAll('.cat-range-btn').forEach(b => b.classList.toggle('is-open', b.dataset.range === key));

  let html = '';
  if (key === 'fuel') {
    const fuels = ['가솔린', '디젤', 'LPG', '하이브리드', '전기'];
    html = fuels.map(f => `<button class="cat-preset-chip ${_filter.fuels.has(f) ? 'is-active' : ''}" data-fuel="${f}">${f}</button>`).join('');
  } else {
    const cfg = RANGE_PRESETS[key];
    const idxSet = _filter[key + 'Idx'];
    html = cfg.items.map((it, i) => `<button class="cat-preset-chip ${idxSet.has(i) ? 'is-active' : ''}" data-i="${i}">${it.l}</button>`).join('');
  }
  presetsEl.innerHTML = html;
  presetsEl.hidden = false;
  presetsEl.onclick = presetsClickHandler;
}

function presetsClickHandler(e) {
  const btn = e.target.closest('.cat-preset-chip');
  if (!btn) return;
  if (_activeRangeKey === 'fuel') {
    const f = btn.dataset.fuel;
    if (_filter.fuels.has(f)) _filter.fuels.delete(f); else _filter.fuels.add(f);
    btn.classList.toggle('is-active');
  } else {
    const idxSet = _filter[_activeRangeKey + 'Idx'];
    const i = Number(btn.dataset.i);
    if (idxSet.has(i)) idxSet.delete(i); else idxSet.add(i);
    btn.classList.toggle('is-active');
  }
  updateCategoryBadges();
  renderGrid();
}

/* 각 카테고리 버튼 — 필터 적용 시 작은 점 indicator (숫자 X, 트렌드) */
function updateCategoryBadges() {
  const has = {
    rent: _filter.rentIdx.size > 0,
    deposit: _filter.depositIdx.size > 0,
    year: _filter.yearIdx.size > 0,
    mileage: _filter.mileageIdx.size > 0,
    fuel: _filter.fuels.size > 0,
  };
  filtersEl.querySelectorAll('.cat-range-btn').forEach(btn => {
    const k = btn.dataset.range;
    btn.classList.toggle('is-active', has[k] || false);
  });
}

/* 빠른필터 popover — preset chip 클릭만으로 즉시 적용 (입력칸 없음) */
const Y = new Date().getFullYear();
const RANGE_PRESETS = {
  rent: {
    title: '대여료',
    items: [
      { l: '0~50만', min: 0, max: 50 },
      { l: '50~70만', min: 50, max: 70 },
      { l: '70~100만', min: 70, max: 100 },
      { l: '100만+', min: 100, max: null },
    ],
  },
  deposit: {
    title: '보증금',
    items: [
      { l: '0~100만', min: 0, max: 100 },
      { l: '100~300만', min: 100, max: 300 },
      { l: '300~500만', min: 300, max: 500 },
      { l: '500만+', min: 500, max: null },
    ],
  },
  year: {
    title: '연식',
    // 2년 단위 버킷 — 가장 오래된 → 최신 순. 양 끝은 "이하" / "+"
    items: (() => {
      const y2 = (n) => String(n).slice(-2);
      return [
        { l: `${y2(Y-6)}년 이하`, min: null, max: Y-6 },
        { l: `${y2(Y-6)}~${y2(Y-4)}년`, min: Y-6, max: Y-4 },
        { l: `${y2(Y-4)}~${y2(Y-2)}년`, min: Y-4, max: Y-2 },
        { l: `${y2(Y-2)}~${y2(Y)}년`, min: Y-2, max: Y },
        { l: `${y2(Y)}년+`, min: Y, max: null },
      ];
    })(),
  },
  mileage: {
    title: '주행거리',
    items: [
      { l: '~3만km', min: 0, max: 30000 },
      { l: '3~5만km', min: 30000, max: 50000 },
      { l: '5~10만km', min: 50000, max: 100000 },
      { l: '10만km+', min: 100000, max: null },
    ],
  },
};
function openCatRangePop(anchor, key) {
  document.querySelector('.cat-range-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'cat-range-pop';

  if (key === 'fuel') {
    const fuels = ['가솔린', '디젤', 'LPG', '하이브리드', '전기'];
    pop.innerHTML = `
      <div class="cat-range-title">연료 (다중 선택)</div>
      <div class="cat-preset-list">
        ${fuels.map(f => `<button class="cat-preset-chip ${_filter.fuels.has(f) ? 'is-active' : ''}" data-fuel="${f}">${f}</button>`).join('')}
        <button class="cat-preset-chip cat-preset-reset" data-act="reset">초기화</button>
      </div>
    `;
    pop.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.act === 'reset') {
        _filter.fuels.clear();
        anchor.classList.remove('is-active');
      } else {
        const f = btn.dataset.fuel;
        if (_filter.fuels.has(f)) _filter.fuels.delete(f); else _filter.fuels.add(f);
        anchor.classList.toggle('is-active', _filter.fuels.size > 0);
        btn.classList.toggle('is-active');
      }
      renderGrid();
    });
  } else {
    const cfg = RANGE_PRESETS[key];
    const minK = key + 'Min', maxK = key + 'Max';
    const isMatch = (item) => _filter[minK] === item.min && _filter[maxK] === item.max;
    pop.innerHTML = `
      <div class="cat-range-title">${cfg.title}</div>
      <div class="cat-preset-list">
        ${cfg.items.map((it, i) => `<button class="cat-preset-chip ${isMatch(it) ? 'is-active' : ''}" data-i="${i}">${it.l}</button>`).join('')}
        <button class="cat-preset-chip cat-preset-reset" data-act="reset">초기화</button>
      </div>
    `;
    pop.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.act === 'reset') {
        _filter[minK] = null; _filter[maxK] = null;
        anchor.classList.remove('is-active');
      } else {
        const it = cfg.items[Number(btn.dataset.i)];
        // 같은 preset 다시 누르면 해제
        if (isMatch(it)) {
          _filter[minK] = null; _filter[maxK] = null;
          anchor.classList.remove('is-active');
        } else {
          _filter[minK] = it.min; _filter[maxK] = it.max;
          anchor.classList.add('is-active');
        }
      }
      pop.remove();
      renderGrid();
    });
  }
  document.body.appendChild(pop);
  // 위치 — anchor 아래쪽
  const r = anchor.getBoundingClientRect();
  pop.style.top = (r.bottom + 4) + 'px';
  pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + 'px';

  // 외부 클릭 시 닫기
  setTimeout(() => {
    const onDocClick = (ev) => {
      if (!pop.contains(ev.target) && ev.target !== anchor) {
        pop.remove();
        document.removeEventListener('click', onDocClick);
      }
    };
    document.addEventListener('click', onDocClick);
  }, 0);
}

/* Firebase 데이터 로드 */
watchCollection('policies', (list) => {
  _policies = list || [];
  if (_products.length) {
    _products = enrichProductsWithPolicy(_products, _policies);
    renderGrid();
  }
});
watchCollection('partners', (list) => {
  _partners = list || [];
  // 공급사 카탈로그면 브랜드 자동 갱신 (?p)
  if (providerCode) {
    const partner = _partners.find(p => (p.partner_code || p.company_code || p._key) === providerCode);
    if (partner) {
      const name = partner.partner_name || partner.company_name || providerCode;
      const brandText = document.getElementById('catBrandText');
      if (brandText) brandText.textContent = name;
      document.title = name;
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', name);
    }
  }
  if (_products.length) renderGrid();
});
watchCollection('products', (list) => {
  let raw = list || [];
  // ?p 공급사 필터
  if (providerCode) {
    raw = raw.filter(p =>
      p.provider_company_code === providerCode ||
      p.partner_code === providerCode
    );
  }
  _products = enrichProductsWithPolicy(raw, _policies);
  renderGrid();

  // 단일 차량 모드 — ?id / ?pid / ?car 지원, 데이터 도착 후 자동 오픈
  const isSingle = singleProductId || singleCarNumber;
  if (isSingle && !document.querySelector('.cat-modal')) {
    const target = singleCarNumber
      ? _products.find(x => (x.car_number || '').replace(/\s+/g, '') === singleCarNumber.replace(/\s+/g, ''))
      : _products.find(x => x._key === singleProductId);
    if (target) {
      const carName = `${target.maker || ''} ${target.sub_model || target.model || ''}`.trim() || target.car_number;
      // 보내는 사람 정보(영업자 또는 공급사)로 타이틀 — freepass 노출 X
      const senderLabel = _agent?.company_name || _agent?.name
        || (_partners.find(p => (p.partner_code || p.company_code || p._key) === target.provider_company_code)?.partner_name)
        || '';
      document.title = senderLabel ? `${carName} | ${senderLabel}` : carName;
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
      const sub = [target.year ? target.year + '년' : '', target.fuel_type, target.mileage ? Number(target.mileage).toLocaleString() + 'km' : ''].filter(Boolean).join(' | ');
      document.querySelector('meta[property="og:description"]')?.setAttribute('content', sub || '');
      openDetail(target._key);
    } else if (_products.length) {
      // 데이터는 로드됐는데 해당 차량 없음 → 단일 모드 해제 + 전체 카탈로그 노출
      document.body.classList.remove('is-single');
    }
  }
});
