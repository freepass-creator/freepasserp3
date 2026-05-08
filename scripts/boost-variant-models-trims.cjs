#!/usr/bin/env node
/**
 * 변형 모델 catalog trim 보강 (4개):
 *  1) 아반떼 N CN7: LPi 1.6 토큰 오류 → 2.0T 가솔린 단일 (6MT / 8DCT 분리)
 *  2) 아이오닉5 N NE: 등급 분리 오류 → 단일 EV 트림
 *  3) 일렉트리파이드 G80: 가솔린 토큰 오류 → EV
 *  4) 일렉트리파이드 GV70: 가솔린 토큰 오류 → EV
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

function loadFlat(name) {
  const fp = path.join(DIR, name);
  return { fp, d: JSON.parse(fs.readFileSync(fp, 'utf8')) };
}

function preserveTrim(t) {
  return { basic: (t?.basic||[]).slice(), select_groups: (t?.select_groups||[]).slice() };
}

const RESULTS = [];

// 1) 아반떼 N CN7
{
  const { fp, d } = loadFlat('hyundai_avante_n.json');
  const oldTrims = d.trims || {};
  const baseN = oldTrims['N 가솔린 1.6'] || Object.values(oldTrims)[0] || {};
  const preserved = preserveTrim(baseN);
  d.trims = {
    'N 6MT 가솔린 2.0 T':  { price: { base: 33090000 }, basic: preserved.basic.slice(), select_groups: preserved.select_groups.slice() },
    'N 8DCT 가솔린 2.0 T': { price: { base: 34090000 }, basic: preserved.basic.slice(), select_groups: preserved.select_groups.slice() },
  };
  RESULTS.push({ fp, d, title: d.title, trims: d.trims });
}

// 2) 아이오닉5 N NE
{
  const { fp, d } = loadFlat('hyundai_ioniq5_n.json');
  const oldTrims = d.trims || {};
  const base = oldTrims['아이오닉 5 N 가솔린'] || Object.values(oldTrims)[0] || {};
  const preserved = preserveTrim(base);
  d.trims = {
    'N AWD EV': { price: { base: 85000000 }, basic: preserved.basic, select_groups: preserved.select_groups },
  };
  RESULTS.push({ fp, d, title: d.title, trims: d.trims });
}

// 3) 일렉트리파이드 G80
{
  const { fp, d } = loadFlat('genesis_g80_e.json');
  const oldTrims = d.trims || {};
  const base = Object.values(oldTrims)[0] || {};
  const preserved = preserveTrim(base);
  d.trims = {
    'AWD EV': { price: { base: 89190000 }, basic: preserved.basic, select_groups: preserved.select_groups },
  };
  RESULTS.push({ fp, d, title: d.title, trims: d.trims });
}

// 4) 일렉트리파이드 GV70
{
  const { fp, d } = loadFlat('genesis_gv70_e.json');
  const oldTrims = d.trims || {};
  const base = Object.values(oldTrims)[0] || {};
  const preserved = preserveTrim(base);
  d.trims = {
    'AWD EV': { price: { base: 78090000 }, basic: preserved.basic, select_groups: preserved.select_groups },
  };
  RESULTS.push({ fp, d, title: d.title, trims: d.trims });
}

console.log('=== 변형 모델 trim 보강 ===');
for (const r of RESULTS) {
  console.log('\n[' + r.title + '] (' + Object.keys(r.trims).length + '개)');
  for (const [k, t] of Object.entries(r.trims)) {
    console.log('   • ' + k + ' — ' + (t.price.base/10000).toLocaleString() + '만원');
  }
  if (APPLY) fs.writeFileSync(r.fp, JSON.stringify(r.d, null, 2));
}
console.log('\n' + (APPLY ? '✓ 적용' : '(dry-run)') + ': ' + RESULTS.length + '개 catalog');
