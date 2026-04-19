/**
 * Chat Panel — 메시지 목록 + 입력
 */
import { store } from '../../core/store.js';
import { watchCollection, pushRecord, updateRecord } from '../../firebase/db.js';
import { uploadFile } from '../../firebase/storage-helper.js';

let unsubMessages = null;
let currentRoomId = null;
let currentContainer = null;

export function renderChatPanel(container, roomId) {
  // Cleanup previous watcher
  unsubMessages?.();
  currentRoomId = roomId;
  currentContainer = container;

  if (!roomId) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--c-text-muted);">
        <div style="text-align: center;">
          <i class="ph ph-chat-circle" style="font-size: 40px; display: block; margin-bottom: var(--sp-3);"></i>
          <p style="font-size: var(--fs-sm);">대화방을 선택하세요</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; height: 100%;">
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input-area">
        <input type="file" id="chatFileInput" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx">
        <button class="chat-send-btn" id="chatAttachBtn" title="파일 첨부">
          <i class="ph ph-paperclip"></i>
        </button>
        <input class="chat-input" id="chatInput" placeholder="메시지 입력... ( / 로 명령어)" autocomplete="off">
        <button class="chat-send-btn" id="chatSendBtn" title="전송">
          <i class="ph ph-paper-plane-tilt"></i>
        </button>
      </div>
    </div>
  `;

  // Watch messages
  unsubMessages = watchCollection(`messages/${roomId}`, (messages) => {
    renderMessages(messages);
  });

  // Send message
  const input = container.querySelector('#chatInput');
  const sendBtn = container.querySelector('#chatSendBtn');

  // Slash commands
  const COMMANDS = {
    '/명함': () => {
      const u = store.currentUser;
      return `📇 ${u.name || ''}\n${u.company_name || ''} ${u.position || ''}\n📞 ${u.phone || ''}`;
    },
    '/견적': () => {
      return `📋 견적 정보를 준비 중입니다...`;
    },
    '/계약': () => {
      return `📝 계약 진행을 시작합니다.`;
    },
  };

  let showingSlash = false;

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;

    // Handle slash command
    const cmd = COMMANDS[text];
    if (cmd) {
      const result = cmd();
      input.value = '';
      input.focus();
      const user = store.currentUser;
      await pushRecord(`messages/${roomId}`, {
        text: result,
        sender_uid: user.uid,
        sender_role: user.role,
        sender_code: user.user_code || '',
        sender_name: user.name || '',
      });
      await updateRecord(`rooms/${roomId}`, {
        last_message: result.split('\n')[0],
        last_message_at: Date.now(),
        last_sender_role: user.role,
      });
      return;
    }

    input.value = '';
    input.focus();

    const user = store.currentUser;
    await pushRecord(`messages/${roomId}`, {
      text,
      sender_uid: user.uid,
      sender_role: user.role,
      sender_code: user.user_code || '',
      sender_name: user.name || '',
    });

    await updateRecord(`rooms/${roomId}`, {
      last_message: text,
      last_message_at: Date.now(),
      last_sender_role: user.role,
    });
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // File attach
  const fileInput = container.querySelector('#chatFileInput');
  const attachBtn = container.querySelector('#chatAttachBtn');
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    if (!files.length) return;
    const user = store.currentUser;

    for (const file of files) {
      const ts = Date.now();
      const path = `chat-files/${roomId}/${ts}_${file.name}`;
      const { url } = await uploadFile(path, file);
      const isImage = file.type.startsWith('image/');

      await pushRecord(`messages/${roomId}`, {
        text: isImage ? '' : `📎 ${file.name}`,
        sender_uid: user.uid,
        sender_role: user.role,
        sender_code: user.user_code || '',
        sender_name: user.name || '',
        ...(isImage ? { image_url: url } : { file_url: url }),
      });
      await updateRecord(`rooms/${roomId}`, {
        last_message: isImage ? '📷 사진' : `📎 ${file.name}`,
        last_message_at: Date.now(),
        last_sender_role: user.role,
      });
    }
    fileInput.value = '';
  });

  // Drag & drop file
  const msgArea = container.querySelector('.chat-messages');
  if (msgArea) {
    msgArea.addEventListener('dragover', (e) => { e.preventDefault(); msgArea.style.background = 'var(--c-accent-soft)'; });
    msgArea.addEventListener('dragleave', () => { msgArea.style.background = ''; });
    msgArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      msgArea.style.background = '';
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (!droppedFiles.length) return;
      const user = store.currentUser;
      if (!currentRoomId || !user) return;
      for (const file of droppedFiles) {
        const ts = Date.now();
        const path = `chat-files/${currentRoomId}/${ts}_${file.name}`;
        const { url } = await uploadFile(path, file);
        const isImage = file.type.startsWith('image/');
        await pushRecord(`messages/${currentRoomId}`, {
          text: isImage ? '' : `📎 ${file.name}`,
          sender_uid: user.uid, sender_role: user.role,
          sender_code: user.user_code || '', sender_name: user.name || '',
          ...(isImage ? { image_url: url } : { file_url: url }),
        });
        await updateRecord(`rooms/${currentRoomId}`, {
          last_message: isImage ? '📷 사진' : `📎 ${file.name}`,
          last_message_at: Date.now(), last_sender_role: user.role,
        });
      }
    });
  }
}

function renderMessages(messages) {
  const el = currentContainer
    ? currentContainer.querySelector('#chatMessages')
    : document.getElementById('chatMessages');
  if (!el) return;

  const uid = store.currentUser?.uid;
  const sorted = [...messages].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

  el.innerHTML = sorted.map(msg => {
    const isMine = msg.sender_uid === uid;
    const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' }) : '';

    let content = '';
    if (msg.image_url) {
      content = `<img src="${msg.image_url}" style="max-width:200px;border-radius:var(--ctrl-r);cursor:pointer;" onclick="window.open('${msg.image_url}','_blank')">`;
    } else if (msg.file_url) {
      content = `<a href="${msg.file_url}" target="_blank" style="color:inherit;text-decoration:underline;">${escapeHtml(msg.text || '📎 파일')}</a>`;
    } else {
      content = escapeHtml(msg.text || '').replace(/\n/g, '<br>');
    }

    return `
      <div class="chat-msg ${isMine ? 'chat-msg-mine' : 'chat-msg-other'}">
        ${!isMine ? `<div style="font-size: 10px; font-weight: var(--fw-medium); color: var(--c-text-sub); margin-bottom: 2px;">${msg.sender_name || ''}</div>` : ''}
        <div>${content}</div>
        <div class="chat-msg-meta">${time}</div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
