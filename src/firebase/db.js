/**
 * Firebase DB helpers — shared subscription cache + common operations
 */
import { ref, onValue, off, get, set, update, push, query, limitToLast, orderByChild, equalTo } from 'firebase/database';
import { db } from './config.js';
import { trackSave } from '../core/save-status.js';
// 영업자 체험(둘러보기) 모드 — 이 초크포인트에서 Firebase 대신 인메모리 샘플 DB 로 우회.
//  실데이터/개인정보 0% 노출 보장. (isDemo() 아니면 아래 로직은 전혀 개입하지 않음)
import {
  isDemo, demoWatchCollection, demoWatchRecord, demoFetchCollection, demoFetchRecord,
  demoSet, demoUpdate, demoPush, demoSoftDelete, demoIncrement, demoAppendToArray, demoRemoveFromArray,
} from '../core/demo.js';

/** RTDB 는 undefined 값을 통째로 거부("set failed: value argument contains undefined") →
 *  쓰기 전 undefined 프로퍼티 제거 (중첩 객체/배열까지 재귀).
 *  계약 생성 등에서 product?.x / customer._key 같은 optional 필드가 undefined 로 섞여
 *  set 전체가 실패하던 문제 방지. null(=삭제) 은 그대로 둠. */
export function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

/* ── Shared Watcher Cache ── */
const _watchers = new Map(); // cacheKey → { ref, callbacks, unsubscribe }

/**
 * Watch a collection with shared subscription cache.
 * Multiple callers watching the same path share ONE Firebase listener.
 */
export function watchCollection(path, callback, options = {}) {
  if (isDemo()) return demoWatchCollection(path, callback, options);
  const { limit, transform, scope } = options;
  // scope = { field, value } → 역할별 서버측 쿼리 스코핑 (자기 것만 다운로드). 없으면 전체(admin).
  const scopeKey = scope ? `${scope.field}=${scope.value}` : '';
  const cacheKey = `${path}\x00${limit || ''}\x00${scopeKey}`;

  if (_watchers.has(cacheKey)) {
    const entry = _watchers.get(cacheKey);
    entry.callbacks.add(callback);
    // Fire immediately with last known data
    if (entry.lastData !== undefined) callback(entry.lastData);
    return () => {
      entry.callbacks.delete(callback);
      if (entry.callbacks.size === 0) {
        entry.unsubscribe();
        _watchers.delete(cacheKey);
      }
    };
  }

  const dbRef = scope
    ? query(ref(db, path), orderByChild(scope.field), equalTo(scope.value))
    : limit
      ? query(ref(db, path), limitToLast(limit))
      : ref(db, path);

  const callbacks = new Set([callback]);

  const entry = { ref: dbRef, callbacks, unsubscribe: () => off(dbRef), lastData: undefined };
  _watchers.set(cacheKey, entry);

  const unsubscribe = onValue(dbRef, (snapshot) => {
    const raw = snapshot.val();
    const data = transform ? transform(raw) : snapshotToArray(raw);
    entry.lastData = data;
    callbacks.forEach(cb => cb(data));
  }, (error) => {
    const code = error?.code || error?.message || error;
    // PERMISSION_DENIED 는 "데이터 0건"이 아니라 스코프/규칙 불일치 신호 — 빈 배열로 삼키되 가시화.
    //  (예: 영업관리자 노드의 agent_channel_code 누락 시 스코프 쿼리 거부 → 조용한 빈 화면 방지)
    if (String(code).toUpperCase().includes('PERMISSION_DENIED')) {
      console.error(`[watchCollection] ${path} 권한거부(PERMISSION_DENIED) — 스코프/규칙 불일치 가능. 빈 목록으로 처리됨.`);
    } else {
      console.warn(`[watchCollection] ${path} 실패:`, code);
    }
    entry.lastData = [];
    callbacks.forEach(cb => cb([]));
  });

  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      off(dbRef);
      _watchers.delete(cacheKey);
    }
  };
}

/**
 * Watch a single record
 */
export function watchRecord(path, callback) {
  if (isDemo()) return demoWatchRecord(path, callback);
  const dbRef = ref(db, path);
  const unsub = onValue(dbRef, (snap) => callback(snap.val()));
  return unsub;
}

/**
 * Fetch once
 */
export async function fetchCollection(path) {
  if (isDemo()) return demoFetchCollection(path);
  const snap = await get(ref(db, path));
  return snapshotToArray(snap.val());
}

export async function fetchRecord(path) {
  if (isDemo()) return demoFetchRecord(path);
  const snap = await get(ref(db, path));
  return snap.val();
}

/**
 * Write operations
 */
export async function setRecord(path, data, opts = {}) {
  if (isDemo()) return demoSet(path, data);
  const clean = stripUndefined({ ...data, updated_at: Date.now() });
  const promise = set(ref(db, path), clean);
  const result = await (opts.silent ? promise : trackSave(promise));
  if (!opts.skipAudit) {
    const { logAudit } = await import('./audit-log.js');
    logAudit({ action: 'create', path, fields: Object.keys(clean), data: clean });
  }
  return result;
}

/**
 * 원자적 카운터 증가 — runTransaction 기반.
 * 여러 클라이언트 동시 쓰기 시 서로 덮어쓰지 않음 (경합 방지).
 * @param {string} path — 증가시킬 숫자 필드 경로
 * @param {number} delta — 기본 +1
 * @returns {Promise<number>} 증가 후 값 (트랜잭션 실패 시 null)
 */
export async function incrementAtomic(path, delta = 1) {
  if (isDemo()) return demoIncrement(path, delta);
  const { runTransaction } = await import('firebase/database');
  try {
    const result = await runTransaction(ref(db, path), (cur) => (Number(cur) || 0) + delta);
    return result.committed ? result.snapshot.val() : null;
  } catch (e) {
    console.warn('[incrementAtomic]', path, e);
    return null;
  }
}

/**
 * 배열 필드에 원자적 append — 동시편집 Lost Update 방지 (원칙 #22).
 *  read-modify-write(스냅샷 push 후 통째 저장)는 두 사람이 동시에 다른 항목을 추가하면
 *  한쪽이 소실됨. runTransaction 으로 서버 최신값 위에 append → 둘 다 보존.
 * @param {string} path — 배열 필드 경로 (예: settlements/{id}/events)
 * @param {object|any} item — 추가할 항목
 * @param {number} [max] — 지정 시 앞에서 잘라 최근 max개만 유지
 * @returns {Promise<Array|null>} 커밋 후 배열 (실패 시 null)
 */
/* RTDB 는 배열을 numeric-key 객체로 복원하기도 함 → 항상 조밀 배열로 정규화 (희소슬롯·객체형 손실 방지) */
const _asArray = (cur) => Array.isArray(cur) ? cur.slice()
  : (cur && typeof cur === 'object' ? Object.values(cur) : []);

export async function appendToArray(path, item, max = 0) {
  if (isDemo()) return demoAppendToArray(path, item, max);
  const { runTransaction } = await import('firebase/database');
  try {
    const result = await runTransaction(ref(db, path), (cur) => {
      const arr = _asArray(cur);
      arr.push(item);
      return max > 0 && arr.length > max ? arr.slice(arr.length - max) : arr;
    });
    return result.committed ? (result.snapshot.val() || []) : null;
  } catch (e) {
    console.warn('[appendToArray]', path, e);
    return null;
  }
}

/**
 * 배열에서 값으로 첫 일치 항목 원자적 제거 — 인덱스 통째덮어쓰기의 동시 add 소실 방지 (원칙 #22).
 *  항목이 문자열(url) 또는 {url} 객체 혼재 가능 → 둘 다 비교.
 * @param {string} path — 배열 필드 경로
 * @param {string} value — 제거할 url(문자열) 또는 항목의 url
 * @returns {Promise<Array|null>} 커밋 후 배열 (실패 시 null)
 */
export async function removeFromArray(path, value) {
  if (isDemo()) return demoRemoveFromArray(path, value);
  const { runTransaction } = await import('firebase/database');
  const matches = (it) => it === value || (it && typeof it === 'object' && (it.url === value || it.link === value));
  try {
    const result = await runTransaction(ref(db, path), (cur) => {
      const arr = _asArray(cur);   // 객체형/희소도 배열로 정규화 후 제거 (구 self-heal 동작 보존)
      const i = arr.findIndex(matches);
      if (i < 0) return arr.length ? arr : cur;
      arr.splice(i, 1); return arr;
    });
    return result.committed ? (result.snapshot.val() || []) : null;
  } catch (e) {
    console.warn('[removeFromArray]', path, e);
    return null;
  }
}

export async function updateRecord(path, data, opts = {}) {
  if (isDemo()) return demoUpdate(path, data);
  const clean = stripUndefined({ ...data, updated_at: Date.now() });
  const promise = update(ref(db, path), clean);
  const result = await (opts.silent ? promise : trackSave(promise));
  if (!opts.skipAudit) {
    const { logAudit } = await import('./audit-log.js');
    // delete/restore 는 _deleted 필드로 판별
    const action = data._deleted === true ? 'delete'
                 : data._deleted === false ? 'restore'
                 : 'update';
    logAudit({ action, path, fields: Object.keys(clean), data: clean });
  }
  return result;
}

export async function pushRecord(path, data, opts = {}) {
  if (isDemo()) return demoPush(path, data);
  const newRef = push(ref(db, path));
  const clean = stripUndefined({ ...data, created_at: Date.now() });
  const promise = set(newRef, clean);
  await (opts.silent ? promise : trackSave(promise));
  if (!opts.skipAudit) {
    const { logAudit } = await import('./audit-log.js');
    logAudit({ action: 'create', path: `${path}/${newRef.key}`, fields: Object.keys(clean), data: clean });
  }
  return newRef.key;
}

/**
 * Soft delete (status = 'deleted')
 */
export async function softDelete(path) {
  if (isDemo()) return demoSoftDelete(path);
  await update(ref(db, path), { _deleted: true, deleted_at: Date.now() });
}

/* ── Helpers ── */
function snapshotToArray(val) {
  if (!val) return [];
  return Object.entries(val)
    .map(([key, v]) => (typeof v === 'object' ? { _key: key, ...v } : { _key: key, value: v }))
    .filter(item => !item._deleted)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

export { ref, db, push, update, get, set, onValue, off, query, limitToLast };
