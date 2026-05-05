#!/usr/bin/env node
/**
 * 팰리세이드 LX3 — 가솔린 2.5 7인승 3 trim 가격 채움
 *   가격 출처: carnoon (현대 공식 기반, 2025년형 2WD 기준)
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_palisade_lx3.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const FILL = {
  '익스클루시브 2.5 7인승': 45160000,
  '프레스티지 2.5 7인승':   50990000,
  '캘리그래피 2.5 7인승':   57940000,
};

for (const [name, price] of Object.entries(FILL)) {
  if (d.trims[name]) d.trims[name].price = { base: price };
}

d.fetched_at = '2026-05-05';
d.source_urls = [
  'https://www.hyundai.com/kr/ko/e/vehicles/the-all-new-palisade/price',
  'https://www.carnoon.co.kr/newcar/vehicle/11735',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
const priced = Object.values(d.trims).filter(t => t.price?.base).length;
console.log(`✓ ${Object.keys(d.trims).length} trim (가격 ${priced}):`);
Object.entries(d.trims).forEach(([n, t]) => {
  const p = t.price?.base ? (t.price.base/10000).toFixed(0) + '만' : '미정';
  console.log(`  ${n.padEnd(28)} ${p.padStart(6)}`);
});
