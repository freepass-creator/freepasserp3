/**
 * catalog-source.js — 우리 차종 매트릭스(catalog) 기반 cascade source.
 *
 *  vehicle_master(빈도 기반) 대신 catalog _index.json (401개) 을 단일 진실원으로 사용.
 *  4단 cascade: 메이커 → 모델(model_root) → 세부모델(catalog title - maker) → 트림(catalog.trims)
 *
 *  ensureCatalogSource() 를 한번 await 한 뒤 sync 함수들 사용. (app.js 부팅 시 호출 권장)
 */
import { loadIndex } from './vehicle-matrix.js';
import { store } from './store.js';

let _index = null;
let _readyPromise = null;

export async function ensureCatalogSource() {
  if (_index) return _index;
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    _index = await loadIndex();
    store.catalogIndex = _index;
    return _index;
  })();
  return _readyPromise;
}

/** 유틸: title 에서 maker prefix 제거 → sub_model 표기 */
export function titleToSubModel(maker, title) {
  if (!title) return '';
  if (!maker) return title.trim();
  const m = title.match(new RegExp('^' + maker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(.+)$'));
  return m ? m[1].trim() : title.trim();
}

/** product 보유대수 — 메이커별 / 메이커+모델별 / 메이커+모델+세부모델별 */
function inventoryCounts() {
  const m = new Map();
  const mm = new Map();
  const mms = new Map();
  for (const p of store.products || []) {
    if (p._deleted || p.status === 'deleted') continue;
    const mk = p.maker || '', md = p.model || '', sb = p.sub_model || '';
    if (mk) m.set(mk, (m.get(mk) || 0) + 1);
    if (mk && md) mm.set(`${mk}|${md}`, (mm.get(`${mk}|${md}`) || 0) + 1);
    if (mk && md && sb) mms.set(`${mk}|${md}|${sb}`, (mms.get(`${mk}|${md}|${sb}`) || 0) + 1);
  }
  return { m, mm, mms };
}

/** 메이커 목록 — 보유대수 우선 → 가나다 */
export function getCatalogMakers() {
  if (!_index) return [];
  const { m: counts } = inventoryCounts();
  const set = new Set();
  for (const c of Object.values(_index)) if (c.maker) set.add(c.maker);
  return [...set].sort((a, b) => {
    const ca = counts.get(a) || 0, cb = counts.get(b) || 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b, 'ko');
  });
}

/** 메이커의 모델(model_root) 목록 — 보유대수 우선 → 가나다 */
export function getCatalogModels(maker) {
  if (!maker || !_index) return [];
  const { mm: counts } = inventoryCounts();
  const set = new Set();
  for (const c of Object.values(_index)) {
    if (c.maker === maker && c.model_root) set.add(c.model_root);
  }
  return [...set].sort((a, b) => {
    const ca = counts.get(`${maker}|${a}`) || 0, cb = counts.get(`${maker}|${b}`) || 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b, 'ko');
  });
}

/** 메이커+모델의 세부모델 목록 — catalog title 에서 maker prefix 제거.
 *   반환: [{ id: catalog_id, sub: '올 뉴 K3 BD', title: '기아 올 뉴 K3 BD', year_start, year_end }] */
export function getCatalogSubModels(maker, model_root) {
  if (!maker || !model_root || !_index) return [];
  const out = [];
  for (const c of Object.values(_index)) {
    if (c.maker !== maker || c.model_root !== model_root) continue;
    out.push({
      id: c.id,
      sub: titleToSubModel(maker, c.title),
      title: c.title,
      year_start: c.year_start || '',
      year_end: c.year_end || '',
    });
  }
  // 최신 연식 우선 (year_start 내림차순) → sub 가나다
  out.sort((a, b) => {
    if (a.year_start && b.year_start && a.year_start !== b.year_start) {
      return b.year_start.localeCompare(a.year_start);
    }
    if (a.year_start && !b.year_start) return -1;
    if (!a.year_start && b.year_start) return 1;
    return a.sub.localeCompare(b.sub, 'ko');
  });
  return out;
}

/** catalog_id 의 트림 배열 — _index.json 의 trims 키 */
export function getCatalogTrims(catalog_id) {
  if (!catalog_id || !_index) return [];
  const c = _index[catalog_id];
  return Array.isArray(c?.trims) ? [...c.trims] : [];
}

/** maker + sub_model(=title-prefix) → catalog 역조회 */
export function findCatalogBySubModel(maker, sub_model) {
  if (!maker || !sub_model || !_index) return null;
  const target = sub_model.trim();
  for (const c of Object.values(_index)) {
    if (c.maker !== maker) continue;
    if (titleToSubModel(maker, c.title) === target) return c;
  }
  return null;
}

/** catalog_id → _index 항목 */
export function getCatalogById(catalog_id) {
  if (!catalog_id || !_index) return null;
  return _index[catalog_id] || null;
}
