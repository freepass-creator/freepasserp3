/**
 * admin-chat.js — 관리자 ↔ 비admin (영업자/공급사) 1:1 소통 페이지
 *
 * app.js 에서 분리. 책임:
 *  - bindAdminChatButton: 사이드바 [관리자 소통] 버튼 wire (역할별 라벨 + 룸 보장 후 페이지 이동)
 *  - renderAdminChat: 페이지 진입 시 룸 목록 렌더 (admin: 모든 문의 / 비admin: 본인 1개)
 *  - openAdminChatRoomInPage: 선택된 룸 열어서 메시지 watchCollection + 입력바 send 핸들러 wire
 *
 * 노출: window.renderAdminChat (index.html showPage 에서 호출)
 */
import { store } from '../core/store.js';
import { watchCollection, pushRecord, updateRecord, setRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { fmtDate, emptyState, renderRoomItem } from '../core/ui-helpers.js';
import { renderChatMessages as v2RenderChatMessages } from '../core/chat-render.js';
import { notifyAdmins } from '../core/notify.js';

export function bindAdminChatButton() {
  const btn = document.getElementById('sbAdminChat');
  if (!btn) return;
  const updateLabel = () => {
    const me = store.currentUser || {};
    const label = btn.querySelector('.sb-label');
    if (me.role === 'admin') {
      btn.title = '받은 관리자 소통 보기';
      if (label) label.textContent = '관리자 소통';
    } else {
      btn.title = '관리자와 소통 (별도 창)';
      if (label) label.textContent = '관리자 소통';
    }
  };
  updateLabel();
  setTimeout(updateLabel, 1000);

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const me = store.currentUser || {};
    if (!me.uid) return;
    // 비admin — 본인 룸 미리 보장 (없으면 생성). 그 후 페이지 이동.
    if (me.role !== 'admin') {
      const roomKey = `ADMIN_${me.uid}`;
      const existing = (store.rooms || []).find(r => r._key === roomKey);
      if (!existing) {
        try {
          await setRecord(`rooms/${roomKey}`, {
            room_id: roomKey,
            chat_code: roomKey,
            is_admin_chat: true,
            agent_uid: me.uid,
            agent_name: me.name || '',
            agent_code: me.user_code || '',
            agent_channel_code: me.role === 'provider' ? 'PROVIDER' : (me.agent_channel_code || me.company_code || ''),
            provider_company_code: me.role === 'provider' ? (me.company_code || '') : '',
            subject: `${me.name || me.email} 관리자 소통`,
            unread: 0,
            created_at: Date.now(),
            created_by: me.uid,
          });
        } catch (err) { console.error('[admin-chat ensure]', err); }
      }
    }
    location.hash = 'admin-chat';
  });
}

/* 관리자 소통 페이지 렌더 — showPage('admin-chat') 시 호출 (window.renderAdminChat 로 노출) */
let _adminChatPageUnsub = null;
let _adminChatPageRoomKey = null;

export function renderAdminChat() {
  const page = document.querySelector('.pt-page[data-page="admin-chat"]');
  if (!page) return;
  const me = store.currentUser || {};
  const isAdmin = me.role === 'admin';

  const listEl = page.querySelector('#adminChatList');
  const allRooms = (store.rooms || []).filter(r => r.is_admin_chat && !r._deleted);
  const rooms = isAdmin
    ? allRooms.sort((a, b) => (b.last_message_at || b.created_at || 0) - (a.last_message_at || a.created_at || 0))
    : allRooms.filter(r => r._key === `ADMIN_${me.uid}`);

  if (!rooms.length) {
    listEl.innerHTML = emptyState(isAdmin ? '받은 문의 없음' : '대화 시작하기');
  } else {
    // 업무 소통 목록과 동일 규격 — renderRoomItem 통일
    listEl.innerHTML = rooms.map(r => {
      const senderRole = r.last_sender_role || (isAdmin ? '' : 'admin');
      const tone = senderRole === 'agent' || senderRole === 'agent_admin' ? 'agent'
                  : senderRole === 'provider' ? 'provider'
                  : senderRole === 'admin' ? 'admin' : '';
      // 안읽음 — 본인 read_by 기준
      const lastAt = Number(r.last_message_at || 0);
      const myRead = Number(r.read_by?.[me.uid] || 0);
      const unread = lastAt && r.last_sender_uid !== me.uid && lastAt > myRead;
      return renderRoomItem({
        id: r._key,
        icon: 'user-circle',
        tone,
        name: isAdmin ? (r.agent_name || r.agent_code || '문의자') : '관리자',
        time: r.last_message_at ? fmtDate(r.last_message_at) : '',
        msg: (r.last_message || '대화 없음').slice(0, 40),
        meta: unread ? '안읽음' : '',
        metaClass: unread ? 'is-warn' : '',
        active: _adminChatPageRoomKey === r._key,
      });
    }).join('');
    listEl.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        listEl.querySelectorAll('.room-item').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        openAdminChatRoomInPage(el.dataset.id);
      });
    });
  }

  // 비admin — 본인 룸 자동 선택
  if (!isAdmin && rooms.length) {
    openAdminChatRoomInPage(rooms[0]._key);
  }
}

function openAdminChatRoomInPage(roomKey) {
  const page = document.querySelector('.pt-page[data-page="admin-chat"]');
  if (!page) return;
  const me = store.currentUser || {};
  _adminChatPageRoomKey = roomKey;
  const body = page.querySelector('#adminChatBody');
  const titleEl = page.querySelector('#adminChatRoomTitle');
  const room = (store.rooms || []).find(r => r._key === roomKey);
  if (titleEl) titleEl.textContent = room?.agent_name || room?.subject || '관리자 소통';

  // 읽음 처리 — 본인 read_by 갱신 (per-admin 안읽음 뱃지 차감)
  if (me.uid) {
    updateRecord(`rooms/${roomKey}`, { [`read_by/${me.uid}`]: Date.now() }).catch(() => null);
  }

  if (_adminChatPageUnsub) { try { _adminChatPageUnsub(); } catch (_) {} }
  body.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">메시지 불러오는 중...</div>';
  _adminChatPageUnsub = watchCollection(`messages/${roomKey}`, (msgs) => {
    if (_adminChatPageRoomKey !== roomKey) return;
    if (!msgs.length) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px;">대화를 시작해보세요</div>';
      return;
    }
    // 시간순 + 발신자 user_code 보강 (옛 메시지 sender_code 누락 케이스 대응)
    const sorted = [...msgs]
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
      .map(m => {
        if (m.sender_code) return m;
        const u = (store.users || []).find(x => (x.uid || x._key) === m.sender_uid);
        return { ...m, sender_code: u?.user_code || m.sender_code || '' };
      });
    body.innerHTML = v2RenderChatMessages(sorted, { uid: me.uid, peerReadAt: null });
    body.scrollTop = body.scrollHeight;
  });

  // 입력바 send 핸들러 — 매번 재바인딩 (단순)
  const input = page.querySelector('#adminChatInput');
  const sendBtn = page.querySelector('#adminChatSend');
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    // 첫 메시지 여부 — 룸의 last_message 가 비어있으면 첫 대화 → 관리자에게 알림
    const roomBefore = (store.rooms || []).find(r => r._key === roomKey);
    const isFirstMessage = !roomBefore?.last_message;
    try {
      await pushRecord(`messages/${roomKey}`, {
        text, sender_uid: me.uid, sender_name: me.name || me.email || '',
        sender_code: me.user_code || '',
        sender_role: me.role || '', created_at: Date.now(),
      });
      const sentAt = Date.now();
      await updateRecord(`rooms/${roomKey}`, {
        last_message: text, last_message_at: sentAt,
        last_sender_role: me.role || '', last_sender_code: me.user_code || '',
        last_sender_uid: me.uid,
        // 보낸 사람은 자동으로 읽음 처리 (사이드바 뱃지 자체 발신으로 안 늘어남)
        [`read_by/${me.uid}`]: sentAt,
      });
      // 비admin 의 첫 메시지 → 관리자에게 SMS/알림톡 (실패해도 비즈니스 플로우는 안 막힘)
      if (isFirstMessage && me.role !== 'admin') {
        const senderLabel = me.role === 'provider' ? '공급사' : '영업자';
        notifyAdmins({
          template: 'admin_chat_new',
          subject: '관리자 소통 신규 문의',
          message: `[Freepass] ${senderLabel} ${me.name || me.email}님이 관리자에게 문의를 시작했습니다.\n첫 메시지: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`,
        }).catch(() => null);
      }
    } catch (err) {
      console.error('[admin-chat send]', err);
      showToast('전송 실패', 'error');
      input.value = text;
    }
  };
  sendBtn.onclick = send;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
}
