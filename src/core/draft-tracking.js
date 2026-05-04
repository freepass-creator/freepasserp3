/**
 * draft-tracking.js — 신규 record 자동 정리 (필수 필드 미입력 시 페이지 이탈에 폐기)
 *
 * app.js 에서 분리. 사용 패턴:
 *   trackDraft('products', uid, 'car_number')                  // 단일 필수
 *   trackDraft('products', uid, ['car_number', 'provider_company_code'])  // 복수 필수 (모두 채워야 valid)
 *   discardIncompleteDrafts()                                   // hashchange / popstate / beforeunload 호출
 *   isDraftSaveBlocked(collection, key) → boolean               // 저장 차단 여부 (필수 빈 값)
 *
 *  ※ "[저장] 버튼만 저장" spec 의 예외 — 사용자가 [수정] → 입력 → 저장 안 하고 다른 메뉴로 가는
 *     실수로 신규 draft 가 통째로 삭제되는 회귀 방지.
 */
import { store } from './store.js';
import { updateRecord } from '../firebase/db.js';
import { showToast } from './toast.js';

/* 신규 생성된 빈 레코드 추적 — 페이지 이동 시 필수 정보 비어있으면 자동 삭제.
 *  collection: { id: requiredField | requiredFields[] } 형식. 모두 채워야 valid. */
const _pendingDrafts = {
  products: new Map(),    // _key → 'car_number' 또는 ['car_number', 'provider_company_code']
  policies: new Map(),    // _key → 'policy_name'
  partners: new Map(),    // _key → 'partner_name'
};

export function trackDraft(collection, key, requiredField) {
  _pendingDrafts[collection]?.set(key, requiredField);
}

/** 필수 필드 모두 채워졌는지 — 단일/복수 모두 지원 */
export function isDraftValid(collection, key) {
  const fieldOrFields = _pendingDrafts[collection]?.get(key);
  if (!fieldOrFields) return true;     // not tracked → valid
  const list = store[collection === 'products' ? 'products'
              : collection === 'policies' ? 'policies' : 'partners'] || [];
  const rec = list.find(x => x._key === key);
  if (!rec) return true;        // already gone
  const fields = Array.isArray(fieldOrFields) ? fieldOrFields : [fieldOrFields];
  return fields.every(f => !!String(rec[f] || '').trim());
}

/** 저장 차단 여부 — 활성 신규 record 가 필수 필드 미입력 시 true.
 *  bindAutoSave 등 저장 진입부에서 호출 → 차단 시 토스트 표시 후 return. */
export function isDraftSaveBlocked(collection, key) {
  if (!_pendingDrafts[collection]?.has(key)) return false;  // 신규 draft 아님 → 정상 저장
  return !isDraftValid(collection, key);
}

/** 누락된 필수 필드 라벨 반환 — 토스트 메시지에 사용 */
export function missingRequiredFields(collection, key) {
  const fieldOrFields = _pendingDrafts[collection]?.get(key);
  if (!fieldOrFields) return [];
  const list = store[collection === 'products' ? 'products'
              : collection === 'policies' ? 'policies' : 'partners'] || [];
  const rec = list.find(x => x._key === key);
  if (!rec) return [];
  const fields = Array.isArray(fieldOrFields) ? fieldOrFields : [fieldOrFields];
  return fields.filter(f => !String(rec[f] || '').trim());
}

/* 미완성 신규 레코드 일괄 정리 — hashchange / popstate / beforeunload / 페이지 이탈 시 호출 */
export async function discardIncompleteDrafts() {
  for (const [collection, map] of Object.entries(_pendingDrafts)) {
    for (const [key, _] of [...map]) {
      if (!isDraftValid(collection, key)) {
        try { await updateRecord(`${collection}/${key}`, { _deleted: true, updated_at: Date.now() }); } catch (_) {}
        showToast('미입력 신규 항목 자동 정리됨', 'info');
      }
      map.delete(key);
    }
  }
}

/** draft tracking 중에서 해당 key 제거 — 저장 완료된 후 (필수 필드 채워짐) 호출하면
 *  더 이상 자동 삭제 대상에서 빠짐. */
export function untrackDraft(collection, key) {
  _pendingDrafts[collection]?.delete(key);
}

/** 추적 중인 draft 인지 (신규 record 인지 판별) */
export function isDraftPending(collection, key) {
  return !!_pendingDrafts[collection]?.has(key);
}

/** draft 가 입력 시작된 상태인지 (any 필수 필드 1개 이상 채워짐).
 *  → true: [저장] 버튼 표시 / false: [취소] 버튼 표시
 *  store(저장된 값) + DOM(입력 중 라이브 값) 둘 다 체크 — 첫 키 입력 즉시 반영 */
export function hasDraftStarted(collection, key) {
  const fieldOrFields = _pendingDrafts[collection]?.get(key);
  if (!fieldOrFields) return false;
  const fields = Array.isArray(fieldOrFields) ? fieldOrFields : [fieldOrFields];
  // 1) store (저장된 값)
  const list = store[collection === 'products' ? 'products'
              : collection === 'policies' ? 'policies' : 'partners'] || [];
  const rec = list.find(x => x._key === key);
  if (rec && fields.some(f => !!String(rec[f] || '').trim())) return true;
  // 2) DOM 활성 페이지 input (typing 중인 값)
  if (typeof document !== 'undefined') {
    for (const f of fields) {
      const el = document.querySelector(`.pt-page.active [data-f="${f}"]`);
      if (el && String(el.value || '').trim()) return true;
    }
  }
  return false;
}
