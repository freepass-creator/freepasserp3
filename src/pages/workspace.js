/**
 * Workspace — 대화 중심 작업 공간
 * 4패널 가로: 대화목록 | 대화창 | 계약진행 | 차량상세
 * 각 패널 사이 드래그 리사이즈
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, pushRecord, fetchRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { uploadFile } from '../firebase/storage-helper.js';
import { markRoomRead } from '../firebase/collections.js';
import { setBreadcrumbTail, setBreadcrumbBrief } from '../core/breadcrumb.js';
import { fmtMoney, fmtWon, fmtTime, cField } from '../core/format.js';
import { fieldInput as ffi, fieldView as ffv, bindAutoSave as bindFormAutoSave } from '../core/form-fields.js';
import { initWs4Resize } from '../core/resize.js';
import { getSettlementStatus, SETTLEMENT_STATUSES_BASIC } from '../core/settlement-status.js';

let unsubs = [];
let activeRoomId = null;
let activeContract = null;

/* ── Mount ── */
export function mount() {
  unsubs.forEach(u => u?.());
  unsubs = [];
  activeRoomId = null;
  activeContract = null;

  // 중분류 패널 숨기기
  const shell = document.querySelector('.shell');

  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="ws4">
      <div class="ws4-panel ws4-rooms" data-panel="rooms">
        <div class="ws4-head">작업 <span class="ws4-head-toggle" data-collapse="rooms"><i class="ph ph-caret-left"></i></span></div>
        <div class="ws4-search">
          <input class="input input-sm" id="wsRoomSearch" placeholder="검색..." >
          <div style="display:flex;gap:3px;">
            <button class="chip is-active" data-rf="unread">안읽음</button>
            <button class="chip" data-rf="all">읽음</button>
          </div>
        </div>
        <div class="ws4-body" id="wsRoomList"></div>
      </div>

      <div class="ws4-resize" data-idx="0"></div>

      <div class="ws4-panel ws4-chat" data-panel="chat">
        <div class="ws4-head" id="wsChatHead">채팅 <span class="ws4-head-toggle" data-collapse="chat"><i class="ph ph-caret-left"></i></span></div>
        <div class="ws4-body ws4-chat-msgs" id="wsChatMsgs">
          <div class="srch-empty"><i class="ph ph-chat-circle"></i><p>대화를 선택하세요</p></div>
        </div>
        <div class="ws4-chat-input" id="wsChatInput" style="display:none;">
          <input type="file" id="wsChatFile" multiple hidden accept="image/*,.pdf,.doc,.docx">
          <button class="ws4-input-btn" id="wsChatAttach"><i class="ph ph-paperclip"></i></button>
          <input class="ws4-input" id="wsChatText" placeholder="메시지 입력...">
          <button class="ws4-input-btn" id="wsChatSend"><i class="ph ph-paper-plane-tilt"></i></button>
        </div>
      </div>

      <div class="ws4-resize" data-idx="1"></div>

      <div class="ws4-panel ws4-contract" data-panel="contract">
        <div class="ws4-head">계약 <span class="ws4-head-toggle" data-collapse="contract"><i class="ph ph-caret-left"></i></span></div>
        <div class="ws4-body" id="wsContractBody">
          <div class="srch-empty"><i class="ph ph-file-text"></i><p>계약 정보</p></div>
        </div>
      </div>

      <div class="ws4-resize" data-idx="2"></div>

      <div class="ws4-panel ws4-detail" data-panel="detail">
        <div class="ws4-head">상세 <span class="ws4-head-toggle" data-collapse="detail"><i class="ph ph-caret-left"></i></span></div>
        <div class="ws4-body" id="wsDetailBody">
          <div class="srch-empty"><i class="ph ph-car-simple"></i><p>차량 상세</p></div>
        </div>
      </div>
    </div>
  `;

  // Resize handles
  initWs4Resize('fp.ws4.widths');

  // Panel collapse/expand
  // 이벤트 위임 — main 하나의 리스너로 패널 토글·확장·룸 필터 칩 전부 처리
  main.addEventListener('click', (e) => {
    // 1) 패널 헤드 토글 버튼
    const toggleBtn = e.target.closest('.ws4-head-toggle');
    if (toggleBtn) {
      e.stopPropagation();
      const panel = main.querySelector(`.ws4-panel[data-panel="${toggleBtn.dataset.collapse}"]`);
      if (!panel) return;
      panel.classList.toggle('is-collapsed');
      const icon = toggleBtn.querySelector('i');
      if (panel.classList.contains('is-collapsed')) {
        icon.className = 'ph ph-caret-right';
      } else {
        icon.className = 'ph ph-caret-left';
        panel.style.width = '';
        panel.style.flex = '';
      }
      return;
    }
    // 2) 접힌 패널 아무 곳 클릭 → 펼치기
    const collapsedPanel = e.target.closest('.ws4-panel.is-collapsed');
    if (collapsedPanel) {
      collapsedPanel.classList.remove('is-collapsed');
      collapsedPanel.style.width = '';
      collapsedPanel.style.flex = '';
      const icon = collapsedPanel.querySelector('.ws4-head-toggle i');
      if (icon) icon.className = 'ph ph-caret-left';
      return;
    }
    // 3) 룸 필터 칩
    const chip = e.target.closest('.chip[data-rf]');
    if (chip) {
      main.querySelectorAll('.chip[data-rf]').forEach(x => x.classList.remove('is-active'));
      chip.classList.add('is-active');
      renderRoomList();
      return;
    }
  });

  // Watch rooms
  unsubs.push(watchCollection('rooms', (data) => {
    store.rooms = data;
    renderRoomList();
    updateBrief();
    // 엑셀 "문의" 링크로 진입한 경우 해당 방 자동 오픈
    if (store.pendingOpenRoom) {
      const target = store.pendingOpenRoom;
      if (data.find(r => r._key === target)) {
        store.pendingOpenRoom = null;
        openRoom(target);
      }
    }
  }, { limit: 200 }));

  unsubs.push(watchCollection('contracts', (data) => { store.contracts = data; }));
  unsubs.push(watchCollection('settlements', (data) => { store.settlements = data; }));
  unsubs.push(watchCollection('products', (data) => { store.products = data; }));

  // Room search
  document.getElementById('wsRoomSearch')?.addEventListener('input', () => renderRoomList());
}

function updateBrief() {
  const rooms = store.rooms || [];
  const role = store.currentUser?.role;
  const unread = rooms.filter(r => {
    const n = role === 'agent' ? r.unread_for_agent : role === 'provider' ? r.unread_for_provider : 0;
    return (n || 0) > 0;
  }).length;
  const active = rooms.length;
  const parts = [];
  if (unread) parts.push(`미읽음 ${unread}`);
  parts.push(`전체 대화 ${active}`);
  setBreadcrumbBrief(parts.join(' > '));
}

/* ── Room List ── */
function renderRoomList() {
  const el = document.getElementById('wsRoomList');
  if (!el) return;

  const q = (document.getElementById('wsRoomSearch')?.value || '').toLowerCase();
  const rf = document.querySelector('.chip[data-rf].is-active')?.dataset.rf || 'all';
  let rooms = store.rooms || [];

  const uid = store.currentUser?.uid;
  const role = store.currentUser?.role;

  // Text search
  if (q) rooms = rooms.filter(r => [
    r.agent_name, r.provider_name, r.vehicle_number, r.model,
    r.contract_status, r.agent_code, r.provider_code, r._key,
  ].some(v => v && String(v).toLowerCase().includes(q)));

  // Filter
  if (rf === 'unread') {
    rooms = rooms.filter(r => {
      if (role === 'agent') return r.unread_for_agent > 0;
      if (role === 'provider') return r.unread_for_provider > 0;
      return false;
    });
  } else if (rf === 'received') {
    rooms = rooms.filter(r => r.last_sender_role !== role);
  } else if (rf === 'sent') {
    rooms = rooms.filter(r => r.last_sender_role === role);
  }

  const sorted = [...rooms].sort((a,b) => (b.last_message_at||0) - (a.last_message_at||0));

  el.innerHTML = sorted.map(room => {
    const name = role === 'agent' ? (room.provider_name||'공급사') : role === 'provider' ? (room.agent_name||'영업자') : (room.agent_name||room.provider_name||'대화');
    const unread = role === 'agent' ? room.unread_for_agent : role === 'provider' ? room.unread_for_provider : 0;
    const active = activeRoomId === room._key;
    const preview = room.vehicle_number
      ? `🚗 ${room.vehicle_number}  ·  ${room.last_message || ''}`
      : (room.last_message || '');
    const initial = (name || '?').trim().charAt(0) || '?';

    return `
      <div class="room-item ${active ? 'is-active' : ''}" data-id="${room._key}">
        <div class="room-item-avatar ${unread > 0 ? 'is-accent' : 'is-muted'}"><i class="ph ${unread > 0 ? 'ph-chat-circle-dots' : 'ph-chat-circle'}"></i></div>
        <div class="room-item-body">
          <div class="room-item-top">
            <span class="room-item-name">${name}</span>
            <span class="room-item-time">${fmtTime(room.last_message_at)}</span>
          </div>
          <div class="room-item-msg">
            <span>${preview}</span>
            ${unread > 0 ? `<span class="badge is-filled is-pill badge-accent">${unread > 99 ? '99+' : unread}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('') || '<div style="padding:var(--sp-4);color:var(--c-text-muted);font-size:var(--fs-xs);text-align:center;">대화 없음</div>';

  el.querySelectorAll('.room-item').forEach(item => {
    item.addEventListener('click', () => openRoom(item.dataset.id));
  });
}

/* ── Open Room → 채팅 + 계약 + 상세 ── */
let unsubMessages = null;
let chatInputAC = null;  // setupChatInput 이벤트 정리용

function openRoom(roomId) {
  activeRoomId = roomId;
  store.activeRoomId = roomId;
  renderRoomList();

  const room = (store.rooms||[]).find(r => r._key === roomId);
  const role = store.currentUser?.role;
  const uid = store.currentUser?.uid;
  const name = role === 'agent' ? (room?.provider_name||'') : (room?.agent_name||'');

  // 상단바 작업 컨텍스트 갱신
  setBreadcrumbTail({ icon: 'ph ph-chat-circle', label: `${name || '대화'}`, sub: room?.vehicle_number || '' });

  // 읽음 처리
  if (uid && role) markRoomRead(roomId, role, uid).catch(() => {});

  // Chat head
  document.getElementById('wsChatHead').innerHTML = `${name || '채팅'} <span class="ws4-head-toggle" data-collapse="chat"><i class="ph ph-caret-left"></i></span>`;
  document.getElementById('wsChatInput').style.display = '';

  // Auto-expand contract & detail panels when room has data
  if (room?.product_uid) {
    const detailPanel = document.querySelector('.ws4-detail');
    if (detailPanel?.classList.contains('is-collapsed')) {
      detailPanel.classList.remove('is-collapsed');
      detailPanel.style.width = '';
      detailPanel.style.flex = '';
      const icon = detailPanel.querySelector('.ws4-head-toggle i');
      if (icon) icon.className = 'ph ph-caret-left';
    }
  }
  const contractPanel = document.querySelector('.ws4-contract');
  if (contractPanel?.classList.contains('is-collapsed')) {
    contractPanel.classList.remove('is-collapsed');
    contractPanel.style.width = '';
    contractPanel.style.flex = '';
    const icon = contractPanel.querySelector('.ws4-head-toggle i');
    if (icon) icon.className = 'ph ph-caret-left';
  }

  // Watch messages
  unsubMessages?.();
  unsubMessages = watchCollection(`messages/${roomId}`, renderMessages);

  // Setup send
  setupChatInput(roomId);

  // Load contract
  loadContract(room);

  // Load vehicle detail
  if (room?.product_uid) loadVehicleDetail(room.product_uid);
}

function renderMessages(messages) {
  const el = document.getElementById('wsChatMsgs');
  if (!el) return;
  const uid = store.currentUser?.uid;
  const sorted = [...messages].sort((a,b) => (a.created_at||0) - (b.created_at||0));

  el.innerHTML = sorted.map(msg => {
    const isMine = msg.sender_uid === uid;
    const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('ko',{hour:'2-digit',minute:'2-digit'}) : '';
    let content = '';
    if (msg.image_url) content = `<img src="${msg.image_url}" style="max-width:180px;border-radius:var(--ctrl-r);cursor:pointer;" onclick="window.open('${msg.image_url}','_blank')">`;
    else if (msg.file_url) content = `<a href="${msg.file_url}" target="_blank" style="color:inherit;text-decoration:underline;">${(msg.text||'📎 파일').replace(/</g,'&lt;')}</a>`;
    else content = (msg.text||'').replace(/</g,'&lt;').replace(/\n/g,'<br>');

    return `
      <div class="chat-msg ${isMine ? 'chat-msg-mine' : 'chat-msg-other'}">
        ${!isMine ? `<div style="font-size:var(--fs-2xs);font-weight:var(--fw-medium);color:var(--c-text-sub);margin-bottom:2px;">${(msg.sender_name||'').replace(/</g,'&lt;')}</div>` : ''}
        <div>${content}</div>
        <div class="chat-msg-meta">${time}</div>
      </div>
    `;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function setupChatInput(roomId) {
  // AbortController로 이전 리스너 전부 해제 (cloneNode 해킹 없이 깔끔)
  chatInputAC?.abort();
  chatInputAC = new AbortController();
  const { signal } = chatInputAC;

  const input = document.getElementById('wsChatText');
  const sendBtn = document.getElementById('wsChatSend');
  const fileInput = document.getElementById('wsChatFile');
  const attachBtn = document.getElementById('wsChatAttach');
  if (!input || !sendBtn) return;

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.focus();
    const user = store.currentUser;
    await pushRecord(`messages/${roomId}`, { text, sender_uid: user.uid, sender_role: user.role, sender_code: user.user_code||'', sender_name: user.name||'' });
    await updateRecord(`rooms/${roomId}`, { last_message: text, last_message_at: Date.now(), last_sender_role: user.role });
  };

  sendBtn.addEventListener('click', send, { signal });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, { signal });
  attachBtn?.addEventListener('click', () => fileInput.click(), { signal });
  fileInput?.addEventListener('change', async () => {
    const MAX_BYTES = 10 * 1024 * 1024;  // 10MB
    const files = Array.from(fileInput.files);
    const user = store.currentUser;
    const oversize = files.filter(f => f.size > MAX_BYTES);
    if (oversize.length) {
      showToast(`${oversize.length}개 파일이 10MB 초과 — 제외됨`, 'error');
    }
    const ok = files.filter(f => f.size <= MAX_BYTES);
    const prevLabel = attachBtn?.innerHTML;
    if (attachBtn && ok.length) attachBtn.innerHTML = '<i class="ph ph-spinner"></i>';
    try {
      for (const file of ok) {
        try {
          const path = `chat-files/${roomId}/${Date.now()}_${file.name}`;
          const { url } = await uploadFile(path, file);
          const isImage = file.type.startsWith('image/');
          await pushRecord(`messages/${roomId}`, { text: isImage ? '' : `📎 ${file.name}`, sender_uid: user.uid, sender_role: user.role, sender_code: user.user_code||'', sender_name: user.name||'', ...(isImage ? { image_url: url } : { file_url: url }) });
          await updateRecord(`rooms/${roomId}`, { last_message: isImage ? '📷 사진' : `📎 ${file.name}`, last_message_at: Date.now(), last_sender_role: user.role });
        } catch (e) {
          console.warn('[chat-upload] 실패', file.name, e);
          showToast(`"${file.name}" 업로드 실패`, 'error');
        }
      }
    } finally {
      if (attachBtn && prevLabel) attachBtn.innerHTML = prevLabel;
      fileInput.value = '';
    }
  }, { signal });

  // 방 오픈 직후 입력창으로 바로 커서 (엑셀 문의하기 진입 포함)
  input.focus();
}

/* ── Contract Panel ── */
const STEPS = [
  { key: 'docs_attached', icon: '📄', label: '서류' },
  { key: 'approval_requested', icon: '✋', label: '승인' },
  { key: 'progress_approved', icon: '✅', label: '진행' },
  { key: 'deposit_confirmed', icon: '💰', label: '보증금' },
  { key: 'contract_written', icon: '📝', label: '계약서' },
  { key: 'delivery_confirmed', icon: '🚗', label: '출고' },
];

function loadContract(room) {
  const el = document.getElementById('wsContractBody');
  if (!el || !room) return;

  // Find contract linked to this room's product
  const contracts = store.contracts || [];
  const c = contracts.find(x => x.product_uid === room.product_uid || x.seed_product_key === room.product_uid) || room.linked_contract && contracts.find(x => x.contract_code === room.linked_contract);

  if (!c) {
    el.innerHTML = '<div style="padding:var(--sp-4);color:var(--c-text-muted);font-size:var(--fs-xs);text-align:center;">연결된 계약 없음</div>';
    return;
  }

  activeContract = c;

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);">
      <div style="font-weight:var(--fw-bold);font-size:var(--fs-sm);">${c.contract_code}</div>
      <div style="font-size:var(--fs-xs);color:var(--c-text-sub);">${c.vehicle_name_snapshot||''} · ${c.customer_name||''}</div>

      <div class="contract-steps">
        ${STEPS.map(s => {
          const done = c[s.key] === 'yes' || c[s.key] === true;
          return `<div class="contract-step ${done ? 'is-done' : ''}" data-step="${s.key}"><span style="font-size:14px;">${s.icon}</span><span>${s.label}</span></div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${['계약대기','계약요청','계약발송','계약완료','계약취소'].map(s => {
          const active = c.contract_status === s;
          return `<div class="status-toggle" data-status="${s}" style="font-size:var(--fs-2xs);padding:3px 8px;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : ''}">${s.replace('계약','')}</div>`;
        }).join('')}
      </div>

      <div class="form-section">
        <div class="form-section-title">정보</div>
        <div class="form-section-body">
          ${ffv('상태', c.contract_status)}${ffv('기간', c.rent_month_snapshot ? c.rent_month_snapshot+'개월' : '-')}
          ${ffv('월대여료', fmtWon(c.rent_amount_snapshot))}${ffv('보증금', fmtWon(c.deposit_amount_snapshot))}
          ${ffv('계약일', c.contract_date)}${ffv('영업자', c.agent_code)}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">고객</div>
        <div class="form-section-body">
          ${ffi('고객명','customer_name',c)}
          ${ffi('연락처','customer_phone',c)}
        </div>
      </div>

      ${renderSettlementSection(c)}
    </div>
  `;

  // Step click
  el.querySelectorAll('.contract-step').forEach(step => {
    step.addEventListener('click', async () => {
      const key = step.dataset.step;
      const latest = (store.contracts||[]).find(x => x.contract_code === c.contract_code);
      const done = latest?.[key] === 'yes' || latest?.[key] === true;
      await updateRecord(`contracts/${c.contract_code}`, { [key]: done ? 'no' : 'yes' });
      showToast(done ? '해제' : '완료');
    });
  });

  // Contract status toggle (not settlement)
  el.querySelectorAll('.status-toggle:not(.ws4-settle-status)').forEach(tog => {
    tog.addEventListener('click', async () => {
      await updateRecord(`contracts/${c.contract_code}`, { contract_status: tog.dataset.status });
      showToast(`→ ${tog.dataset.status}`);
    });
  });

  // Settlement status toggle
  el.querySelectorAll('.ws4-settle-status').forEach(tog => {
    tog.addEventListener('click', async () => {
      const key = tog.dataset.settleKey;
      const { settlementStatusPayload } = await import('../core/settlement-status.js');
      await updateRecord(`settlements/${key}`, settlementStatusPayload(tog.dataset.status));
      showToast(`정산 → ${tog.dataset.status}`);
    });
  });

  // Settlement confirm toggle
  el.querySelectorAll('.ws4-settle-confirm').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.settleKey;
      const role = btn.dataset.role;
      const settlements = store.settlements || [];
      const s = settlements.find(x => x._key === key);
      const current = s?.confirms?.[role] || false;
      await updateRecord(`settlements/${key}`, { [`confirms/${role}`]: !current });
      showToast(!current ? '확인' : '해제');
    });
  });

  // Auto-save inputs
  el.querySelectorAll('.contract-field-input').forEach(inp => {
    inp.addEventListener('blur', async () => {
      await updateRecord(`contracts/${c.contract_code}`, { [inp.dataset.field]: inp.value.trim() });
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
}

/* ── Vehicle Detail Panel ── */
async function loadVehicleDetail(productKey) {
  const el = document.getElementById('wsDetailBody');
  if (!el) return;

  el.innerHTML = '<div style="padding:var(--sp-4);color:var(--c-text-muted);font-size:var(--fs-xs);">로딩...</div>';

  const p = await fetchRecord(`products/${productKey}`);
  if (!p) { el.innerHTML = '<div style="padding:var(--sp-4);color:var(--c-text-muted);font-size:var(--fs-xs);">차량 없음</div>'; return; }

  const price = p.price || {};
  const imgs = p.image_urls || p.images || [];
  const imgList = Array.isArray(imgs) ? imgs : Object.values(imgs);

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;">
      ${imgList.length ? `<div style="width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--c-bg-sub);"><img src="${imgList[0]}" style="width:100%;height:100%;object-fit:cover;"></div>` : ''}

      <div style="padding:var(--sp-3);">
        <div style="font-weight:var(--fw-heavy);font-size:var(--fs-md);">${p.year||''} ${p.model||''} ${p.sub_model||''}</div>
        <div style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:2px;">${p.car_number||''} · ${p.maker||''}</div>
      </div>

      <div class="form-section">
        <div class="form-section-title">스펙</div>
        <div class="form-section-body">
          ${ffv('연식',p.year)}${ffv('연료',p.fuel_type)}
          ${ffv('주행',p.mileage?Number(p.mileage).toLocaleString()+'km':'-')}${ffv('색상',p.ext_color||p.exterior_color)}
          ${ffv('위치',p.location)}${ffv('유형',p.product_type)}
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">대여료</div>
        <table class="srch-price-table" style="width:100%;">
          <thead><tr><th></th><th>12</th><th>24</th><th>36</th></tr></thead>
          <tbody>
            <tr><td>월납입</td><td class="accent">${fmtMoney(price['12']?.rent)}</td><td class="accent">${fmtMoney(price['24']?.rent)}</td><td class="accent">${fmtMoney(price['36']?.rent)}</td></tr>
            <tr><td>보증금</td><td>${fmtMoney(price['12']?.deposit)}</td><td>${fmtMoney(price['24']?.deposit)}</td><td>${fmtMoney(price['36']?.deposit)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="form-section">
        <div class="form-section-title">부가</div>
        <div class="form-section-body">
          ${ffv('공급사',p.provider_company_code)}${ffv('정책',p.policy_name)}
          ${ffv('상태',p.vehicle_status)}${ffv('코드',p.product_code)}
        </div>
      </div>
    </div>
  `;
}

/* ── Settlement Section (계약 패널 안) ── */
function renderSettlementSection(contract) {
  if (!contract) return '';

  const settlements = store.settlements || [];
  const s = settlements.find(x => x.contract_code === contract.contract_code);

  if (!s) return `
    <div style="padding:var(--sp-3);color:var(--c-text-muted);font-size:var(--fs-xs);text-align:center;border-top:1px solid var(--c-border);margin-top:var(--sp-2);padding-top:var(--sp-3);">
      정산 정보 없음
    </div>
  `;

  const status = getSettlementStatus(s);
  const confirms = s.confirms || {};

  return `
    <div style="border-top:2px solid var(--c-border);margin-top:var(--sp-2);padding-top:var(--sp-3);">
      <div style="font-weight:var(--fw-bold);font-size:var(--fs-sm);margin-bottom:var(--sp-2);">정산</div>

      <div style="text-align:center;padding:var(--sp-3);background:var(--c-bg-sub);border-radius:var(--ctrl-r);margin-bottom:var(--sp-2);">
        <div style="font-size:var(--fs-xs);color:var(--c-text-muted);">수수료</div>
        <div style="font-size:var(--fs-xl);font-weight:var(--fw-heavy);color:var(--c-accent);">${fmtWon(s.fee_amount)}</div>
      </div>

      <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:var(--sp-2);">
        ${SETTLEMENT_STATUSES_BASIC.map(st => {
          const active = status === st;
          return `<div class="status-toggle ws4-settle-status" data-settle-key="${s._key}" data-status="${st}" style="font-size:var(--fs-2xs);padding:3px 8px;${active ? 'background:var(--c-accent-soft);color:var(--c-accent);' : ''}">${st.replace('정산','')}</div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:var(--sp-1);margin-bottom:var(--sp-2);">
        ${['공급사','영업자','관리자'].map((label, i) => {
          const roles = ['provider','agent','admin'];
          const confirmed = confirms[roles[i]];
          return `<div class="settle-confirm ws4-settle-confirm ${confirmed ? 'is-confirmed' : ''}" data-settle-key="${s._key}" data-role="${roles[i]}" style="padding:var(--sp-2);font-size:var(--fs-2xs);">
            <i class="ph ${confirmed ? 'ph-check-circle' : 'ph-circle'}" style="font-size:16px;"></i>
            <span>${label}</span>
          </div>`;
        }).join('')}
      </div>

      <div class="form-section">
        <div class="form-section-title">정산정보</div>
        <div class="form-section-body">
          ${ffv('월대여료', fmtWon(s.rent_amount))}${ffv('보증금', fmtWon(s.deposit_amount))}
          ${ffv('정산일', s.settled_date||'-')}${ffv('상태', status)}
        </div>
      </div>
    </div>
  `;
}

/* ── Helpers ── */

/* ── Unmount ── */
export function unmount() {
  unsubs.forEach(u => u?.());
  unsubs = [];
  unsubMessages?.();
  unsubMessages = null;
  chatInputAC?.abort();
  chatInputAC = null;
}
