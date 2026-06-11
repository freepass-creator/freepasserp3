/**
 * ssot-source.js — 차종마스터 SSOT 매칭 인덱스 (온라인)
 *
 * GitHub(freepass-creator/vehicle-master) 의 매칭 전용 슬림 인덱스(match-index.json)를
 * 가져와 vehicle-matcher.js 의 buildVehicleIndex/ matchVehicle 가 쓰는 엔트리 형태로 변환.
 *
 *  - 엔카 기반 1,803 세부모델 = 전 세대(구형 포함) 커버 → 연식 기반 세대 매칭이 catalog(403, 신차위주)보다 강함.
 *  - 엔트리: { maker, model, sub_model(코드통일), gen_code, year_start, year_end, title, status, variants, trims }
 */
const MATCH_URL = 'https://raw.githubusercontent.com/freepass-creator/vehicle-master/main/dist/match-index.json';
const MANIFEST_URL = 'https://raw.githubusercontent.com/freepass-creator/vehicle-master/main/dist/manifest.json';
const CACHE_KEY = 'ssot_match_index_v1';
const ORIGIN_KEY = 'ssot_maker_origin_v1';   // { maker: '국산'|'수입' }

let _entries = null;
let _version = null;

function toEntries(data) {
  return (data.entries || []).map(e => ({
    maker: e.maker,
    model: e.model,
    sub_model: e.sub_model,
    gen_code: e.gen_code || '',
    year_start: e.year_start || '',
    year_end: e.year_end || '현재',
    title: e.title || `${e.maker} ${e.sub_model}`,
    origin: e.origin || '',
    status: 'active',
    source: 'ssot',
    variants: e.variants || [],
    trims: e.trims || [],
  }));
}

/** SSOT 매칭 엔트리 로드 (메모리 + localStorage 버전 캐시) */
export async function loadSsotEntries({ force = false } = {}) {
  if (_entries && !force) return _entries;

  let version = null;
  try { version = (await fetch(MANIFEST_URL, { cache: 'no-store' }).then(r => r.json()))?.version; } catch {}

  if (!force && version) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.version === version && Array.isArray(c.entries)) {
        _entries = toEntries({ entries: c.entries }); _version = version; return _entries;
      }
    } catch {}
  }

  const data = await fetch(MATCH_URL, { cache: 'no-store' }).then(r => r.json());
  _entries = toEntries(data);
  _version = data.version || version;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: _version, entries: data.entries })); } catch {}
  cacheMakerOrigin();
  return _entries;
}

/** 제조사 → 국산/수입 맵을 localStorage 캐시 (데이터 기반 — 하드코딩 패턴 대체) */
function cacheMakerOrigin() {
  const map = {};
  for (const e of _entries || []) if (e.maker && e.origin) map[e.maker] = e.origin;
  try { localStorage.setItem(ORIGIN_KEY, JSON.stringify(map)); } catch {}
}

/** 동기 — 캐시된 제조사 origin 맵 { maker: '국산'|'수입' }. 없으면 {} */
export function getCachedMakerOrigin() {
  try { return JSON.parse(localStorage.getItem(ORIGIN_KEY) || '{}'); } catch { return {}; }
}

export function ssotVersion() { return _version; }
