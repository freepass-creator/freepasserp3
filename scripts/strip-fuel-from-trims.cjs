#!/usr/bin/env node
/**
 * trim 키에서 동력원 토큰 제거 (catalog title 에 이미 동력원 명시되어 있어 중복).
 *
 * 변경 예:
 *  - "프리미엄 하이브리드 1.6" → "프리미엄 1.6"
 *  - "노블레스 가솔린 3.5 9인승" → "노블레스 3.5 9인승"
 *  - "익스클루시브 EV 5인승" → "익스클루시브 5인승"
 *  - "프리미엄 LPG 2.0" → "프리미엄 2.0"
 *
 * 한국 OEM 만 대상.
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const FUEL_RE = /\s*(?:가솔린|디젤|LPG|LPi|하이브리드|HEV|EV|일렉트릭|수소|플러그인하이브리드|PHEV)\s*/g;

function stripFuel(trimKey) {
  return trimKey.replace(FUEL_RE, ' ').replace(/\s+/g, ' ').trim();
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalRenamed = 0;

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const oldTrims = d.trims || {};
  if (!Object.keys(oldTrims).length) continue;

  const newTrims = {};
  let changed = 0;
  const dups = new Set();
  for (const [k, v] of Object.entries(oldTrims)) {
    const newK = stripFuel(k);
    if (newK === k) {
      newTrims[k] = v;
      continue;
    }
    if (newTrims[newK]) {
      // 중복 발생 → 원본 키 유지
      newTrims[k] = v;
      dups.add(newK);
      continue;
    }
    newTrims[newK] = v;
    changed++;
  }
  if (changed > 0) {
    d.trims = newTrims;
    if (APPLY) fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 2));
    if (dups.size) console.log('  ! [' + d.title + '] 중복 키로 인해 ' + dups.size + '개 trim 그대로 유지');
    console.log((APPLY ? '✓' : '+') + ' ' + d.title + ' — ' + changed + '개 trim 키 정리');
    totalRenamed += changed;
    touched++;
  }
}
console.log('\n=== ' + (APPLY ? '적용' : 'dry-run') + ': ' + touched + '개 catalog · ' + totalRenamed + '개 trim 키 동력원 제거 ===');
