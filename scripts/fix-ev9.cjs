#!/usr/bin/env node
/**
 * 기아 EV9 catalog — 가격 채움 (8 trim, 가격 1 → 8)
 *   2025년형 19" 휠 기준 5% 개소세. 2WD/4WD 분기는 미적용 (단일가).
 *   가격 출처: carnoon (현대 공식 기반)
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'kia_ev9.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const PRICES = {
  '라이트 스탠다드':       64122282,
  '라이트 롱레인지':       68574955,
  '에어 스탠다드':         64587487,
  '에어 롱레인지':         69040159,
  '어스 스탠다드':         69372448,
  '어스 롱레인지':         73825121,
  'GT-Line 롱레인지':      80110130,  // 4WD
  'GT':                    86490000,  // 기존 유지 (high-perf 별도 모델)
};

for (const [name, t] of Object.entries(d.trims)) {
  if (PRICES[name]) t.price = { base: PRICES[name] };
}
d.fetched_at = '2026-05-05';
d.year_start = '2023-05';
d.year_end   = '현재';
d.source_urls = [
  'https://www.kia.com/kr/vehicles/ev9/price',
  'https://www.carnoon.co.kr/newcar/vehicle/11536',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
console.log(`✓ ${Object.keys(d.trims).length} trim:`);
Object.entries(d.trims).forEach(([n, t]) => {
  const p = t.price?.base ? (t.price.base/10000).toFixed(0) + '만' : '미정';
  console.log(`  ${n.padEnd(28)} ${p.padStart(6)}`);
});
console.log(`✓ ${path.relative(process.cwd(), FILE)}`);
