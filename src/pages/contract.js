/**
 * 계약 — 4패널: 목록 | 작업(진행) | 상세 | 보조
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, softDelete } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtWon, empty, cField } from '../core/format.js';
import { fieldInput as ffi, fieldView as ffv, bindAutoSave as bindFormAutoSave } from '../core/form-fields.js';
import { STEPS, getStepStates, getProgress } from '../core/contract-steps.js';
import { initWs4Resize } from '../core/resize.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';

let unsubContracts = null;
let allContracts = [];
let activeCode = null;

const WS_KEY = 'fp.ct.widths';

export function mount() {
  unsubContracts?.();
  activeCode = null;

  const shell = document.querySelector('.shell');

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel" data-panel="list">
        <div class="ws4-head">목록</div>
        <div class="ws4-search">
          <input class="input input-sm" id="ctSearch" placeholder="검색..." >
          <div style="display:flex;gap:3px;">
            <button class="chip is-active" data-f="active">미완료</button>
            <button class="chip" data-f="done">완료</button>
            <button class="chip" data-f="all">전체</button>
          </div>
        </div>
        <div class="ws4-body" id="ctList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="progress">
        <div class="ws4-head"><span>진행상황</span><div style="display:flex;gap:var(--sp-1);" id="ctWorkActions"></div></div>
        <div class="ws4-body" id="ctWork">
          <div class="srch-empty"><i class="ph ph-clipboard-text"></i><p>계약을 선택하세요</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>
      <div class="ws4-panel" data-panel="detail">
        <div class="ws4-head">계약접수내용</div>
        <div class="ws4-body" id="ctDetail">
          <div class="srch-empty"><i class="ph ph-file-text"></i><p>계약 접수 내용</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="2"></div>
      <div class="ws4-panel" data-panel="sub">
        <div class="ws4-head">보조</div>
        <div class="ws4-body" id="ctSub">
          <div class="srch-empty"><i class="ph ph-note"></i><p>정산 · 메모</p></div>
        </div>
      </div>
    </div>
  `;

  initWs4Resize(WS_KEY);

  main.querySelectorAll('.chip[data-f]').forEach(c => {
    c.addEventListener('click', () => {
      main.querySelectorAll('.chip[data-f]').forEach(x => x.classList.remove('is-active'));
      c.classList.add('is-active');
      renderList();
    });
  });
  document.getElementById('ctSearch')?.addEventListener('input', () => renderList());

  unsubContracts = watchCollection('contracts', (data) => {
    allContracts = data;
    store.contracts = data;
    renderList();
    updateBrief();
  });
}

function updateBrief() {
  const counts = {};
  allContracts.forEach(c => {
    const s = c.contract_status || '-';
    counts[s] = (counts[s] || 0) + 1;
  });
  const parts = [];
  if (counts['계약요청']) parts.push(`요청 ${counts['계약요청']}`);
  if (counts['계약대기']) parts.push(`대기 ${counts['계약대기']}`);
  if (counts['계약발송']) parts.push(`발송 ${counts['계약발송']}`);
  if (counts['계약완료']) parts.push(`완료 ${counts['계약완료']}`);
  setBreadcrumbBrief(parts.length ? parts.join(' > ') : `총 ${allContracts.length}건`);
}

function renderList() {
  const el = document.getElementById('ctList');
  if (!el) return;
  const q = (document.getElementById('ctSearch')?.value || '').toLowerCase();
  const f = document.querySelector('.chip[data-f].is-active')?.dataset.f || 'active';

  let list = [...allContracts];
  if (f === 'active') list = list.filter(c => c.contract_status !== '계약완료' && c.contract_status !== '계약취소');
  else if (f === 'done') list = list.filter(c => c.contract_status === '계약완료');

  if (q) list = list.filter(c => [
    c.car_number_snapshot, c.vehicle_name_snapshot, c.customer_name,
    c.contract_code, c.contract_status, c.agent_code,
    c.provider_company_code, c.customer_phone, c.model_snapshot,
    c.sub_model_snapshot, c.policy_code, c._key,
  ].some(v => v && String(v).toLowerCase().includes(q)));
  list.sort((a,b) => (b.created_at||0) - (a.created_at||0));

  const STATUS_TONE = { '계약대기':'warn', '계약요청':'info', '계약발송':'info', '계약완료':'ok', '계약취소':'err' };
  const tone = s => STATUS_TONE[s] || 'muted';
  const statusBadge = s => s ? `<span class="badge badge-${tone(s)}">${s.replace('계약','')}</span>` : '';

  el.innerHTML = list.map(c => {
    const done = c.contract_status === '계약완료';
    const avatarTone = done ? 'ok' : 'muted';
    const avatarLabel = done ? '완료' : '미완료';
    // 진행률
    const prog = getProgress(c);
    const stepsDone = prog.done;
    const stepsTotal = prog.total;
    const progressColor = stepsDone === stepsTotal ? 'var(--c-ok)' : stepsDone > 0 ? 'var(--c-info)' : 'var(--c-text-muted)';
    const fmtDate = c.contract_date || (c.created_at ? new Date(c.created_at).toLocaleDateString('ko', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '');
    return `
      <div class="room-item ${activeCode === c.contract_code ? 'is-active' : ''}" data-code="${c.contract_code}">
        <div class="room-item-avatar is-${avatarTone}" style="flex-direction:column;gap:1px;font-size:var(--fs-2xs);"><i class="ph ph-file-text"></i>${avatarLabel}</div>
        <div class="room-item-body">
          <div class="room-item-top">
            <span class="room-item-name">${c.car_number_snapshot || ''} ${c.sub_model_snapshot || c.model_snapshot || ''}</span>
            <span class="room-item-time">${fmtDate}</span>
          </div>
          <div class="room-item-msg">
            <span>${[c.provider_company_code, c.agent_channel_code, c.agent_code].filter(Boolean).join(' · ')}</span>
            <span style="font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:${progressColor};">${stepsDone}/${stepsTotal}</span>
          </div>
        </div>
      </div>
    `;
  }).join('') || empty('계약 없음');

  el.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', async () => {
      activeCode = item.dataset.code;
      renderList();
      loadAll(item.dataset.code);
      const c = list.find(x => x.contract_code === item.dataset.code);
      if (c) {
        const { setBreadcrumbTail } = await import('../core/breadcrumb.js');
        setBreadcrumbTail({ icon: 'ph ph-file-text', label: c.vehicle_name_snapshot || c.contract_code, sub: c.customer_name || '' });
      }
    });
  });
}

function loadAll(code) {
  const c = allContracts.find(x => x.contract_code === code);
  if (!c) return;
  renderWork(c);
  renderDetail(c);
  renderSub(c);
}

/* ── 작업 패널: 진행 스텝 + 상태 + 서류 ── */
function renderWork(c) {
  const actions = document.getElementById('ctWorkActions');
  if (actions) actions.innerHTML = `
    <button class="btn btn-xs btn-outline" id="ctDeleteBtn" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>
  `;
  const el = document.getElementById('ctWork');
  const role = store.currentUser?.role || 'agent';
  const states = getStepStates(c);
  const prog = getProgress(c);

  const renderStep = (step) => {
    const st = states[step.id];
    const agentKey = step.agent?.key;
    const respKey = step.provider?.key || step.admin?.key;
    const respLabel = step.provider?.label || step.admin?.label || '';
    const respRole = step.admin ? 'admin' : 'provider';
    const choices = step.provider?.choices || step.admin?.choices || null;
    const agentDone = agentKey ? (c[agentKey] === true || c[agentKey] === 'yes') : false;
    const respVal = respKey ? c[respKey] : null;
    const respDone = respVal === true || respVal === 'yes' || respVal === '가능' || respVal === '승인' || respVal === '출고 가능' || respVal === '출고 협의' || respVal === '서류 승인';
    const rejected = respVal === '불가' || respVal === '부결' || respVal === '출고 불가' || respVal === '서류 부결';
    const locked = st?.locked;

    // 영업자 쪽
    const agentClass = locked ? 'is-locked' : agentDone ? 'is-done' : 'is-pending';
    const isAdmin = role === 'admin';
    const canClickAgent = isAdmin || (!locked && role === 'agent' && !agentDone);
    // 공급사/관리자 쪽
    const respClass = !agentDone && !isAdmin ? 'is-locked' : rejected ? 'is-rejected' : respDone ? 'is-done' : 'is-pending';
    const canClickResp = isAdmin || (agentDone && !locked && role === respRole && !respDone && !rejected);

    // 관리자가 대신 처리한 경우 표시
    const agentBy = c[agentKey + '_by'];
    const respBy = c[(respKey || '') + '_by'];
    const agentAdmin = agentBy === 'admin' ? '<span class="ct-step-admin">관리자</span>' : '';
    const respAdmin = respBy === 'admin' ? '<span class="ct-step-admin">관리자</span>' : '';

    return `
      <div class="ct-step-row ${step.parallel ? 'is-parallel' : ''}" data-step="${step.id}">
        <div class="ct-step-cell ${agentClass}" data-key="${agentKey || ''}" ${canClickAgent && agentKey ? 'data-clickable' : ''}>
          <i class="ph ${agentDone ? 'ph-check-circle' : 'ph-circle'}"></i>
          <span>${step.agent?.label || ''}</span>${agentAdmin}
        </div>
        <div class="ct-step-arrow"><i class="ph ph-arrow-right"></i></div>
        <div class="ct-step-cell ${respClass}" data-key="${respKey || ''}" ${!choices && canClickResp && respKey ? 'data-clickable' : ''}>
          <i class="ph ${rejected ? 'ph-x-circle' : respDone ? 'ph-check-circle' : 'ph-circle'}"></i>
          ${choices && canClickResp ? `<select class="ct-step-select" data-key="${respKey}" data-choices="${choices.join(',')}">
            <option value="">${respLabel}</option>
            ${choices.map(ch => `<option value="${ch}" ${respVal === ch ? 'selected' : ''}>${ch}</option>`).join('')}
          </select>` : `<span>${respDone && respVal && respVal !== 'yes' && respVal !== true ? respVal : rejected ? respVal : respLabel}</span>`}${respAdmin}
        </div>
      </div>`;
  };

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-list-checks"></i> 진행 단계 <span class="form-section-hint" style="color:${prog.done === prog.total ? 'var(--c-ok)' : 'var(--c-info)'};">${prog.done}/${prog.total}</span></div>
        <div class="ct-steps">
          <div class="ct-step-row" style="font-size:var(--fs-2xs);color:var(--c-text-muted);font-weight:var(--fw-medium);">
            <div style="text-align:center;">영업자</div>
            <div></div>
            <div style="text-align:center;">공급사</div>
          </div>
          ${STEPS.map(renderStep).join('')}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-file-text"></i> 첨부 서류</div>
        <div class="form-section-body" style="grid-template-columns:1fr;">
          <label class="pd-dropzone" id="ctDocDropzone" for="ctDocFile">
            <i class="ph ph-upload-simple" aria-hidden="true"></i>
            <div class="pd-dropzone-text">서류를 끌어놓거나 클릭해서 업로드</div>
            <div class="pd-dropzone-hint">고객 신분증 · 면허증 · 재직증명서 등</div>
            <input type="file" id="ctDocFile" multiple hidden accept="image/*,.pdf">
          </label>
          ${(c.doc_urls || []).length ? `
            <div style="display:flex;flex-wrap:wrap;gap:var(--sp-1);margin-top:var(--sp-1);">
              ${(c.doc_urls || []).map((url, i) => `
                <a href="${url}" target="_blank" class="btn btn-xs btn-outline"><i class="ph ph-file"></i> 서류${i+1}</a>
              `).join('')}
            </div>` : ''}
        </div>
      </div>

      ${prog.done === prog.total
        ? `<button class="btn btn-primary btn-full" id="ctCompleteBtn" style="height:44px;font-size:var(--fs-sm);"><i class="ph ph-check-circle"></i> 계약 완료</button>`
        : `<button class="btn btn-outline btn-full" id="ctCancelBtn" style="height:44px;font-size:var(--fs-sm);color:var(--c-err);border-color:var(--c-err);"><i class="ph ph-prohibit"></i> 계약 취소</button>`
      }
    </div>
  `;

  // 단순 체크 클릭
  el.querySelectorAll('.ct-step-cell[data-clickable]').forEach(cell => {
    cell.addEventListener('click', async () => {
      const key = cell.dataset.key;
      if (!key) return;
      const cur = c[key] === true || c[key] === 'yes';
      c[key] = !cur;
      const byField = isAdmin ? { [key + '_by']: !cur ? 'admin' : '' } : {};
      await updateRecord(`contracts/${c.contract_code}`, { [key]: !cur, ...byField });
      showToast(cur ? '해제' : '완료');
      renderWork(c);
    });
  });

  // 드롭다운 선택 (출고 가능/불가, 서류 승인/부결)
  el.querySelectorAll('.ct-step-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const key = sel.dataset.key;
      const val = sel.value;
      c[key] = val;
      const byField = isAdmin ? { [key + '_by']: val ? 'admin' : '' } : {};
      await updateRecord(`contracts/${c.contract_code}`, { [key]: val, ...byField });
      showToast(val || '해제');
      renderWork(c);
    });
  });

  // 서류 업로드
  const docInput = el.querySelector('#ctDocFile');
  const docZone = el.querySelector('#ctDocDropzone');
  if (docInput && docZone) {
    const uploadDocs = async (files) => {
      const { uploadFile } = await import('../firebase/storage-helper.js');
      const urls = [...(c.doc_urls || [])];
      for (const file of files) {
        const path = `contract-docs/${c.contract_code}/${Date.now()}_${file.name}`;
        const { url } = await uploadFile(path, file);
        urls.push(url);
      }
      c.doc_urls = urls;
      await updateRecord(`contracts/${c.contract_code}`, { doc_urls: urls });
      showToast(`${files.length}건 업로드 완료`);
      renderWork(c);
    };
    docInput.addEventListener('change', () => { if (docInput.files.length) uploadDocs([...docInput.files]); });
    docZone.addEventListener('dragover', e => { e.preventDefault(); docZone.classList.add('is-dragover'); });
    docZone.addEventListener('dragleave', () => docZone.classList.remove('is-dragover'));
    docZone.addEventListener('drop', e => { e.preventDefault(); docZone.classList.remove('is-dragover'); if (e.dataTransfer.files.length) uploadDocs([...e.dataTransfer.files]); });
  }

  el.querySelector('#ctDocBtn')?.addEventListener('click', async () => {
    const { mount: m } = await import('./contract-send.js');
    m(c.contract_code);
  });

  el.querySelector('#ctSignReqBtn')?.addEventListener('click', async () => {
    if (c.sign_requested && !c.sign_token) {
      showToast('이미 발송 요청됨 — 관리자 처리 대기 중');
      return;
    }
    if (c.sign_token) {
      showToast('이미 서명 링크가 발송됐습니다');
      return;
    }
    if (!confirm('관리자에게 계약서 발송을 요청하시겠습니까?')) return;
    try {
      await updateRecord(`contracts/${c.contract_code}`, {
        sign_requested: true,
        sign_requested_at: Date.now(),
        sign_requested_by: store.currentUser?.user_code || store.currentUser?.uid || '',
      });
      showToast('관리자에게 발송 요청됐습니다');
    } catch (e) {
      console.error(e);
      showToast('요청 실패', 'error');
    }
  });

  // 서명 수신 확인 — contract.sign_token 있으면 서명 상태 감지 후 자동 처리
  if (c.sign_token) {
    (async () => {
      try {
        const { fetchRecord } = await import('../firebase/db.js');
        const sign = await fetchRecord(`contract_sign/${c.sign_token}`);
        if (!sign?.signed_at) return;

        // UI 표시 갱신
        const signBtn = el.querySelector('#ctSignReqBtn');
        if (signBtn) {
          signBtn.innerHTML = `<i class="ph ph-check-circle"></i> 서명 완료 · ${new Date(sign.signed_at).toLocaleString('ko-KR')}`;
          signBtn.style.color = 'var(--c-ok)';
          signBtn.disabled = true;
        }

        // 아직 계약완료로 전환 안됐으면 자동 전환 + 알림톡
        //  (sign.html side는 Rules 때문에 실패할 가능성 있어 agent 쪽에서 최종 확정)
        if (c.contract_status !== '계약완료') {
          await updateRecord(`contracts/${c.contract_code}`, {
            contract_status: '계약완료',
            signed_at: sign.signed_at,
          });
          showToast(`${c.customer_name || '고객'} 서명 완료 → 계약 체결`);
          // auto-status.js 가 contract_status 변화 감지해서 product.vehicle_status 전환·
          // 정산 자동생성·notifyContractDone 알림톡까지 처리함
        }
      } catch { /* silent */ }
    })();
  }

  // 계약취소/완료 버튼
  el.querySelector('#ctCancelBtn')?.addEventListener('click', async () => {
    if (!confirm('이 계약을 취소하시겠습니까?')) return;
    await updateRecord(`contracts/${c.contract_code}`, { contract_status: '계약취소' });
    c.contract_status = '계약취소';
    showToast('계약 취소됨');
    renderWork(c);
  });
  el.querySelector('#ctCompleteBtn')?.addEventListener('click', async () => {
    if (!confirm('모든 단계가 완료되었습니다. 계약을 완료 처리하시겠습니까?')) return;
    await updateRecord(`contracts/${c.contract_code}`, { contract_status: '계약완료' });
    c.contract_status = '계약완료';
    showToast('계약 완료!');
    renderWork(c);
  });

  document.getElementById('ctDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm('이 계약을 삭제하시겠습니까?')) return;
    await softDelete(`contracts/${c.contract_code}`);
    showToast('삭제됨');
  });
}

/** 서명 요청 버튼 — 계약 상태에 따라 4단계 표시
 *  1) 요청 전: "관리자에게 발송 요청" (active primary)
 *  2) 요청됨·미발송: "발송 대기 중 — 관리자 처리" (disabled)
 *  3) 발송됨·미서명: "고객 서명 대기" (disabled accent)
 *  4) 서명 완료: "서명 완료 · {일시}" (disabled ok) — watcher가 갱신 */
function renderSignReqButton(c) {
  const base = 'btn btn-sm';
  if (c.sign_token) {
    return `<button class="${base} btn-outline" id="ctSignReqBtn" style="width:100%;margin-top:var(--sp-1);color:var(--c-accent);" disabled>
      <i class="ph ph-paper-plane-tilt"></i> 고객 서명 대기
    </button>`;
  }
  if (c.sign_requested) {
    return `<button class="${base} btn-outline" id="ctSignReqBtn" style="width:100%;margin-top:var(--sp-1);" disabled>
      <i class="ph ph-hourglass"></i> 발송 요청됨 — 관리자 처리 대기
    </button>`;
  }
  return `<button class="${base} btn-outline" id="ctSignReqBtn" style="width:100%;margin-top:var(--sp-1);">
    <i class="ph ph-paper-plane-tilt"></i> 관리자에게 발송 요청
  </button>`;
}

/* ── 상세 패널: 차량/대여/관계자 ── */
function renderDetail(c) {
  const el = document.getElementById('ctDetail');
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-4);overflow-y:auto;height:100%;">
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-user"></i> 고객정보</div>
        <div class="form-section-body">
          ${ffi('고객명','customer_name',c)}
          ${ffi('연락처','customer_phone',c)}
          ${ffi('생년월일','customer_birth',c)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-car-simple"></i> 차량정보</div>
        <div class="form-section-body">
          ${ffv('차량번호',c.car_number_snapshot)}
          ${ffv('세부모델',c.sub_model_snapshot || c.model_snapshot)}
          ${ffv('차량명',c.vehicle_name_snapshot)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-currency-krw"></i> 대여정보</div>
        <div class="form-section-body">
          ${ffv('기간',c.rent_month_snapshot?c.rent_month_snapshot+'개월':'-')}
          ${ffv('월대여료',fmtWon(c.rent_amount_snapshot))}
          ${ffv('보증금',fmtWon(c.deposit_amount_snapshot))}
          ${ffv('계약일',c.contract_date)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-users"></i> 관계자</div>
        <div class="form-section-body">
          ${ffv('공급사',c.provider_company_code)}
          ${ffv('영업자',c.agent_code)}
          ${ffv('채널',c.agent_channel_code)}
          ${ffv('정책',c.policy_code)}
          ${ffv('계약코드',c.contract_code)}
        </div>
      </div>
    </div>
  `;
  bindFormAutoSave(el, (field, value) => updateRecord(`contracts/${c.contract_code}`, { [field]: value }));
}

/* ── 보조 패널: 정산 + 메모 ── */
function renderSub(c) {
  const el = document.getElementById('ctSub');
  const settlements = store.settlements || [];
  const s = settlements.find(x => x.contract_code === c.contract_code);

  let settleHtml = '<div style="color:var(--c-text-muted);font-size:var(--fs-xs);">정산 정보 없음</div>';
  if (s) {
    const confirms = s.confirms || {};
    settleHtml = `
      <div class="settle-amount" style="margin-bottom:var(--sp-2);">
        <div class="settle-amount-label">수수료</div>
        <div class="settle-amount-value">${fmtWon(s.fee_amount)}</div>
      </div>
      <div style="display:flex;gap:var(--sp-1);margin-bottom:var(--sp-2);">
        ${['공급사','영업자','관리자'].map((label,i) => {
          const roles = ['provider','agent','admin'];
          const confirmed = confirms[roles[i]];
          return `<div class="settle-confirm ${confirmed ? 'is-confirmed' : ''}" data-settle-key="${s._key}" data-role="${roles[i]}" style="padding:var(--sp-2);font-size:var(--fs-2xs);">
            <i class="ph ${confirmed ? 'ph-check-circle' : 'ph-circle'}" style="font-size:16px;"></i><span>${label}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="form-section"><div class="form-section-title">정산정보</div>
        <div class="form-section-body">
          ${ffv('상태',s.settlement_status||s.status)}${ffv('정산일',s.settled_date||'-')}
          ${ffv('월대여료',fmtWon(s.rent_amount))}${ffv('보증금',fmtWon(s.deposit_amount))}
        </div>
      </div>
    `;
  }

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div style="font-weight:var(--fw-bold);font-size:var(--fs-sm);">정산</div>
      ${settleHtml}
      <div class="form-section"><div class="form-section-title">메모</div>
        <div class="form-section-body">
          <textarea class="input" id="ctMemo" rows="4" style="resize:vertical;height:auto;" placeholder="메모...">${c.admin_memo||''}</textarea>
        </div>
      </div>
    </div>
  `;

  // Settle confirm
  el.querySelectorAll('.settle-confirm').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.settleKey;
      const role = btn.dataset.role;
      const st = (store.settlements||[]).find(x => x._key === key);
      const current = st?.confirms?.[role] || false;
      await updateRecord(`settlements/${key}`, { [`confirms/${role}`]: !current });
      showToast(!current ? '확인' : '해제');
    });
  });

  // Memo
  let memoTimer;
  document.getElementById('ctMemo')?.addEventListener('input', (e) => {
    clearTimeout(memoTimer);
    memoTimer = setTimeout(() => updateRecord(`contracts/${c.contract_code}`, { admin_memo: e.target.value }), 800);
  });
}


export function unmount() {
  unsubContracts?.();
}
