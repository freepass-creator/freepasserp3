/**
 * 계약 → 차량 상태 자동 변경
 *  계약완료           → 차량 '출고불가'  (차량이 나갔으니 더 이상 판매 불가)
 *  계약취소           → 차량 '출고가능'  (다시 판매 가능)
 *  계약대기/요청/발송 → 차량 '출고협의'  (진행 중, 섣불리 다른 에이전트에 팔면 안됨)
 *
 * 규칙: project_freepass_v2_vehicle_status.md
 */
import { subscribe, store } from './store.js';
import { updateRecord } from '../firebase/db.js';
import { createSettlement } from '../firebase/collections.js';

const IN_PROGRESS = new Set(['계약대기', '계약요청', '계약발송']);

/** 계약 상태 → 차량 상태 매핑 (해당 없으면 null = 건드리지 않음) */
function deriveVehicleStatus(contractStatus) {
  if (contractStatus === '계약완료') return '출고불가';
  if (contractStatus === '계약취소') return '출고가능';
  if (IN_PROGRESS.has(contractStatus)) return '출고협의';
  return null;
}

/** 계약완료 시 양측(에이전트·공급사) 알림 — phone은 users에서 uid로 lookup */
async function notifyContractDoneBoth(contract) {
  const carNo = contract.car_number_snapshot || contract.car_number || '';
  const customerName = contract.customer_name || '';
  const users = store.users || [];
  const agentPhone = users.find(u => u.uid === contract.agent_uid)?.phone;
  const providerPhone = users.find(u => u.uid === contract.provider_uid)?.phone;
  if (!agentPhone && !providerPhone) return;
  const { notifyContractDone } = await import('./alimtalk.js');
  if (agentPhone) notifyContractDone({ tel: agentPhone, carNo, customerName });
  if (providerPhone) notifyContractDone({ tel: providerPhone, carNo, customerName });
}

let prevContracts = new Map();

export function initAutoStatus() {
  subscribe('contracts', (contracts) => {
    if (!contracts?.length) return;

    for (const c of contracts) {
      const prev = prevContracts.get(c.contract_code);
      if (prev === c.contract_status) continue;  // 변화 없음
      if (!prev) {
        // 최초 스냅샷: 이미 존재하던 계약은 retroactive 덮어쓰지 않음
        continue;
      }

      const productKey = c.product_uid || c.seed_product_key;
      if (productKey) {
        const nextVs = deriveVehicleStatus(c.contract_status);
        if (nextVs) updateRecord(`products/${productKey}`, { vehicle_status: nextVs }).catch(() => {});
      }

      // 계약완료 최초 진입 시 정산 자동 생성 + 양측 알림톡
      if (c.contract_status === '계약완료' && prev !== '계약완료') {
        const already = (store.settlements || []).some(s => s.contract_code === c.contract_code);
        if (!already) {
          createSettlement(c).catch(err => console.warn('[auto-settlement] 생성 실패', err));
        }
        notifyContractDoneBoth(c).catch(() => {});
      }
    }

    // Update prev state
    prevContracts = new Map(contracts.map(c => [c.contract_code, c.contract_status]));
  });
}
