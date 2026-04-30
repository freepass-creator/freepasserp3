/**
 * pages/user.js — 사용자 관리 페이지 (v3 ERP)
 *
 * 의존: core/store, core/ui-helpers
 * Export: renderUserList / renderUserDetail
 *
 * 신규 사용자 추가는 self-signup (sign 카드) 으로. admin 의 직접 추가 UI 는 미구현.
 */
import { store } from '../core/store.js';
import {
  esc, fmtDate, fmtTime, fmtFullTime,
  listBody, emptyState, renderRoomItem,
  setHeadSave, bindFormSave, renderInfoGrid, ffi,
} from '../core/ui-helpers.js';

const ROLE_BADGE = {
  admin:         { txt: '관리', tone: 'red' },
  provider:      { txt: '공급', tone: 'blue' },
  agent_admin:   { txt: '영관', tone: 'orange' },
  agent_manager: { txt: '영관', tone: 'orange' },   // legacy alias
  agent:         { txt: '영업', tone: 'orange' },
};
const ROLE_LABEL = {
  admin: '관리자', provider: '공급사', agent: '영업자',
  agent_admin: '영업관리자', agent_manager: '영업관리자',
};

// 사용자 목록 필터 (전역 — 사이드바 chip + 소속코드 dropdown 이 갱신)
//  status: 'all' / 'active' / 'pending'
//  company_code: 'all' / 특정 코드
export const userFilter = { status: 'all', company_code: 'all' };

/** 상태 정규화 — 'active'/'approved'/undefined → 'active' / 'pending'/'rejected'/inactive → 'pending' */
function normalizeStatus(u) {
  if (u.status === 'pending') return 'pending';
  if (u.status === 'rejected') return 'pending';      // 반려도 대기로 통일
  if (u.is_active === false) return 'pending';        // 비활성도 대기로 통일
  return 'active';
}

export function renderUserList(users) {
  const body = listBody('users');
  if (!body) return;
  if (!Array.isArray(users)) return;   // 미로드 — prototype 보존
  // 1) 필터 적용 — userFilter.status / company_code
  let filtered = users.filter(u => !u._deleted);
  if (userFilter.status !== 'all') {
    filtered = filtered.filter(u => normalizeStatus(u) === userFilter.status);
  }
  if (userFilter.company_code !== 'all') {
    filtered = filtered.filter(u => u.company_code === userFilter.company_code);
  }
  if (!filtered.length) { body.innerHTML = emptyState('해당 사용자가 없습니다'); renderUserDetail(null); return; }
  // 2) 정렬 — 대기 우선, 그 다음 이름 가나다
  const sorted = [...filtered].sort((a, b) => {
    const sa = normalizeStatus(a), sb = normalizeStatus(b);
    if (sa !== sb) return sa === 'pending' ? -1 : 1;     // pending 우선
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
  body.innerHTML = sorted.map((u, i) => {
    const roleLabel = ROLE_LABEL[u.role] || u.role || '-';
    const norm = normalizeStatus(u);
    // 메인: 역할 | 이름 | 이메일(계정)
    const mainParts = [
      roleLabel,
      u.name || u.email?.split('@')[0] || u._key.slice(0, 8),
      u.email,
    ].filter(Boolean);
    // 보조: 소속 | 직급 | 연락처
    const subParts = [
      u.company_name || u.company_code,
      u.position || u.title,
      u.phone,
    ].filter(Boolean);
    return renderRoomItem({
      id: u._key,
      icon: norm === 'pending' ? 'clock' : 'check-circle',
      badge: norm === 'pending' ? '대기' : '승인',
      tone: norm === 'pending' ? 'orange' : 'green',
      name: mainParts.join(' | '),
      time: fmtDate(u.last_login_at || u.created_at),
      msg: subParts.join(' | ') || '-',
      active: i === 0,
    });
  }).join('');
  renderUserDetail(sorted[0]);
}

export function renderUserDetail(u) {
  const page = document.querySelector('.pt-page[data-page="users"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  const editCard = cards[1], detailCard = cards[2], historyCard = cards[3];

  if (!u) {
    [editCard, detailCard, historyCard].forEach(c => { if (c) c.querySelector('.ws4-body').innerHTML = emptyState('-'); });
    return;
  }

  const role = store.currentUser?.role;
  const canEdit = role === 'admin';
  const dis = canEdit ? '' : ' disabled';
  const ROLES = [['admin', '관리자'], ['provider', '공급사'], ['agent_admin', '영업관리자'], ['agent', '영업자']];
  const STATUSES = [['active', '승인'], ['pending', '대기']];
  const currentStatus = normalizeStatus(u);   // 'active' / 'pending'
  // 사용자 소속 회사 후보 — partners 기반. value=partner_code, display=partner_name
  const companies = (store.partners || []).filter(p => !p._deleted).map(p => ({
    code: p.partner_code || p.company_code || p._key,
    name: p.partner_name || p.company_name || p.partner_code || p._key,
  })).filter(p => p.code);

  // 1. 편집
  if (editCard) {
    setHeadSave(editCard, '사용자 정보', canEdit, 'user');
    const lock = canEdit ? ' readonly data-edit-lock="1"' : dis;
    const lockSel = canEdit ? ' data-edit-lock="1"' : dis;
    editCard.querySelector('.ws4-body').innerHTML = `
      <div class="form-grid">
        ${ffi('이름',   'name',  u.name,  dis)}
        ${ffi('직책',   'title', u.title, dis)}
        ${ffi('이메일', 'email', u.email, dis)}
        <div class="ff"><label>역할</label><select class="input" data-f="role"${lockSel}>${ROLES.map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="ff"><label>소속코드</label><select class="input" data-f="company_code"${lockSel}>
          <option value="">-</option>
          ${companies.map(c => `<option value="${esc(c.code)}" ${c.code === u.company_code ? 'selected' : ''}>${esc(c.name)} (${esc(c.code)})</option>`).join('')}
          ${u.company_code && !companies.find(c => c.code === u.company_code) ? `<option value="${esc(u.company_code)}" selected>${esc(u.company_code)}</option>` : ''}
        </select></div>
        ${ffi('연락처', 'phone', u.phone, dis)}
        <div class="ff"><label>상태</label><select class="input" data-f="status"${lockSel}>${STATUSES.map(([k, v]) => `<option value="${k}" ${k === currentStatus ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="ff"><label>비고</label><textarea class="input" data-f="memo" style="height: 50px;"${lock}>${esc(u.memo || '')}</textarea></div>
      </div>
    `;
  }

  // 2. 상세
  if (detailCard) {
    const myContracts = (store.contracts || []).filter(c => c.agent_uid === u.uid || c.created_by === u.uid);
    const thisMonth = (() => {
      const m = new Date(); const y = m.getFullYear(), mo = m.getMonth();
      return myContracts.filter(c => { const t = c.created_at; if (!t) return false; const d = new Date(t); return d.getFullYear() === y && d.getMonth() === mo; }).length;
    })();
    const rows = [
      ['이름', u.name, true],
      ['직책', u.title, true],
      ['이메일', u.email, true],
      ['역할', ROLE_LABEL[u.role] || u.role || '-', true],
      ['상태', currentStatus, true],
      ['소속', [u.company_name, u.company_code].filter(Boolean).join(' | '), true],
      ['연락처', u.phone, true],
      ['최근 로그인', fmtFullTime(u.last_login_at), true],
      ['담당 계약', myContracts.length + '건', true],
      ['이번달', thisMonth + '건', true],
      ['등록일', fmtDate(u.created_at), true],
    ].filter(([, v]) => v != null && v !== '');
    detailCard.querySelector('.ws4-body').innerHTML = renderInfoGrid(rows);
  }

  // 3. 활동 이력
  if (historyCard) {
    const events = Array.isArray(u.events) ? [...u.events].sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
    if (!events.length) {
      historyCard.querySelector('.ws4-body').innerHTML = u.last_login_at
        ? `<div class="timeline-row"><span class="text-weak">${esc(fmtFullTime(u.last_login_at))}</span> | 로그인</div>`
        : emptyState('이력 없음');
    } else {
      historyCard.querySelector('.ws4-body').innerHTML = events.map(ev => `
        <div class="timeline-row">
          <span class="text-weak">${esc(fmtFullTime(ev.at))}</span> | ${esc(ev.type || '-')}
          <div class="text-sub">${esc(ev.note || '')}</div>
        </div>
      `).join('');
    }
  }

  if (canEdit) bindFormSave(page, 'users', u._key, u);
}
