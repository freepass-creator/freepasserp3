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
 *  resolve: { _key, name, phone, ... } 또는 null (취소) */
export function pickOrCreateCustomer() {
  const customers = store.customers || [];
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'pick-overlay';
    overlay.innerHTML = `
      <div class="pick-card" style="max-width: 420px;">
        <div class="pick-head">계약자 정보</div>
        <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
          <input class="input" id="cuName" placeholder="이름 *" autocomplete="off">
          <input class="input" id="cuPhone" placeholder="연락처 010-0000-0000 *" autocomplete="off" inputmode="tel">
          <label style="font-size:11px; color:var(--text-sub); display:flex; align-items:center; gap:6px;">
            <input type="checkbox" id="cuBiz"> 사업자 계약
          </label>
          <input class="input" id="cuBizNo" placeholder="사업자등록번호" style="display:none;">
          <input class="input" id="cuBizName" placeholder="법인/상호명" style="display:none;">
          <div id="cuMatch" style="font-size:11px; color:var(--accent-blue); min-height:14px;"></div>
        </div>
        <div class="pick-foot">
          <button class="btn btn-sm" id="cuCancel">취소</button>
          <button class="btn btn-sm btn-primary" id="cuOk">확인</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const nameEl = overlay.querySelector('#cuName');
    const phoneEl = overlay.querySelector('#cuPhone');
    const bizEl = overlay.querySelector('#cuBiz');
    const bizNoEl = overlay.querySelector('#cuBizNo');
    const bizNameEl = overlay.querySelector('#cuBizName');
    const matchEl = overlay.querySelector('#cuMatch');

    bizEl.addEventListener('change', () => {
      const on = bizEl.checked;
      bizNoEl.style.display = bizNameEl.style.display = on ? '' : 'none';
    });

    phoneEl.addEventListener('input', () => {
      const phone = normalizePhone(phoneEl.value);
      if (phone.length < 10) { matchEl.textContent = ''; return; }
      const existing = customers.find(c => normalizePhone(c.phone) === phone);
      if (existing) {
        matchEl.textContent = `기존 고객 매칭: ${existing.name || ''} (계약 ${(store.contracts || []).filter(x => x.customer_uid === existing._key).length}건)`;
        if (!nameEl.value) nameEl.value = existing.name || '';
      } else {
        matchEl.textContent = '신규 고객으로 등록됩니다';
      }
    });

    setTimeout(() => nameEl.focus(), 50);

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#cuCancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('#cuOk').addEventListener('click', async () => {
      const name = nameEl.value.trim();
      const phone = normalizePhone(phoneEl.value);
      if (!name || phone.length < 10) {
        matchEl.style.color = 'var(--accent-red)';
        matchEl.textContent = '이름과 연락처(10자리 이상) 필수';
        return;
      }
      const existing = customers.find(c => normalizePhone(c.phone) === phone);
      if (existing) {
        close({ ...existing, _existing: true });
        return;
      }
      try {
        const ref = await pushRecord('customers', {
          name, phone,
          is_business: bizEl.checked,
          business_number: bizEl.checked ? bizNoEl.value.trim() : '',
          company_name: bizEl.checked ? bizNameEl.value.trim() : '',
          created_at: Date.now(),
          created_by: store.currentUser?.uid || '',
        });
        const newKey = ref?.key || ref;
        close({ _key: newKey, name, phone, is_business: bizEl.checked });
      } catch (e) {
        console.error('[customer create]', e);
        matchEl.style.color = 'var(--accent-red)';
        matchEl.textContent = '저장 실패: ' + (e.message || e);
      }
    });
  });
}
