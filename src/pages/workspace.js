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
import { STEPS as CONTRACT_STEPS, getStepStates, getProgress } from '../core/contract-steps.js';
import { renderExcelTable } from '../core/excel-table.js';
import { renderProductDetail } from '../core/product-detail-render.js';

let unsubs = [];
let activeRoomId = null;
let activeContract = null;
let viewMode = 'card';

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
        <div class="ws4-head"><span>업무 목록</span><button class="btn btn-sm btn-outline" id="wsViewToggle"><i class="ph ph-table"></i> 엑셀보기</button></div>
        <div class="ws4-search">
          <input class="input input-sm" id="wsRoomSearch" placeholder="검색..." >
          <div style="display:flex;gap:3px;">
            <button class="chip is-active" data-rf="all">전체</button>
            <button class="chip" data-rf="unread">안읽음</button>
            <button class="chip" data-rf="read">읽음</button>
          </div>
        </div>
        <div class="ws4-body" id="wsRoomList"></div>
      </div>

      <div class="ws4-resize" data-idx="0"></div>

      <div class="ws4-panel ws4-chat" data-panel="chat">
        <div class="ws4-head">
          <span id="wsChatHead">소통 채팅</span>
          <span style="display:flex;gap:var(--sp-1);" id="wsChatActions"></span>
        </div>
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
        <div class="ws4-head">계약 진행상황</div>
        <div class="ws4-body" id="wsContractBody">
          <div class="srch-empty"><i class="ph ph-file-text"></i><p>계약 정보</p></div>
        </div>
      </div>

      <div class="ws4-resize" data-idx="2"></div>

      <div class="ws4-panel ws4-detail" data-panel="detail">
        <div class="ws4-head">상품 상세</div>
        <div class="ws4-body" id="wsDetailBody">
          <div class="srch-empty"><i class="ph ph-car-simple"></i><p>차량 상세</p></div>
        </div>
      </div>
    </div>
  `;

  // Resize handles
  initWs4Resize('fp.ws4.widths');

  // 룸 필터 칩 이벤트 위임
  main.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-rf]');
    if (chip) {
      main.querySelectorAll('.chip[data-rf]').forEach(x => x.classList.remove('is-active'));
      chip.classList.add('is-active');
      renderRoomList();
    }
  });

  // Watch rooms
  let _prevActiveRoomReadAt = null;
  unsubs.push(watchCollection('rooms', (data) => {
    store.rooms = data;
    renderRoomList();
    updateBrief();
    // 활성 방의 상대방 read_at 변경 시 메시지 재렌더 (읽음 표시 갱신)
    if (activeRoomId) {
      const activeRoom = data.find(r => r._key === activeRoomId);
      const role = store.currentUser?.role;
      const peerReadAt = role === 'agent' ? (activeRoom?.read_at_provider || 0) : role === 'provider' ? (activeRoom?.read_at_agent || 0) : 0;
      if (peerReadAt !== _prevActiveRoomReadAt) {
        _prevActiveRoomReadAt = peerReadAt;
        if (currentMessages.length) renderMessages(currentMessages);
      }
    }
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

  document.getElementById('wsViewToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    viewMode = viewMode === 'excel' ? 'card' : 'excel';
    const btn = document.getElementById('wsViewToggle');
    if (btn) btn.innerHTML = viewMode === 'excel' ? '<i class="ph ph-cards"></i> 카드보기' : '<i class="ph ph-table"></i> 엑셀보기';
    renderRoomList();
  });
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

  // 삭제된 대화 제외
  rooms = rooms.filter(r => !r._deleted);

  // 역할별 숨김 처리
  if (role === 'agent') {
    rooms = rooms.filter(r => !r.hidden_for_agent);
  } else if (role === 'provider') {
    rooms = rooms.filter(r => !r.hidden_for_provider);
  } else if (role === 'admin') {
    rooms = rooms.filter(r => !r.hidden_for_admin);
  }

  // 영업자: 본인 관련 대화만 / 영업관리자: 본인 채널 전체 / 공급사: 본인 소속 대화만
  const myChannelCode = store.currentUser?.agent_channel_code || store.currentUser?.channel_code || '';
  if (role === 'agent') {
    rooms = rooms.filter(r => r.agent_uid === uid);
  } else if (role === 'agent_admin') {
    rooms = rooms.filter(r => r.agent_channel_code === myChannelCode);
  } else if (role === 'provider') {
    rooms = rooms.filter(r => r.provider_uid === uid || r.provider_company_code === store.currentUser?.company_code);
  }

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
  } else if (rf === 'read') {
    rooms = rooms.filter(r => {
      const unread = role === 'agent' ? r.unread_for_agent : role === 'provider' ? r.unread_for_provider : 0;
      return !unread || unread <= 0;
    });
  }

  const sorted = [...rooms].sort((a,b) => (b.last_message_at||0) - (a.last_message_at||0));

  if (viewMode === 'excel') {
    renderExcelTable(el, {
      cols: [
        { key: 'vehicle_number', label: '차량번호', width: 90, pin: 'left', filter: 'search' },
        { key: '_status', label: '소통상태', width: 80, filter: 'check', render: (r) => {
          const myRole = store.currentUser?.role;
          const unread = myRole === 'agent' ? r.unread_for_agent : myRole === 'provider' ? r.unread_for_provider : 0;
          return (unread || 0) > 0 ? '안읽음' : '읽음';
        }},
        { key: 'vehicle_number', label: '차량번호', width: 100, pin: 'left', filter: 'search' },
        { key: 'sub_model', label: '세부모델', width: 160, filter: 'search', render: (r) => r.sub_model || r.model || '' },
        { key: 'agent_channel_code', label: '영업채널', width: 90, filter: 'check' },
        { key: 'agent_code', label: '영업자', width: 90, filter: 'check' },
        { key: 'last_message_at', label: '메시지시간', width: 120, render: (r) => r.last_message_at ? new Date(r.last_message_at).toLocaleString('ko', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '' },
        { key: 'last_message', label: '마지막메시지', width: 240, render: (r) => r.last_message || '' },
      ],
      data: sorted,
      activeKey: activeRoomId,
      keyField: '_key',
      onRowClick: (room) => openRoom(room._key),
    });
    return;
  }

  // Card view
  el.innerHTML = sorted.map(room => {
    const unread = role === 'agent' ? room.unread_for_agent : role === 'provider' ? room.unread_for_provider : 0;
    const active = activeRoomId === room._key;
    const fmtDate = room.last_message_at ? new Date(room.last_message_at).toLocaleDateString('ko', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '';
    const fmtHM = room.last_message_at ? new Date(room.last_message_at).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' }) : '';

    return `
      <div class="room-item ${active ? 'is-active' : ''}" data-id="${room._key}">
        <div class="room-item-avatar ${unread > 0 ? 'is-accent' : 'is-muted'}" style="flex-direction:column;gap:1px;font-size:var(--fs-2xs);"><i class="ph ${unread > 0 ? 'ph-chat-circle-dots' : 'ph-chat-circle'}"></i>${unread > 0 ? '안읽음' : '읽음'}</div>
        <div class="room-item-body">
          <div class="room-item-top">
            <span class="room-item-name">${[room.vehicle_number, room.sub_model || room.model].filter(Boolean).join(' ') || '-'}</span>
            <span class="room-item-time">${fmtDate}</span>
          </div>
          <div class="room-item-msg">
            <span>${[room.provider_company_code || room.provider_code, room.agent_channel_code, room.agent_code, fmtHM, room.last_message].filter(Boolean).join(' · ')}</span>
            ${unread > 0 ? `<span class="sb-badge is-visible">${unread > 99 ? '99+' : unread}</span>` : ''}
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
let currentMessages = [];  // 최근 렌더 메시지 캐시 (room 업데이트 시 재렌더용)

function openRoom(roomId) {
  activeRoomId = roomId;
  store.activeRoomId = roomId;
  renderRoomList();

  const room = (store.rooms||[]).find(r => r._key === roomId);
  const role = store.currentUser?.role;
  const uid = store.currentUser?.uid;
  // 상대방 코드 (역할별)
  const peerCode = role === 'agent' ? (room?.provider_code || room?.provider_company_code || '') : (room?.agent_code || '');
  const peerRole = role === 'agent' ? '공급' : role === 'provider' ? '영업' : '';
  const roomCode = room?.chat_code || room?.room_code || room?.room_id || room?._key || '';

  // 상단바 작업 컨텍스트 갱신
  setBreadcrumbTail({ icon: 'ph ph-chat-circle', label: peerCode || '대화', sub: room?.vehicle_number || '' });

  // 읽음 처리
  if (uid && role) markRoomRead(roomId, role, uid, room).catch(() => {});

  // Chat head — 대화코드 표시
  document.getElementById('wsChatHead').textContent = roomCode ? `소통 채팅 · ${roomCode}` : '소통 채팅';
  document.getElementById('wsChatInput').style.display = '';

  // 채팅 액션 버튼 — 역할별
  const actionsEl = document.getElementById('wsChatActions');
  if (actionsEl) {
    const canDelete = role === 'provider' || role === 'admin';
    actionsEl.innerHTML = `
      <button class="btn btn-xs btn-outline" id="wsChatHide" title="이 대화 목록에서 숨기기"><i class="ph ph-eye-slash"></i> 숨김</button>
      ${canDelete ? '<button class="btn btn-xs btn-outline" id="wsChatDelete" title="이 대화 삭제" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>' : ''}
    `;
    document.getElementById('wsChatHide')?.addEventListener('click', async () => {
      if (!confirm('이 대화를 목록에서 숨기시겠습니까? (메시지는 유지됩니다)')) return;
      const field = role === 'agent' ? 'hidden_for_agent' : role === 'provider' ? 'hidden_for_provider' : 'hidden_for_admin';
      await updateRecord(`rooms/${roomId}`, { [field]: true });
      showToast('대화 숨김');
      activeRoomId = null;
      document.getElementById('wsChatMsgs').innerHTML = '<div class="srch-empty"><i class="ph ph-chat-circle"></i><p>대화를 선택하세요</p></div>';
      document.getElementById('wsChatInput').style.display = 'none';
      document.getElementById('wsChatHead').textContent = '소통 채팅';
      actionsEl.innerHTML = '';
    });
    document.getElementById('wsChatDelete')?.addEventListener('click', async () => {
      if (!confirm('이 대화를 완전히 삭제하시겠습니까?\n(메시지 포함 전체 삭제 — 되돌릴 수 없음)')) return;
      await updateRecord(`rooms/${roomId}`, { _deleted: true, deleted_at: Date.now(), deleted_by: uid });
      showToast('대화 삭제됨');
      activeRoomId = null;
      document.getElementById('wsChatMsgs').innerHTML = '<div class="srch-empty"><i class="ph ph-chat-circle"></i><p>대화를 선택하세요</p></div>';
      document.getElementById('wsChatInput').style.display = 'none';
      document.getElementById('wsChatHead').textContent = '소통 채팅';
      actionsEl.innerHTML = '';
    });
  }

  // Watch messages
  unsubMessages?.();
  unsubMessages = watchCollection(`messages/${roomId}`, (msgs) => {
    currentMessages = msgs;
    renderMessages(msgs);
    // 활성 방이고 탭이 보이는 상태면 새 메시지 도착 즉시 읽음 처리
    if (activeRoomId === roomId && !document.hidden && uid && role) {
      markRoomRead(roomId, role, uid, room).catch(() => {});
    }
  });

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
  const me = store.currentUser;
  const uid = me?.uid;
  const myRole = me?.role;
  const room = (store.rooms || []).find(r => r._key === activeRoomId);
  const sorted = [...messages].sort((a,b) => (a.created_at||0) - (b.created_at||0));

  // 상대방이 마지막으로 읽은 시각 — read_at_* 기준 (실제 대화 열람 시점)
  // 관리자(admin)는 당사자가 아니므로 읽음에 영향 X
  const peerReadAt = myRole === 'agent' ? (room?.read_at_provider || 0) : myRole === 'provider' ? (room?.read_at_agent || 0) : Infinity;

  // 날짜 구분선용
  let lastDate = '';
  let lastSenderUid = '';
  let lastMinute = '';

  const fmt = (ts) => {
    const d = new Date(ts);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h < 12 ? '오전' : '오후';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${ampm} ${h12}:${m}`;
  };
  const fmtDate = (ts) => {
    const d = new Date(ts);
    const W = ['일','월','화','수','목','금','토'][d.getDay()];
    return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 ${W}요일`;
  };

  el.innerHTML = sorted.map((msg, i) => {
    const isMine = msg.sender_uid === uid;
    const ts = msg.created_at || 0;
    const dateKey = new Date(ts).toDateString();
    const minuteKey = new Date(ts).toISOString().slice(0, 16);

    // 날짜 바뀌면 구분선
    let dateSep = '';
    if (dateKey !== lastDate) {
      dateSep = `<div class="chat-date-sep"><span>${fmtDate(ts)}</span></div>`;
      lastDate = dateKey;
      lastSenderUid = '';
      lastMinute = '';
    }

    // 연속 메시지 (같은 사람 + 같은 분) → 이름/시간 생략
    const groupStart = msg.sender_uid !== lastSenderUid || minuteKey !== lastMinute;
    lastSenderUid = msg.sender_uid;
    lastMinute = minuteKey;

    // 다음 메시지와 같은 그룹인지 (마지막 메시지에만 시간 표시)
    const next = sorted[i + 1];
    const groupEnd = !next || next.sender_uid !== msg.sender_uid || new Date(next.created_at || 0).toISOString().slice(0, 16) !== minuteKey;

    // 코드명 — 발신자 코드 (sender_code 우선, 없으면 role 약어)
    const senderLabel = msg.sender_code || (msg.sender_role === 'agent' ? '영업' : msg.sender_role === 'provider' ? '공급' : msg.sender_role === 'admin' ? '관리' : '');
    const roleTone = msg.sender_role === 'agent' ? 'agent' : msg.sender_role === 'provider' ? 'provider' : 'admin';

    // 읽음 여부 (내 메시지만 표시)
    const isRead = isMine && ts <= peerReadAt;
    const readMark = isMine ? (isRead ? '<span class="chat-read">읽음</span>' : '<span class="chat-unread">안읽음</span>') : '';

    // 콘텐츠
    let content = '';
    if (msg.image_url) content = `<img src="${msg.image_url}" class="chat-img" onclick="window.open('${msg.image_url}','_blank')">`;
    else if (msg.file_url) content = `<a href="${msg.file_url}" target="_blank" class="chat-file"><i class="ph ph-paperclip"></i> ${(msg.text||'파일').replace(/</g,'&lt;')}</a>`;
    else content = (msg.text||'').replace(/</g,'&lt;').replace(/\n/g,'<br>');

    return `${dateSep}<div class="chat-row ${isMine ? 'is-mine' : 'is-other'} ${groupStart ? 'is-start' : ''} ${groupEnd ? 'is-end' : ''}">
      ${!isMine && groupStart ? `<div class="chat-sender chat-sender-${roleTone}">${senderLabel}</div>` : (!isMine ? '<div class="chat-sender-spacer"></div>' : '')}
      <div class="chat-bubble-wrap">
        <div class="chat-bubble chat-bubble-${roleTone}">${content}</div>
        ${groupEnd ? `<div class="chat-meta">${readMark}<span class="chat-time">${fmt(ts)}</span></div>` : ''}
      </div>
    </div>`;
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
    const senderCode = user.user_code || user.agent_code || user.partner_code || user.company_code || '';
    await pushRecord(`messages/${roomId}`, { text, sender_uid: user.uid, sender_role: user.role, sender_code: senderCode, sender_name: user.name||'', created_at: Date.now() });
    const room = (store.rooms || []).find(r => r._key === roomId) || {};
    const roomUpdate = { last_message: text, last_message_at: Date.now(), last_sender_role: user.role, last_sender_uid: user.uid, last_sender_code: senderCode };
    // 상대방 미읽음 카운트 증가
    if (user.role === 'agent') roomUpdate.unread_for_provider = (room.unread_for_provider || 0) + 1;
    else if (user.role === 'provider') roomUpdate.unread_for_agent = (room.unread_for_agent || 0) + 1;
    await updateRecord(`rooms/${roomId}`, roomUpdate);
  };

  sendBtn.addEventListener('click', send, { signal });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, { signal });
  // 입력 포커스 → 읽음 처리
  input.addEventListener('focus', () => {
    const me = store.currentUser;
    if (me?.uid && me?.role) markRoomRead(roomId, me.role, me.uid, (store.rooms||[]).find(r => r._key === roomId)).catch(() => {});
  }, { signal });
  // 탭 복귀 → 읽음 처리
  const onVisible = () => {
    if (!document.hidden && activeRoomId === roomId) {
      const me = store.currentUser;
      if (me?.uid && me?.role) markRoomRead(roomId, me.role, me.uid, (store.rooms||[]).find(r => r._key === roomId)).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onVisible, { signal });
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
          const senderCode = user.user_code || user.agent_code || user.partner_code || user.company_code || '';
          await pushRecord(`messages/${roomId}`, { text: isImage ? '' : file.name, sender_uid: user.uid, sender_role: user.role, sender_code: senderCode, sender_name: user.name||'', created_at: Date.now(), ...(isImage ? { image_url: url } : { file_url: url }) });
          const room2 = (store.rooms || []).find(r => r._key === roomId) || {};
          const fileUpdate = { last_message: isImage ? '📷 사진' : `📎 ${file.name}`, last_message_at: Date.now(), last_sender_role: user.role, last_sender_uid: user.uid, last_sender_code: senderCode };
          if (user.role === 'agent') fileUpdate.unread_for_provider = (room2.unread_for_provider || 0) + 1;
          else if (user.role === 'provider') fileUpdate.unread_for_agent = (room2.unread_for_agent || 0) + 1;
          await updateRecord(`rooms/${roomId}`, fileUpdate);
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
function loadContract(room) {
  const el = document.getElementById('wsContractBody');
  if (!el || !room) return;

  const contracts = store.contracts || [];
  const c = contracts.find(x => x.product_uid === room.product_uid || x.seed_product_key === room.product_uid) || (room.linked_contract && contracts.find(x => x.contract_code === room.linked_contract));

  if (!c) {
    const myRole = store.currentUser?.role;
    const canCreate = myRole === 'agent' || myRole === 'agent_admin';
    el.innerHTML = `
      <div style="padding:var(--sp-4);display:flex;flex-direction:column;align-items:center;gap:var(--sp-3);">
        <i class="ph ph-file-text" style="font-size:36px;color:var(--c-text-muted);"></i>
        <p style="color:var(--c-text-muted);font-size:var(--fs-xs);">연결된 계약 없음</p>
        ${canCreate
          ? '<button class="btn btn-primary btn-sm" id="wsCreateContract" style="width:100%;"><i class="ph ph-plus"></i> 계약 생성하기</button>'
          : '<p style="color:var(--c-text-muted);font-size:var(--fs-2xs);">영업자만 계약 생성 가능</p>'}
      </div>`;
    el.querySelector('#wsCreateContract')?.addEventListener('click', async () => {
      const { createContractFromRoom } = await import('../firebase/collections.js');
      try {
        const code = await createContractFromRoom(room, store.currentUser);
        showToast('계약 생성됨');
        loadContract(room);
      } catch (e) { showToast('생성 실패', 'error'); console.error(e); }
    });
    return;
  }

  activeContract = c;
  const role = store.currentUser?.role || 'agent';
  const isAgent = role === 'agent' || role === 'agent_admin';
  const prog = getProgress(c);

  el.innerHTML = `
    <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-3);overflow-y:auto;height:100%;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);">${c.car_number_snapshot || ''} ${c.sub_model_snapshot || c.model_snapshot || ''}</div>
        <span style="font-size:var(--fs-2xs);color:${prog.done === prog.total ? 'var(--c-ok)' : 'var(--c-info)'};">${prog.done}/${prog.total}</span>
      </div>

      <div class="form-section">
        <div class="form-section-title"><i class="ph ph-list-checks"></i> 진행상황</div>
        <div class="ct-steps">
          <div class="ct-step-row" style="font-size:var(--fs-2xs);color:var(--c-text-muted);font-weight:var(--fw-medium);">
            <div style="text-align:center;">영업자</div><div></div><div style="text-align:center;">공급사</div>
          </div>
          ${CONTRACT_STEPS.map(step => {
            const agentKey = step.agent?.key;
            const respKey = step.provider?.key || step.admin?.key;
            const agentDone = agentKey ? (c[agentKey] === true || c[agentKey] === 'yes') : false;
            const respVal = respKey ? c[respKey] : null;
            const respDone = respVal === true || respVal === 'yes' || respVal === '출고 가능' || respVal === '출고 협의' || respVal === '서류 승인';
            const rejected = respVal === '출고 불가' || respVal === '서류 부결';
            const agentClass = agentDone ? 'is-done' : 'is-pending';
            const respClass = rejected ? 'is-rejected' : respDone ? 'is-done' : 'is-pending';
            return `<div class="ct-step-row">
              <div class="ct-step-cell ${agentClass}"><i class="ph ${agentDone ? 'ph-check-circle' : 'ph-circle'}"></i><span>${step.agent?.label || ''}</span></div>
              <div class="ct-step-arrow"><i class="ph ph-arrow-right"></i></div>
              <div class="ct-step-cell ${respClass}"><i class="ph ${rejected ? 'ph-x-circle' : respDone ? 'ph-check-circle' : 'ph-circle'}"></i><span>${respDone && respVal && respVal !== 'yes' && respVal !== true ? respVal : rejected ? respVal : step.provider?.label || step.admin?.label || ''}</span></div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <button class="btn btn-outline btn-sm" style="width:100%;" onclick="location.hash='';import('./contract.js').then(()=>{});window.__nav?.('/contract');">
        <i class="ph ph-arrow-square-out"></i> 계약관리에서 상세보기
      </button>
    </div>
  `;
  bindFormAutoSave(el, (field, value) => updateRecord(`contracts/${c.contract_code}`, { [field]: value }));
}

/* ── Vehicle Detail Panel ── */
let activeDetailProductKey = null;

async function loadVehicleDetail(productKey) {
  const el = document.getElementById('wsDetailBody');
  if (!el) return;

  activeDetailProductKey = productKey;
  el.innerHTML = '<div style="padding:var(--sp-4);color:var(--c-text-muted);font-size:var(--fs-xs);">로딩...</div>';

  // store.products에서 먼저 찾고, 없으면 Firebase에서 fetch
  let p = (store.products || []).find(x => x._key === productKey);
  if (!p) p = await fetchRecord(`products/${productKey}`);
  if (!p) {
    el.innerHTML = '<div style="padding:var(--sp-4);color:var(--c-text-muted);font-size:var(--fs-xs);">차량 없음</div>';
    return;
  }
  // search.js의 detail과 렌더러는 _key 기반으로 움직임 — 없으면 주입
  if (!p._key) p._key = productKey;

  renderProductDetail(el, p, {
    shouldRerender: () => activeDetailProductKey === productKey,
    showActions: false,
  });
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
      <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);margin-bottom:var(--sp-2);">정산</div>

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
