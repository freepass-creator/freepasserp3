/**
 * Firebase DB helpers — shared subscription cache + common operations
 */
import { ref, onValue, off, get, set, update, push, query, limitToLast } from 'firebase/database';
import { db } from './config.js';
import { trackSave } from '../core/save-status.js';

/* ── Shared Watcher Cache ── */
const _watchers = new Map(); // cacheKey → { ref, callbacks, unsubscribe }

/**
 * Watch a collection with shared subscription cache.
 * Multiple callers watching the same path share ONE Firebase listener.
 */
export function watchCollection(path, callback, options = {}) {
  const { limit, transform } = options;
  const cacheKey = `${path}\x00${limit || ''}`;

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

  const dbRef = limit
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
    console.warn(`[watchCollection] ${path} 실패:`, error?.code || error?.message || error);
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
  const dbRef = ref(db, path);
  const unsub = onValue(dbRef, (snap) => callback(snap.val()));
  return unsub;
}

/**
 * Fetch once
 */
export async function fetchCollection(path) {
  const snap = await get(ref(db, path));
  return snapshotToArray(snap.val());
}

export async function fetchRecord(path) {
  const snap = await get(ref(db, path));
  return snap.val();
}

/**
 * Write operations
 */
export async function setRecord(path, data, opts = {}) {
  const promise = set(ref(db, path), { ...data, updated_at: Date.now() });
  const result = await (opts.silent ? promise : trackSave(promise));
  if (!opts.skipAudit) {
    const { logAudit } = await import('./audit-log.js');
    logAudit({ action: 'create', path, fields: Object.keys(data), data });
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
  const { runTransaction } = await import('firebase/database');
  try {
    const result = await runTransaction(ref(db, path), (cur) => (Number(cur) || 0) + delta);
    return result.committed ? result.snapshot.val() : null;
  } catch (e) {
    console.warn('[incrementAtomic]', path, e);
    return null;
  }
}

export async function updateRecord(path, data, opts = {}) {
  const promise = update(ref(db, path), { ...data, updated_at: Date.now() });
  const result = await (opts.silent ? promise : trackSave(promise));
  if (!opts.skipAudit) {
    const { logAudit } = await import('./audit-log.js');
    // delete/restore 는 _deleted 필드로 판별
    const action = data._deleted === true ? 'delete'
                 : data._deleted === false ? 'restore'
                 : 'update';
    logAudit({ action, path, fields: Object.keys(data), data });
  }
  return result;
}

export async function pushRecord(path, data, opts = {}) {
  const newRef = push(ref(db, path));
  const promise = set(newRef, { ...data, created_at: Date.now() });
  await (opts.silent ? promise : trackSave(promise));
  if (!opts.skipAudit) {
    const { logAudit } = await import('./audit-log.js');
    logAudit({ action: 'create', path: `${path}/${newRef.key}`, fields: Object.keys(data), data });
  }
  return newRef.key;
}

/**
 * Soft delete (status = 'deleted')
 */
export async function softDelete(path) {
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
