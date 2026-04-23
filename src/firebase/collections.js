/**
 * Firebase Collections — 신규 생성, 읽음 처리, 코드 채번
 */
import { ref, runTransaction, get } from 'firebase/database';
import { db } from './config.js';
import { setRecord, updateRecord, pushRecord } from './db.js';

/* ── 코드 시퀀스 채번 ── */
export async function nextSequence(sequenceKey) {
  const seqRef = ref(db, `code_sequences/${sequenceKey}`);
  try {
    const result = await runTransaction(seqRef, (v) => (v || 0) + 1);
    if (result.committed) return result.snapshot.val();
  } catch (e) {}
  return (Date.now() % 90) + 10; // fallback
}

/* ── 상품 등록 ── */
export async function saveProduct(data) {
  const uid = `PD${new Date().toISOString().slice(2,10).replace(/-/g,'')}${String(await nextSequence('product_uid')).padStart(3,'0')}`;
  const productCode = `${data.car_number || ''}_${data.provider_company_code || ''}`;
  await setRecord(`products/${uid}`, {
    product_uid: uid,
    product_code: productCode,
    ...data,
    status: 'available',
    vehicle_status: '출고가능',
    created_at: Date.now(),
  });
  return uid;
}

/* ── 계약 생성 ── */
export async function saveContract(data) {
  const dateStr = new Date().toISOString().slice(2,10).replace(/-/g,'').slice(0,4);
  const seq = await nextSequence(`contract_${dateStr}`);
  const code = `CT${dateStr}${String(seq).padStart(2,'0')}`;
  await setRecord(`contracts/${code}`, {
    contract_code: code,
    contract_status: '계약대기',
    contract_date: new Date().toISOString().slice(0,10),
    ...data,
    created_at: Date.now(),
  });

  // 계약 생성 시점의 차량 상태: 출고협의 (진행 중) — auto-status는 prev 없으면 건너뛰므로 여기서 직접 세팅
  const productKey = data.product_uid || data.seed_product_key;
  if (productKey) {
    try { await updateRecord(`products/${productKey}`, { vehicle_status: '출고협의' }); } catch {}
  }

  return code;
}

/* ── 정산 생성 (계약 완료 시) ── */
export async function createSettlement(contract) {
  const dateStr = new Date().toISOString().slice(2,10).replace(/-/g,'').slice(0,4);
  const seq = await nextSequence(`settlement_${dateStr}`);
  const code = `ST${dateStr}${String(seq).padStart(2,'0')}`;

  const { settlementStatusPayload, SETTLEMENT_STATUS_DEFAULT } = await import('../core/settlement-status.js');
  const { getFeeRate } = await import('../core/settlement-rules.js');
  const { store } = await import('../core/store.js');

  // 수수료: 명시값 > 자동계산 (월대여료 × 파트너 수수료율)
  const rentAmount = Number(contract.rent_amount_snapshot || 0);
  const feeRate = getFeeRate(contract.provider_company_code || contract.partner_code, store.partners || []);
  const feeAmount = contract.price?.fee || contract.fee_amount || Math.round(rentAmount * feeRate);

  await setRecord(`settlements/${code}`, {
    settlement_code: code,
    contract_code: contract.contract_code,
    ...settlementStatusPayload(SETTLEMENT_STATUS_DEFAULT),
    partner_code: contract.partner_code || contract.provider_company_code,
    provider_company_code: contract.provider_company_code || contract.partner_code,
    agent_uid: contract.agent_uid,
    agent_code: contract.agent_code,
    agent_channel_code: contract.agent_channel_code,
    customer_name: contract.customer_name,
    car_number: contract.car_number_snapshot,
    vehicle_name_snapshot: contract.vehicle_name_snapshot,
    model_snapshot: contract.model_snapshot,
    sub_model_snapshot: contract.sub_model_snapshot,
    rent_month: contract.rent_month_snapshot,
    rent_amount: rentAmount,
    deposit_amount: contract.deposit_amount_snapshot,
    fee_rate: feeRate,
    fee_amount: feeAmount,
    confirms: { provider: false, agent: false, admin: false },
    created_at: Date.now(),
  });
  return code;
}

/* ── 대화방 생성/열기 ── */
export async function ensureRoom({ productUid, productCode, agentUid, agentCode, agentName, agentChannelCode, providerUid, providerName, providerCompanyCode, providerCode, vehicleNumber, modelName, subModel }) {
  const roomId = `CH_${productCode || productUid}_${agentCode}`;

  // Check if exists
  const snap = await get(ref(db, `rooms/${roomId}`));
  if (snap.exists()) return roomId;

  await setRecord(`rooms/${roomId}`, {
    room_id: roomId,
    chat_code: roomId,
    product_uid: productUid || '',
    product_code: productCode || '',
    agent_uid: agentUid || '',
    agent_code: agentCode || '',
    agent_name: agentName || '',
    agent_channel_code: agentChannelCode || '',
    provider_uid: providerUid || '',
    provider_name: providerName || '',
    provider_company_code: providerCompanyCode || '',
    vehicle_number: vehicleNumber || '',
    model: modelName || '',
    sub_model: subModel || '',
    provider_code: providerCode || providerCompanyCode || '',
    last_message: '',
    last_message_at: Date.now(),
    chat_status: '신규',
    created_at: Date.now(),
  });

  // 신규 문의 알림 — 공급사에게 (Aligo 미설정이면 조용히 실패)
  try {
    const { store } = await import('../core/store.js');
    const providerPhone = (store.users || []).find(u => u.uid === providerUid)?.phone;
    if (providerPhone) {
      const { notifyNewInquiry } = await import('../core/alimtalk.js');
      notifyNewInquiry({
        providerTel: providerPhone,
        agentName,
        carNo: vehicleNumber,
        model: modelName,
      });
    }
  } catch { /* silent */ }

  return roomId;
}

/* ── 읽음 처리 ── */
export async function markRoomRead(roomId, role, uid, room) {
  // 관리자는 당사자 아님 → 읽음 상태 관여 X
  if (role !== 'agent' && role !== 'provider' && role !== 'agent_admin') return;
  // 영업관리자는 본인이 당사자(agent_uid)인 방일 때만 읽음 처리
  if (role === 'agent_admin' && room && room.agent_uid !== uid) return;
  const updates = {};
  const now = Date.now();
  updates[`read_by/${uid}`] = now;
  if (role === 'agent' || (role === 'agent_admin' && room?.agent_uid === uid)) {
    updates.unread_for_agent = 0;
    updates.read_at_agent = now;
  } else if (role === 'provider') {
    updates.unread_for_provider = 0;
    updates.read_at_provider = now;
  }
  await updateRecord(`rooms/${roomId}`, updates);
}

/* ── 사용자 프로필 저장 (회원가입 시) ── */
export async function saveUserProfile(uid, profile) {
  const user_code = await allocateUserCode();
  await setRecord(`users/${uid}`, {
    uid,
    ...profile,
    user_code,
    status: 'pending',
    created_at: Date.now(),
  });
}

/** 가입 순 전역 시퀀스 — 'U-001' 포맷, runTransaction 으로 원자적 증가 */
async function allocateUserCode() {
  const seqRef = ref(db, 'counters/user_code_seq');
  const result = await runTransaction(seqRef, (cur) => (cur || 0) + 1);
  const seq = result.committed ? result.snapshot.val() : Date.now() % 10000; // 실패 fallback
  return `U-${String(seq).padStart(3, '0')}`;
}
