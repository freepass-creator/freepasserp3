#!/usr/bin/env node
/**
 * 현대 아반떼 CN7 (페리 후) — 가격 채움
 *   가솔린 1.6 (3g) + LPG 1.6 (3g) + 영업용/장애인용 (3 기존 유지) + N라인 (가격 미정)
 *   가격 출처: car.finance-information.net (2025년형)
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_avante_cn7.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const FILL = {
  '스마트 1.6':              20340000,
  '모던 1.6':                23550000,
  '인스퍼레이션 1.6':        27170000,
  'N 라인 1.6':              null,        // 자료 부족
  '스마트 LPG 1.6':          21720000,
  '모던 LPG 1.6':            24920000,
  '인스퍼레이션 LPG 1.6':    28420000,
};

for (const [name, price] of Object.entries(FILL)) {
  if (d.trims[name] && price) d.trims[name].price = { base: price };
}

d.fetched_at = '2026-05-05';
d.source_urls = [
  'https://www.hyundai.com/kr/ko/e/vehicles/avante/price',
  'https://car.finance-information.net/21',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
const priced = Object.values(d.trims).filter(t => t.price?.base).length;
console.log(`✓ ${Object.keys(d.trims).length} trim (가격 ${priced}):`);
Object.entries(d.trims).forEach(([n, t]) => {
  const p = t.price?.base ? (t.price.base/10000).toFixed(0) + '만' : '미정';
  console.log(`  ${n.padEnd(28)} ${p.padStart(6)}`);
});
