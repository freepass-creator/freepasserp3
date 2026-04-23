/**
 * 모바일 업무소통 (workspace)
 * - 방 목록 (1컬럼 카드)
 * - 방 탭 → 풀스크린 채팅 뷰 (뒤로가기 가능)
 * - 채팅 상단 우측 버튼 → 계약진행상황 사이드 패널
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, pushRecord } from '../firebase/db.js';
import { markRoomRead } from '../firebase/collections.js';
import { showToast } from '../core/toast.js';
import { STEPS as CONTRACT_STEPS, getProgress } from '../core/contract-steps.js';
import { pushMobileView, openBottomSheet } from '../core/mobile-shell.js';

let unsubRooms = null;
let unsubMessages = null;
let unsubContracts = null;
let activeRoomId = null;
let activeView = null; // {view, close}
let chatMessages = [];

export function mount() {
  cleanup();
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="m-shell-page">
      <div class="m-search-head">
        <div class="m-search-bar">
          <i class="ph ph-magnifying-glass"></i>
          <input type="search" id="mwsSearch" placeholder="차량번호, 모델명 검색..."
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                 enterkeyhint="search">
          <span class="m-search-count" id="mwsCount"></span>
          <button class="m-topbar-action" id="mwsSearchClear" style="display:none;" aria-label="지우기"><i class="ph ph-x-circle"></i></button>
        </div>
        <div class="m-filter-chips">
          <button class="chip is-active" data-rf="all">전체</button>
          <button class="chip" data-rf="unread">안읽음</button>
          <button class="chip" data-rf="read">읽음</button>
        </div>
      </div>
      <div class="m-page" id="mwsRoomList"></div>
    </div>
  `;

  const listEl = document.getElementById('mwsRoomList');
  const mwsSearchEl = document.getElementById('mwsSearch');
  const mwsSearchClearEl = document.getElementById('mwsSearchClear');
  mwsSearchEl?.addEventListener('input', () => {
    if (mwsSearchClearEl) mwsSearchClearEl.style.display = mwsSearchEl.value ? '' : 'none';
    renderRooms();
  });
  mwsSearchClearEl?.addEventListener('click', () => {
    mwsSearchEl.value = '';
    mwsSearchClearEl.style.display = 'none';
    renderRooms();
  });
  main.querySelectorAll('.chip[data-rf]').forEach(chip => {
    chip.addEventListener('click', () => {
      main.querySelectorAll('.chip[data-rf]').forEach(x => x.classList.remove('is-active'));
      chip.classList.add('is-active');
      renderRooms();
    });
  });

  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-rid]');
    if (item) openRoom(item.dataset.rid);
  });

  unsubRooms = watchCollection('rooms', (data) => {
    store.rooms = data;
    renderRooms();
    if (store.pendingOpenRoom) {
      const rid = store.pendingOpenRoom;
      if (data.find(r => r._key === rid)) {
        store.pendingOpenRoom = null;
        openRoom(rid);
      }
    }
  }, { limit: 200 });
  unsubContracts = watchCollection('contracts', (d) => { store.contracts = d; });
}

function renderRooms() {
  const el = document.getElementById('mwsRoomList');
  if (!el) return;
  const me = store.currentUser || {};
  const role = me.role;
  const q = (document.getElementById('mwsSearch')?.value || '').toLowerCase();
  const rf = document.querySelector('.chip[data-rf].is-active')?.dataset.rf || 'all';

  let rooms = (store.rooms || []).filter(r => !r._deleted);
  const myChannelCode = me.agent_channel_code || me.channel_code || '';
  if (role === 'agent') {
    rooms = rooms.filter(r => r.agent_uid === me.uid && !r.hidden_for_agent);
  } else if (role === 'agent_admin') {
    rooms = rooms.filter(r => r.agent_channel_code === myChannelCode && !r.hidden_for_agent);
  } else if (role === 'provider') {
    rooms = rooms.filter(r => (r.provider_uid === me.uid || r.provider_company_code === me.company_code) && !r.hidden_for_provider);
  } else if (role === 'admin') {
    rooms = rooms.filter(r => !r.hidden_for_admin);
  }

  if (q) rooms = rooms.filter(r => [r.vehicle_number, r.sub_model, r.model, r.agent_code, r.provider_code, r.provider_company_code].some(v => v && String(v).toLowerCase().includes(q)));

  if (rf === 'unread') {
    rooms = rooms.filter(r => {
      const n = (role === 'agent' || role === 'agent_admin') ? r.unread_for_agent : role === 'provider' ? r.unread_for_provider : 0;
      return (n || 0) > 0;
    });
  } else if (rf === 'read') {
    rooms = rooms.filter(r => {
      const n = (role === 'agent' || role === 'agent_admin') ? r.unread_for_agent : role === 'provider' ? r.unread_for_provider : 0;
      return !(n > 0);
    });
  }

  rooms.sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));

  const countEl = document.getElementById('mwsCount');
  if (countEl) countEl.textContent = rooms.length ? `${rooms.length}건` : '';

  if (!rooms.length) {
    el.innerHTML = `<div class="m-empty"><i class="ph ph-chat-circle"></i><p>대화 없음</p></div>`;
    return;
  }

  el.innerHTML = rooms.map(r => {
    const unread = (role === 'agent' || role === 'agent_admin') ? r.unread_for_agent : role === 'provider' ? r.unread_for_provider : 0;
    const fmtDate = r.last_message_at ? new Date(r.last_message_at).toLocaleDateString('ko', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '';
    const fmtHM   = r.last_message_at ? new Date(r.last_message_at).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' }) : '';
    const title = [r.vehicle_number, r.sub_model || r.model].filter(Boolean).join(' ') || '-';
    // 2줄: 공급사코드 · 영업채널 · 영업자 · 대화코드
    const chatCode = r.chat_code || r.room_id || r._key || '';
    const chatCodeShort = chatCode.length > 18 ? chatCode.slice(-12) : chatCode;
    const meta = [r.provider_company_code || r.provider_code, r.agent_channel_code, r.agent_code, chatCodeShort].filter(Boolean).join(' · ');
    // 3줄: 마지막 발신자 코드 + 시간 · 마지막메세지
    const senderTone = r.last_sender_role === 'agent' || r.last_sender_role === 'agent_admin' ? 'agent'
                     : r.last_sender_role === 'provider' ? 'provider'
                     : r.last_sender_role === 'admin' ? 'admin' : '';
    const senderBadge = r.last_sender_code
      ? `<span class="chat-sender chat-sender-${senderTone}">${r.last_sender_code}</span>`
      : '';
    const hasUnread = unread > 0;
    return `
      <div class="m-room-item" data-rid="${r._key}">
        <div class="m-chat-avatar ${hasUnread ? 'is-accent' : ''}">
          <i class="ph ${hasUnread ? 'ph-chat-circle-dots' : 'ph-chat-circle'}"></i>
          <span class="m-avatar-label">${hasUnread ? '안읽음' : '읽음'}</span>
        </div>
        <div class="m-room-item-body">
          <div class="m-room-item-top">
            <span class="m-room-item-name">${title}</span>
            <span class="m-room-item-time">${fmtDate}</span>
          </div>
          <div class="m-room-item-msg">
            <span>${meta}</span>
          </div>
          <div class="m-room-item-sub">
            ${senderBadge}
            <span>${[fmtHM, r.last_message, hasUnread ? `(안읽음 ${unread > 99 ? '99+' : unread})` : ''].filter(Boolean).join(' · ') || '-'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openRoom(roomId) {
  activeRoomId = roomId;
  const room = (store.rooms || []).find(r => r._key === roomId);
  if (!room) return;

  const title = [room.vehicle_number, room.sub_model || room.model].filter(Boolean).join(' ') || '대화';
  const headerRight = `
    <button class="m-topbar-action" id="mwsShowContract" title="계약진행"><i class="ph ph-clipboard-text"></i></button>
  `;

  const body = `
    <div class="m-chat-view">
      <div class="m-chat-messages" id="mwsChatMsgs">
        <div class="m-empty"><i class="ph ph-spinner ph-spin"></i></div>
      </div>
      <div class="m-chat-input-area">
        <input class="m-chat-input" id="mwsChatText" type="text"
               placeholder="메시지 입력..."
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               data-form-type="other" data-lpignore="true"
               enterkeyhint="send" inputmode="text">
        <button class="m-chat-send" id="mwsChatSend" aria-label="보내기"><i class="ph ph-paper-plane-tilt"></i></button>
      </div>
    </div>
  `;

  activeView = pushMobileView(body, {
    title,
    headerRight,
    onMount: () => {
      bindChatInput(roomId, room);
      subscribeMessages(roomId);
      // 읽음 처리
      const me = store.currentUser;
      if (me?.uid && me?.role) markRoomRead(roomId, me.role, me.uid, room).catch(() => {});
      document.getElementById('mwsShowContract')?.addEventListener('click', () => openContractSheet(room));
      // 입력칸 자동 포커스 — slide-in 중 focus 하면 iOS 가 스크롤 점프 발생, 완료 후 올림
      setTimeout(() => document.getElementById('mwsChatText')?.focus(), 120);
    },
    onClose: () => {
      activeRoomId = null;
      unsubMessages?.();
      unsubMessages = null;
    },
  });
}

function subscribeMessages(roomId) {
  unsubMessages?.();
  unsubMessages = watchCollection(`messages/${roomId}`, (msgs) => {
    chatMessages = msgs;
    renderMessages();
    const me = store.currentUser;
    if (activeRoomId === roomId && !document.hidden && me?.uid && me?.role) {
      markRoomRead(roomId, me.role, me.uid, (store.rooms||[]).find(r => r._key === roomId)).catch(() => {});
    }
  });
}

function renderMessages() {
  const el = document.getElementById('mwsChatMsgs');
  if (!el) return;
  const me = store.currentUser || {};
  const sorted = [...chatMessages].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  if (!sorted.length) {
    el.innerHTML = `<div class="m-empty"><i class="ph ph-chat-circle"></i><p>메시지 없음</p></div>`;
    return;
  }

  const fmt = (ts) => {
    const d = new Date(ts);
    const h = d.getHours(), mi = String(d.getMinutes()).padStart(2, '0');
    return `${h < 12 ? '오전' : '오후'} ${h === 0 ? 12 : h > 12 ? h - 12 : h}:${mi}`;
  };
  let lastDate = '';
  let lastSenderUid = null;
  let lastMinute = null;
  el.innerHTML = sorted.map((msg, i) => {
    const mine = msg.sender_uid === me.uid;
    const ts = msg.created_at || 0;
    const dk = new Date(ts).toDateString();
    const minuteKey = new Date(ts).toISOString().slice(0, 16);
    let dateSep = '';
    if (dk !== lastDate) {
      dateSep = `<div class="chat-date-sep"><span>${new Date(ts).toLocaleDateString('ko', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>`;
      lastDate = dk;
      lastSenderUid = null;
      lastMinute = null;
    }
    const groupStart = msg.sender_uid !== lastSenderUid || minuteKey !== lastMinute;
    lastSenderUid = msg.sender_uid;
    lastMinute = minuteKey;
    const next = sorted[i + 1];
    const groupEnd = !next || next.sender_uid !== msg.sender_uid
      || new Date(next.created_at || 0).toISOString().slice(0, 16) !== minuteKey;

    // 발신자 라벨 — sender_code 우선, 없으면 role 약어
    const senderLabel = msg.sender_code
      || (msg.sender_role === 'agent' ? '영업'
        : msg.sender_role === 'provider' ? '공급'
        : msg.sender_role === 'admin' ? '관리' : '');
    const roleTone = msg.sender_role === 'agent' ? 'agent'
                   : msg.sender_role === 'provider' ? 'provider' : 'admin';

    let content;
    if (msg.image_url) content = `<img src="${msg.image_url}" class="chat-img">`;
    else if (msg.file_url) content = `<a href="${msg.file_url}" target="_blank" class="chat-file"><i class="ph ph-paperclip"></i> ${(msg.text||'파일').replace(/</g, '&lt;')}</a>`;
    else content = (msg.text || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');

    return `${dateSep}<div class="chat-row ${mine ? 'is-mine' : 'is-other'} ${groupStart ? 'is-start' : ''} ${groupEnd ? 'is-end' : ''}">
      ${!mine && groupStart ? `<div class="chat-sender chat-sender-${roleTone}">${senderLabel}</div>` : (!mine ? '<div class="chat-sender-spacer"></div>' : '')}
      <div class="chat-bubble-wrap">
        <div class="chat-bubble chat-bubble-${roleTone}">${content}</div>
        ${groupEnd ? `<div class="chat-meta"><span class="chat-time">${fmt(ts)}</span></div>` : ''}
      </div>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function bindChatInput(roomId, room) {
  const input = document.getElementById('mwsChatText');
  const sendBtn = document.getElementById('mwsChatSend');

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const user = store.currentUser;
    // 개인 식별자만 허용 — company_code 폴백 금지 (SP999 같은 공유 임시채널 노출 방지)
    const senderCode = user.user_code || '';
    await pushRecord(`messages/${roomId}`, {
      text, sender_uid: user.uid, sender_role: user.role,
      sender_code: senderCode, sender_name: user.name || '', created_at: Date.now(),
    });
    const cur = (store.rooms || []).find(r => r._key === roomId) || {};
    const upd = { last_message: text, last_message_at: Date.now(), last_sender_role: user.role, last_sender_uid: user.uid, last_sender_code: senderCode };
    if (user.role === 'agent' || user.role === 'agent_admin') upd.unread_for_provider = (cur.unread_for_provider || 0) + 1;
    else if (user.role === 'provider') upd.unread_for_agent = (cur.unread_for_agent || 0) + 1;
    await updateRecord(`rooms/${roomId}`, upd);
  };

  sendBtn?.addEventListener('click', send);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // 포커스 시 읽음
  input?.addEventListener('focus', () => {
    const me = store.currentUser;
    if (me?.uid && me?.role) markRoomRead(roomId, me.role, me.uid, room).catch(() => {});
  });
}

/** 계약 진행상황 바텀시트 */
function openContractSheet(room) {
  const contracts = store.contracts || [];
  const c = contracts.find(x => x.product_uid === room.product_uid || x.seed_product_key === room.product_uid)
         || (room.linked_contract && contracts.find(x => x.contract_code === room.linked_contract));

  if (!c) {
    const myRole = store.currentUser?.role;
    const canCreate = myRole === 'agent' || myRole === 'agent_admin';
    openBottomSheet(`
      <div style="padding:var(--sp-4);display:flex;flex-direction:column;align-items:center;gap:var(--sp-3);">
        <i class="ph ph-file-text" style="font-size:36px;color:var(--c-text-muted);"></i>
        <p style="color:var(--c-text-muted);font-size:var(--fs-sm);">연결된 계약 없음</p>
        ${canCreate ? '<button class="btn btn-primary" id="mwsCreateContract" style="width:100%;"><i class="ph ph-plus"></i> 계약 생성하기</button>' : ''}
      </div>
    `, {
      title: '계약 진행상황',
      onMount: (sheet) => {
        sheet.querySelector('#mwsCreateContract')?.addEventListener('click', async () => {
          try {
            const { createContractFromRoom } = await import('../firebase/collections.js');
            await createContractFromRoom(room, store.currentUser);
            showToast('계약 생성됨');
          } catch (e) { showToast('생성 실패', 'error'); }
        });
      },
    });
    return;
  }

  const prog = getProgress(c);
  const stepsHtml = CONTRACT_STEPS.map(step => {
    const agentKey = step.agent?.key;
    const respKey = step.provider?.key || step.admin?.key;
    const agentDone = agentKey ? (c[agentKey] === true || c[agentKey] === 'yes') : false;
    const respVal = respKey ? c[respKey] : null;
    const respDone = respVal === true || respVal === 'yes' || respVal === '출고 가능' || respVal === '출고 협의' || respVal === '서류 승인';
    const rejected = respVal === '출고 불가' || respVal === '서류 부결';
    const agentClass = agentDone ? 'is-done' : 'is-pending';
    const respClass = rejected ? 'is-rejected' : respDone ? 'is-done' : 'is-pending';
    return `
      <div class="ct-step-row">
        <div class="ct-step-cell ${agentClass}"><i class="ph ${agentDone ? 'ph-check-circle' : 'ph-circle'}"></i><span>${step.agent?.label || ''}</span></div>
        <div class="ct-step-arrow"><i class="ph ph-arrow-right"></i></div>
        <div class="ct-step-cell ${respClass}"><i class="ph ${rejected ? 'ph-x-circle' : respDone ? 'ph-check-circle' : 'ph-circle'}"></i><span>${respDone && respVal && respVal !== 'yes' && respVal !== true ? respVal : rejected ? respVal : step.provider?.label || step.admin?.label || ''}</span></div>
      </div>
    `;
  }).join('');

  openBottomSheet(`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-2) 0;">
      <div style="font-weight:var(--fw-semibold);">${c.car_number_snapshot || ''} ${c.sub_model_snapshot || c.model_snapshot || ''}</div>
      <span style="font-size:var(--fs-xs);color:${prog.done === prog.total ? 'var(--c-ok)' : 'var(--c-info)'};">${prog.done}/${prog.total}</span>
    </div>
    <div class="ct-steps">
      <div class="ct-step-row" style="font-size:var(--fs-2xs);color:var(--c-text-muted);">
        <div style="text-align:center;">영업자</div><div></div><div style="text-align:center;">공급사</div>
      </div>
      ${stepsHtml}
    </div>
  `, { title: '계약 진행상황' });
}

function cleanup() {
  unsubRooms?.();
  unsubMessages?.();
  unsubContracts?.();
  unsubRooms = unsubMessages = unsubContracts = null;
  activeRoomId = null;
  if (activeView) {
    activeView.close?.();
    activeView = null;
  }
}

export function unmount() {
  cleanup();
}
