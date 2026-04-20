/**
 * 계약 — 4패널: 목록 | 작업(진행) | 상세 | 보조
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, softDelete } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtWon, empty, cField } from '../core/format.js';
import { initWs4Resize } from '../core/resize.js';
import { setBreadcrumbBrief } from '../core/breadcrumb.js';

let unsubContracts = null;
let allContracts = [];
let activeCode = null;

const WS_KEY = 'fp.ct.widths';
const STEPS = [
  { key: 'docs_attached', icon: '📄', label: '서류' },
  { key: 'approval_requested', icon: '✋', label: '승인요청' },
  { key: 'progress_approved', icon: '✅', label: '진행승인' },
  { key: 'deposit_confirmed', icon: '💰', label: '보증금' },
  { key: 'contract_written', icon: '📝', label: '계약서' },
  { key: 'delivery_confirmed', icon: '🚗', label: '출고' },
];

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
            <button class="chip is-active" data-f="active">진행중</button>
            <button class="chip" data-f="done">완료</button>
            <button class="chip" data-f="all">전체</button>
          </div>
        </div>
        <div class="ws4-body" id="ctList"></div>
      </div>
      <div class="ws4-resize" data-idx="0"></div>
      <div class="ws4-panel" data-panel="work">
        <div class="ws4-head"><span>작업</span><div style="display:flex;gap:var(--sp-1);" id="ctWorkActions"></div></div>
        <div class="ws4-body" id="ctWork">
          <div class="srch-empty"><i class="ph ph-clipboard-text"></i><p>계약을 선택하세요</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="1"></div>
      <div class="ws4-panel" data-panel="detail">
        <div class="ws4-head">상세</div>
        <div class="ws4-body" id="ctDetail">
          <div class="srch-empty"><i class="ph ph-info"></i><p>상세 정보</p></div>
        </div>
      </div>
      <div class="ws4-resize" data-idx="2"></div>
      <div class="ws4-panel" data-panel="sub">
        <div class="ws4-head">보조</div>
        <div class="ws4-body" id="ctSub">
          <div class="srch-empty"><i class="ph ph-note"></i><p>보조 정보</p></div>
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
    return `
      <div class="room-item ${activeCode === c.contract_code ? 'is-active' : ''}" data-code="${c.contract_code}">
        <div class="room-item-avatar is-${tone(c.contract_status)}"><i class="ph ph-file-text"></i></div>
        <div class="room-item-body">
          <div class="room-item-top">
            <span class="room-item-name">${c.vehicle_name_snapshot || c.car_number_snapshot || c.contract_code}</span>
            ${statusBadge(c.contract_status)}
          </div>
          <div class="room-item-msg">
            <span>${c.customer_name||''} · ${c.agent_code||''}</span>
            <span class="room-item-time">${c.contract_date||''}</span>
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
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div style="font-weight:var(--fw-heavy);">${c.contract_code}</div>

      <div class="contract-steps">
        ${STEPS.map(s => {
          const done = c[s.key] === 'yes' || c[s.key] === true;
          return `<div class="contract-step ${done ? 'is-done' : ''}" data-step="${s.key}"><span style="font-size:14px;">${s.icon}</span><span>${s.label}</span></div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${['계약대기','계약요청','계약발송','계약완료','계약취소'].map(s => {
          const active = c.contract_status === s;
          const colors = { '계약대기':'var(--c-warn)','계약요청':'var(--c-info)','계약발송':'var(--c-accent)','계약완료':'var(--c-ok)','계약취소':'var(--c-err)' };
          return `<div class="status-toggle" data-status="${s}" style="font-size:var(--fs-2xs);padding:3px 8px;${active ? `background:${colors[s]}20;color:${colors[s]};` : ''}">${s.replace('계약','')}</div>`;
        }).join('')}
      </div>

      <div class="contract-section"><div class="contract-section-title">고객정보</div>
        <div class="contract-section-grid">
          ${inp('고객명','customer_name',c.customer_name)}
          ${inp('연락처','customer_phone',c.customer_phone)}
          ${inp('생년월일','customer_birth',c.customer_birth)}
        </div>
      </div>

      <button class="btn btn-primary btn-sm" id="ctDocBtn" style="width:100%;"><i class="ph ph-pencil-line"></i> 계약서 작성</button>
      ${renderSignReqButton(c)}
    </div>
  `;

  el.querySelectorAll('.contract-step').forEach(step => {
    step.addEventListener('click', async () => {
      const key = step.dataset.step;
      const latest = allContracts.find(x => x.contract_code === c.contract_code);
      const done = latest?.[key] === 'yes' || latest?.[key] === true;
      await updateRecord(`contracts/${c.contract_code}`, { [key]: done ? 'no' : 'yes' });
      showToast(done ? '해제' : '완료');
    });
  });

  el.querySelectorAll('.status-toggle').forEach(tog => {
    tog.addEventListener('click', async () => {
      await updateRecord(`contracts/${c.contract_code}`, { contract_status: tog.dataset.status });
      showToast(`→ ${tog.dataset.status}`);
    });
  });

  el.querySelectorAll('.contract-field-input').forEach(i => {
    i.addEventListener('blur', async () => { await updateRecord(`contracts/${c.contract_code}`, { [i.dataset.field]: i.value.trim() }); });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
  });

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

  document.getElementById('ctDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm('이 계약을 삭제하시겠습니까?')) return;
    await softDelete(`contracts/${c.contract_code}`);
    showToast('삭제됨');
  });

/* ── 상세 패널: 차량/대여/관계자 ── */
function renderDetail(c) {
  const el = document.getElementById('ctDetail');
  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div class="contract-section"><div class="contract-section-title">차량정보</div>
        <div class="contract-section-grid">
          ${cField('차량번호',c.car_number_snapshot)}${cField('차량명',c.vehicle_name_snapshot)}
          ${cField('모델',c.model_snapshot)}${cField('세부',c.sub_model_snapshot)}
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">대여정보</div>
        <div class="contract-section-grid">
          ${cField('기간',c.rent_month_snapshot?c.rent_month_snapshot+'개월':'-')}${cField('월대여료',fmtWon(c.rent_amount_snapshot))}
          ${cField('보증금',fmtWon(c.deposit_amount_snapshot))}${cField('계약일',c.contract_date)}
        </div>
      </div>
      <div class="contract-section"><div class="contract-section-title">관계자</div>
        <div class="contract-section-grid">
          ${cField('영업자',c.agent_code)}${cField('공급사',c.provider_company_code)}
          ${cField('채널',c.agent_channel_code)}${cField('정책',c.policy_code)}
        </div>
      </div>
    </div>
  `;
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
      <div class="contract-section"><div class="contract-section-title">정산정보</div>
        <div class="contract-section-grid">
          ${cField('상태',s.settlement_status||s.status)}${cField('정산일',s.settled_date||'-')}
          ${cField('월대여료',fmtWon(s.rent_amount))}${cField('보증금',fmtWon(s.deposit_amount))}
        </div>
      </div>
    `;
  }

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div style="font-weight:var(--fw-bold);font-size:var(--fs-sm);">정산</div>
      ${settleHtml}
      <div class="contract-section"><div class="contract-section-title">메모</div>
        <div class="contract-section-grid">
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

function inp(l, field, v) { return `<div class="contract-field"><span class="contract-field-label">${l}</span><input class="contract-field-input" data-field="${field}" value="${v || ''}" placeholder="-"></div>`; }

export function unmount() {
  unsubContracts?.();
}
