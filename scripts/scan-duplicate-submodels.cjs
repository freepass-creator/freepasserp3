#!/usr/bin/env node
/**
 * catalog 1개에 encar sub 명이 서로 다른 여러 encar key 가 매핑되는 경우를 스캔.
 * migration 후 같은 sub_model 이름을 가진 vehicle_master row 가 다수 생기는 케이스를 찾음.
 *
 * 사례: kia_sportage_nq5 → encar_002_025_180 ("더 뉴 스포티지 5세대") + encar_002_025_181 ("더 뉴 스포티지 5세대 하이브리드")
 *  → migration 후 둘 다 "더 뉴 스포티지 NQ5" 로 rename → dropdown 에 2개 entry
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CAR_MASTER = path.join(ROOT, 'public', 'data', 'car-master', '_index.json');
const ENCAR_SEED = path.join(ROOT, 'public', 'data', 'encar-master-seed.js');

const catIndex = JSON.parse(fs.readFileSync(CAR_MASTER, 'utf-8'));

// encar-seed.js 는 ESM `export default` — 배열 부분만 따와서 eval 로 평가
const encarRaw = fs.readFileSync(ENCAR_SEED, 'utf-8');
const arrStart = encarRaw.indexOf('[');
const arrEnd = encarRaw.lastIndexOf(']');
const arr = eval('(' + encarRaw.slice(arrStart, arrEnd + 1) + ')');
const encarMap = {};
for (const e of arr) encarMap[e._key] = { sub: e.sub, production_start: e.production_start };
console.log(`encar entries 파싱: ${Object.keys(encarMap).length}개\n`);

const issues = [];
for (const [cid, entry] of Object.entries(catIndex)) {
  const enKeys = (entry.source && entry.source.encar) || [];
  if (enKeys.length < 2) continue;
  const subs = enKeys.map(k => ({ key: k, ...(encarMap[k] || { sub: '?(missing)', production_start: '' }) }));
  const distinctSubs = new Set(subs.map(s => s.sub));
  if (distinctSubs.size < 2) continue;  // 모두 같은 sub → migration 후에도 1개 row 만 남으니 OK

  // 카탈로그 title 에서 standardSub 추출 (제조사 prefix 제거)
  const maker = entry.maker || '';
  const standardSub = (entry.title || '').replace(new RegExp('^' + maker + '\\s+'), '').trim();
  issues.push({ cid, title: entry.title, standardSub, subs });
}

console.log(`■ catalog 1개에 서로 다른 encar sub 가 매핑된 케이스: ${issues.length}개\n`);
for (const it of issues) {
  console.log(`▶ ${it.cid}  (title="${it.title}")`);
  console.log(`  → migration 후 standardSub = "${it.standardSub}"`);
  for (const s of it.subs) {
    console.log(`    - ${s.key}  sub="${s.sub}"  production_start="${s.production_start}"`);
  }
  console.log('');
}

console.log(`총 ${issues.length}개 카탈로그에서 dropdown 중복 발생 가능성`);
