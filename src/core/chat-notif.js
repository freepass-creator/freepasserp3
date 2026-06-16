/**
 * Chat Notifications — 새 메시지 알림
 * 소리 + 배지 + 브라우저 알림 + 토스트
 */
import { store, subscribe } from './store.js';
import { showToast } from './toast.js';

let prevRoomStates = new Map(); // roomId → last_message_at
let audioCtx = null;
let initialized = false;
let soundEnabled = true;

export function initChatNotif() {
  if (initialized) return;
  initialized = true;

  soundEnabled = localStorage.getItem('fp.sound') !== 'off';

  subscribe('rooms', (rooms) => {
    if (!rooms?.length) return;
    const me = store.currentUser;
    const uid = me?.uid;
    const userCode = me?.user_code;
    const role = me?.role;
    if (!uid) return;

    for (const room of rooms) {
      const prevTs = prevRoomStates.get(room._key);
      const curTs = room.last_message_at || 0;

      // Skip first load
      if (prevTs === undefined) continue;

      // New message detected
      if (curTs > prevTs) {
        // 본인이 보낸 메시지는 알림 제외 — uid / user_code / role 다중 체크
        const isMine =
          (room.last_sender_uid && room.last_sender_uid === uid) ||
          (room.last_sender_code && userCode && room.last_sender_code === userCode) ||
          // fallback: sender_uid/code 없는 옛 데이터 — role 기반
          (!room.last_sender_uid && !room.last_sender_code && room.last_sender_role === role);
        if (!isMine) {
          onNewMessage(room);
        }
      }
    }

    // Update prev states
    prevRoomStates = new Map(rooms.map(r => [r._key, r.last_message_at || 0]));
    updateBadge(rooms);
  });
}

function onNewMessage(room) {
  const role = store.currentUser?.role;
  const name = role === 'agent' ? (room.provider_name || '공급사') : (room.agent_name || '영업자');
  const msg = room.last_message || '새 메시지';
  const isActiveRoom = store.activeRoomId === room._key;

  // 1. Sound
  if (soundEnabled && !isActiveRoom) {
    playNotifSound();
  }

  // 2. Chat popup (if not looking at this room)
  if (!isActiveRoom) {
    showChatPopup(room, name, msg);
  }

  // 3. Browser notification (if tab not focused)
  if (document.hidden && ('Notification' in window) && Notification.permission === 'granted') {
    const notif = new Notification(`${name}`, {
      body: msg,
      icon: '/favicon.svg',
      tag: room._key, // Prevent duplicate notifications
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  }

  // 4. Title flash
  if (document.hidden) {
    flashTitle(name);
  }
}

function updateBadge(rooms) {
  const uid = store.currentUser?.uid;
  const role = store.currentUser?.role;
  if (!uid || !role) return;

  let total = 0;
  for (const room of rooms) {
    if (role === 'agent' && room.unread_for_agent > 0) total += room.unread_for_agent;
    else if (role === 'provider' && room.unread_for_provider > 0) total += room.unread_for_provider;
  }

  // Quick menu badge
  const homeBtn = document.querySelector('.qm-item[data-path="/"]');
  if (homeBtn) {
    let badge = homeBtn.querySelector('.qm-badge');
    if (total > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'qm-badge';
        homeBtn.appendChild(badge);
      }
      badge.textContent = total > 99 ? '99+' : total;
    } else {
      badge?.remove();
    }
  }

  // Sub tab badge
  const chatTab = document.querySelector('.sub-tab[data-tab="chat"]');
  if (chatTab) {
    let badge = chatTab.querySelector('.qm-badge');
    if (total > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'qm-badge';
        badge.style.cssText = 'position:absolute;top:2px;right:2px;';
        chatTab.style.position = 'relative';
        chatTab.appendChild(badge);
      }
      badge.textContent = total > 99 ? '99+' : total;
    } else {
      badge?.remove();
    }
  }

  // Document title
  if (total > 0) {
    document.title = `(${total}) freepass erp`;
  } else {
    document.title = "freepass erp";
  }
}

function ensurePopupContainer() {
  let wrap = document.getElementById('chatNotifWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'chatNotifWrap';
    wrap.className = 'chat-notif-wrap';
    document.body.appendChild(wrap);
  }
  return wrap;
}

function dismissPopup(el) {
  if (!el.isConnected) return;
  clearTimeout(el._cnpTimer);
  el.classList.add('is-out');
  setTimeout(() => el.remove(), 250);
}

function showChatPopup(room, name, msg) {
  const wrap = ensurePopupContainer();
  const el = document.createElement('div');
  el.className = 'chat-notif-popup';
  const preview = msg.slice(0, 60) + (msg.length > 60 ? '…' : '');
  el.innerHTML = `
    <div class="cnp-inner">
      <div class="cnp-icon"><i class="ph ph-chat-circle-dots"></i></div>
      <div class="cnp-content">
        <div class="cnp-name">${name}</div>
        <div class="cnp-msg">${preview}</div>
      </div>
      <button class="cnp-close" aria-label="닫기"><i class="ph ph-x"></i></button>
    </div>
    <div class="cnp-bar"></div>
  `;

  el.querySelector('.cnp-inner').addEventListener('click', (e) => {
    if (e.target.closest('.cnp-close')) return;
    window.dispatchEvent(new CustomEvent('fp:open-room', { detail: { roomKey: room._key } }));
    dismissPopup(el);
  });

  el.querySelector('.cnp-close').addEventListener('click', () => dismissPopup(el));

  wrap.appendChild(el);
  el._cnpTimer = setTimeout(() => dismissPopup(el), 5000);
}

// Bell notification sound (Web Audio API)
function playNotifSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const now = audioCtx.currentTime;
    // 종 소리 = 여러 배음 + 빠른 어택 + 긴 감쇠
    [
      { freq: 880,  gain: 0.7 },
      { freq: 1108, gain: 0.4 },
      { freq: 2637, gain: 0.2 },
    ].forEach(({ freq, gain: peak }) => {
      const osc = audioCtx.createOscillator();
      const g   = audioCtx.createGain();
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(peak, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
      osc.start(now);
      osc.stop(now + 1.8);
    });
  } catch (e) { /* ignore */ }
}

// Title flash
let flashInterval = null;
function flashTitle(name) {
  if (flashInterval) return;
  const original = document.title;
  let flip = false;
  flashInterval = setInterval(() => {
    document.title = flip ? `💬 ${name}` : original;
    flip = !flip;
  }, 1000);

  // Stop when tab becomes visible
  const stop = () => {
    if (!document.hidden) {
      clearInterval(flashInterval);
      flashInterval = null;
      document.title = "freepass erp";
      document.removeEventListener('visibilitychange', stop);
    }
  };
  document.addEventListener('visibilitychange', stop);
}

export function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('fp.sound', soundEnabled ? 'on' : 'off');
  return soundEnabled;
}
