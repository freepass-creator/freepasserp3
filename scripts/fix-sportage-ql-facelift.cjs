#!/usr/bin/env node
/**
 * 기아 스포티지 더 볼드 (QL 페리 후) — 가격 채움
 *   1.6 디젤 트림 가격 (autoview / 다나와 2018)
 *   트렌디 = entry, 자료 부족
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'kia_sportage_ql_facelift.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const FILL = {
  '트렌디':       null,        // 자료 부족
  '프레스티지':   25480000,    // 1.6 디젤
  '노블레스':     27390000,
  '시그니처':     29160000,
};

for (const [name, price] of Object.entries(FILL)) {
  if (d.trims[name] && price) d.trims[name].price = { base: price };
}

d.fetched_at = '2026-05-05';
d.year_start = '2018-08';
d.year_end   = '2021-06';
d.source_urls = ['https://www.autoview.co.kr/ko-kr/articles/65116'];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
const priced = Object.values(d.trims).filter(t => t.price?.base).length;
console.log(`✓ ${Object.keys(d.trims).length} trim (가격 ${priced}):`);
Object.entries(d.trims).forEach(([n, t]) => {
  const p = t.price?.base ? (t.price.base/10000).toFixed(0) + '만' : '미정';
  console.log(`  ${n.padEnd(20)} ${p.padStart(6)}`);
});
