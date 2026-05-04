/**
 * audit-log.js — 모든 entity 변경 (create/update/delete/restore) 추적
 *
 * Firebase RTDB 별도 노드: /audit_logs/{auto_id}
 * 구조: { action, collection, record_key, fields[], actor_uid, actor_role, actor_name, ts }
 *
 * 사용:
 *  - db.js 의 setRecord/updateRecord/pushRecord 가 자동 호출 (skipAudit: true 로 opt-out)
 *  - 명시적 호출: logAudit({ action: 'delete', path: 'contracts/CT-...', fields: ['_deleted'] })
 *
 * 정책:
 *  - 고볼륨 write (messages, read_at 등) 는 skipAudit: true 로 제외
 *  - 감사 로그 자체 실패는 사용자 액션을 막지 않음 (fire-and-forget + .catch)
 *  - 메인 record 가 누가·언제 (created_by/created_at + updated_by/updated_at + deleted_by/deleted_at) 도 inline 으로 보존
 */
import { ref, push } from 'firebase/database';
import { db } from './config.js';
import { store } from '../core/store.js';

/* 감사 대상 컬렉션 — 고볼륨 (messages 등) 은 의도적으로 제외 */
const AUDITED_COLLECTIONS = new Set([
  'products', 'contracts', 'policies', 'partners', 'users', 'settlements',
  'rooms', 'customers', 'vehicle_master',
]);

/* 노이즈 필드 — 채팅 읽음/마지막메시지 업데이트는 감사 의미 없음 (rooms 컬렉션 한정) */
const NOISY_FIELDS = new Set([
  'read_at_agent', 'read_at_provider', 'read_at_admin',
  'last_message', 'last_message_at',
  'last_sender_uid', 'last_sender_role', 'last_sender_code',
  'unread', 'updated_at',  // updated_at 만 변경되는 건 의미 없음
]);
const isNoisyField = (f) => NOISY_FIELDS.has(f) || f.startsWith('read_by/');

/**
 * @param {Object} params
 * @param {'create'|'update'|'delete'|'restore'} params.action
 * @param {string} params.path  — 'contracts/CT-241105-01' 형식
 * @param {string[]} [params.fields]  — 변경된 필드 이름 (update 시)
 * @param {Object} [params.data]  — 변경 후 값 (선택, 작은 데이터만)
 */
export async function logAudit({ action, path, fields, data }) {
  if (!action || !path) return;
  const [collection, ...rest] = path.split('/');
  if (!AUDITED_COLLECTIONS.has(collection)) return;   // 감사 대상 아님
  const key = rest.join('/');

  // update 시 의미 있는 필드만 추려서 노이즈 제거 (채팅 read 등)
  if (action === 'update' && Array.isArray(fields)) {
    const meaningful = fields.filter(f => !isNoisyField(f));
    if (!meaningful.length) return;   // 모두 noise → 감사 안 함
    fields = meaningful;
  }

  const me = store.currentUser || {};
  const entry = {
    action,
    collection,
    record_key: key,
    actor_uid: me.uid || '',
    actor_role: me.role || '',
    actor_name: me.name || me.email || '',
    fields: Array.isArray(fields) ? fields : [],
    ts: Date.now(),
  };
  // data 는 작은 경우만 inline (계약자명 / 차량번호 / 상태 등 핵심 필드만)
  if (data && typeof data === 'object') {
    const compact = {};
    for (const f of (fields || []).slice(0, 8)) {
      const v = data[f];
      if (v == null) continue;
      const s = String(v);
      if (s.length <= 80) compact[f] = v;   // 짧은 값만 보존 (긴 텍스트는 이름만 기록)
    }
    if (Object.keys(compact).length) entry.values = compact;
  }
  try {
    await push(ref(db, 'audit_logs'), entry);
  } catch (err) {
    // 감사 실패는 사용자 액션을 막지 않음.
    // PERMISSION_DENIED 는 rules 미배포 상태 — 한 번만 안내 후 다음부턴 silent
    if (err?.code === 'PERMISSION_DENIED') {
      if (!_audit_warned) {
        _audit_warned = true;
        console.warn('[audit-log] /audit_logs RTDB rules 미배포 — firebase deploy --only database 필요');
      }
      return;
    }
    console.warn('[audit-log]', err);
  }
}
let _audit_warned = false;

/* 헬퍼: actor inline 필드 (record 자체에 누가·언제 마킹) */
export function actorStamp(action) {
  const me = store.currentUser || {};
  const ts = Date.now();
  if (action === 'create') return { created_by: me.uid || '', created_at: ts };
  if (action === 'update') return { updated_by: me.uid || '', updated_at: ts };
  if (action === 'delete') return { deleted_by: me.uid || '', deleted_at: ts, _deleted: true };
  if (action === 'restore') return { restored_by: me.uid || '', restored_at: ts, _deleted: false };
  return { updated_at: ts };
}
