/**
 * pages/settlement.js — 정산 관리 페이지 (v3 ERP)
 *
 * 의존: core/store, firebase/db, core/toast, core/roles, core/ui-helpers
 * Export: renderSettlementList / renderSettlementDetail / bindSettlementCreate
 */
import { store } from '../core/store.js';
import { updateRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { filterByRole } from '../core/roles.js';
import {
  esc, fmtDate, fmtTime, fmtFullTime,
  listBody, emptyState, renderRoomItem, flashSaved,
  providerNameByCode, formatMainLine, renderInfoGrid,
} from '../core/ui-helpers.js';

const SETTLE_STATUSES = ['미정산', '정산완료', '환수'];
const SETTLE_BADGE = {
  '미정산': { txt: '미정', tone: 'orange' },
  '정산완료': { txt: '완료', tone: 'green' },
  '환수': { txt: '환수', tone: 'red' },
};

function toDateInput(ts) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : (ts?.toMillis?.() || Date.parse(ts) || 0);
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function renderSettlementList(settlements) {
  const body = listBody('settle');
  if (!body) return;
  if (!Array.isArray(settlements)) return;   // 미로드 — prototype 보존
  const visible = filterByRole(settlements, store.currentUser);
  if (!visible.length) { body.innerHTML = emptyState('정산 항목이 없습니다'); renderSettlementDetail(null); return; }
  const sorted = [...visible].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  body.innerHTML = sorted.map((s, i) => {
    const status = s.settlement_status || s.status || '미정산';
    const sb = SETTLE_BADGE[status] || { txt: status.slice(0, 2), tone: 'gray' };
    const fee = s.fee_amount || s.commission || 0;
    const feeText = fee ? `${Math.round(Number(fee)/10000)}만원` : '';
    const settledDate = fmtDate(s.settled_date || s.settled_at || s.created_at);
    // 메인: 차량번호 세부모델 공급사명(한글)  /  우측: 금액 (정산은 금액이 가장 중요한 스캔 정보)
    const mainLine = formatMainLine(
      s.car_number_snapshot || s.car_number,
      s.sub_model_snapshot,
      providerNameByCode(s.provider_company_code || s.partner_code, store),
    );
    // 보조: 영업채널 | 영업자 | 계약자명 | 정산상태 (정산일)
    const statusWithDate = settledDate ? `${status} (${settledDate})` : status;
    const subParts = [
      s.agent_channel_code,
      s.agent_code,
      s.customer_name,
      statusWithDate,
    ].filter(Boolean);
    return renderRoomItem({
      id: s._key,
      icon: status === '정산완료' ? 'check-circle' : status === '환수' ? 'arrow-counter-clockwise' : 'hourglass',
      badge: sb.txt,
      tone: sb.tone,
      name: mainLine,
      time: feeText || '-',
      msg: subParts.join(' | ') || '-',
      meta: s.contract_code || '',
      active: i === 0,
    });
  }).join('');
  renderSettlementDetail(sorted[0]);
}

/* 정산 작업 (편집) + 상세 + 이력 — 우측 3패널 갱신 */
export function renderSettlementDetail(s) {
  const page = document.querySelector('.pt-page[data-page="settle"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  // [목록(0), 정산작업(1), 정산상세(2), 정산이력(3)]
  const workCard = cards[1];
  const detailCard = cards[2];
  const historyCard = cards[3];

  if (!s) {
    if (workCard) workCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    if (detailCard) detailCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    if (historyCard) historyCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    return;
  }

  const role = store.currentUser?.role;
  const canEdit = role === 'admin' || role === 'provider';
  const fee = Number(s.fee_amount || s.commission || 0);
  const baseFee = Number(s.base_fee || 0);
  const status = s.settlement_status || s.status || '미정산';

  // 1. 정산 작업 (편집 폼) — 헤더에 [저장] 버튼 (id="setlSave")
  if (workCard) {
    const disabled = canEdit ? '' : ' disabled';
    const lock = canEdit ? ' readonly data-edit-lock="1"' : '';
    const head = workCard.querySelector('.ws4-head');
    if (head) head.innerHTML = `
      <span>정산 작업</span>
      <div class="spacer" style="flex:1;"></div>
      ${canEdit ? `<button class="btn btn-sm btn-primary" id="setlSave">저장</button>` : ''}
    `;
    workCard.querySelector('.ws4-body').innerHTML = `
      <div class="form-grid">
        <div class="ff"><label>수수료</label><input type="text" class="input" id="setlFee" value="${fee ? fee.toLocaleString() : ''}" style="text-align:right;"${disabled}${lock}></div>
        <div class="ff"><label>정산상태</label>
          <div id="setlStatus" style="display:flex; gap:3px; flex-wrap:wrap;">
            ${SETTLE_STATUSES.map(st => `<span class="chip${st === status ? ' active' : ''}" data-status="${esc(st)}">${esc(st)}</span>`).join('')}
          </div>
        </div>
        <div class="ff"><label>정산일</label><input type="date" class="input" id="setlDate" value="${esc(toDateInput((s.settled_date || s.settled_at)))}"${disabled}${lock}></div>
        <div class="ff"><label>메모</label><textarea class="input" id="setlMemo" placeholder="정산 메모..." style="height: 80px;"${disabled}${lock}>${esc(s.memo || '')}</textarea></div>
        ${baseFee ? `<div class="ff"><label>기본수수료</label><div>${Math.round(baseFee/10000)}만${s.term ? ' | ' + s.term + '개월' : ''}</div></div>` : ''}
      </div>
    `;
    if (canEdit) bindSettleEdit(s);
  }

  // 2. 정산 상세 (read-only)
  if (detailCard) {
    const monthlyRent = s.monthly_rent ? `${Math.round(Number(s.monthly_rent)/10000)}만/월` : '';
    const dep = s.deposit ? `${Math.round(Number(s.deposit)/10000)}만` : '';
    const carLine = [s.car_number, s.maker, s.sub_model || s.model, s.trim_name].filter(Boolean).join(' · ');
    const agentLine = [s.agent_company || s.agent_partner_name, s.agent_name].filter(Boolean).join(' · ');
    const rows = [
      ['계약번호', s.contract_id || s._key, true],
      ['계약자', s.customer_name],
      ['기간', s.term ? s.term + '개월' : ''],
      ['차량', carLine, true],
      ['대여료', monthlyRent],
      ['보증금', dep],
      ['공급사', s.provider_name || s.provider_company_code, true],
      ['영업', agentLine, true],
      ['원수수료', baseFee ? Math.round(baseFee/10000) + '만' : ''],
      ['정산금', fee ? Math.round(fee/10000) + '만' : ''],
      ['정산상태', status, true],
      ['정산일', (s.settled_date || s.settled_at) ? fmtDate((s.settled_date || s.settled_at)) : '-', true],
    ].filter(([, v]) => v != null && v !== '');
    detailCard.querySelector('.ws4-body').innerHTML = renderInfoGrid(rows);
  }

  // 3. 정산 이력
  if (historyCard) {
    const events = Array.isArray(s.events) ? [...s.events].sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
    if (!events.length) {
      historyCard.querySelector('.ws4-body').innerHTML = `
        <div class="timeline-row">
          <span class="text-weak">${esc(fmtFullTime(s.created_at))}</span> | ${esc(status)} | 자동
          <div class="text-sub">정산 항목 생성${baseFee ? ' (' + Math.round(baseFee/10000) + '만)' : ''}</div>
        </div>
      `;
    } else {
      historyCard.querySelector('.ws4-body').innerHTML = events.map(ev => `
        <div class="timeline-row">
          <span class="text-weak">${esc(fmtFullTime(ev.at))}</span> | ${esc(ev.status || '-')} | ${esc(ev.actor || '-')}
          <div class="text-sub">${esc(ev.note || '')}</div>
        </div>
      `).join('');
    }
  }
}

/* 정산 편집 — 수수료/상태/정산일/메모 저장 */
function bindSettleEdit(s) {
  const page = document.querySelector('.pt-page[data-page="settle"]');
  if (!page) return;
  const statusWrap = page.querySelector('#setlStatus');
  statusWrap?.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      statusWrap.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  page.querySelector('#setlSave')?.addEventListener('click', async () => {
    const feeStr = page.querySelector('#setlFee')?.value.replace(/[^\d]/g, '') || '0';
    const dateStr = page.querySelector('#setlDate')?.value || '';
    const memo = page.querySelector('#setlMemo')?.value || '';
    const status = page.querySelector('#setlStatus .chip.active')?.dataset.status || '미정산';
    const settled_at = dateStr ? new Date(dateStr).getTime() : null;

    const update = {
      fee_amount: Number(feeStr) || 0,
      status,
      memo,
      settled_at,
      updated_at: Date.now(),
    };
    const events = Array.isArray(s.events) ? [...s.events] : [];
    events.push({
      at: Date.now(),
      status,
      actor: store.currentUser?.name || store.currentUser?.email || '-',
      note: `${status}${update.fee_amount ? ' | ' + Math.round(update.fee_amount/10000) + '만' : ''}`,
    });
    update.events = events;

    try {
      await updateRecord(`settlements/${s._key}`, update);
      flashSaved([...page.querySelectorAll('#setlFee, #setlDate, #setlMemo')]);
    } catch (e) {
      console.error('[settle] save fail', e);
      alert('저장 실패 — ' + (e.message || e));
    }
  });
}

/* 일괄 정산 — 향후 하단 액션바 액션으로 옮길 예정. 현재는 호출 지점 없음. */
export async function bulkCreateSettlements() {
  const role = store.currentUser?.role;
  if (!(role === 'admin' || role === 'agent_admin')) {
    showToast('일괄 정산은 관리자 전용', 'error');
    return;
  }
  const completed = (store.contracts || []).filter(c => !c._deleted && c.contract_status === '계약완료');
  const existingCodes = new Set((store.settlements || []).map(s => s.contract_code).filter(Boolean));
  const targets = completed.filter(c => !existingCodes.has(c.contract_code));
  if (!targets.length) { showToast('정산 대상 없음 — 모든 계약완료 건이 이미 정산됨', 'info'); return; }
  if (!confirm(`${targets.length}건의 정산을 일괄 생성할까요?`)) return;
  try {
    const { createSettlement } = await import('../firebase/collections.js');
    let ok = 0, fail = 0;
    for (const c of targets) {
      try { await createSettlement(c); ok++; } catch (e) { console.error('[settle]', c.contract_code, e); fail++; }
    }
    showToast(`정산 생성 ${ok}건${fail ? ` | 실패 ${fail}건` : ''}`, fail ? 'error' : 'success');
  } catch (e) {
    console.error('[settle batch]', e);
    showToast('일괄 정산 실패 — ' + (e.message || e), 'error');
  }
}
