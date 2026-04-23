/**
 * vehicle-master.js — 차종 마스터 (JPKerp2 vehicle_master 포팅)
 * - Firebase RTDB `vehicle_master` 경로
 * - 캐스케이드 선택: maker → model → sub → trim
 * - 등록증 매칭: type_number_pattern → car_name → maker+model+engine
 * - 시드 일괄 import (한국 차종 263종)
 */
import { db } from '../firebase/config.js';
import { ref, push, set, update, onValue, get } from 'firebase/database';
import { KOREAN_CAR_MODELS, inferOrigin, inferPowertrain, subWithYear, inferFuel } from './car-models-seed.js';

const PATH = 'vehicle_master';

/** 전체 구독 (활성만, soft-delete 제외) */
export function watchVehicleMaster(callback) {
  const r = ref(db, PATH);
  return onValue(r, (snap) => {
    const data = snap.val() || {};
    const list = Object.entries(data)
      .map(([key, v]) => ({ _key: key, ...(v || {}) }))
      .filter(v => v.status !== 'deleted');
    callback(list);
  });
}

/** 단발 조회 */
export async function fetchVehicleMaster() {
  const snap = await get(ref(db, PATH));
  const data = snap.val() || {};
  return Object.entries(data)
    .map(([key, v]) => ({ _key: key, ...(v || {}) }))
    .filter(v => v.status !== 'deleted');
}

/** 신규 차종 등록 */
export async function createVehicleModel(data) {
  const now = Date.now();
  const payload = {
    status: 'active',
    source: 'manual',
    ...data,
    origin: data.origin || inferOrigin(data.maker),
    powertrain: data.powertrain || inferPowertrain(data.category || ''),
    fuel_type: data.fuel_type || inferFuel(data.category || ''),
    sub: data.sub.endsWith('-') ? data.sub : subWithYear(data.sub, data.year_start),
    created_at: now,
    updated_at: now,
  };
  const newRef = push(ref(db, PATH));
  await set(newRef, payload);
  return newRef.key;
}

/** 수정 */
export async function updateVehicleModel(key, patch) {
  await update(ref(db, `${PATH}/${key}`), { ...patch, updated_at: Date.now() });
}

/** soft-delete */
export async function deleteVehicleModel(key) {
  await update(ref(db, `${PATH}/${key}`), { status: 'deleted', deleted_at: Date.now() });
}

/** 시드 일괄 import (관리자용) — 중복 skip */
export async function seedVehicleMaster(onProgress) {
  const existing = await fetchVehicleMaster();
  const existingKeys = new Set(existing.map(v => `${v.maker}|${v.model}|${v.sub}`));
  let added = 0, skipped = 0;
  for (let i = 0; i < KOREAN_CAR_MODELS.length; i++) {
    const m = KOREAN_CAR_MODELS[i];
    const sub = subWithYear(m.sub, m.year_start);
    const key = `${m.maker}|${m.model}|${sub}`;
    if (existingKeys.has(key)) { skipped++; continue; }
    await createVehicleModel({ ...m, sub });
    added++;
    onProgress?.({ i: i + 1, total: KOREAN_CAR_MODELS.length, added, skipped });
  }
  return { added, skipped, total: KOREAN_CAR_MODELS.length };
}

/** ─── 캐스케이드 헬퍼 ─── */

/** 전체 차종에서 활성 제조사 목록 + 대수 */
export function uniqueMakers(list) {
  const map = new Map();
  list.forEach(v => map.set(v.maker, (map.get(v.maker) || 0) + 1));
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([maker, count]) => ({ maker, count }));
}

/** maker 필터 → 모델 목록 */
export function uniqueModels(list, maker) {
  const map = new Map();
  list.filter(v => v.maker === maker)
    .forEach(v => map.set(v.model, (map.get(v.model) || 0) + 1));
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko')).map(([model, count]) => ({ model, count }));
}

/** maker+model 필터 → sub 목록 (최신 생산 우선) */
export function uniqueSubs(list, maker, model) {
  return list.filter(v => v.maker === maker && v.model === model)
    .sort((a, b) => String(b.year_start || '').localeCompare(String(a.year_start || '')));
}

/** ─── 매칭 (등록증 → 마스터) ─── */

/**
 * 등록증 데이터로 vehicle_master 레코드 찾기
 * @param {object} reg - {maker, model, sub_model, car_name, type_number, engine_type, first_registration_date}
 * @param {Array} list - 전체 차종 마스터
 */
export function matchFromRegistration(reg, list) {
  if (!reg) return null;
  const { maker, model, sub_model, type_number, engine_type, first_registration_date } = reg;

  // 1. type_number_pattern 매칭 (가장 정확)
  if (type_number) {
    const hit = list.find(v => {
      if (!v.type_number_pattern) return false;
      try {
        const re = new RegExp(v.type_number_pattern.replace(/\*/g, '.*'), 'i');
        return re.test(type_number);
      } catch { return false; }
    });
    if (hit) return hit;
  }

  // 2. maker + model + sub 완전 일치
  if (maker && model && sub_model) {
    const exact = list.find(v => v.maker === maker && v.model === model && v.sub === sub_model);
    if (exact) return exact;
  }

  // 3. maker + model + 생산 연월 범위
  if (maker && model && first_registration_date) {
    const year = Number(String(first_registration_date).slice(0, 4));
    const candidates = list.filter(v => v.maker === maker && v.model === model);
    const inRange = candidates.find(v => {
      const ys = Number(String(v.year_start || '').slice(0, 4));
      const ye = v.year_end === '현재' ? 9999 : Number(String(v.year_end || '').slice(0, 4));
      return year >= ys && year <= ye;
    });
    if (inRange) return inRange;
    if (candidates.length) return candidates[0];
  }

  // 4. maker + model 매칭
  if (maker && model) {
    const hit = list.find(v => v.maker === maker && v.model === model);
    if (hit) return hit;
  }

  // 5. maker + engine_type
  if (maker && engine_type) {
    const hit = list.find(v => v.maker === maker && v.engine_type === engine_type);
    if (hit) return hit;
  }

  return null;
}
