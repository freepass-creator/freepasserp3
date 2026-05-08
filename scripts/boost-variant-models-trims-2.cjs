#!/usr/bin/env node
/**
 * 변형 모델 trim 보강 2탄:
 *  1) G70 슈팅브레이크: 동력원/배기량 누락 → 가솔린 2.0T 단일 (프리미엄/스포츠 패키지) — 한국은 2.0T만
 *  2) GV80 쿠페: 트림 키 정리 (등급=배기량 어색) + 5인승 명시 + 가격 보강
 *  3) 무쏘 EV: 트림 토큰 + 가격 보강 (STD/DLX 공식명)
 *  4) 토레스 EVX: 트림명 정정 (T7/V7/X7 → E5/E7) + 가격 보강
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

// 1) G70 슈팅브레이크
{
  const { fp, d } = loadFlat('genesis_g70_st.json');
  const oldTrims = d.trims || {};
  const baseSt   = preserveTrim(oldTrims['스탠다드 가솔린'] || Object.values(oldTrims)[0] || {});
  const baseSp   = preserveTrim(oldTrims['스포츠 가솔린'] || oldTrims['스포츠 프레스티지 가솔린'] || baseSt);
  d.trims = {
    '프리미엄 가솔린 2.0 T':       { price: { base: 43100000 }, basic: baseSt.basic.slice(), select_groups: baseSt.select_groups.slice() },
    '스포츠 패키지 가솔린 2.0 T':  { price: { base: 47030000 }, basic: baseSp.basic.slice(), select_groups: baseSp.select_groups.slice() },
  };
  RESULTS.push({ fp, d, title: d.title, trims: d.trims });
}

// 2) GV80 쿠페
{
  const { fp, d } = loadFlat('genesis_gv80_coupe.json');
  const oldTrims = d.trims || {};
  const base25   = preserveTrim(oldTrims['2.5 T 가솔린'] || Object.values(oldTrims)[0] || {});
  const base35   = preserveTrim(oldTrims['3.5 T 가솔린'] || oldTrims['3.5 T 스포츠 패키지 가솔린'] || base25);
  const baseEsc  = preserveTrim(oldTrims['3.5 T 스포츠 플러스 패키지 가솔린'] || base35);
  d.trims = {
    '가솔린 2.5 T':         { price: { base: 81900000 }, basic: base25.basic.slice(), select_groups: base25.select_groups.slice() },
    '가솔린 3.5 T':         { price: { base: 84300000 }, basic: base35.basic.slice(), select_groups: base35.select_groups.slice() },
    'e-SC 가솔린 3.5 T':   { price: { base: 90550000 }, basic: baseEsc.basic.slice(), select_groups: baseEsc.select_groups.slice() },
  };
  RESULTS.push({ fp, d, title: d.title, trims: d.trims });
}

// 3) 무쏘 EV O100
{
  const { fp, d } = loadFlat('kgm_musso_ev_o100.json');
  const oldTrims = d.trims || {};
  const baseStd  = preserveTrim(oldTrims['스탠다드 EV'] || Object.values(oldTrims)[0] || {});
  const baseDlx  = preserveTrim(oldTrims['프레스티지 EV'] || baseStd);
  d.trims = {
    'STD EV': { price: { base: 48000000 }, basic: baseStd.basic.slice(), select_groups: baseStd.select_groups.slice() },
    'DLX EV': { price: { base: 50500000 }, basic: baseDlx.basic.slice(), select_groups: baseDlx.select_groups.slice() },
  };
  RESULTS.push({ fp, d, title: d.title, trims: d.trims });
}

// 4) 토레스 EVX
{
  const { fp, d } = loadFlat('kgm_torres_evx.json');
  const oldTrims = d.trims || {};
  const baseT7   = preserveTrim(oldTrims['T7 EV'] || Object.values(oldTrims)[0] || {});
  const baseV7   = preserveTrim(oldTrims['V7 EV'] || baseT7);
  d.trims = {
    'E5 EV': { price: { base: 45500000 }, basic: baseT7.basic.slice(), select_groups: baseT7.select_groups.slice() },
    'E7 EV': { price: { base: 47600000 }, basic: baseV7.basic.slice(), select_groups: baseV7.select_groups.slice() },
  };
  RESULTS.push({ fp, d, title: d.title, trims: d.trims });
}

console.log('=== 변형 모델 trim 보강 2탄 ===');
for (const r of RESULTS) {
  console.log('\n[' + r.title + '] (' + Object.keys(r.trims).length + '개)');
  for (const [k, t] of Object.entries(r.trims)) {
    console.log('   • ' + k + ' — ' + (t.price.base/10000).toLocaleString() + '만원');
  }
  if (APPLY) fs.writeFileSync(r.fp, JSON.stringify(r.d, null, 2));
}
console.log('\n' + (APPLY ? '✓ 적용' : '(dry-run)') + ': ' + RESULTS.length + '개 catalog');
