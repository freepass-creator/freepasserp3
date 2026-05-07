/**
 * 사이드바 메뉴 dot 뱃지 — 미처리 작업 있으면 빨간 점 표시.
 *
 *  요즘 트렌드 (Slack/Discord/Notion 패턴): 카운트 숫자 X, 점 있음/없음만.
 *  카운트 자체는 .has-unread 클래스 토글로 표현 (CSS 가 dot 그림).
 *  textContent 는 비워둠 — 스크린리더 친화적이며 collapsed 상태에서도 깔끔.
 */
import { store, subscribe, filterCollectionByRole } from './store.js';
import { SETTLEMENT_STATUS as SS, getSettlementStatus } from './settlement-status.js';

function setBadge(id, hasUnread) {
  document.querySelectorAll(`[data-badge="${id}"]`).forEach(el => {
    el.classList.toggle('has-unread', !!hasUnread);
  });
}

function recompute() {
  const user = store.currentUser;
  if (!user) return;

  // 업무 소통 — 안 읽은 메시지 (역할별 hidden 필드 + unread 카운트)
  const rooms = filterCollectionByRole(store.rooms || [], 'rooms').filter(r => !r._deleted);
  const hiddenField = user.role === 'agent' ? 'hidden_for_agent'
                    : user.role === 'provider' ? 'hidden_for_provider'
                    : 'hidden_for_admin';
  const hasUnreadRooms = rooms.some(r => {
    if (r[hiddenField]) return false;
    const n = user.role === 'agent'    ? (r.unread_for_agent    || 0)
            : user.role === 'provider' ? (r.unread_for_provider || 0)
            : 0;
    return n > 0;
  });
  setBadge('workspace', hasUnreadRooms);

  // 계약 — 진행 중 (계약완료/계약취소 제외)
  const contracts = filterCollectionByRole(store.contracts || [], 'contracts');
  const hasActiveContracts = contracts.some(c => {
    const s = c.contract_status;
    return s && s !== '계약완료' && s !== '계약취소' && !c._deleted;
  });
  setBadge('contract', hasActiveContracts);

  // 정산 — 미정산 (PENDING / 레거시 '대기'·'진행'·'미정산')
  const settlements = filterCollectionByRole(store.settlements || [], 'settlements');
  const hasPendingSettle = settlements.some(s => {
    if (s._deleted) return false;
    const st = getSettlementStatus(s);
    return st === SS.PENDING || st === '대기' || st === '진행' || st === '미정산';
  });
  setBadge('settle', hasPendingSettle);

  // 사용자 관리 (admin) — pending 사용자
  if (user.role === 'admin') {
    const hasPendingUsers = (store.users || []).some(u => u.status === 'pending' && !u._deleted);
    setBadge('users', hasPendingUsers);
  } else {
    setBadge('users', false);
  }

  // 관리자 소통 (agent/provider) — admin 과의 룸 안 읽은 메시지
  // 위 workspace 와 같은 rooms 데이터 사용 — 추후 admin-chat 별도 룸 컬렉션으로 분리되면 갱신
  setBadge('admin-chat', hasUnreadRooms && user.role !== 'admin');
}

export function initMenuBadges() {
  subscribe('rooms', recompute);
  subscribe('contracts', recompute);
  subscribe('settlements', recompute);
  subscribe('users', recompute);
  subscribe('currentUser', recompute);
  recompute();
}
