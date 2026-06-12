/**
 * Firebase Collections — 신규 생성, 읽음 처리, 코드 채번
 */
import { ref, runTransaction, get } from 'firebase/database';
import { db } from './config.js';
import { setRecord, updateRecord, pushRecord } from './db.js';

/* ── 코드 시퀀스 채번 ──
 *  정상 트랜잭션 → 1부터 증가하는 seq
 *  실패 fallback → 충돌 회피용 999000+ 난수 (정상 seq 범위와 명확 분리)
 *  실패했더라도 호출 로그 남겨서 재발 감지 가능 */
export async function nextSequence(sequenceKey) {
  const seqRef = ref(db, `code_sequences/${sequenceKey}`);
  try {
    const result = await runTransaction(seqRef, (v) => (v || 0) + 1);
    if (result.committed) return result.snapshot.val();
    console.warn(`[nextSequence] ${sequenceKey} 트랜잭션 커밋 실패 — fallback 사용`);
  } catch (e) {
    console.warn(`[nextSequence] ${sequenceKey} 에러 — fallback 사용:`, e);
  }
  return 999000 + Math.floor(Math.random() * 999); // 정상 seq 대역(<1000 일반적) 과 분리
}

/* ── 채번 헬퍼 ── */
/** 오늘 날짜 YYMMDD — 한국 기준 */
function todayYYMMDD() {
  const d = new Date();
  return String(d.getFullYear()).slice(-2)
       + String(d.getMonth() + 1).padStart(2, '0')
       + String(d.getDate()).padStart(2, '0');
}

/** PT-0001 — 파트너 글로벌 시퀀스 (PT- prefix 유지, 4자리 패딩) */
export async function allocatePartnerCode() {
  const seq = await nextSequence('partner_seq');
  return `PT-${String(seq).padStart(4, '0')}`;
}

/** POL-0001 — 정책 글로벌 시퀀스 */
export async function allocatePolicyCode() {
  const seq = await nextSequence('policy_seq');
  return `POL-${String(seq).padStart(4, '0')}`;
}

/** PD-YYMMDD-001 — 수기 등록 상품 (sync 의 EXT_ 와 구분) */
export async function allocateManualProductUid() {
  const date = todayYYMMDD();
  const seq = await nextSequence(`product_${date}`);
  return `PD-${date}-${String(seq).padStart(3, '0')}`;
}

/** 임시 차량번호 — 100신NNNN 패턴 (신차/번호미정 매물용 글로벌 시퀀스).
 *  한국 plate 형식 (3자리+한글+4자리) 통과 → isValidCarNumber 검증 OK. */
export async function allocateTempCarNumber() {
  const seq = await nextSequence('temp_car_number_seq');
  return `100신${String(seq).padStart(4, '0')}`;
}

/* ── 정산 생성 (계약 완료 시) ── */
export async function createSettlement(contract) {
  const dateStr = todayYYMMDD();
  const seq = await nextSequence(`settlement_${dateStr}`);
  const code = `ST-${dateStr}-${String(seq).padStart(3, '0')}`;

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

/* ── 관리자 월별 수수료 정산 (수기 등록) ──
 *  정산관리(건별)에서 정산완료된 건을 관리자가 실제 수수료 정산으로 옮겨 만지는 별도 레코드.
 *  data = { settle_month, ...A/B/C 블록 입력 + 자동계산 결과 } (계산은 페이지에서 수행) */
export async function allocateAdminSettlementCode() {
  const dateStr = todayYYMMDD();
  const seq = await nextSequence(`admin_settlement_${dateStr}`);
  return `AS-${dateStr}-${String(seq).padStart(3, '0')}`;
}

export async function createAdminSettlement(data) {
  const code = await allocateAdminSettlementCode();
  await setRecord(`admin_settlements/${code}`, {
    admin_settlement_code: code,
    ...data,
    created_at: Date.now(),
    updated_at: Date.now(),
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
  } catch (e) { console.warn('[room.notify] 신규 문의 알림톡 실패 (Aligo 미설정 가능):', e); }

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

/* ── 사용자 프로필 저장 (회원가입 시) ──
 * 규칙:
 *  - user_code 는 소속과 무관하게 전역 시퀀스(U0001…)
 *  - business_no(사업자번호) 입력 시 partners 의 business_number 와 매칭:
 *    · sales_channel 매칭 → role='agent' + 해당 partner_code
 *    · provider 매칭     → role='provider' + 해당 partner_code
 *    · operator 매칭     → SP999 + agent (운영사 가입은 비정상)
 *    · 매칭 실패         → SP999 + agent (임시소속, admin 재지정)
 *  - status='active' — 가입 즉시 로그인 가능. admin 검토는 필요시 수동으로
 */
export async function saveUserProfile(uid, profile) {
  const user_code = await allocateUserCode();
  const bizNo = String(profile.business_no || '').replace(/\D/g, '');
  const matched = bizNo ? await matchPartnerByBizNo(bizNo) : null;

  let role = 'agent';
  let company_code = 'SP999';
  let agent_channel_code = '';
  let matched_partner_code = null;
  if (matched) {
    matched_partner_code = matched.partner_code;
    const pt = matched.partner_type || '';   // 한/영 모두 대응 (데이터 혼재 + 마이그레이션 과도기)
    if (/영업|sales/i.test(pt)) {
      // 영업채널 → 영업자. 채널 연결은 agent_channel_code (영업채널 카운트 기준 필드)
      role = 'agent'; company_code = matched.partner_code; agent_channel_code = matched.partner_code;
    } else if (/공급|provider/i.test(pt)) {
      role = 'provider'; company_code = matched.partner_code;
    }
    // 운영사(operator) 는 SP999 유지 (운영사 가입은 비정상 — admin 이 수동 부여)
  }

  await setRecord(`users/${uid}`, {
    uid,
    ...profile,
    business_no: bizNo,
    user_code,
    role,
    company_code,
    agent_channel_code,      // 영업자 소속 채널 (영업채널 카운트가 이 필드 기준)
    matched_partner_code,    // 매칭 추적용 (감사 / admin 검토)
    status: 'active',
    created_at: Date.now(),
  });
}

/* business_no (숫자만) 로 partners 의 business_number 찾기.
 *  partners 는 read public 이라 가입 전 호출 가능. */
async function matchPartnerByBizNo(bizNoDigits) {
  try {
    const snap = await get(ref(db, 'partners'));
    const all = snap.val() || {};
    for (const [k, p] of Object.entries(all)) {
      if (!p || p._deleted) continue;
      const pn = String(p.business_number || '').replace(/\D/g, '');
      if (pn && pn === bizNoDigits) {
        return {
          partner_code: p.partner_code || k,
          partner_type: p.partner_type || '',
          partner_name: p.partner_name || p.company_name || '',
        };
      }
    }
  } catch (e) {
    console.warn('[matchPartnerByBizNo]', e?.code || e?.message || e);
  }
  return null;
}

/** 가입 순 전역 시퀀스 — 'U0001' 포맷 (4자리), runTransaction 으로 원자적 증가
 *  트랜잭션 실패 시 throw — 중복 위험한 fallback 대신 호출자가 재시도하게 함 */
async function allocateUserCode() {
  const seqRef = ref(db, 'counters/user_code_seq');
  const result = await runTransaction(seqRef, (cur) => (cur || 0) + 1);
  if (!result.committed) throw new Error('user_code 시퀀스 발급 실패 — 다시 시도하세요');
  const seq = result.snapshot.val();
  return `U${String(seq).padStart(4, '0')}`;
}
