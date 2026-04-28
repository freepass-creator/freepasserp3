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
  setHeadSave, bindFormSave,
} from '../core/ui-helpers.js';

const ROLE_BADGE = {
  admin:        { txt: '관리', tone: 'red' },
  provider:     { txt: '공급', tone: 'blue' },
  agent_admin:  { txt: '영관', tone: 'orange' },
  agent:        { txt: '영업', tone: 'orange' },
};
const ROLE_LABEL = { admin: '관리자', provider: '공급', agent: '영업', agent_admin: '영업' };

export function renderUserList(users) {
  const body = listBody('users');
  if (!body) return;
  if (!Array.isArray(users)) return;   // 미로드 — prototype 보존
  if (!users.length) { body.innerHTML = emptyState('사용자가 없습니다'); renderUserDetail(null); return; }
  const sorted = [...users].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  body.innerHTML = sorted.map((u, i) => {
    const rb = ROLE_BADGE[u.role] || { txt: '-', tone: 'gray' };
    // 통일 spec: name=이름 직급 / msg=회사·연락처 / meta=상태(활성·대기·비활)
    const namePos = [u.name || u.email?.split('@')[0] || u._key.slice(0, 8), u.position].filter(Boolean).join(' ');
    const status = u.status === 'pending' ? '대기' : (u.is_active === false ? '비활' : '활성');
    return renderRoomItem({
      id: u._key,
      icon: 'user',
      badge: rb.txt,
      tone: rb.tone,
      name: namePos,
      time: fmtTime(u.last_login_at),
      msg: [u.company_name || u.company_code, u.phone].filter(Boolean).join(' · ') || u.email || '-',
      meta: status,
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
  const ROLES = [['admin', '관리자'], ['provider', '공급'], ['agent_admin', '영업관리'], ['agent', '영업']];
  const STATUSES = ['활성', '대기', '반려', '비활성'];
  const currentStatus = u.is_active === false ? '비활성' : (u.status || '활성');
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
        <div class="ff"><label>이름</label><input type="text" class="input" data-f="name" value="${esc(u.name || '')}"${lock}></div>
        <div class="ff"><label>직책</label><input type="text" class="input" data-f="title" value="${esc(u.title || '')}"${lock}></div>
        <div class="ff"><label>이메일</label><input type="text" class="input" data-f="email" value="${esc(u.email || '')}"${lock}></div>
        <div class="ff"><label>역할</label><select class="input" data-f="role"${lockSel}>${ROLES.map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="ff"><label>소속코드</label><select class="input" data-f="company_code"${lockSel}>
          <option value="">-</option>
          ${companies.map(c => `<option value="${esc(c.code)}" ${c.code === u.company_code ? 'selected' : ''}>${esc(c.name)} (${esc(c.code)})</option>`).join('')}
          ${u.company_code && !companies.find(c => c.code === u.company_code) ? `<option value="${esc(u.company_code)}" selected>${esc(u.company_code)}</option>` : ''}
        </select></div>
        <div class="ff"><label>연락처</label><input type="text" class="input" data-f="phone" value="${esc(u.phone || '')}"${lock}></div>
        <div class="ff"><label>상태</label>
          <div data-f="status" style="display:flex; gap:3px; flex-wrap:wrap;">
            ${STATUSES.map(s => `<span class="chip${s === currentStatus ? ' active' : ''}" data-v="${esc(s)}">${esc(s)}</span>`).join('')}
          </div>
        </div>
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
      ['이름', u.name],
      ['직책', u.title],
      ['이메일', u.email, true],
      ['역할', ROLE_LABEL[u.role] || u.role || '-'],
      ['상태', currentStatus],
      ['소속', [u.company_name, u.company_code].filter(Boolean).join(' · '), true],
      ['연락처', u.phone, true],
      ['최근 로그인', fmtFullTime(u.last_login_at), true],
      ['담당 계약', myContracts.length + '건'],
      ['이번달', thisMonth + '건'],
      ['등록일', fmtDate(u.created_at), true],
    ].filter(([, v]) => v != null && v !== '');
    detailCard.querySelector('.ws4-body').innerHTML = `<div class="info-grid">${rows.map(([l, v, full, html]) => `<div class="lab">${esc(l)}</div><div${full ? ' class="full"' : ''}>${html ? v : esc(v)}</div>`).join('')}</div>`;
  }

  // 3. 활동 이력
  if (historyCard) {
    const events = Array.isArray(u.events) ? [...u.events].sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
    if (!events.length) {
      historyCard.querySelector('.ws4-body').innerHTML = u.last_login_at
        ? `<div class="timeline-row"><span class="text-weak">${esc(fmtFullTime(u.last_login_at))}</span> · 로그인</div>`
        : emptyState('이력 없음');
    } else {
      historyCard.querySelector('.ws4-body').innerHTML = events.map(ev => `
        <div class="timeline-row">
          <span class="text-weak">${esc(fmtFullTime(ev.at))}</span> · ${esc(ev.type || '-')}
          <div class="text-sub">${esc(ev.note || '')}</div>
        </div>
      `).join('');
    }
  }

  if (canEdit) bindFormSave(page, 'users', u._key, u);
}
