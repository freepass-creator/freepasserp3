#!/usr/bin/env node
/**
 * 그랜저 IG pre (페리 전) 가솔린 catalog 트림별 매핑.
 *  IG 페리 매핑 base 로 trim 등급 매핑 (Modern→base 80% / Premium→Premium / Exclusive Special→Exclusive / Celebrity→Calligraphy).
 *  LPi 트림 = 가솔린 동급 trim - 가솔린 엔진 코드 + LPG 코드.
 *
 *  주의: IG pre 의 실제 옵션은 IG 페리보다 적음 (페리 전, 9 에어백/17인치 등).
 *        catalog 옵션 사전이 GN7 기준이라 정확하지 않음. 향후 IG pre 가격표 정확 OCR 후 보정 필요.
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_ig_pre.json');
const IG_FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_ig.json');

const d = JSON.parse(fs.readFileSync(FP, 'utf8'));
const ig = JSON.parse(fs.readFileSync(IG_FP, 'utf8'));

// IG pre 트림 → IG 페리 base trim 매핑
// Modern (base) — IG 페리 프리미엄의 일부 (페리 전이라 옵션 적음)
// Premium (mid-low) — IG 페리 프리미엄 정도
// Exclusive Special (mid-high) — IG 페리 익스클루시브 정도
// Celebrity (top, 가솔린 3.3) — IG 페리 캘리그래피 정도
// LPi 트림 = 가솔린 동급 + LPG 동력
const ENGINE_GAS_25 = ['GN03001'];
const ENGINE_GAS_33 = ['GN03001'];  // catalog 에 가솔린 3.3 별도 없으면 가솔린 2.5 코드 그대로
const ENGINE_LPG_30 = ['GN03011', 'GN03012'];

// IG pre 의 Modern 은 IG 페리 프리미엄에서 디지털 키 / 1열 통풍 / 무선 충전 등 제외 (페리 전이라)
const IG_PRE_REMOVE_FROM_PREMIUM = [
  'GN03106',  // 디지털 키 2 (페리 전 없음)
  'GN03107',  // 무선 충전 (페리 전 없음)
  'GN03108',  // 지문 인증 (페리 전 없음)
];

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

const igPrem = ig.trims['프리미엄 가솔린 2.5']?.basic || [];
const igExcl = ig.trims['익스클루시브 가솔린 2.5']?.basic || [];
const igCal = ig.trims['캘리그래피 가솔린 2.5']?.basic || [];

// IG pre Modern = IG 페리 프리미엄의 75% (페리 전 base)
function makeModern() {
  return igPrem.filter(c => !IG_PRE_REMOVE_FROM_PREMIUM.includes(c));
}
function makePremiumPre() {
  return igPrem;  // IG 페리 프리미엄과 동일
}
function makeExclSpecial() {
  return igExcl;  // IG 페리 익스클루시브와 동일
}
function makeCelebrity() {
  return igCal;  // IG 페리 캘리그래피와 동일
}

function withEngine(codes, addCodes, removeCodes) {
  return [...new Set(codes.filter(c => !removeCodes.includes(c)).concat(addCodes))];
}

const trimMap = {
  '모던 가솔린 2.4/3.0': withEngine(makeModern(), ENGINE_GAS_25, []),
  '프리미엄 가솔린 2.4/3.0': withEngine(makePremiumPre(), ENGINE_GAS_25, []),
  '익스클루시브 스페셜 가솔린 2.4/3.0': withEngine(makeExclSpecial(), ENGINE_GAS_25, []),
  '셀러브리티 가솔린 3.3': withEngine(makeCelebrity(), ENGINE_GAS_33, []),
  '모던 LPi 3.0': withEngine(makeModern(), ENGINE_LPG_30, ENGINE_GAS_25),
  '익스클루시브 LPi 3.0': withEngine(makeExclSpecial(), ENGINE_LPG_30, ENGINE_GAS_25),
  '익스클루시브 스페셜 LPi 3.0': withEngine(makeExclSpecial(), ENGINE_LPG_30, ENGINE_GAS_25),
};

console.log(`옵션 사전 동기화: ${added}개`);
console.log('\n=== 트림별 basic 옵션 수 ===');
for (const [name, codes] of Object.entries(trimMap)) {
  const valid = codes.filter(c => d.options[c]);
  console.log(`  ${name}: ${valid.length}개`);
}

if (APPLY) {
  for (const [name, codes] of Object.entries(trimMap)) {
    if (d.trims[name]) d.trims[name].basic = codes.filter(c => d.options[c]);
  }
  fs.writeFileSync(FP, JSON.stringify(d, null, 2));
  console.log('\n✓ 적용');
}
