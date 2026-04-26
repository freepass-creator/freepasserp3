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
const singleProductId = params.get('id');

let _products = [];
let _policies = [];
let _partners = [];
let _agent = null;
let _filter = { search: '', status: 'all', fuel: '' };

const grid = document.getElementById('catGrid');
const searchEl = document.getElementById('catSearch');
const filtersEl = document.getElementById('catFilters');
const agentEl = document.getElementById('catAgent');

// 단일 차량 모드 — 그리드/필터 숨김 (CSS body.is-single)
if (singleProductId) document.body.classList.add('is-single');

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
  if (!_agent || !agentEl) return;
  const role = _agent.role === 'agent_admin' ? '영업관리' : (_agent.role === 'agent' ? '영업' : (_agent.role || ''));
  agentEl.innerHTML = `
    <div class="cat-agent">
      <div class="cat-agent-avatar"><i class="ph ph-user"></i></div>
      <div class="cat-agent-info">
        <div class="cat-agent-name">${esc(_agent.name || _agent.email || '-')}</div>
        <div class="cat-agent-sub">${esc([_agent.company_name, role].filter(Boolean).join(' · '))}</div>
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
    if (_filter.fuel && p.fuel_type !== _filter.fuel) return false;
    if (q) {
      const hay = [p.car_number, p.maker, p.model, p.sub_model, p.trim_name, p.options].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // 비공개 상태 (불가, 상품화) 카탈로그에서 안 보이게 — 수정 가능 (user said only fee/codes/contract hidden)
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
    const sub = [p.year ? p.year + '년' : '', p.fuel_type, p.mileage ? fmtMileage(p.mileage) + 'km' : ''].filter(Boolean).join(' · ');
    const p36 = p.price?.['36'];
    const priceText = p36?.rent ? `${Math.round(p36.rent/10000)}만 <small>/${Math.round((p36.deposit||0)/10000)}만 · 36개월</small>` : '<small>가격 문의</small>';
    return `<div class="cat-card" data-key="${esc(p._key)}">
      <div class="cat-card-img">${imgs[0] ? `<img src="${esc(imgs[0])}" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\\'ph ph-image\\'></i>';">` : '<i class="ph ph-image"></i>'}</div>
      <div class="cat-card-body">
        ${status ? `<span class="cat-card-status ${esc(status)}">${esc(status)}</span>` : ''}
        <div class="cat-card-title">${esc(carName)}</div>
        ${sub ? `<div class="cat-card-sub">${esc(sub)}</div>` : ''}
        <div class="cat-card-price">${priceText}</div>
      </div>
    </div>`;
  }).join('');

  // 카드 클릭 → 상세 모달
  grid.querySelectorAll('.cat-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.key));
  });
}

/* 상세 모달 */
function openDetail(key) {
  const p = _products.find(x => x._key === key);
  if (!p) return;
  closeDetail();   // 기존 모달 제거

  const imgs = [...new Set([...productImages(p), ...productExternalImages(p)])].map(toProxiedImage);
  const carName = `${p.car_number || '-'} ${p.maker || ''} ${p.sub_model || p.model || ''}`.trim();

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

  const photoHtml = imgs.length ? `
    <img class="cat-gallery-main" id="catGalleryMain" src="${esc(imgs[0])}" alt="" loading="lazy">
    ${imgs.length > 1 ? `<div class="cat-gallery-thumbs">
      ${imgs.slice(0, 6).map((u, i) => `<div class="cat-gallery-thumb${i === 0 ? ' active' : ''}" data-img="${esc(u)}"><img src="${esc(u)}" alt="" loading="lazy"></div>`).join('')}
    </div>` : ''}
  ` : `<div class="cat-gallery-main" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);"><i class="ph ph-image" style="font-size:48px;"></i></div>`;

  const wrap = document.createElement('div');
  wrap.className = 'cat-modal';
  wrap.innerHTML = `
    <div class="cat-modal-card">
      <div class="cat-modal-head">
        <div class="cat-modal-title">${esc(carName)}</div>
        <button class="cat-modal-close" aria-label="닫기"><i class="ph ph-x"></i></button>
      </div>
      <div class="cat-modal-body">
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

        <div style="margin-top:20px; display:flex; gap:8px; justify-content:center;">
          ${_agent?.phone ? `<a class="cat-cta" href="tel:${esc(_agent.phone)}" style="padding:12px 24px;font-size:14px;"><i class="ph ph-phone"></i> ${esc(_agent.name || '담당자')} 전화</a>` : `<a class="cat-cta" href="tel:1588-0000" style="padding:12px 24px;font-size:14px;"><i class="ph ph-phone"></i> 전화 문의</a>`}
          <button class="cat-cta" id="catInquiryBtn" style="padding:12px 24px;font-size:14px; background:var(--accent-green);"><i class="ph ph-chat-circle-text"></i> 상담 요청</button>
        </div>
      </div>
      <div class="cat-inquiry" id="catInquiryForm" style="display:none;">
        <input id="inqName" placeholder="성함" required>
        <input id="inqPhone" placeholder="연락처 (010-0000-0000)" type="tel" required>
        <textarea id="inqMsg" placeholder="문의 내용 (선택)" rows="3"></textarea>
        <button class="cat-inquiry-cta" id="inqSend">문의 보내기</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelector('.cat-modal-close').addEventListener('click', closeDetail);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeDetail(); });
  document.addEventListener('keydown', escClose);

  // 상담 요청 폼 토글 + 전송
  wrap.querySelector('#catInquiryBtn')?.addEventListener('click', () => {
    const form = wrap.querySelector('#catInquiryForm');
    if (form) form.style.display = 'flex';
  });
  wrap.querySelector('#inqSend')?.addEventListener('click', async () => {
    const name = wrap.querySelector('#inqName').value.trim();
    const phone = wrap.querySelector('#inqPhone').value.trim();
    const msg = wrap.querySelector('#inqMsg').value.trim();
    if (!name || !phone) { alert('성함과 연락처를 입력해주세요'); return; }
    try {
      await pushRecord('inquiries', {
        product_uid: p._key,
        product_code: p.product_code || '',
        car_number: p.car_number || '',
        maker: p.maker || '',
        model: p.model || '',
        sub_model: p.sub_model || '',
        agent_code: agentCode || '',
        provider_company_code: p.provider_company_code || '',
        visitor_name: name,
        visitor_phone: phone,
        message: msg,
        source: singleProductId ? 'catalog-single' : (providerCode ? 'catalog-provider' : 'catalog'),
        created_at: Date.now(),
        status: 'new',
      });
      const form = wrap.querySelector('#catInquiryForm');
      if (form) form.innerHTML = '<div class="cat-inquiry-done"><i class="ph ph-check-circle"></i> 문의가 전송되었습니다. 곧 연락드리겠습니다.</div>';
    } catch (e) {
      console.error('[inquiry]', e);
      alert('전송 실패 — ' + (e.message || e));
    }
  });

  // 썸네일 클릭 → 메인 교체
  wrap.querySelectorAll('.cat-gallery-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const main = wrap.querySelector('#catGalleryMain');
      if (main) main.src = thumb.dataset.img;
      wrap.querySelectorAll('.cat-gallery-thumb').forEach(t => t.classList.remove('active'));
      thumb.classList.add('active');
    });
  });

  // Drive 폴더면 비동기 fetch 후 갤러리 교체
  const driveSrc = supportedDriveSource(p);
  if (driveSrc && !p._drive_folder_virtual) {
    import('./core/drive-photos.js').then(m => {
      m.fetchDriveFolderImages(driveSrc).then(urls => {
        if (!urls?.length) return;
        p.image_urls = urls; p._drive_folder_virtual = true;
        if (document.body.contains(wrap)) {
          closeDetail();
          openDetail(key);
        }
      }).catch(() => {});
    });
  }
}

function closeDetail() {
  document.querySelector('.cat-modal')?.remove();
  document.removeEventListener('keydown', escClose);
  // 단일 차량 모드 → 닫기 시 전체 카탈로그 노출
  if (document.body.classList.contains('is-single')) {
    document.body.classList.remove('is-single');
  }
}
function escClose(e) { if (e.key === 'Escape') closeDetail(); }

/* 검색·필터 바인딩 */
searchEl?.addEventListener('input', (e) => {
  _filter.search = e.target.value.trim();
  renderGrid();
});

filtersEl?.querySelectorAll('.cat-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const val = chip.dataset.f;
    // 상태 chip (전체/즉시/협의) — 단일 토글
    if (val === 'all' || val === '즉시' || val === '협의') {
      filtersEl.querySelectorAll('.cat-chip[data-f="all"], .cat-chip[data-f="즉시"], .cat-chip[data-f="협의"]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _filter.status = val;
    } else {
      // 연료 chip — 토글 (이미 active 면 해제)
      const isActive = chip.classList.contains('active');
      filtersEl.querySelectorAll('.cat-chip[data-f="가솔린"], .cat-chip[data-f="디젤"], .cat-chip[data-f="하이브리드"], .cat-chip[data-f="전기"]').forEach(c => c.classList.remove('active'));
      if (!isActive) {
        chip.classList.add('active');
        _filter.fuel = val;
      } else {
        _filter.fuel = '';
      }
    }
    renderGrid();
  });
});

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

  // ?id 단일 차량 모드 — 데이터 도착 후 자동 오픈
  if (singleProductId && !document.querySelector('.cat-modal')) {
    const target = _products.find(x => x._key === singleProductId);
    if (target) {
      const carName = `${target.maker || ''} ${target.sub_model || target.model || ''}`.trim() || target.car_number;
      document.title = `${carName} — freepass`;
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', carName);
      const sub = [target.year ? target.year + '년' : '', target.fuel_type, target.mileage ? Number(target.mileage).toLocaleString() + 'km' : ''].filter(Boolean).join(' · ');
      document.querySelector('meta[property="og:description"]')?.setAttribute('content', sub || '장기렌트 차량 안내');
      openDetail(singleProductId);
    } else if (_products.length) {
      // 데이터는 로드됐는데 해당 id 차량 없음 → 단일 모드 해제 + 전체 카탈로그 노출
      document.body.classList.remove('is-single');
    }
  }
});
