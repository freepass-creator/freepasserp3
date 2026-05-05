#!/usr/bin/env node
/**
 * 기아 더 뉴 카니발 YP 페리 후 — 가격 채움 (stub 7 → 7 가격)
 *   가격 출처: 다나와 / 위클리오토 (2020년형 9인승/7인승 디젤 대표가)
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'kia_carnival_yp_facelift.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const FILL = {
  '디럭스':           28800000,  // 11인승 디젤
  '럭셔리':           31500000,  // 9인승 디젤
  '프레스티지':       34900000,  // 9인승 디젤
  '노블레스':         38300000,  // 9인승 디젤
  '노블레스 스페셜':  38900000,
  'VIP':              36720000,  // 7인승 디젤
  '프레지던트':       40450000,  // 7인승 리무진
};

for (const [name, price] of Object.entries(FILL)) {
  if (d.trims[name]) d.trims[name].price = { base: price };
}

d.fetched_at = '2026-05-05';
d.year_start = '2018-08';
d.year_end   = '2020-07';
d.source_urls = [
  'https://auto.danawa.com/news/?Tab=N1&Work=detail&no=4006924',
];
d.source = 'web_research';

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
console.log(`✓ ${Object.keys(d.trims).length} trim:`);
Object.entries(d.trims).forEach(([n, t]) => {
  const p = t.price?.base ? (t.price.base/10000).toFixed(0) + '만' : '미정';
  console.log(`  ${n.padEnd(28)} ${p.padStart(6)}`);
});
