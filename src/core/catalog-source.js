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

/** 국산 메이커 인기순 우선 + 수입 메이커 인기순 + 가나다 */
const KOR_MAKER_RANK = ['현대', '기아', '제네시스', 'KGM', '쌍용', '쉐보레', '한국GM', 'GM대우', '르노', '르노삼성', '대우'];
const FOREIGN_MAKER_RANK = ['BMW', '벤츠', '아우디', '테슬라', '렉서스', '미니', '볼보', '폭스바겐', '포르쉐', '랜드로버', '재규어', '포드', '지프', '도요타', '토요타', '닛산', '혼다', '인피니티', '캐딜락', '링컨', '크라이슬러', '마세라티', '페라리', '람보르기니', '벤틀리', '롤스로이스', '맥라렌', '애스턴마틴', '부가티'];

/** 메이커 목록 — 국산 인기순 → 수입 인기순 → 가나다 */
export function getCatalogMakers() {
  if (!_index) return [];
  const set = new Set();
  for (const c of Object.values(_index)) if (c.maker) set.add(c.maker);
  return [...set].sort((a, b) => {
    const ak = KOR_MAKER_RANK.indexOf(a), bk = KOR_MAKER_RANK.indexOf(b);
    const aIsKor = ak >= 0, bIsKor = bk >= 0;
    if (aIsKor !== bIsKor) return aIsKor ? -1 : 1;       // 국산 우선
    if (aIsKor) return ak - bk;                            // 국산 인기순
    const af = FOREIGN_MAKER_RANK.indexOf(a), bf = FOREIGN_MAKER_RANK.indexOf(b);
    const aIsKnown = af >= 0, bIsKnown = bf >= 0;
    if (aIsKnown !== bIsKnown) return aIsKnown ? -1 : 1;
    if (aIsKnown) return af - bf;                          // 수입 인기순
    return a.localeCompare(b, 'ko');                       // 그 외 가나다
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
  // 정렬: ① year_start 내림차순 (최신 먼저)
  //       ② 동일 시점에선 fuel 일반(0) → 하이브리드(1) → EV(2) 순
  //       ③ 같은 fuel 내에선 sub 가나다
  const fuelRank = (t) => {
    if (/일렉트리파이드|electrified|일렉트릭|electric|\bev\b/i.test(t)) return 2;
    if (/하이브리드|hybrid|hev/i.test(t)) return 1;
    return 0;
  };
  out.sort((a, b) => {
    if (a.year_start && b.year_start && a.year_start !== b.year_start) {
      return b.year_start.localeCompare(a.year_start);
    }
    if (a.year_start && !b.year_start) return -1;
    if (!a.year_start && b.year_start) return 1;
    const ar = fuelRank(a.title || a.sub), br = fuelRank(b.title || b.sub);
    if (ar !== br) return ar - br;
    return a.sub.localeCompare(b.sub, 'ko');
  });
  return out;
}

/** catalog_id 의 트림 배열 — 가격순 (trims_meta 의 price.base 오름차순), 가격 없는 trim 은 뒤로 */
export function getCatalogTrims(catalog_id) {
  if (!catalog_id || !_index) return [];
  const c = _index[catalog_id];
  const trims = Array.isArray(c?.trims) ? c.trims : [];
  const meta = c?.trims_meta || {};
  return [...trims].sort((a, b) => {
    const pa = meta[a] || 0, pb = meta[b] || 0;
    if (pa && pb) return pa - pb;        // 둘 다 가격 있음 → 오름차순
    if (pa && !pb) return -1;             // 가격 있는 게 먼저
    if (!pa && pb) return 1;
    return 0;                             // 둘 다 없으면 원래 순서 유지
  });
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
