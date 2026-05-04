/**
 * 모바일 업무소통 (workspace)
 * - 방 목록 (1컬럼 카드)
 * - 방 탭 → 풀스크린 채팅 뷰 (뒤로가기 가능)
 * - 채팅 상단 우측 버튼 → 계약진행상황 사이드 패널
 */
import { store } from '../core/store.js';
import { watchCollection, updateRecord, pushRecord, incrementAtomic } from '../firebase/db.js';
import { markRoomRead } from '../firebase/collections.js';
import { showToast } from '../core/toast.js';
import { STEPS as CONTRACT_STEPS, getProgress } from '../core/contract-steps.js';
import { pushMobileView, openBottomSheet } from '../core/mobile-shell.js';
import { renderChatMessages, getPeerReadAt } from '../core/chat-render.js';
import { mEmpty, mLoading } from '../core/format.js';
import { fmtDate, chatCodeOf, providerNameByCode } from '../core/ui-helpers.js';

let unsubRooms = null;
let unsubMessages = null;
let unsubContracts = null;
let activeRoomId = null;
let activeView = null; // {view, close}
let chatMessages = [];
let chatKeyboardCleanup = null;

export function mount() {
  cleanup();
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="m-shell-page">
      <div class="m-search-head">
        <label class="m-search-bar" for="mwsSearch">
          <i class="ph ph-magnifying-glass"></i>
          <input type="search" id="mwsSearch" placeholder="차량번호, 모델명 검색..."
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                 enterkeyhint="search">
          <span class="m-search-count" id="mwsCount"></span>
          <button type="button" class="m-topbar-action" id="mwsSearchClear" style="display:none;" aria-label="지우기"><i class="ph ph-x-circle"></i></button>
        </label>
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

  if (q) rooms = rooms.filter(r => [
    r.vehicle_number, r.sub_model, r.model, r.maker,
    r.agent_code, r.provider_code, r.provider_company_code,
    r.last_message, r.last_sender_code,
  ].some(v => v && String(v).toLowerCase().includes(q)));

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
    el.innerHTML = mEmpty('대화 없음', 'ph-chat-circle');
    return;
  }

  el.innerHTML = rooms.map(r => {
    const unread = (role === 'agent' || role === 'agent_admin') ? r.unread_for_agent : role === 'provider' ? r.unread_for_provider : 0;
    const dateStr = fmtDate(r.last_message_at);
    const fmtHM   = r.last_message_at ? new Date(r.last_message_at).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' }) : '';
    // 메인: 차량번호 세부모델 공급사명 (공백 구분, 데스크톱과 통일)
    const providerName = providerNameByCode(r.provider_company_code || r.provider_code, store);
    const title = [r.vehicle_number, r.sub_model || r.model, providerName].filter(Boolean).join(' ') || '-';
    // 보조: 영업채널 | 영업자 | 대화코드
    const meta = [r.agent_channel_code, r.agent_code, chatCodeOf(r)].filter(Boolean).join(' · ');
    // 3줄: 마지막 발신자 코드 + 시간 | 마지막메세지
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
            <span class="m-room-item-time">${dateStr}</span>
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
        ${mLoading()}
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

      // 키보드가 올라와 viewport 가 축소될 때 마지막 대화가 항상 보이도록 하단 스크롤 유지
      // (interactive-widget=resizes-content 로 .m-chat-view 가 축소되면 기존 scrollTop 이
      //  남아 최신 메시지가 잘림 — resize·focus 시점에 다시 bottom 으로 당겨줌)
      const msgsEl = document.getElementById('mwsChatMsgs');
      const inputEl = document.getElementById('mwsChatText');
      const scrollBottom = () => {
        if (!msgsEl) return;
        requestAnimationFrame(() => { msgsEl.scrollTop = msgsEl.scrollHeight; });
      };
      inputEl?.addEventListener('focus', scrollBottom);
      window.visualViewport?.addEventListener('resize', scrollBottom);
      chatKeyboardCleanup = () => {
        inputEl?.removeEventListener('focus', scrollBottom);
        window.visualViewport?.removeEventListener('resize', scrollBottom);
      };
    },
    onClose: () => {
      activeRoomId = null;
      unsubMessages?.();
      unsubMessages = null;
      chatKeyboardCleanup?.();
      chatKeyboardCleanup = null;
    },
  });
}

function subscribeMessages(roomId) {
  unsubMessages?.();
  unsubMessages = watchCollection(`messages/${roomId}`, (msgs) => {
    // 구독 콜백에서 한 번만 정렬 — 매 렌더마다 재정렬 방지
    chatMessages = [...msgs].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
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
  const sorted = chatMessages; // 이미 subscribeMessages 에서 정렬됨
  if (!sorted.length) {
    el.innerHTML = mEmpty('메시지 없음', 'ph-chat-circle');
    return;
  }
  const room = (store.rooms || []).find(r => r._key === activeRoomId);
  el.innerHTML = renderChatMessages(sorted, {
    uid: me.uid,
    peerReadAt: getPeerReadAt(room, me.role),
  });
  el.scrollTop = el.scrollHeight;
}

function bindChatInput(roomId, room) {
  const input = document.getElementById('mwsChatText');
  const sendBtn = document.getElementById('mwsChatSend');

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    const user = store.currentUser;
    if (!user?.uid || !user?.role) { showToast('로그인 필요', 'error'); return; }
    input.value = '';  // 낙관적 클리어 — 실패 시 복구
    // 개인 식별자만 허용 — company_code 폴백 금지 (SP999 같은 공유 임시채널 노출 방지)
    const senderCode = user.user_code || '';
    try {
      await pushRecord(`messages/${roomId}`, {
        text, sender_uid: user.uid, sender_role: user.role,
        sender_code: senderCode, sender_name: user.name || '', created_at: Date.now(),
      });
      // 마지막 메시지 메타는 last-writer-wins 로 OK — unread 카운트만 원자적 증가 필요
      const upd = { last_message: text, last_message_at: Date.now(), last_sender_role: user.role, last_sender_uid: user.uid, last_sender_code: senderCode };
      await updateRecord(`rooms/${roomId}`, upd).catch(err => console.warn('[chat] room update 실패 (메시지는 전송됨):', err));
      const unreadField = (user.role === 'agent' || user.role === 'agent_admin') ? 'unread_for_provider'
                        : user.role === 'provider' ? 'unread_for_agent' : null;
      if (unreadField) {
        incrementAtomic(`rooms/${roomId}/${unreadField}`).catch(err => console.warn('[chat] unread 증가 실패:', err));
      }
    } catch (err) {
      console.error('[chat] 전송 실패:', err);
      input.value = text; // 입력 복구
      showToast('전송 실패 — 다시 시도하세요', 'error');
    }
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
    const canCreate = myRole === 'agent' || myRole === 'agent_admin' || myRole === 'admin';
    if (!canCreate) {
      openBottomSheet(`
        <div style="padding:var(--sp-4);display:flex;flex-direction:column;align-items:center;gap:var(--sp-3);">
          <i class="ph ph-file-text" style="font-size:36px;color:var(--c-text-muted);"></i>
          <p style="color:var(--c-text-muted);font-size:var(--fs-sm);">연결된 계약 없음</p>
        </div>
      `, { title: '계약 진행상황' });
      return;
    }
    openContractStartSheet({ room });
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

/** 계약 시작 시트 — 채팅·상품 공통 (데스크톱 pickOrCreateCustomer 와 기능 동일, UI 만 모바일)
 *  권한: admin, agent 만 (agent_admin / provider 는 view-only) */
export function openContractStartSheet({ room, product, onCreated } = {}) {
  const me = store.currentUser;
  if (!me || !(me.role === 'agent' || me.role === 'admin')) {
    showToast('계약 생성 권한 없음 (관리자/영업자만 가능)', 'error');
    return;
  }
  const isAdmin = me.role === 'admin';
  // admin 일 때만 영업자 picker 노출 → 선택한 agent 의 uid/code 로 계약 생성
  const agentList = isAdmin
    ? (store.users || []).filter(u => u.role === 'agent' && !u._deleted && u.is_active !== false)
    : [];

  // 차량 정보 — room 또는 product 에서 추출
  const ctx = room || {};
  const p = product || (room && (store.products || []).find(
    pp => pp._key === room.product_uid || pp.car_number === (room.vehicle_number || room.car_number)
  )) || {};

  // 본인 계약 product_uid (중복 체크용 — submit 시 customer_name 까지 매칭하면 같은 계약)
  const productUid = p._key || ctx.product_uid;
  const carNo = p.car_number || ctx.vehicle_number || '';
  const modelText = `${p.maker || ctx.maker || ''} ${p.sub_model || ctx.sub_model || p.model || ctx.model || ''}`.trim();

  // 기간/가격 — 등록된 가격 있는 기간만 노출 (desktop 동일)
  const priceMap = p.price || {};
  const PERIODS = ['1', '12', '24', '36', '48', '60'];
  const availablePeriods = PERIODS.filter(m => Number(priceMap[m]?.rent) > 0);
  const defaultM = availablePeriods.includes('36') ? '36' : (availablePeriods[0] || '36');

  const fmtKr = (n) => Number(n || 0).toLocaleString();

  const html = `
    <div class="m-contract-start">
      <div class="m-cstart-vehicle">
        <i class="ph ph-car-simple"></i>
        <div>
          <div class="m-cstart-vehicle-no">${carNo || '-'}</div>
          <div class="m-cstart-vehicle-model">${modelText || '-'}</div>
        </div>
      </div>

      ${availablePeriods.length ? `
      <div class="m-cstart-row">
        <label class="m-cstart-label">대여기간</label>
        <div class="m-cstart-periods">
          ${availablePeriods.map(m => `
            <button type="button" class="chip ${m === defaultM ? 'is-active' : ''}" data-m="${m}">${m}개월</button>
          `).join('')}
        </div>
      </div>
      <div class="m-cstart-row m-cstart-price">
        <div class="m-cstart-price-cell">
          <label class="m-cstart-label">월 대여료</label>
          <input class="m-cstart-input" id="csRent" readonly>
        </div>
        <div class="m-cstart-price-cell">
          <label class="m-cstart-label">보증금</label>
          <input class="m-cstart-input" id="csDeposit" readonly>
        </div>
      </div>
      ` : '<div class="m-cstart-warn">⚠ 등록된 가격 정보가 없습니다</div>'}

      ${isAdmin ? `
      <div class="m-cstart-row">
        <label class="m-cstart-label" for="csAgent">담당 영업자</label>
        <select class="m-cstart-input" id="csAgent">
          <option value="">선택...</option>
          ${agentList.map(a => `<option value="${a.uid || a._key}">${a.name || a.user_code} (${a.user_code || ''})</option>`).join('')}
        </select>
      </div>
      ` : ''}

      <div class="m-cstart-row">
        <label class="m-cstart-label" for="csName">계약자명</label>
        <input class="m-cstart-input" id="csName" type="text" placeholder="홍길동" autocomplete="off">
      </div>

      <div class="m-cstart-row">
        <label class="m-cstart-label" for="csBirth">생년월일</label>
        <input class="m-cstart-input" id="csBirth" type="text" placeholder="YYMMDD (6자리)"
               inputmode="numeric" maxlength="6" autocomplete="off">
      </div>

      <div class="m-cstart-row">
        <label class="m-cstart-label" for="csPhone">연락처</label>
        <input class="m-cstart-input" id="csPhone" type="tel" placeholder="010-0000-0000"
               inputmode="tel" maxlength="13" autocomplete="off">
      </div>

      <label class="m-cstart-biz">
        <input type="checkbox" id="csBiz"> 사업자 계약
      </label>
      <div class="m-cstart-row m-cstart-biz-fields" id="csBizFields" style="display:none;">
        <input class="m-cstart-input" id="csBizNo" placeholder="사업자등록번호 (123-45-67890)" inputmode="numeric">
        <input class="m-cstart-input" id="csBizName" placeholder="법인/상호명">
      </div>

      <button type="button" class="m-action-btn is-primary m-cstart-submit" id="csSubmit">
        <i class="ph ph-file-plus"></i><span>계약 시작하기</span>
      </button>
    </div>
  `;

  openBottomSheet(html, {
    title: '계약 생성',
    onMount: (sheet) => {
      // 가격 표시 갱신
      const rentEl = sheet.querySelector('#csRent');
      const depEl = sheet.querySelector('#csDeposit');
      const updatePrice = (m) => {
        const v = priceMap[m] || {};
        if (rentEl) rentEl.value = v.rent ? `${fmtKr(v.rent)}원` : '';
        if (depEl) depEl.value = v.deposit ? `${fmtKr(v.deposit)}원` : '';
      };
      updatePrice(defaultM);

      // 기간 chip toggle
      sheet.querySelectorAll('.m-cstart-periods .chip').forEach(c => {
        c.addEventListener('click', () => {
          sheet.querySelectorAll('.m-cstart-periods .chip').forEach(x => x.classList.remove('is-active'));
          c.classList.add('is-active');
          updatePrice(c.dataset.m);
        });
      });

      // 사업자 토글
      const bizCk = sheet.querySelector('#csBiz');
      const bizFields = sheet.querySelector('#csBizFields');
      bizCk?.addEventListener('change', () => {
        bizFields.style.display = bizCk.checked ? 'flex' : 'none';
      });

      // 연락처 자동 하이픈
      const phoneEl = sheet.querySelector('#csPhone');
      phoneEl?.addEventListener('input', () => {
        const d = phoneEl.value.replace(/\D/g, '').slice(0, 11);
        phoneEl.value = d.length <= 3 ? d
          : d.length <= 7 ? `${d.slice(0,3)}-${d.slice(3)}`
          : `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
      });

      sheet.querySelector('#csSubmit')?.addEventListener('click', async () => {
        const name = sheet.querySelector('#csName')?.value.trim();
        const birth = (sheet.querySelector('#csBirth')?.value || '').replace(/\D/g, '');
        const phone = (sheet.querySelector('#csPhone')?.value || '').replace(/\D/g, '');
        const m = sheet.querySelector('.m-cstart-periods .chip.is-active')?.dataset.m || defaultM;
        const isBiz = !!sheet.querySelector('#csBiz')?.checked;
        const bizNo = (sheet.querySelector('#csBizNo')?.value || '').replace(/\D/g, '');
        const bizName = sheet.querySelector('#csBizName')?.value.trim();

        // 영업자 결정 — admin 이면 picker 에서, 아니면 본인
        let agent = me;
        if (isAdmin) {
          const agentUidPick = sheet.querySelector('#csAgent')?.value;
          if (!agentUidPick) { showToast('영업자 선택', 'error'); return; }
          agent = agentList.find(a => (a.uid || a._key) === agentUidPick);
          if (!agent) { showToast('영업자 정보 오류', 'error'); return; }
        }

        if (!name) { showToast('계약자명 입력', 'error'); return; }
        if (!phone || phone.length < 10) { showToast('연락처 입력', 'error'); return; }
        if (birth && birth.length !== 6) { showToast('생년월일 6자리', 'error'); return; }
        if (isBiz && (!bizNo || !bizName)) { showToast('사업자 정보 입력', 'error'); return; }

        // 중복 체크 — 본인 + 동일 차량 + 동일 계약자명 = 같은 계약
        // (다른 영업자 / 다른 계약자 / 취소된 계약 은 무관)
        if (productUid) {
          const dup = (store.contracts || []).find(c =>
            !c._deleted &&
            c.agent_uid === me.uid &&
            c.product_uid === productUid &&
            (c.customer_name || '').trim() === name &&
            c.contract_status !== '계약취소'
          );
          if (dup) {
            showToast(`이미 진행중 — 계약 페이지로 이동 (${dup.contract_code})`, 'info');
            const { navigate } = await import('../core/router.js');
            navigate('/contract');
            onCreated?.(dup.contract_code);
            return;
          }
        }

        const submitBtn = sheet.querySelector('#csSubmit');
        if (submitBtn) submitBtn.disabled = true;
        try {
          const { pushRecord, updateRecord } = await import('../firebase/db.js');
          const { makeTempContractCode } = await import('./contract.js');

          // 1. 계약자 — phone 매칭 시 기존 reuse, 없으면 신규 push
          let customer = (store.customers || []).find(c => c.phone === phone || (c.phone || '').replace(/\D/g, '') === phone);
          if (!customer) {
            const cKey = await pushRecord('customers', {
              name,
              phone,
              birth,
              is_business: isBiz,
              business_no: isBiz ? bizNo : '',
              business_name: isBiz ? bizName : '',
              created_by: me.uid,
            });
            customer = { _key: cKey, name, phone, birth, is_business: isBiz };
          }

          // 2. 영업자 — 위 submit 핸들러 진입부에서 결정 (agent 변수 사용)

          // 3. 계약 생성 — desktop createContractFromRoomLocal 과 동일 필드
          const code = await makeTempContractCode();
          const priceVal = priceMap[m] || {};
          // Firebase RTDB 는 undefined 거부 → 모든 필드를 fallback '' 또는 0 으로
          const payload = {
            contract_code: code,
            is_draft: true,
            product_uid: p._key || ctx.product_uid || '',
            product_code: p.product_code || '',
            // 차량 snapshot
            car_number_snapshot: p.car_number || ctx.vehicle_number || '',
            maker_snapshot: p.maker || ctx.maker || '',
            model_snapshot: p.model || ctx.model || '',
            sub_model_snapshot: p.sub_model || ctx.sub_model || '',
            vehicle_name_snapshot: `${p.maker || ''} ${p.sub_model || p.model || ''}`.trim(),
            year_snapshot: p.year || '',
            fuel_type_snapshot: p.fuel_type || '',
            ext_color_snapshot: p.ext_color || '',
            // 기간/가격 snapshot
            rent_month_snapshot: Number(m) || 0,
            rent_amount_snapshot: Number(priceVal.rent) || 0,
            deposit_amount_snapshot: Number(priceVal.deposit) || 0,
            // 계약자 snapshot
            customer_uid: customer._key || '',
            customer_name: name,
            customer_birth: birth || '',
            customer_phone: phone,
            customer_is_business: isBiz,
            customer_business_no: isBiz ? (bizNo || '') : '',
            customer_business_name: isBiz ? (bizName || '') : '',
            // 관계자 — 본인 (agent_uid/code 가 본인이어야 본인 목록에 노출)
            agent_uid: agent.uid || agent._key || '',
            agent_code: agent.user_code || '',
            agent_name: agent.name || '',
            agent_channel_code: agent.agent_channel_code || agent.channel_code || '',
            provider_company_code: ctx.provider_company_code || p.provider_company_code || '',
            provider_uid: ctx.provider_uid || p.provider_uid || '',
            // 정책 snapshot
            policy_code: p.policy_code || '',
            policy_name_snapshot: p._policy?.policy_name || '',
            credit_grade_snapshot: p._policy?.credit_grade || '',
            // 메타
            contract_status: '계약요청',
            contract_date: new Date().toISOString().slice(0, 10),
            created_at: Date.now(),
            created_by: me.uid || '',
          };
          await pushRecord('contracts', payload);

          // 4. room 연결 + product 상태 전환 (desktop 동일)
          if (room && room._key) {
            await updateRecord(`rooms/${room._key}`, { linked_contract: code }).catch(() => null);
          }
          if (p._key) {
            const vsUpdate = (p.vehicle_status === '출고불가') ? {} : { vehicle_status: '출고협의' };
            await updateRecord(`products/${p._key}`, {
              ...vsUpdate,
              assigned_agent_uid: agent.uid || agent._key,
              assigned_agent_code: agent.user_code,
              assigned_agent_name: agent.name,
              assigned_at: Date.now(),
            }).catch(() => null);
          }

          showToast(`계약 생성됨 (${code})`, 'success');
          // 계약 페이지로 이동 — 생성된 계약 즉시 확인
          const { navigate } = await import('../core/router.js');
          navigate('/contract');
          onCreated?.(code);
        } catch (e) {
          console.error('[contract start]', e);
          const msg = e?.code === 'PERMISSION_DENIED' ? '권한 없음 (RTDB rules)'
                    : e?.message || String(e).slice(0, 80);
          showToast(`계약 생성 실패: ${msg}`, 'error');
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    },
  });
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
