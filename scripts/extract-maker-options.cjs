#!/usr/bin/env node
/**
 * 모든 catalog 의 options 사전을 메이커별로 통합 → 마스터 옵션 사전 생성.
 *
 *  출력: public/data/car-master/_maker-options.json
 *   {
 *     "현대": {
 *       "옵션명1": { fp_ids: ['NAVIGATION'], used_in: 12, codes: ['KRDL...', 'KRPS...'] },
 *       ...
 *     },
 *     "기아": { ... },
 *     ...
 *   }
 *
 *  - 같은 옵션명이 여러 catalog/code 로 흩어진 거 통합
 *  - FP_KEYWORD_RULES 기반 표준옵션 매핑 자동 부여
 *  - used_in: 이 옵션을 쓰는 catalog 수 (인기도)
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');

// FP_KEYWORD_RULES 파싱
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const RULES = [];
const ruleRe = /\{\s*kw:\s*['"]([^'"]+)['"]\s*,\s*ids:\s*\[([^\]]+)\]\s*\}/g;
let m;
while ((m = ruleRe.exec(rulesSrc)) !== null) {
  const kw = m[1];
  const ids = m[2].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  RULES.push({ kw, ids });
}
// 긴 키워드 우선 매칭
RULES.sort((a, b) => b.kw.length - a.kw.length);

function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '')
    .replace(/\s+/g, '');
}
function matchFp(name) {
  const n = normName(name);
  const idsSet = new Set();
  for (const { kw, ids } of RULES) {
    if (n.includes(normName(kw))) {
      for (const id of ids) idsSet.add(id);
    }
  }
  return [...idsSet];
}

// catalog 순회
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const byMaker = {};

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const maker = d.maker;
  if (!maker) continue;
  if (!byMaker[maker]) byMaker[maker] = {};
  const bag = byMaker[maker];
  const cid = d.catalog_id || f;

  const opts = d.options || {};
  for (const [code, info] of Object.entries(opts)) {
    const name = info?.name;
    if (!name) continue;
    const cat = info?.category || '';
    if (!bag[name]) bag[name] = {
      fp_ids: new Set(matchFp(name)),
      used_in: new Set(),
      used_as_basic: 0,
      used_as_select: 0,
      codes: new Set(),
      categories: new Set(),
    };
    bag[name].used_in.add(cid);
    bag[name].codes.add(code);
    if (cat) bag[name].categories.add(cat);
  }
  // basic / select 분류 — trim 별로 카운트
  const trims = d.trims || {};
  for (const trim of Object.values(trims)) {
    const basicCodes = Array.isArray(trim?.basic) ? trim.basic : [];
    const selectCodes = Array.isArray(trim?.select) ? trim.select : [];
    const groupCodes = (Array.isArray(trim?.select_groups) ? trim.select_groups : [])
      .flatMap(g => [...(Array.isArray(g?.codes) ? g.codes : []), ...(Array.isArray(g?.items) ? g.items : [])]);
    for (const code of basicCodes) {
      const name = opts[code]?.name;
      if (name && bag[name]) bag[name].used_as_basic++;
    }
    for (const code of [...selectCodes, ...groupCodes]) {
      const name = opts[code]?.name;
      if (name && bag[name]) bag[name].used_as_select++;
    }
  }
}

// 정리 + 저장
const out = {};
let totalOptions = 0;
let mappedOptions = 0;
for (const maker of Object.keys(byMaker).sort((a, b) => a.localeCompare(b, 'ko'))) {
  const bag = byMaker[maker];
  const sorted = Object.keys(bag).sort((a, b) => bag[b].used_in.size - bag[a].used_in.size);
  out[maker] = {};
  for (const name of sorted) {
    const v = bag[name];
    const fpIds = [...v.fp_ids];
    out[maker][name] = {
      fp_ids: fpIds,
      used_in: v.used_in.size,
      used_as_basic: v.used_as_basic,
      used_as_select: v.used_as_select,
      codes: [...v.codes].sort(),
      categories: [...v.categories],
    };
    totalOptions++;
    if (fpIds.length) mappedOptions++;
  }
}

const outPath = path.join(CATALOG_DIR, '_maker-options.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`✓ ${path.relative(process.cwd(), outPath)} 생성`);
console.log(`  메이커 ${Object.keys(out).length}개`);
console.log(`  unique 옵션 ${totalOptions}개`);
console.log(`  FP 매핑 ${mappedOptions}/${totalOptions} (${(mappedOptions / totalOptions * 100).toFixed(1)}%)`);
console.log('');
// 메이커별 통계
for (const maker of ['현대', '기아', '제네시스', 'KGM']) {
  if (!out[maker]) continue;
  const opts = out[maker];
  const total = Object.keys(opts).length;
  const mapped = Object.values(opts).filter(o => o.fp_ids.length).length;
  console.log(`  ${maker.padEnd(8)} ${total.toString().padStart(4)}개 (FP 매핑 ${mapped})`);
}
