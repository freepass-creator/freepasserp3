#!/usr/bin/env node
/**
 * 기아 K8 GL3 (페리 전) — 가격 채움 (stub 7 → 10 trim)
 *   2.5 가솔린 (3g) + 3.5 가솔린 (4g) + 3.5 LPG 렌터카 (3g)
 *   가격 출처: 위키카 docSrl=45415 (2021-04 출시) p2/p3/p5 OCR
 *   (p6~p9 미확인, HEV 자료 후속 보강)
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'kia_k8_gl3_pre.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const T = (newName, from, price) => ({ newName, from, price });
const TRIMS = [
  // 2.5 가솔린
  T('노블레스 라이트 2.5 가솔린',   '노블레스 라이트',  33400000),
  T('노블레스 2.5 가솔린',          '노블레스',         35750000),
  T('시그니처 2.5 가솔린',          '시그니처',         39400000),
  // 3.5 가솔린 (4 grade — 새 trim 3개 추가)
  T('노블레스 라이트 3.5 가솔린',   '노블레스 라이트',  36850000),
  T('노블레스 3.5 가솔린',          '노블레스',         39200000),
  T('시그니처 3.5 가솔린',          '시그니처',         42550000),
  T('플래티넘 3.5 가솔린',          '플래티넘',         46100000),
  // 3.5 LPG 렌터카 (3 grade)
  T('스탠다드 LPG 3.5 렌터카',      '스탠다드',         28200000),
  T('트렌디 LPG 3.5 렌터카',        '트렌디',           29800000),
  T('프레스티지 LPG 3.5 렌터카',    '프레스티지',       35000000),
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
d.year_start = '2021-04';
d.year_end   = '2024-08';
d.source_urls = [
  'http://wikicar.co.kr/K8/45415',
];
delete d.source;
d.source = 'wikicar_ocr';

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
console.log(`✓ ${Object.keys(d.trims).length} trim:`);
Object.entries(d.trims).forEach(([n, t]) => {
  console.log(`  ${n.padEnd(30)} ${(t.price.base/10000).toFixed(0).padStart(4)}만`);
});
console.log(`✓ ${path.relative(process.cwd(), FILE)}`);
