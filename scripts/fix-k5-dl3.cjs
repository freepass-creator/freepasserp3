#!/usr/bin/env node
/**
 * 기아 K5 DL3 catalog — 트림 재구성
 *   기존 16 trim (가격 12개, suffix "n / 2 / 3 / 4" 동력원 합본 혼란)
 *   →   20 trim (가격 모두 명시, 동력원 명시적 분기)
 *
 *   가솔린 2.0 (5g) + 1.6T (4g) + LPG 일반 (3g) + LPG 렌터카 (2g) + LPG 장애인 (3g) + HEV (3g)
 *   가격 출처: 위키카 2024-11 docSrl=56796 (페리 후 2025년형)
 *   베스트 셀렉션 HEV 자료 없음 → 일단 제외
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'kia_k5_dl3.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 신규 trim 매핑 (newName → from + price)
const T = (newName, from, price) => ({ newName, from, price });
const TRIMS = [
  // 가솔린 2.0 (기존 "n 2" 시리즈 + 스마트 셀렉션)
  T('스마트 셀렉션 가솔린 2.0',     '스마트 셀렉션',        27660000),
  T('프레스티지 가솔린 2.0',        '프레스티지 2',         28510000),
  T('베스트 셀렉션 가솔린 2.0',     '베스트 셀렉션 2',      29730000),
  T('노블레스 가솔린 2.0',          '노블레스 2',           32030000),
  T('시그니처 가솔린 2.0',          '시그니처 2',           35220000),
  // 1.6 터보 (기존 "n 3" 시리즈)
  T('프레스티지 1.6 터보',          '프레스티지 3',         29320000),
  T('베스트 셀렉션 1.6 터보',       '베스트 셀렉션 3',      30540000),
  T('노블레스 1.6 터보',            '노블레스 3',           33270000),
  T('시그니처 1.6 터보',            '시그니처 3',           36010000),
  // LPG 2.0 일반판매 (기존 "n 4" 시리즈)
  T('프레스티지 LPG 2.0',           '프레스티지 4',         29200000),
  T('노블레스 LPG 2.0',             '노블레스 4',           32820000),
  T('시그니처 LPG 2.0',             '시그니처 4',           35370000),
  // LPG 2.0 렌터카 (기존 trim 없음 — 가솔린 2.0 grade 기반 stub 으로 생성)
  T('트렌디 렌터카 LPG 2.0',        '스마트 셀렉션',        25070000),
  T('프레스티지 렌터카 LPG 2.0',    '프레스티지 2',         27740000),
  // LPG 2.0 장애인용 (기존 trim 없음 — LPG 2.0 grade 기반)
  T('프레스티지 LPG 2.0 장애인용',  '프레스티지 4',         27570000),
  T('노블레스 LPG 2.0 장애인용',    '노블레스 4',           30990000),
  T('시그니처 LPG 2.0 장애인용',    '시그니처 4',           33420000),
  // HEV (기존 "suffix 없음" 시리즈, 가격 없던 4개 중 베스트 셀렉션 제외)
  T('프레스티지 하이브리드',        '프레스티지',           33930000),
  T('노블레스 하이브리드',          '노블레스',             37300000),
  T('시그니처 하이브리드',          '시그니처',             40290000),
];

const newTrims = {};
for (const spec of TRIMS) {
  const src = d.trims[spec.from];
  if (!src) { console.warn(`⚠ source trim "${spec.from}" 없음 — skip "${spec.newName}"`); continue; }
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
// K5 DL3 = 2019-12 출시, 2024-08 페리 (현재 페리 후 모델)
d.year_start = '2019-12';
d.year_end   = '현재';
d.source_urls = [
  'https://www.kia.com/kr/vehicles/k5/price',
  'http://wikicar.co.kr/K5_dl3/56796',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');

console.log(`✓ ${Object.keys(newTrims).length} trim:`);
Object.entries(newTrims).forEach(([n, t]) => {
  console.log(`  ${n.padEnd(34)} ${(t.price.base/10000).toFixed(0).padStart(4)}만 — basic ${t.basic.length}`);
});
if (dropped.length) console.log(`  drop ${dropped.length}: ${dropped.join(' / ')}`);
console.log(`✓ ${path.relative(process.cwd(), FILE)}`);
