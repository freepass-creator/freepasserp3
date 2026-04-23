/**
 * 사이드바 메뉴 카운트 뱃지 — 미처리 작업 수 실시간 표시
 */
import { store, subscribe, filterCollectionByRole } from './store.js';
import { SETTLEMENT_STATUS as SS, getSettlementStatus } from './settlement-status.js';

function setBadge(id, n) {
  document.querySelectorAll(`.sb-badge[data-badge="${id}"]`).forEach(el => {
    if (!n || n <= 0) {
      el.textContent = '';
      el.classList.remove('is-visible');
    } else {
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.add('is-visible');
    }
  });
}

function recompute() {
  const user = store.currentUser;
  if (!user) return;

  // 업무 소통: 안읽은 메시지 총 수 (역할별)
  const rooms = filterCollectionByRole(store.rooms || [], 'rooms').filter(r => !r._deleted);
  const hiddenField = user.role === 'agent' ? 'hidden_for_agent' : user.role === 'provider' ? 'hidden_for_provider' : 'hidden_for_admin';
  const totalUnread = rooms.filter(r => !r[hiddenField]).reduce((sum, r) => {
    const n = user.role === 'agent' ? (r.unread_for_agent || 0)
            : user.role === 'provider' ? (r.unread_for_provider || 0)
            : 0;
    return sum + n;
  }, 0);
  setBadge('home', totalUnread);

  // 계약: 진행 중
  const contracts = filterCollectionByRole(store.contracts || [], 'contracts');
  const activeContracts = contracts.filter(c => {
    const s = c.contract_status;
    return s && s !== '완료' && s !== '취소' && s !== '종료';
  }).length;
  setBadge('contract', activeContracts);

  // 정산: 미정산
  const settlements = filterCollectionByRole(store.settlements || [], 'settlements');
  // 정산대기 기본 + 구버전 '대기'·'진행'·'미정산' legacy 호환
  const pendingSettle = settlements.filter(s => {
    const st = getSettlementStatus(s);
    return st === SS.PENDING || st === '대기' || st === '진행' || st === '미정산';
  }).length;
  setBadge('settle', pendingSettle);

  // admin 전용
  if (user.role === 'admin') {
    // 계약발송: 발송 요청 들어왔는데 아직 발송 안 된 건
    const pendingSign = (store.contracts || []).filter(c => c.sign_requested && !c.sign_token).length;
    setBadge('sign', pendingSign);

    // 사용자관리: 대기중 사용자
    const pendingUsers = (store.users || []).filter(u => u.status === 'pending').length;
    setBadge('users', pendingUsers);
  }
}

export function initMenuBadges() {
  subscribe('rooms', recompute);
  subscribe('contracts', recompute);
  subscribe('settlements', recompute);
  subscribe('users', recompute);
  subscribe('currentUser', recompute);
  recompute();
}
