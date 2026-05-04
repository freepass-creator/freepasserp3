#!/usr/bin/env node
/**
 * encar 매물 sub_model → catalog_id 직접 lookup 맵 생성.
 * _index.json 의 source.encar 배열 + encar-master-seed.js 의 sub 를 cross-ref.
 *
 * 출력: public/data/car-master/_encar-catalog-map.json
 *  형식: { "maker|sub_model_normalized": "catalog_id", ... }
 *
 * matching engine (src/core/vehicle-matrix.js findCatalog) 이 첫 번째 lookup 으로 사용.
 * 직접 매핑이 있으면 score-based matching 건너뛰고 high confidence 로 즉시 반환.
 *
 * 사용:
 *   node scripts/build-encar-catalog-map.cjs
 */
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '..', 'public', 'data', 'car-master', '_index.json');
const ENCAR_PATH = path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.js');
const OUTPUT = path.join(__dirname, '..', 'public', 'data', 'car-master', '_encar-catalog-map.json');

// encar-master-seed.js 파싱 — `window.ENCAR_MASTER = [...];` 형식
function loadEncarMaster() {
  const raw = fs.readFileSync(ENCAR_PATH, 'utf8');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('encar-master 배열 못 찾음');
  return JSON.parse(raw.slice(start, end + 1));
}

function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '')
    .replace(/\s+/g, '');
}

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const encar = loadEncarMaster();

// encar key → entry 빠른 lookup
const encarByKey = new Map();
for (const e of encar) {
  if (e?._key) encarByKey.set(e._key, e);
}

// catalog → encar entries → maker|sub_model 키
const map = {};
let hits = 0;
let misses = 0;

for (const [catalogId, entry] of Object.entries(index)) {
  const encarKeys = entry?.source?.encar || [];
  if (!Array.isArray(encarKeys) || !encarKeys.length) continue;
  for (const ek of encarKeys) {
    const e = encarByKey.get(ek);
    if (!e) { misses++; continue; }
    const maker = e.maker;
    const sub = e.sub || e.car_name;
    if (!maker || !sub) continue;
    const key = `${maker}|${normName(sub)}`;
    if (map[key] && map[key] !== catalogId) {
      console.warn(`⚠ 충돌: "${key}" → 기존 ${map[key]} vs 신규 ${catalogId} (기존 유지)`);
      continue;
    }
    map[key] = catalogId;
    hits++;
  }
}

// 미매핑 encar entry → 휴리스틱으로 가장 가까운 catalog 에 자동 매핑.
//  같은 maker, 같은 model, sub 가 catalog title 에 substring 으로 포함되면 매핑.
//  예: "카니발 4세대" → "기아 더 뉴 카니발 KA4" (둘 다 "카니발" 포함, 모델 "카니발" 일치)
let autoHits = 0;
const titleCandidatesByMaker = new Map();   // maker → [{ catalogId, title, model }]
for (const [catalogId, entry] of Object.entries(index)) {
  if (!entry?.maker) continue;
  if (!titleCandidatesByMaker.has(entry.maker)) titleCandidatesByMaker.set(entry.maker, []);
  titleCandidatesByMaker.get(entry.maker).push({ catalogId, title: entry.title || '', maker: entry.maker });
}

for (const e of encar) {
  if (!e?.maker || !e?.sub || !e?.model) continue;
  if (e.archived) continue;
  const key = `${e.maker}|${normName(e.sub)}`;
  if (map[key]) continue;   // 이미 매핑됨

  // 같은 maker 카탈로그 중 model 이 sub 에 포함된 것 찾기
  const subN = normName(e.sub);
  const mdN = normName(e.model);
  const cands = titleCandidatesByMaker.get(e.maker) || [];
  // 점수 — 카탈로그 title 토큰이 sub 또는 model 에 매칭되는지
  let best = null, bestScore = 0;
  for (const c of cands) {
    const titleNoMaker = c.title.replace(new RegExp('^' + e.maker + '\\s+'), '').trim();
    const titleN = normName(titleNoMaker);
    let score = 0;
    // model 매칭 — sub 에 model 단어가 있어야 같은 모델 카탈로그
    if (subN.includes(mdN) && titleN.includes(mdN)) score += mdN.length * 2;
    // 추가 토큰 매칭
    const tokens = titleNoMaker.split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      const tn = normName(t);
      if (!tn || tn === mdN) continue;
      if (subN.includes(tn)) score += tn.length;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  // 최소 점수 (model + 1 토큰) 충족 시 매핑
  if (best && bestScore >= mdN.length * 2) {
    map[key] = best.catalogId;
    autoHits++;
  }
}

// 정렬 (가독성)
const sorted = {};
for (const k of Object.keys(map).sort()) sorted[k] = map[k];

fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2));
console.log(`✓ encar→catalog 매핑 ${Object.keys(sorted).length}개 생성`);
console.log(`  명시 매핑: ${hits} / 자동 휴리스틱: ${autoHits} / encar key 누락: ${misses}`);
console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);
