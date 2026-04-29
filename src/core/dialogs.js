/**
 * core/dialogs.js — 모달 picker 다이얼로그 (영업자/파트너/계약자 선택)
 *
 * 공통 마크업: .pick-overlay > .pick-card (CSS 는 index.html 인라인 정의)
 * 모두 Promise resolve(value | null) 반환. 취소 시 null.
 */
import { store } from './store.js';
import { pushRecord } from '../firebase/db.js';
import { showToast } from './toast.js';
import { esc } from './ui-helpers.js';

export function normalizePhone(s) {
  return String(s || '').replace(/[^\d]/g, '');
}

/* 전화번호 표시 포맷 — 011/010-XXXX-XXXX 또는 02-XXX-XXXX (서울)
 *  자동 하이픈 입력 보조용. digit-only 문자열을 받아 010-1234-5678 형태로 반환. */
export function formatPhone(s) {
  const d = normalizePhone(s);
  if (!d) return '';
  // 서울 02 (2자리 지역번호)
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  // 휴대폰 010/011/016/017/018/019 등 (3자리 시작)
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}

/* 생년월일 — YYMMDD 6자리 강제. YYYYMMDD 입력하면 YY 만 남김. */
export function normalizeBirth6(s) {
  const d = String(s || '').replace(/[^\d]/g, '');
  if (d.length === 8) return d.slice(2);    // YYYYMMDD → YYMMDD
  return d.slice(0, 6);
}

/* YYMMDD 표시 포맷 — YY.MM.DD */
export function formatBirth6(s) {
  const d = normalizeBirth6(s);
  if (!d) return '';
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}`;
}

/* 영업자 선택 — admin 이 계약 생성할 때 호출
 *  agent / agent_admin 활성 사용자 목록. 클릭하면 해당 user 객체, 취소면 null */
export function pickAgent() {
  const agents = (store.users || []).filter(u =>
    (u.role === 'agent' || u.role === 'agent_admin') && u.is_active !== false && !u._deleted
  );
  if (!agents.length) {
    showToast('등록된 영업자가 없습니다', 'error');
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'pick-overlay';
    overlay.innerHTML = `
      <div class="pick-card">
        <div class="pick-head">영업자 선택</div>
        <div class="pick-body">
          ${agents.map(a => `
            <button class="pick-item" data-uid="${esc(a.uid || a._key)}">
              <i class="ph ph-user-circle"></i>
              <div>
                <div class="pick-item-name">${esc(a.name || a.email || '-')}</div>
                <div class="pick-item-sub">${esc([a.user_code, a.company_name, a.role === 'agent_admin' ? '영업관리' : '영업'].filter(Boolean).join(' · '))}</div>
              </div>
            </button>
          `).join('')}
        </div>
        <div class="pick-foot">
          <button class="btn btn-sm" id="pickCancel">취소</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelectorAll('.pick-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.uid;
        close(agents.find(x => (x.uid || x._key) === uid));
      });
    });
    overlay.querySelector('#pickCancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  });
}

/* 파트너 선택 — admin 이 차량/계약 등록 시 호출
 *  type: '공급사' | '영업채널' | '운영사' (기본 공급사) */
export function pickPartner(type = '공급사') {
  const partners = (store.partners || []).filter(p => {
    if (p._deleted || p.is_active === false) return false;
    if (!type) return true;
    const pt = p.partner_type || '공급사';
    return pt === type || (type === '공급사' && pt === 'provider');
  });
  if (!partners.length) {
    showToast(`등록된 ${type}가 없습니다`, 'error');
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'pick-overlay';
    overlay.innerHTML = `
      <div class="pick-card">
        <div class="pick-head">${esc(type)} 선택</div>
        <div class="pick-body">
          ${partners.map(p => {
            const code = p.partner_code || p.company_code || p._key;
            const name = p.partner_name || p.company_name || code;
            return `
              <button class="pick-item" data-code="${esc(code)}">
                <i class="ph ph-buildings"></i>
                <div>
                  <div class="pick-item-name">${esc(name)}</div>
                  <div class="pick-item-sub">${esc(code)}${p.contact_name ? ' · ' + esc(p.contact_name) : ''}</div>
                </div>
              </button>`;
          }).join('')}
        </div>
        <div class="pick-foot">
          <button class="btn btn-sm" id="pickCancel">취소</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelectorAll('.pick-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        const p = partners.find(x => (x.partner_code || x.company_code || x._key) === code);
        close({ partner_code: code, partner_name: p?.partner_name || p?.company_name || code, ...p });
      });
    });
    overlay.querySelector('#pickCancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  });
}

/* 계약자(고객) 결정 — phone 매칭 시 기존 customer 재사용, 없으면 신규 push.
 *  product 전달 시 기간별 대여료/보증금 선택 영역 노출
 *  resolve: { _key, name, phone, period?, rent?, deposit?, ... } 또는 null (취소) */
export function pickOrCreateCustomer(product = null) {
  const customers = store.customers || [];
  // 상품의 기간별 가격 — 가격이 등록된 기간만 노출
  const priceMap = product?.price || {};
  const PERIODS = ['1', '12', '24', '36', '48', '60'];
  const availablePeriods = PERIODS.filter(p => Number(priceMap[p]?.rent) > 0);
  const defaultPeriod = availablePeriods.includes('36') ? '36' : (availablePeriods[0] || '');

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'pick-overlay';
    overlay.innerHTML = `
      <div class="pick-card" style="max-width: 460px;">
        <div class="pick-head">${product ? `${product.car_number || ''} ${product.maker || ''} ${product.sub_model || product.model || ''} — 계약 생성` : '계약자 정보'}</div>
        <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
          ${availablePeriods.length ? `
          <div>
            <div style="font-size:12px; color:var(--text-sub); margin-bottom:4px;">대여 기간</div>
            <div id="cuPeriods" style="display:flex; gap:4px; flex-wrap:wrap;">
              ${availablePeriods.map(m => `<button type="button" class="chip cu-period-chip${m === defaultPeriod ? ' is-active' : ''}" data-m="${m}">${m}개월</button>`).join('')}
            </div>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            <div>
              <div style="font-size:12px; color:var(--text-sub); margin-bottom:4px;">월 대여료</div>
              <input class="input" id="cuRent" readonly>
            </div>
            <div>
              <div style="font-size:12px; color:var(--text-sub); margin-bottom:4px;">보증금</div>
              <input class="input" id="cuDeposit" readonly>
            </div>
          </div>
          ` : (product ? '<div style="font-size:12px; color:var(--accent-orange);">⚠ 등록된 가격 정보가 없습니다</div>' : '')}
          <div style="border-top: 1px solid var(--border-soft); padding-top:10px;">
            <div style="font-size:12px; color:var(--text-sub); margin-bottom:4px;">계약자 정보</div>
            <div style="display:flex; flex-direction: column; gap:8px;">
              <input class="input" id="cuName" placeholder="이름 : 홍길동" autocomplete="off">
              <input class="input" id="cuBirth" placeholder="생년월일 : 90.01.01 (YYMMDD 6자리)" autocomplete="off" inputmode="numeric" maxlength="8">
              <input class="input" id="cuPhone" placeholder="연락처 : 010-0000-0000" autocomplete="off" inputmode="tel" maxlength="13">
              <label style="font-size:12px; color:var(--text-sub); display:flex; align-items:center; gap:6px;">
                <input type="checkbox" id="cuBiz"> 사업자 계약
              </label>
              <input class="input" id="cuBizNo" placeholder="사업자등록번호 : 123-45-67890" style="display:none;">
              <input class="input" id="cuBizName" placeholder="법인/상호명 : (주)예시" style="display:none;">
              <div id="cuMatch" style="font-size:12px; color:var(--accent-blue); min-height:14px;"></div>
            </div>
          </div>
        </div>
        <div class="pick-foot">
          <button class="btn btn-sm" id="cuCancel">취소</button>
          <button class="btn btn-sm btn-primary" id="cuOk">확인</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 기간 선택 → 대여료/보증금 자동 채움
    let selectedPeriod = defaultPeriod;
    const rentEl = overlay.querySelector('#cuRent');
    const depEl = overlay.querySelector('#cuDeposit');
    const fillPrice = (m) => {
      if (!m || !rentEl || !depEl) return;
      const p = priceMap[m] || {};
      rentEl.value = p.rent ? Math.round(Number(p.rent) / 10000) + '만원' : '-';
      depEl.value = p.deposit ? Math.round(Number(p.deposit) / 10000) + '만원' : '-';
    };
    fillPrice(selectedPeriod);
    overlay.querySelectorAll('.cu-period-chip').forEach(b => {
      b.addEventListener('click', () => {
        overlay.querySelectorAll('.cu-period-chip').forEach(x => x.classList.remove('is-active'));
        b.classList.add('is-active');
        selectedPeriod = b.dataset.m;
        fillPrice(selectedPeriod);
      });
    });

    const nameEl = overlay.querySelector('#cuName');
    const phoneEl = overlay.querySelector('#cuPhone');
    const birthEl = overlay.querySelector('#cuBirth');
    const bizEl = overlay.querySelector('#cuBiz');
    const bizNoEl = overlay.querySelector('#cuBizNo');
    const bizNameEl = overlay.querySelector('#cuBizName');
    const matchEl = overlay.querySelector('#cuMatch');

    bizEl.addEventListener('change', () => {
      const on = bizEl.checked;
      bizNoEl.style.display = bizNameEl.style.display = on ? '' : 'none';
    });

    // 전화번호 자동 하이픈
    phoneEl.addEventListener('input', () => {
      const formatted = formatPhone(phoneEl.value);
      if (formatted !== phoneEl.value) phoneEl.value = formatted;
      const phone = normalizePhone(phoneEl.value);
      if (phone.length < 10) { matchEl.textContent = ''; return; }
      const existing = customers.find(c => normalizePhone(c.phone) === phone);
      if (existing) {
        matchEl.textContent = `기존 고객 매칭: ${existing.name || ''} (계약 ${(store.contracts || []).filter(x => x.customer_uid === existing._key).length}건)`;
        if (!nameEl.value) nameEl.value = existing.name || '';
        if (birthEl && !birthEl.value && existing.birth) birthEl.value = formatBirth6(existing.birth);
      } else {
        matchEl.textContent = '신규 고객으로 등록됩니다';
      }
    });

    // 생년월일 — YYMMDD 6자리만, 자동 점 포맷
    birthEl?.addEventListener('input', () => {
      const formatted = formatBirth6(birthEl.value);
      if (formatted !== birthEl.value) birthEl.value = formatted;
    });

    setTimeout(() => nameEl.focus(), 50);

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#cuCancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('#cuOk').addEventListener('click', () => {
      const name = nameEl.value.trim();
      const phone = normalizePhone(phoneEl.value);
      const birth = normalizeBirth6(birthEl?.value);
      if (!name || phone.length < 10) {
        matchEl.style.color = 'var(--alert-red-text, #dc2626)';
        matchEl.textContent = '이름과 연락처(10자리 이상) 필수';
        return;
      }
      if (birth.length !== 6) {
        matchEl.style.color = 'var(--alert-red-text, #dc2626)';
        matchEl.textContent = '생년월일 6자리(YYMMDD) 입력';
        return;
      }
      const existing = customers.find(c => normalizePhone(c.phone) === phone);
      // 모달은 데이터 수집만 — 실제 저장은 caller (search.js / contract.js) 에서 가계약 생성과 함께
      const customerData = existing
        ? { ...existing, _existing: true, birth: existing.birth || birth }
        : {
            _existing: false,
            name, phone, birth,
            is_business: bizEl.checked,
            business_number: bizEl.checked ? bizNoEl.value.trim() : '',
            company_name: bizEl.checked ? bizNameEl.value.trim() : '',
          };
      // product 가 있었으면 기간/대여료/보증금도 같이 반환
      const period = selectedPeriod || '';
      const priceItem = period ? (priceMap[period] || {}) : {};
      close({
        ...customerData,
        contract_period: period,
        contract_rent: Number(priceItem.rent) || 0,
        contract_deposit: Number(priceItem.deposit) || 0,
      });
    });
  });
}
