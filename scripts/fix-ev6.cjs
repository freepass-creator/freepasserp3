#!/usr/bin/env node
/**
 * 기아 더 뉴 EV6 (페리 후 2024) — 가격 분기 정확화
 *   기존 7 trim 동일가 (롱레인지 4WD 가격으로 합쳐짐) → 4 grade × 3 동력 = 12 trim
 *   가격 출처: carnoon (현대 공식 기반, 2025년형 19" 기준 5%)
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'kia_ev6.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const T = (newName, from, price) => ({ newName, from, price });
const TRIMS = [
  // 스탠다드 2WD
  T('라이트 스탠다드',           '라이트 스탠다드',  46596411),
  T('에어 스탠다드',             '에어 스탠다드',    51295927),
  T('어스 스탠다드',             '어스 스탠다드',    55349853),
  // 롱레인지 2WD
  T('라이트 롱레인지',           '라이트 롱레인지',  50602867),
  T('에어 롱레인지',             '에어 롱레인지',    55292889),
  T('어스 롱레인지',             '어스 롱레인지',    59356309),
  T('GT-Line 롱레인지',         'GT-Line 롱레인지', 59954429),
  // 롱레인지 4WD
  T('라이트 롱레인지 4WD',       '라이트 롱레인지',  52947878),
  T('에어 롱레인지 4WD',         '에어 롱레인지',    57637900),
  T('어스 롱레인지 4WD',         '어스 롱레인지',    61701320),
  T('GT-Line 롱레인지 4WD',     'GT-Line 롱레인지', 62299440),
];

const newTrims = {};
for (const spec of TRIMS) {
  const src = d.trims[spec.from];
  if (!src) continue;
  newTrims[spec.newName] = {
    slug: spec.newName,
    price: { base: spec.price },
    basic: [...(src.basic || [])],
    ...(src.select ? { select: [...src.select] } : {}),
    ...(src.select_groups ? { select_groups: src.select_groups.map(g => ({ ...g })) } : {}),
  };
}
d.trims = newTrims;
d.fetched_at = '2026-05-05';
d.year_start = '2024-08';
d.year_end = '현재';
d.source_urls = [
  'https://www.kia.com/kr/vehicles/ev6/price',
  'https://www.carnoon.co.kr/newcar/vehicle/11676',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n');
console.log(`✓ ${Object.keys(d.trims).length} trim:`);
Object.entries(d.trims).forEach(([n, t]) => {
  console.log(`  ${n.padEnd(28)} ${(t.price.base/10000).toFixed(0).padStart(4)}만`);
});
