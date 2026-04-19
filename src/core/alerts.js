/**
 * 계약 만료 알림 + 제안서 열람 추적
 */
import { subscribe } from './store.js';
import { showToast } from './toast.js';

let alerted = new Set();

export function initAlerts() {
  // 계약 만료 알림 (30/14/7일)
  subscribe('contracts', (contracts) => {
    if (!contracts?.length) return;

    const now = Date.now();
    for (const c of contracts) {
      if (c.contract_status !== '계약완료') continue;
      if (!c.contract_date || !c.rent_month_snapshot) continue;

      const startDate = new Date(c.contract_date).getTime();
      const months = parseInt(c.rent_month_snapshot) || 0;
      if (!months) continue;

      const endDate = startDate + months * 30 * 86400000; // approximate
      const daysLeft = Math.floor((endDate - now) / 86400000);
      const key = `${c.contract_code}_${daysLeft <= 7 ? '7' : daysLeft <= 14 ? '14' : '30'}`;

      if ((daysLeft === 30 || daysLeft === 14 || daysLeft === 7) && !alerted.has(key)) {
        alerted.add(key);
        showToast(`⏰ ${c.vehicle_name_snapshot || c.contract_code} 계약 만료 ${daysLeft}일 전`, 'warn', 5000);
      }
    }
  });
}

/**
 * 제안서 열람 추적 — 제안 페이지에서 호출
 * proposal page에서 Firebase에 기록, 여기서 실시간 알림
 */
export function trackProposalView(proposalId, productKey) {
  // 제안 페이지(proposal.html)에서 열람 시 Firebase에 기록
  // proposals/{id}/views/{timestamp} = { product_key, viewed_at }
  // 이 데이터를 대시보드에서 읽어서 표시
}
