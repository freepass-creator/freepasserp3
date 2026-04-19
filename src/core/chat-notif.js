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
    const uid = store.currentUser?.uid;
    if (!uid) return;

    for (const room of rooms) {
      const prevTs = prevRoomStates.get(room._key);
      const curTs = room.last_message_at || 0;

      // Skip first load
      if (prevTs === undefined) continue;

      // New message detected
      if (curTs > prevTs) {
        const isMine = room.last_sender_role === store.currentUser?.role;
        if (!isMine) {
          onNewMessage(room);
        }
      }
    }

    // Update prev states
    prevRoomStates = new Map(rooms.map(r => [r._key, r.last_message_at || 0]));
    updateBadge(rooms);
  });

  // Init prev states on first load
  subscribe('rooms', (rooms) => {
    if (!rooms?.length) return;
    if (prevRoomStates.size === 0) {
      prevRoomStates = new Map(rooms.map(r => [r._key, r.last_message_at || 0]));
    }
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

  // 2. Toast (if not looking at this room)
  if (!isActiveRoom) {
    showToast(`${name}: ${msg.slice(0, 30)}${msg.length > 30 ? '...' : ''}`, 'info', 3000);
  }

  // 3. Browser notification (if tab not focused)
  if (document.hidden && Notification.permission === 'granted') {
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

// Simple notification sound (Web Audio API)
function playNotifSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.1;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
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
