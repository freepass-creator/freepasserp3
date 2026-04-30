/**
 * 채팅 메시지 렌더 — 모바일·웹 공통.
 *
 * 그룹화 규칙 (카톡 규격):
 *  - 발신자 바뀜  → is-sender-start (새 배지, 큰 간격 7px, 포인트 코너)
 *  - 같은 사람·분 바뀜 → is-minute-start (배지 생략, 중간 간격 5px)
 *  - 같은 사람·분 연속 → 기본 (배지 생략, 3px 밀착)
 *
 * 시간 표시:
 *  - 분 경계 직전 메시지(minuteEnd) 에만 chat-meta 표시
 *
 * 읽음 표시 (내 메시지만):
 *  - peerReadAt (상대가 마지막 읽은 시각) 이상이면 '읽음', 미만이면 '안읽음'
 *  - peerReadAt=null(또는 Infinity) 이면 읽음표시 생략 (관리자 등)
 */
import { fmtHM, fmtChatDate } from './format.js';

/**
 * @param {Array} messages - sorted ASC by created_at
 * @param {Object} ctx
 * @param {string} ctx.uid - 현재 유저 uid (mine 판정)
 * @param {number} [ctx.peerReadAt] - 상대가 마지막 읽은 시각(ms). null/Infinity 면 읽음표시 생략.
 * @returns {string} HTML
 */
export function renderChatMessages(messages, ctx = {}) {
  const uid = ctx.uid;
  const peerReadAt = Number.isFinite(ctx.peerReadAt) ? ctx.peerReadAt : null;
  const sorted = messages;

  let lastDate = '';
  let lastSenderUid = null;
  let lastMinute = null;

  return sorted.map((msg, i) => {
    const mine = msg.sender_uid === uid;
    const ts = msg.created_at || 0;
    const dk = new Date(ts).toDateString();
    const minuteKey = new Date(ts).toISOString().slice(0, 16);

    let dateSep = '';
    if (dk !== lastDate) {
      dateSep = `<div class="chat-date-sep"><span>${fmtChatDate(ts)}</span></div>`;
      lastDate = dk;
      lastSenderUid = null;
      lastMinute = null;
    }

    // 그룹 상태
    const senderChanged = msg.sender_uid !== lastSenderUid;
    const minuteChanged = minuteKey !== lastMinute;
    const senderStart = senderChanged;
    const minuteStart = !senderChanged && minuteChanged;
    lastSenderUid = msg.sender_uid;
    lastMinute = minuteKey;

    const next = sorted[i + 1];
    const nextMinuteKey = next ? new Date(next.created_at || 0).toISOString().slice(0, 16) : null;
    const senderEnd = !next || next.sender_uid !== msg.sender_uid;
    const minuteEnd = senderEnd || nextMinuteKey !== minuteKey;

    // 라벨 / 톤 — agent_manager 는 agent_admin 의 동의어, 둘 다 'agent' 톤
    const senderLabel = msg.sender_code
      || (msg.sender_role === 'agent' || msg.sender_role === 'agent_admin' || msg.sender_role === 'agent_manager' ? '영업'
        : msg.sender_role === 'provider' ? '공급'
        : msg.sender_role === 'admin' ? '관리' : '');
    const roleTone = (msg.sender_role === 'agent' || msg.sender_role === 'agent_admin' || msg.sender_role === 'agent_manager') ? 'agent'
                   : msg.sender_role === 'provider' ? 'provider' : 'admin';

    // 콘텐츠
    let content;
    if (msg.image_url) {
      content = `<img src="${msg.image_url}" class="chat-img" onclick="window.open('${msg.image_url}','_blank')">`;
    } else if (msg.file_url) {
      content = `<a href="${msg.file_url}" target="_blank" class="chat-file"><i class="ph ph-paperclip"></i> ${(msg.text || '파일').replace(/</g, '&lt;')}</a>`;
    } else {
      content = (msg.text || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    }

    // 읽음 표시 (내 메시지 + peerReadAt 있을 때만)
    const isRead = mine && peerReadAt != null && ts <= peerReadAt;
    const readMark = (mine && peerReadAt != null)
      ? (isRead ? '<span class="chat-read">읽음</span>' : '<span class="chat-unread">안읽음</span>')
      : '';

    const rowCls = [
      'chat-row',
      mine ? 'is-mine' : 'is-other',
      senderStart ? 'is-start is-sender-start' : '',
      minuteStart ? 'is-minute-start' : '',
      senderEnd ? 'is-end' : '',
    ].filter(Boolean).join(' ');

    return `${dateSep}<div class="${rowCls}">
      ${!mine && senderStart ? `<div class="chat-sender chat-sender-${roleTone}">${senderLabel}</div>` : (!mine ? '<div class="chat-sender-spacer"></div>' : '')}
      <div class="chat-bubble-wrap">
        <div class="chat-bubble chat-bubble-${roleTone}">${content}</div>
        ${minuteEnd ? `<div class="chat-meta">${readMark}<span class="chat-time">${fmtHM(ts)}</span></div>` : ''}
      </div>
    </div>`;
  }).join('');
}

/** room/role 에서 peerReadAt 계산 — 상대방이 마지막 읽은 시각 */
export function getPeerReadAt(room, myRole) {
  if (!room) return null;
  if (myRole === 'agent' || myRole === 'agent_admin') return room.read_at_provider || 0;
  if (myRole === 'provider') return room.read_at_agent || 0;
  return null; // 관리자는 당사자 아님
}
