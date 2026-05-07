#!/usr/bin/env node
/**
 * 그랜저 IG 페리 후 하이브리드 (ig_163) — 페리 가솔린 매핑 기반 + 하이브리드 동력원.
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_ig_163.json');
const IG_GAS_FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_ig.json');

const d = JSON.parse(fs.readFileSync(FP, 'utf8'));
const ig = JSON.parse(fs.readFileSync(IG_GAS_FP, 'utf8'));

// IG 페리 하이브리드 트림 → IG 페리 가솔린 base
const TRIM_BASE = {
  '프리미엄 하이브리드 2.4': '프리미엄 가솔린 2.5',
  '익스클루시브 하이브리드 2.4': '익스클루시브 가솔린 2.5',
  '캘리그래피 하이브리드 2.4': '캘리그래피 가솔린 2.5',
};

// 가솔린 2.5 엔진 → 하이브리드 동력원으로 교체
const REMOVE = ['GN03001'];  // 스마트스트림 가솔린 2.5 엔진 제거

// 옵션 사전 동기화
let added = 0;
for (const [code, info] of Object.entries(ig.options || {})) {
  if (!d.options[code]) {
    d.options[code] = JSON.parse(JSON.stringify(info));
    added++;
    if (info.category) {
      if (!d.categories[info.category]) d.categories[info.category] = [];
      if (!d.categories[info.category].includes(code)) d.categories[info.category].push(code);
    }
  }
}

const trimMap = {};
for (const [hyTrim, gasTrim] of Object.entries(TRIM_BASE)) {
  const gasT = ig.trims[gasTrim];
  if (!gasT) continue;
  const codes = (gasT.basic || []).filter(c => !REMOVE.includes(c));
  trimMap[hyTrim] = codes.filter(c => d.options[c]);
}

console.log(`옵션 사전 동기화: ${added}개`);
console.log('\n=== 트림별 basic 옵션 수 ===');
for (const [name, codes] of Object.entries(trimMap)) {
  console.log(`  ${name}: ${codes.length}개`);
}

if (APPLY) {
  for (const [name, codes] of Object.entries(trimMap)) {
    if (d.trims[name]) d.trims[name].basic = codes;
  }
  fs.writeFileSync(FP, JSON.stringify(d, null, 2));
  console.log('\n✓ 적용');
}
