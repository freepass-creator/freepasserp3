/**
 * car-models.js — 차종 마스터 API 호환 레이어
 *
 * JPKerp2 와 동일한 `vehicle_master` 컬렉션을 사용.
 * 구 API (`sub_model` 키) 를 유지하기 위해 `vehicle_master` 의 `sub` 를
 * `sub_model` 로 매핑해서 store.carModels 에 캐시.
 */

import { watchCollection } from '../firebase/db.js';
import { store } from './store.js';

let _unsub = null;

/** 최초 1회 구독 시작. 이미 구독 중이면 기존 구독 유지 */
export function subscribeCarModels() {
  if (_unsub) return _unsub;
  _unsub = watchCollection('vehicle_master', (data) => {
    store.carModels = (data || [])
      .filter(m => m && m.status !== 'deleted')
      .map(m => ({
        ...m,
        sub_model: m.sub_model || m.sub || '',   // sub → sub_model 호환
        vehicle_class: m.vehicle_class || m.category || '',
      }));
  });
  return _unsub;
}

export function unsubscribeCarModels() {
  _unsub?.();
  _unsub = null;
}

/* ── 공용 조회 헬퍼 ── */

/** products 기준 보유 카운트 계산 — 제조사별 · 제조사+모델별 */
function productCounts() {
  const byMaker = new Map();
  const byMakerModel = new Map();
  for (const p of store.products || []) {
    if (p._deleted || p.status === 'deleted') continue;
    const mk = p.maker || '';
    const md = p.model || '';
    if (mk) byMaker.set(mk, (byMaker.get(mk) || 0) + 1);
    if (mk && md) byMakerModel.set(`${mk}|${md}`, (byMakerModel.get(`${mk}|${md}`) || 0) + 1);
  }
  return { byMaker, byMakerModel };
}

/** 제조사/모델의 엔카 인기도 합계 — carModels 의 popularity 집계
 *  popularity: 엔카 매물 수 (세대별), model_popularity: 모델그룹 전체 매물 수 */
function popularityIndex() {
  const byMaker = new Map();
  const byMakerModel = new Map();
  for (const m of store.carModels || []) {
    if (m.archived) continue;
    const mk = m.maker;
    const md = m.model;
    const pop = Number(m.model_popularity || m.popularity || 0);
    if (mk && pop) byMaker.set(mk, Math.max(byMaker.get(mk) || 0, pop));
    if (mk && md && pop) byMakerModel.set(`${mk}|${md}`, Math.max(byMakerModel.get(`${mk}|${md}`) || 0, pop));
  }
  return { byMaker, byMakerModel };
}

/** 제조사 목록 — 보유대수 → 엔카 인기도 → 가나다 (JPKerp2 asset-create 준용) */
export function getMakers() {
  const { byMaker: countByMaker } = productCounts();
  const { byMaker: popByMaker } = popularityIndex();
  const s = new Set();
  for (const m of store.carModels || []) if (m.maker && !m.archived) s.add(m.maker);
  return [...s].sort((a, b) => {
    const ca = countByMaker.get(a) || 0;
    const cb = countByMaker.get(b) || 0;
    if (cb !== ca) return cb - ca;                        // 1순위: 보유 많은 순
    const pa = popByMaker.get(a) || 0;
    const pb = popByMaker.get(b) || 0;
    if (pb !== pa) return pb - pa;                        // 2순위: 엔카 인기순
    return a.localeCompare(b, 'ko');                      // 3순위: 가나다
  });
}

/** 제조사의 모델 목록 — 보유대수 → 엔카 모델 인기도 → 가나다 */
export function getModelsByMaker(maker) {
  if (!maker) return [];
  const { byMakerModel: countByMM } = productCounts();
  const { byMakerModel: popByMM } = popularityIndex();
  const s = new Set();
  for (const m of store.carModels || []) {
    if (m.maker === maker && m.model && !m.archived) s.add(m.model);
  }
  return [...s].sort((a, b) => {
    const ca = countByMM.get(`${maker}|${a}`) || 0;
    const cb = countByMM.get(`${maker}|${b}`) || 0;
    if (cb !== ca) return cb - ca;
    const pa = popByMM.get(`${maker}|${a}`) || 0;
    const pb = popByMM.get(`${maker}|${b}`) || 0;
    if (pb !== pa) return pb - pa;
    return a.localeCompare(b, 'ko');
  });
}

/** (제조사, 모델)의 세부모델 목록 — 연식 내림차순 (최신 먼저) */
export function getSubModels(maker, model) {
  if (!maker || !model) return [];
  const rows = (store.carModels || []).filter(m =>
    m.maker === maker && m.model === model && m.sub_model && !m.archived
  );
  rows.sort((a, b) => {
    // production_start ("YYYY-MM") 우선, 없으면 year_start ("YYYY"→"YYYY-01"), 그래도 없으면 이름
    const pa = a.production_start || (a.year_start ? `${a.year_start}-01` : '');
    const pb = b.production_start || (b.year_start ? `${b.year_start}-01` : '');
    if (pa && pb && pa !== pb) return pb.localeCompare(pa);   // 최신 먼저
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return (a.sub_model || '').localeCompare(b.sub_model || '', 'ko');
  });
  // 중복 sub_model 제거 (같은 세부모델이 여러 레코드에 있을 경우)
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.sub_model)) continue;
    seen.add(r.sub_model);
    out.push(r.sub_model);
  }
  return out;
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
