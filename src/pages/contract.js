/**
 * pages/contract.js — 계약 관리 페이지 (v3 ERP)
 *
 * Export:
 *   - CONTRACT_STATUSES
 *   - renderContractList, renderContractDetail
 *   - renderContractWorkV2(c) → HTML
 *   - bindContractWorkV2(stepCard, c, { reRender })  // workspace 에서 호출 시 reRender 주입
 *   - createContractFromRoomLocal(room)              // 임시 계약 생성 (workspace 에서 호출)
 *   - makeTempContractCode, allocateRealContractCode
 *
 * 분리 원칙: workspace 의존성 제거 — bindContractWorkV2 가 페이지별 재렌더 콜백을 외부 주입받음.
 */
import { store } from '../core/store.js';
import { pushRecord, updateRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { filterByRole } from '../core/roles.js';
import { STEPS as CONTRACT_STEPS_V2, getStepStates, getProgress } from '../core/contract-steps.js';
import { notifyProviderAndAdmin } from '../core/notify.js';
import { pickAgent, pickOrCreateCustomer } from '../core/dialogs.js';
import {
  esc, fmtDate, fmtTime,
  listBody, emptyState, renderRoomItem, flashSaved,
} from '../core/ui-helpers.js';

export const CONTRACT_STATUSES = ['계약요청', '계약대기', '계약발송', '계약완료', '계약취소'];

const STATUS_BADGE = {
  '계약요청': { txt: '요청', tone: 'blue' },
  '계약대기': { txt: '대기', tone: 'orange' },
  '계약발송': { txt: '발송', tone: 'orange' },
  '계약완료': { txt: '완료', tone: 'green' },
  '계약취소': { txt: '취소', tone: 'red' },
};

/* ── 임시/정식 계약 코드 발급 ── */
export function makeTempContractCode() {
  return 'TMP-' + new Date().getFullYear() + '-' + Date.now().toString(36).toUpperCase().slice(-6);
}

export async function allocateRealContractCode() {
  const dateStr = new Date().toISOString().slice(2,10).replace(/-/g,'').slice(0,4);
  const { nextSequence } = await import('../firebase/collections.js');
  const seq = await nextSequence(`contract_${dateStr}`);
  return `CT${dateStr}${String(seq).padStart(2,'0')}`;
}

export function renderContractList(contracts) {
  const body = listBody('contract');
  if (!body) return;
  let list = (contracts || []).filter(c => !c._deleted);
  list = filterByRole(list, store.currentUser);
  if (!list.length) { body.innerHTML = emptyState('계약이 없습니다'); renderContractDetail(null); return; }
  const sorted = [...list].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  body.innerHTML = sorted.map((c, i) => {
    const status = c.contract_status || '-';
    const sb = STATUS_BADGE[status] || { txt: status.slice(0, 2), tone: 'gray' };
    const carName = `${c.car_number_snapshot || ''} ${c.sub_model_snapshot || c.model_snapshot || ''}`.trim();
    const rent = c.rent_amount_snapshot || c.monthly_rent;
    const term = c.rent_month_snapshot || c.contract_term;
    const price = rent ? `${term ? term + '개월 ' : ''}${Math.round(Number(rent)/10000)}만` : (term ? term + '개월' : '');
    return renderRoomItem({
      id: c.contract_code || c._key,
      icon: 'file-text',
      badge: sb.txt,
      tone: sb.tone,
      name: `${c.contract_code || ''} ${c.customer_name || ''}`.trim() || (c._key.slice(0, 8)),
      time: fmtTime(c.created_at),
      msg: carName || '-',
      meta: price,
      active: i === 0,
    });
  }).join('');
  renderContractDetail(sorted[0]);
}

/* 계약 진행상황 + 상세 + 조건 — 우측 3개 패널 갱신 */
export function renderContractDetail(c) {
  const page = document.querySelector('.pt-page[data-page="contract"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  const [, stepCard, detailCard, condCard] = cards;

  if (!c) {
    if (stepCard) stepCard.querySelector('.ws4-body').innerHTML = emptyState('선택된 계약이 없습니다');
    if (detailCard) detailCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    if (condCard) condCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    return;
  }

  // 1. 진행상황
  if (stepCard) {
    stepCard.querySelector('.ws4-body').innerHTML = renderContractWorkV2(c);
    bindContractWorkV2(stepCard, c, { reRender: () => renderContractDetail(c) });
  }

  // 2. 계약 상세
  if (detailCard) {
    const termN = c.rent_month_snapshot || c.contract_term;
    const rentN = c.rent_amount_snapshot || c.monthly_rent;
    const depN = c.deposit_amount_snapshot || c.deposit;
    const carRows = [
      ['차량번호', c.car_number_snapshot],
      ['제조사', c.maker_snapshot],
      ['모델', c.model_snapshot],
      ['세부모델', c.sub_model_snapshot, true],
      ['차량명', c.vehicle_name_snapshot, true],
      ['연식', c.year_snapshot],
      ['연료', c.fuel_type_snapshot],
      ['색상', c.ext_color_snapshot],
    ].filter(([, v]) => v);
    const rentRows = [
      ['대여기간', termN ? termN + '개월' : ''],
      ['월대여료', rentN ? Math.round(Number(rentN)/10000) + '만' : ''],
      ['보증금', depN ? Math.round(Number(depN)/10000) + '만' : ''],
      ['계약일', fmtDate(c.contract_date), true],
      ['심사기준', c.credit_grade_snapshot, true],
      ['정책명', c.policy_name_snapshot || c.policy_code, true],
    ].filter(([, v]) => v);
    // 같은 customer_uid 의 다른 계약 카운트
    const sameCustomerCount = c.customer_uid
      ? (store.contracts || []).filter(x => x.customer_uid === c.customer_uid && x._key !== c._key && !x._deleted).length
      : 0;
    const customerLabel = sameCustomerCount > 0
      ? `${c.customer_name || ''} · 다른계약 ${sameCustomerCount}건`
      : (c.customer_name || '');
    const partyRows = [
      ['계약자', customerLabel],
      ['생년월일', c.customer_birth],
      ['연락처', c.customer_phone, true],
      ['사업자', c.customer_is_business ? '예' : ''],
      ['배송지', c.delivery_region, true],
      ['영업자', c.agent_name ? `${c.agent_name} (${c.agent_code || ''})` : c.agent_code],
      ['영업코드', c.agent_channel_code],
      ['공급코드', c.provider_company_code, true],
      ['정책코드', c.policy_code],
      ['계약코드', c.contract_code + (c.is_draft ? ' · 임시' : '')],
    ].filter(([, v]) => v);
    const renderRows = (rows) => `<div class="info-grid">${rows.map(([l, v, full, html]) => `<div class="lab">${esc(l)}</div><div${full ? ' class="full"' : ''}>${html ? v : esc(v)}</div>`).join('')}</div>`;
    detailCard.querySelector('.ws4-body').innerHTML = `
      ${carRows.length ? `<div style="color:var(--text-weak); margin-bottom: 4px;"><i class="ph ph-car-simple"></i> 차량정보</div>${renderRows(carRows)}` : ''}
      ${rentRows.length ? `<div style="color:var(--text-weak); margin: 12px 0 4px;"><i class="ph ph-currency-krw"></i> 대여정보</div>${renderRows(rentRows)}` : ''}
      ${partyRows.length ? `<div style="color:var(--text-weak); margin: 12px 0 4px;"><i class="ph ph-users"></i> 관계자</div>${renderRows(partyRows)}` : ''}
    `;
  }

  // 3. 계약 조건
  if (condCard) {
    const pol = c._policy || (store.policies || []).find(p => p.policy_code === c.policy_code) || {};
    const cond = c.condition || {};
    const reviewed = c.is_screened || pol.credit_grade ? '심사' : '무심사';
    const insLine = [
      pol.injury_compensation_limit && `대인 ${pol.injury_compensation_limit}`,
      pol.property_compensation_limit && `대물 ${pol.property_compensation_limit}`,
      pol.own_damage_min_deductible && `자차 ${pol.own_damage_min_deductible} 자기부담`,
    ].filter(Boolean).join(' / ');
    const condRows = [
      ['심사', reviewed],
      ['연 주행', pol.annual_mileage ? `${pol.annual_mileage}` : (c.annual_mileage || '')],
      ['운전 연령', pol.basic_driver_age ? `${pol.basic_driver_age}` : ''],
      ['운전 범위', pol.personal_driver_scope || pol.business_driver_scope || ''],
      ['보험', insLine, true],
      ['중도해지', cond.early_termination || pol.penalty_condition || '', true],
    ].filter(([, v]) => v);

    const settlement = (store.settlements || []).find(s => s.contract_code === c.contract_code);
    const settleRows = settlement ? [
      ['정산상태', settlement.settlement_status || settlement.status || '미정산'],
      ['수수료', settlement.fee_amount ? Math.round(Number(settlement.fee_amount)/10000) + '만' : '-'],
      ['정산일', fmtDate(settlement.settled_date || settlement.settled_at) || '-'],
    ] : [];

    const renderRows = (rows) => `<div class="info-grid">${rows.map(([l, v, full, html]) => `<div class="lab">${esc(l)}</div><div${full ? ' class="full"' : ''}>${html ? v : esc(v)}</div>`).join('')}</div>`;
    condCard.querySelector('.ws4-body').innerHTML = (condRows.length || settleRows.length)
      ? `${condRows.length ? renderRows(condRows) : ''}
         ${settleRows.length ? `<div style="color:var(--text-weak); margin: 12px 0 4px;"><i class="ph ph-coins"></i> 정산</div>${renderRows(settleRows)}` : ''}`
      : emptyState('조건 정보 없음');
  }
}

/* v2 contract.js renderWork 동등 — 진행 단계 + 클릭 + 드롭다운 + 취소/완료 + 메모 */
export function renderContractWorkV2(c) {
  if (!c) return emptyState('계약 데이터 없음');
  const status = c.contract_status || '계약요청';
  const isCancelled = status === '계약취소';
  const isCompleted = status === '계약완료';
  const role = store.currentUser?.role || 'agent';
  const isAdmin = role === 'admin';
  const states = getStepStates(c);
  const prog = getProgress(c);
  const isDoneVal = v => v === true || v === 'yes' || v === '출고 가능' || v === '출고 협의' || v === '서류 승인';

  const stepRow = (step) => {
    const st = states[step.id] || {};
    const locked = !!st.locked;
    const agentKey = step.agent?.key;
    const respKey = step.provider?.key || step.admin?.key;
    const respRole = step.admin ? 'admin' : 'provider';
    const choices = step.provider?.choices || step.admin?.choices || null;
    const agentVal = agentKey ? c[agentKey] : null;
    const respVal = respKey ? c[respKey] : null;
    const agentDone = isDoneVal(agentVal);
    const respDone = isDoneVal(respVal);
    const isRejected = respVal === '출고 불가' || respVal === '서류 부결';

    const canClickAgent = isAdmin || (!locked && role === 'agent' && !agentDone);
    const canClickResp = isAdmin || (agentDone && !locked && role === respRole && !respDone && !isRejected);

    const agentCls = agentDone ? 'done' : (locked ? 'locked' : 'pending');
    const respCls = isRejected ? 'rejected' : (respDone ? 'done' : (locked ? 'locked' : 'pending'));
    const agentLabel = step.agent?.label || '-';
    const respLabel = step.provider?.label || step.admin?.label || '-';
    const respDisplay = (typeof respVal === 'string' && respVal && respVal !== 'yes') ? respVal : respLabel;

    return `<div class="ct-step-row">
      <div class="ct-step-cell ${agentCls}${canClickAgent && agentKey ? ' clickable' : ''}" data-key="${esc(agentKey || '')}">
        <i class="ph ${agentDone ? 'ph-check-circle' : 'ph-circle'}"></i><span>${esc(agentLabel)}</span>
      </div>
      <div class="ct-step-arrow"><i class="ph ph-arrow-right"></i></div>
      <div class="ct-step-cell ${respCls}${!choices && canClickResp && respKey ? ' clickable' : ''}" data-key="${esc(respKey || '')}">
        <i class="ph ${isRejected ? 'ph-x-circle' : respDone ? 'ph-check-circle' : 'ph-circle'}"></i>
        ${choices && canClickResp ? `<select class="ct-step-select" data-key="${esc(respKey)}">
          <option value="">${esc(respLabel)}</option>
          ${choices.map(ch => `<option value="${esc(ch)}" ${respVal === ch ? 'selected' : ''}>${esc(ch)}</option>`).join('')}
        </select>` : `<span>${esc(respDisplay)}</span>`}
      </div>
    </div>`;
  };

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:11px;">
        <b style="color:var(--text-main);">${esc(c.contract_code || '-')}</b>
        ${c.customer_name ? ' · ' + esc(c.customer_name) : ''}
        <span style="margin-left:6px;color:var(--text-sub);">${esc(status)}</span>
      </div>
      <span style="font-size:10px;color:${prog.done === prog.total ? 'var(--alert-green-text)' : 'var(--alert-blue-text)'};">${prog.done}/${prog.total}</span>
    </div>
    <div class="ct-steps-v3">
      <div class="ct-step-row ct-step-head"><div>영업</div><div></div><div>공급·관리</div></div>
      ${CONTRACT_STEPS_V2.map(stepRow).join('')}
    </div>

    <!-- 취소/완료 버튼 -->
    <div style="margin-top:10px;">
      ${isCancelled
        ? `<div style="text-align:center;color:var(--alert-red-text);font-size:11px;padding:6px;">계약취소됨</div>`
        : isCompleted
          ? `<div style="text-align:center;color:var(--alert-green-text);font-size:11px;padding:6px;"><i class="ph ph-check-circle"></i> 계약완료</div>`
          : `<button class="btn btn-sm" id="ctCancelBtn" style="width:100%;color:var(--alert-red-text);"><i class="ph ph-prohibit"></i> 계약 취소</button>
             ${prog.done === prog.total ? `<button class="btn btn-sm btn-primary" id="ctCompleteBtn" style="width:100%;margin-top:4px;"><i class="ph ph-check-circle"></i> 계약 완료</button>` : ''}`
      }
    </div>

    <!-- 진행 메모 (영업/공급/관리) -->
    ${!isCancelled ? `
      <div style="margin-top:12px;color:var(--text-weak);margin-bottom:4px;font-size:10px;">진행 메모</div>
      <div class="info-grid" style="grid-template-columns: 60px 1fr;">
        <div class="lab">영업</div>
        <textarea class="input" data-memo="agent_memo" rows="2" style="width:100%;resize:vertical;font-size:11px;">${esc(c.agent_memo || '')}</textarea>
        <div class="lab">공급</div>
        <textarea class="input" data-memo="provider_memo" rows="2" style="width:100%;resize:vertical;font-size:11px;">${esc(c.provider_memo || '')}</textarea>
        <div class="lab">관리</div>
        <textarea class="input" data-memo="admin_memo" rows="2" style="width:100%;resize:vertical;font-size:11px;">${esc(c.admin_memo || '')}</textarea>
      </div>
    ` : ''}
  `;
}

/* renderContractWorkV2 의 클릭/드롭다운/메모/취소·완료 이벤트 바인딩
 *  options.reRender — 호출자가 자기 페이지 재렌더 함수 주입 (workspace / contract 양쪽 호환) */
export function bindContractWorkV2(stepCard, c, options = {}) {
  if (!c?.contract_code) return;
  const role = store.currentUser?.role || 'agent';
  const isAdmin = role === 'admin';
  const reRender = options.reRender || (() => renderContractDetail(c));

  // 단계 셀 클릭 (단순 체크 토글)
  stepCard.querySelectorAll('.ct-step-cell.clickable').forEach(cell => {
    cell.addEventListener('click', async () => {
      const key = cell.dataset.key;
      if (!key) return;
      const cur = c[key] === true || c[key] === 'yes';
      const next = !cur;
      const update = { [key]: next };
      if (isAdmin) update[`${key}_by`] = next ? 'admin' : '';
      try {
        await updateRecord(`contracts/${c.contract_code}`, update);
        c[key] = next;
        reRender();
      } catch (e) { alert('저장 실패: ' + (e.message || e)); }
    });
  });

  // 드롭다운 (출고 가능/협의/불가, 서류 승인/부결)
  stepCard.querySelectorAll('.ct-step-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const key = sel.dataset.key;
      const val = sel.value;
      const update = { [key]: val };
      if (isAdmin) update[`${key}_by`] = val ? 'admin' : '';
      try {
        await updateRecord(`contracts/${c.contract_code}`, update);
        c[key] = val;
        reRender();
      } catch (e) { alert('저장 실패: ' + (e.message || e)); }
    });
  });

  // 메모 자동 저장 (blur)
  stepCard.querySelectorAll('textarea[data-memo]').forEach(ta => {
    ta.addEventListener('blur', async () => {
      const field = ta.dataset.memo;
      try {
        await updateRecord(`contracts/${c.contract_code}`, { [field]: ta.value });
        c[field] = ta.value;
        flashSaved(ta);
      } catch (e) { /* silent */ }
    });
  });

  // 계약 취소
  stepCard.querySelector('#ctCancelBtn')?.addEventListener('click', async () => {
    if (!confirm('정말 계약을 취소하시겠습니까?')) return;
    try {
      await updateRecord(`contracts/${c._key}`, {
        contract_status: '계약취소',
        cancelled_at: Date.now(),
        cancelled_by: store.currentUser?.uid,
      });
      // 차량 상태 복구 — 같은 차량의 다른 활성 계약 없으면 '출고가능'으로
      if (c.product_uid) {
        const others = (store.contracts || []).filter(x =>
          x._key !== c._key && x.product_uid === c.product_uid && !x._deleted &&
          (x.contract_status === '계약요청' || x.contract_status === '계약대기' || x.contract_status === '계약발송')
        );
        if (!others.length) {
          await updateRecord(`products/${c.product_uid}`, { vehicle_status: '출고가능', updated_at: Date.now() });
        }
      }
      showToast('계약 취소됨', 'info');
    } catch (e) { showToast('취소 실패: ' + (e.message || e), 'error'); }
  });

  // 계약 완료 — 임시 코드 → 정식 코드 promote, 같은 차량의 다른 완료 계약 차단
  stepCard.querySelector('#ctCompleteBtn')?.addEventListener('click', async () => {
    if (c.product_uid) {
      const alreadyDone = (store.contracts || []).find(x =>
        x._key !== c._key && x.product_uid === c.product_uid &&
        x.contract_status === '계약완료' && !x._deleted
      );
      if (alreadyDone) {
        return showToast(`이미 완료된 계약이 있습니다 · ${alreadyDone.contract_code}`, 'error');
      }
    }
    if (!confirm('계약을 완료 처리하시겠습니까?')) return;
    try {
      const oldCode = c.contract_code;
      const newCode = await allocateRealContractCode();
      await updateRecord(`contracts/${c._key}`, {
        contract_code: newCode,
        is_draft: false,
        contract_status: '계약완료',
        completed_at: Date.now(),
        completed_by: store.currentUser?.uid,
      });
      if (c.product_uid) {
        await updateRecord(`products/${c.product_uid}`, {
          vehicle_status: '출고불가', updated_at: Date.now(),
        });
      }
      const linkedRoom = (store.rooms || []).find(r => r.linked_contract === oldCode);
      if (linkedRoom) {
        await updateRecord(`rooms/${linkedRoom._key}`, { linked_contract: newCode });
      }
      const product = (store.products || []).find(p => p._key === c.product_uid);
      notifyProviderAndAdmin({
        template: 'contract_done',
        providerCode: c.provider_company_code,
        subject: '계약 체결',
        message: `[Freepass]\n${product?.car_number || c.car_number_snapshot || ''} ${c.customer_name || ''} 계약이 체결됐습니다 (${newCode}).`,
      }).catch(() => null);
      showToast(`계약 완료 · ${newCode}`, 'success');
    } catch (e) {
      console.error('[contract complete]', e);
      showToast('완료 실패: ' + (e.message || e), 'error');
    }
  });
}

/* 룸에서 계약 생성 — 권한별 영업자 배정 분기 + 임시 코드 + 차량상태 + 알림
 *  - 영업자(agent/agent_admin) 본인이 만들면 → 본인 자동 배정
 *  - 관리자(admin)가 만들면 → pickAgent 다이얼로그 → 선택된 영업자 배정 */
export async function createContractFromRoomLocal(room) {
  if (!room) return;
  const me = store.currentUser;
  if (!me) return;
  if (!(me.role === 'agent' || me.role === 'agent_admin' || me.role === 'admin')) {
    showToast('계약 생성 권한이 없습니다', 'error');
    return;
  }

  // 영업자 결정
  let agent;
  if (me.role === 'admin') {
    agent = await pickAgent();
    if (!agent) return;
  } else {
    agent = me;
  }

  // 계약자(고객) 결정
  const customer = await pickOrCreateCustomer();
  if (!customer) return;

  const product = (store.products || []).find(p => p._key === room.product_uid || p.car_number === (room.vehicle_number || room.car_number));
  const code = makeTempContractCode();
  try {
    await pushRecord('contracts', {
      contract_code: code,
      is_draft: true,
      product_uid: room.product_uid,
      product_code: product?.product_code,
      // 차량 snapshot
      car_number_snapshot: product?.car_number || room.vehicle_number,
      maker_snapshot: product?.maker || room.maker,
      model_snapshot: product?.model || room.model,
      sub_model_snapshot: product?.sub_model || room.sub_model,
      vehicle_name_snapshot: product ? `${product.maker || ''} ${product.sub_model || product.model || ''}`.trim() : '',
      year_snapshot: product?.year,
      fuel_type_snapshot: product?.fuel_type,
      ext_color_snapshot: product?.ext_color,
      // 계약자 참조 + snapshot
      customer_uid: customer._key,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_is_business: !!customer.is_business,
      // 관계자
      agent_uid: agent.uid || agent._key,
      agent_code: agent.user_code,
      agent_name: agent.name,
      agent_channel_code: agent.agent_channel_code || agent.channel_code,
      provider_company_code: room.provider_company_code || product?.provider_company_code,
      provider_uid: room.provider_uid,
      // 정책 snapshot
      policy_code: product?.policy_code,
      policy_name_snapshot: product?._policy?.policy_name,
      credit_grade_snapshot: product?._policy?.credit_grade,
      // 메타
      contract_status: '계약요청',
      contract_date: new Date().toISOString().slice(0, 10),
      created_at: Date.now(),
      created_by: me.uid,
    });
    await updateRecord(`rooms/${room._key}`, { linked_contract: code });
    if (product?._key) {
      // 차량 상태 자동 전환 — 임시 계약 생성 시 '출고협의' (이미 출고불가면 유지)
      const vsUpdate = (product.vehicle_status === '출고불가') ? {} : { vehicle_status: '출고협의' };
      await updateRecord(`products/${product._key}`, {
        ...vsUpdate,
        assigned_agent_uid: agent.uid || agent._key,
        assigned_agent_code: agent.user_code,
        assigned_agent_name: agent.name,
        assigned_at: Date.now(),
        updated_at: Date.now(),
      });
    }
    // 알림 — 공급사 + 관리자에게 신규 계약 알림
    notifyProviderAndAdmin({
      template: 'new_inquiry',
      providerCode: product?.provider_company_code,
      subject: '신규 계약 생성',
      message: `[Freepass]\n${agent.name || '영업자'}님이 ${product?.car_number || ''} ${product?.maker || ''} ${product?.sub_model || product?.model || ''} 계약(${code})을 생성했습니다.`,
    }).catch(() => null);

    showToast(`계약 생성됨 · ${agent.name || agent.user_code} 배정 · ${code}`, 'success');
  } catch (e) {
    console.error('[contract create]', e);
    showToast('계약 생성 실패 — ' + (e.message || e), 'error');
  }
}
