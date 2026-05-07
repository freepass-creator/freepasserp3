#!/usr/bin/env node
/**
 * 그랜저 IG 페이스리프트 가솔린 catalog 트림별 정확 매핑.
 *  catalog 옵션 사전이 GN7 와 같은 GN03* 코드 사용.
 *  GN7 가솔린 매핑을 base 로 IG 페리 (가솔린 2.5 단일) 적용.
 *  cumulative: 프리미엄 → 익스클루시브 → 캘리그래피, 르블랑 = 익스클루시브 + 디자인 디테일
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_ig.json');
const GN7_FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_gn7.json');

const d = JSON.parse(fs.readFileSync(FP, 'utf8'));
const gn7 = JSON.parse(fs.readFileSync(GN7_FP, 'utf8'));

// IG 페리 트림 → GN7 베이스 트림 매핑
// IG 페리는 가솔린 2.5 단일 / Le Blanc 추가
const TRIM_BASE = {
  '프리미엄 가솔린 2.5': '프리미엄 가솔린 2.5',
  '익스클루시브 가솔린 2.5': '익스클루시브 가솔린 2.5',
  '캘리그래피 가솔린 2.5': '캘리그래피 가솔린 2.5',
  // 르블랑 = 익스클루시브 base + 르블랑 전용 디자인
  '르블랑 가솔린 2.5': '익스클루시브 가솔린 2.5',
};

// 르블랑 추가 코드 (르블랑 전용 디자인 / 19인치 다크 스퍼터링 휠 + 다이내믹 웰컴)
const LE_BLANC_EXTRA = [
  'GN03054',  // 19인치 캘리그래피 전용 알로이 휠 (르블랑은 다른 디자인이지만 catalog 에는 19인치 캘리 코드 사용)
  'GN03056',  // 다이내믹 웰컴/에스코트 라이트
];

// 옵션 사전 동기화 (IG 페리에 GN7 의 새 옵션 추가)
let added = 0;
for (const [code, info] of Object.entries(gn7.options || {})) {
  if (!d.options[code]) {
    d.options[code] = JSON.parse(JSON.stringify(info));
    added++;
    if (info.category) {
      if (!d.categories[info.category]) d.categories[info.category] = [];
      if (!d.categories[info.category].includes(code)) d.categories[info.category].push(code);
    }
  }
}

console.log(`옵션 사전 동기화: ${added}개 추가 (IG 페리 ← GN7)`);

const trimMap = {};
for (const [igTrim, gn7Trim] of Object.entries(TRIM_BASE)) {
  const gn7T = gn7.trims[gn7Trim];
  if (!gn7T) {
    console.log(`  ⚠ GN7 트림 ${gn7Trim} 없음`);
    continue;
  }
  let codes = [...(gn7T.basic || [])];
  if (igTrim === '르블랑 가솔린 2.5') {
    codes = [...new Set([...codes, ...LE_BLANC_EXTRA])];
  }
  // catalog 사전에 있는 코드만 유지
  trimMap[igTrim] = codes.filter(c => d.options[c]);
}

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
