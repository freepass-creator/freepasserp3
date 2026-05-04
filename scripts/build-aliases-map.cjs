#!/usr/bin/env node
/**
 * catalog json 의 aliases 필드를 모아 sub_model → catalog_id lookup 맵 생성.
 *  encar-master-seed 의존성 0 — catalog 데이터만 source of truth.
 *
 * 출력: public/data/car-master/_aliases-map.json
 *  형식: { "maker|sub_normalized": "catalog_id", ... }
 *
 * 사용:
 *   node scripts/build-aliases-map.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const OUTPUT = path.join(CATALOG_DIR, '_aliases-map.json');
const OUTPUT_YEARS = path.join(CATALOG_DIR, '_year-ranges.json');

const map = {};
const yearRanges = {};   // catalog_id → { start, end }  (YM 형식)
let totalAliases = 0;
let conflicts = 0;

const files = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'));

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const cid = data.catalog_id || f.replace('.json', '');
  const maker = data.maker;
  const aliases = Array.isArray(data.aliases) ? data.aliases : [];

  // year range
  if (data.year_start || data.year_end) {
    yearRanges[cid] = { start: data.year_start || '', end: data.year_end || '' };
  }

  if (!maker || !aliases.length) continue;
  for (const alias of aliases) {
    if (!alias) continue;
    const key = `${maker}|${alias}`;
    if (map[key] && map[key] !== cid) {
      console.warn(`⚠ 충돌: "${key}" 기존 ${map[key]} vs 신규 ${cid} (기존 유지)`);
      conflicts++;
      continue;
    }
    map[key] = cid;
    totalAliases++;
  }
}

const sorted = {};
for (const k of Object.keys(map).sort()) sorted[k] = map[k];

fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2));
console.log(`✓ aliases→catalog 매핑 ${Object.keys(sorted).length}개 생성 (${files.length}개 catalog 처리)`);
if (conflicts) console.log(`  충돌: ${conflicts}건`);
console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);

// year ranges
const yrSorted = {};
for (const k of Object.keys(yearRanges).sort()) yrSorted[k] = yearRanges[k];
fs.writeFileSync(OUTPUT_YEARS, JSON.stringify(yrSorted, null, 2));
console.log(`✓ year-ranges ${Object.keys(yrSorted).length}개 생성 → ${path.relative(process.cwd(), OUTPUT_YEARS)}`);
