#!/usr/bin/env node
/**
 * 쏘나타 디 엣지 (DN8 페리 후) catalog — 가격 채움
 *
 *   기존 15 trim (가격 3개) → 16 trim (가격 모두 명시)
 *   - 가솔린 2.0 (4g) + 1.6 터보 (4g) + N라인 (2 동력원: 1.6T/2.5T) + LPG 2.0 (3g) + LPG 렌터카 (2) + LPG 장애인 (1)
 *
 *   가격 출처: carnoon.co.kr (현대 공식 기반, 2026년형)
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_sonata_dn8_edge.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const T = (newName, from, price) => ({ newName, from, price });
const TRIMS = [
  // 가솔린 2.0
  T('프리미엄 가솔린 2.0',          '프리미엄 2.0',         28700000),
  T('에스 가솔린 2.0',              '에스 2.0',             30020000),
  T('익스클루시브 가솔린 2.0',      '익스클루시브 2.0',     33100000),
  T('인스퍼레이션 가솔린 2.0',      '인스퍼레이션 2.0',     36040000),
  // 1.6 터보
  T('프리미엄 1.6 터보',            '프리미엄 1.6',         29370000),
  T('에스 1.6 터보',                '에스 1.6',             30690000),
  T('익스클루시브 1.6 터보',        '익스클루시브 1.6',     33770000),
  T('인스퍼레이션 1.6 터보',        '인스퍼레이션 1.6',     36710000),
  // N라인
  T('N라인 1.6 터보',               '프리미엄 N라인',       37310000),
  T('N라인 2.5 터보',               '프리미엄 N라인',       39310000),
  // LPG 2.0 일반
  T('프리미엄 LPG 2.0',             '프리미엄 LPG 2.0',     29550000),
  T('익스클루시브 LPG 2.0',         '익스클루시브 LPG 2.0', 33600000),
  T('인스퍼레이션 LPG 2.0',         '인스퍼레이션 LPG 2.0', 36290000),
  // LPG 렌터카
  T('비즈니스1 렌터카 LPG 2.0',     '비즈니스1 영업용',     25600000),
  T('비즈니스2 렌터카 LPG 2.0',     '비즈니스2 영업용',     29840000),
  // LPG 장애인용
  T('익스클루시브 LPG 2.0 장애인용', '익스클루시브 장애인용', 33220000),
];

const newTrims = {};
for (const spec of TRIMS) {
  const src = d.trims[spec.from];
  if (!src) { console.warn(`⚠ source "${spec.from}" 없음 — skip`); continue; }
  newTrims[spec.newName] = {
    slug: spec.newName,
    price: { base: spec.price },
    basic: [...(src.basic || [])],
    ...(src.select ? { select: [...src.select] } : {}),
    ...(src.select_groups ? { select_groups: src.select_groups.map(g => ({ ...g })) } : {}),
  };
}

const dropped = Object.keys(d.trims).filter(n => !TRIMS.some(t => t.from === n));
d.trims = newTrims;
d.fetched_at = '2026-05-05';
d.year_start = '2023-04';
d.year_end   = '현재';
d.source_urls = [
  'https://www.hyundai.com/kr/ko/e/vehicles/sonata-the-edge/price',
  'https://www.carnoon.co.kr/newcar/vehicle/11462',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
console.log(`✓ ${Object.keys(newTrims).length} trim:`);
Object.entries(newTrims).forEach(([n, t]) => {
  console.log(`  ${n.padEnd(34)} ${(t.price.base/10000).toFixed(0).padStart(4)}만 — basic ${t.basic.length}`);
});
if (dropped.length) console.log(`  drop ${dropped.length}: ${dropped.join(' / ')}`);
console.log(`✓ ${path.relative(process.cwd(), FILE)}`);
