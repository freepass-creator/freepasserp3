/**
 * pages/partner.js — 파트너 관리 페이지 (v3 ERP)
 *
 * 의존: core/store, firebase/db, core/toast, core/ui-helpers
 * Export: renderPartnerList / renderPartnerDetail / bindPartnerCreate
 */
import { store } from '../core/store.js';
import { setRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import {
  esc, fmtDate, fmtFullTime,
  listBody, emptyState, renderRoomItem,
  setHeadSave, bindFormSave, renderInfoGrid, ffi,
} from '../core/ui-helpers.js';

export function renderPartnerList(partners) {
  const body = listBody('partners');
  if (!body) return;
  if (!Array.isArray(partners)) return;   // 미로드 — prototype 보존
  if (!partners.length) { body.innerHTML = emptyState('파트너가 없습니다'); renderPartnerDetail(null); return; }
  // v2 partners: partner_code (HCAP), partner_name (현대캐피탈)
  const pCode = (pa) => pa.partner_code || pa.company_code || pa._key;
  const pName = (pa) => pa.partner_name || pa.company_name || pCode(pa);
  const sorted = [...partners].sort((a, b) => String(pName(a)).localeCompare(String(pName(b)), 'ko'));
  body.innerHTML = sorted.map((pa, i) => {
    const ptype = pa.partner_type || '';
    const isAgent = ptype === '영업채널' || ptype === 'sales_channel';
    const isOperator = ptype === '운영사' || ptype === 'operator';
    const typeBadge = isAgent ? { txt: '영업', tone: 'orange', icon: 'storefront' }
                     : isOperator ? { txt: '운영', tone: 'red', icon: 'gear' }
                     : { txt: '공급', tone: 'blue', icon: 'buildings' };
    const code = pCode(pa);
    const typeLabel = isAgent ? '영업채널' : (isOperator ? '운영사' : '공급사');
    // 유형별 카운트
    let stats = '';
    if (isAgent) {
      const agentCount = (store.users || []).filter(u => u.agent_channel_code === code).length;
      const ctCount = (store.contracts || []).filter(c => c.agent_channel_code === code).length;
      stats = `영업${agentCount} 계약${ctCount}`;
    } else if (isOperator) {
      const userCount = (store.users || []).filter(u => u.company_code === code).length;
      stats = `사용자${userCount}`;
    } else {
      const carCount = (store.products || []).filter(p => p.provider_company_code === code || p.partner_code === code).length;
      const ctCount = (store.contracts || []).filter(c => c.provider_company_code === code).length;
      stats = `차량${carCount} 계약${ctCount}`;
    }
    // 메인: 파트너명 코드  /  우측: 등록일
    const mainLine = [pName(pa), code].filter(Boolean).join(' ');
    // 보조: 유형 | 담당자 | 연락처 | 통계
    const subParts = [typeLabel, pa.contact_name, pa.phone, stats].filter(Boolean);
    return renderRoomItem({
      id: pa._key,
      icon: typeBadge.icon,
      badge: typeBadge.txt,
      tone: typeBadge.tone,
      name: mainLine,
      time: fmtDate(pa.created_at),
      msg: subParts.join(' | ') || '-',
      meta: '',
      active: i === 0,
    });
  }).join('');
  renderPartnerDetail(sorted[0]);
}

export function renderPartnerDetail(pa) {
  const page = document.querySelector('.pt-page[data-page="partners"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  // [목록(0), 파트너정보(1, 편집), 파트너상세(2 = .ws4-detail, RO), 활동이력(3)]
  const editCard = cards[1], detailCard = cards[2], historyCard = cards[3];

  if (!pa) {
    [editCard, detailCard, historyCard].forEach(c => { if (c) c.querySelector('.ws4-body').innerHTML = emptyState('-'); });
    return;
  }
  const role = store.currentUser?.role;
  const canEdit = role === 'admin';
  const dis = canEdit ? '' : ' disabled';

  // 1. 편집 폼
  if (editCard) {
    const partnerTypeOpts = [
      ['공급사', /(공급|provider)/i],
      ['영업채널', /(영업|sales)/i],
      ['운영사', /(운영|operator)/i],
    ];
    setHeadSave(editCard, '파트너 정보', canEdit, 'partner');
    const lockSel = canEdit ? ' data-edit-lock="1"' : dis;   // select 는 readonly 불가
    // 표준 helper — ffi(label, field, value, dis). dis 빈 문자열이면 readonly+data-edit-lock 자동 부여.
    editCard.querySelector('.ws4-body').innerHTML = `
      <div class="form-grid">
        ${ffi('파트너코드',  'partner_code',    pa.partner_code || pa.company_code || '', dis)}
        ${ffi('파트너명',    'partner_name',    pa.partner_name || pa.company_name || '', dis)}
        <div class="ff"><label>유형</label><select class="input" data-f="partner_type"${lockSel}>${partnerTypeOpts.map(([label, re]) => `<option value="${esc(label)}" ${re.test(pa.partner_type || '공급사') ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
        ${ffi('대표자',      'ceo_name',        pa.ceo_name,        dis)}
        ${ffi('사업자번호',  'business_number', pa.business_number, dis)}
        ${ffi('담당자',      'contact_name',    pa.contact_name,    dis)}
        ${ffi('직급',        'contact_title',   pa.contact_title,   dis)}
        ${ffi('연락처',      'phone',           pa.phone,           dis)}
        ${ffi('이메일',      'email',           pa.email,           dis)}
        ${ffi('주소',        'address',         pa.address,         dis)}
        <div class="ff"><label>비고</label><textarea class="input" data-f="memo" style="height: 50px;"${canEdit ? ' readonly data-edit-lock="1"' : dis}>${esc(pa.memo || '')}</textarea></div>
      </div>
    `;
  }

  // 2. 상세 (계산 카운트)
  if (detailCard) {
    const code = pa.partner_code || pa.company_code || pa._key;
    const cars = (store.products || []).filter(p => p.provider_company_code === code || p.partner_code === code).length;
    const contracts = (store.contracts || []).filter(c => c.provider_company_code === code || c.agent_company === code);
    const thisMonth = (() => {
      const m = new Date(); const y = m.getFullYear(), mo = m.getMonth();
      return contracts.filter(c => { const t = c.created_at; if (!t) return false; const d = new Date(t); return d.getFullYear() === y && d.getMonth() === mo; }).length;
    })();
    const ptype = pa.partner_type || '';
    const isAgentType = ptype === '영업채널' || ptype === 'sales_channel';
    const isOpType = ptype === '운영사' || ptype === 'operator';
    const typeLabel = isAgentType ? '영업채널' : (isOpType ? '운영사' : '공급사');
    const rows = [
      ['파트너코드', code, true],
      ['파트너명', pa.partner_name || pa.company_name, true],
      ['유형', typeLabel],
      ['상태', pa.is_active === false ? '비활성' : '활성'],
      ['직원', pa.staff_count ? pa.staff_count + '명' : ''],
      ['차량', cars + '대'],
      ['계약', contracts.length + '건'],
      ['이번달', thisMonth + '건'],
      ['등록일', fmtDate(pa.created_at), true],
      ['최근 활동', fmtFullTime(pa.last_active_at), true],
    ].filter(([, v]) => v != null && v !== '');
    detailCard.querySelector('.ws4-body').innerHTML = renderInfoGrid(rows);
  }

  // 3. 활동 이력
  if (historyCard) {
    const events = Array.isArray(pa.events) ? [...pa.events].sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
    if (!events.length) {
      historyCard.querySelector('.ws4-body').innerHTML = emptyState('이력 없음');
    } else {
      historyCard.querySelector('.ws4-body').innerHTML = events.map(ev => `
        <div class="timeline-row">
          <span class="text-weak">${esc(fmtFullTime(ev.at))}</span> | ${esc(ev.status || '-')} | ${esc(ev.actor || '시스템')}
          <div class="text-sub">${esc(ev.note || '')}</div>
        </div>
      `).join('');
    }
  }

  if (canEdit) bindFormSave(page, 'partners', pa._key, pa);
}

/* 신규등록은 하단 액션바(setPageActions) 의 createNewPartner 가 처리 — app.js 정의 */
