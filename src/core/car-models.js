/**
 * car-models.js — 차종 마스터 (jpkerp-next와 공유)
 *
 * RTDB `car_models/{key}` 를 구독해서 store.carModels에 캐시.
 * picker, 신규 상품 입력, OCR 보정 등에서 단일 진실 소스로 사용.
 *
 * 스키마: project_car_models_master.md 참조.
 */

import { watchCollection } from '../firebase/db.js';
import { store } from './store.js';

let _unsub = null;

/** 최초 1회 구독 시작. 이미 구독 중이면 기존 구독 유지 */
export function subscribeCarModels() {
  if (_unsub) return _unsub;
  _unsub = watchCollection('car_models', (data) => {
    // 소프트 삭제(status === 'deleted') 제외
    store.carModels = (data || []).filter(m => m && m.status !== 'deleted');
  });
  return _unsub;
}

export function unsubscribeCarModels() {
  _unsub?.();
  _unsub = null;
}

/* ── 공용 조회 헬퍼 ── */

/** 제조사 unique 목록 (정렬) */
export function getMakers() {
  const s = new Set();
  for (const m of store.carModels || []) if (m.maker) s.add(m.maker);
  return [...s].sort();
}

/** 주어진 제조사의 모델 unique 목록 (정렬) */
export function getModelsByMaker(maker) {
  if (!maker) return [];
  const s = new Set();
  for (const m of store.carModels || []) if (m.maker === maker && m.model) s.add(m.model);
  return [...s].sort();
}

/** (제조사, 모델)로 세부모델 unique 목록 (정렬) */
export function getSubModels(maker, model) {
  if (!maker || !model) return [];
  const s = new Set();
  for (const m of store.carModels || []) {
    if (m.maker === maker && m.model === model && m.sub_model) s.add(m.sub_model);
  }
  return [...s].sort();
}

/** (제조사, 모델, 세부모델)의 트림 unique 목록 (정렬) */
export function getTrims(maker, model, sub_model) {
  if (!maker || !model || !sub_model) return [];
  const s = new Set();
  for (const m of store.carModels || []) {
    if (m.maker === maker && m.model === model && m.sub_model === sub_model && m.trim_name) s.add(m.trim_name);
  }
  return [...s].sort();
}

/** 정확 매칭(제조사+모델+세부모델[+트림]) — 세부모델 선택 시 vehicle_class(category) auto-derive 용 */
export function findCarModel({ maker, model, sub_model, trim_name } = {}) {
  if (!maker || !model) return null;
  return (store.carModels || []).find(m =>
    m.maker === maker &&
    m.model === model &&
    (!sub_model || m.sub_model === sub_model) &&
    (!trim_name || m.trim_name === trim_name)
  ) || null;
}

/** products에서 미등록 차종 추출 (admin 유틸 — 신규 car_models seed 보조) */
export function extractUnregisteredFromProducts(products = [], carModels = store.carModels || []) {
  const known = new Set(carModels.map(m => `${m.maker}|${m.model}|${m.sub_model || ''}`));
  const out = new Map();
  for (const p of products) {
    if (!p?.maker || !p?.model) continue;
    const key = `${p.maker}|${p.model}|${p.sub_model || ''}`;
    if (known.has(key) || out.has(key)) continue;
    out.set(key, {
      maker: p.maker,
      model: p.model,
      sub_model: p.sub_model || '',
      fuel_type: p.fuel_type || '',
    });
  }
  return [...out.values()];
}
