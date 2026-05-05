#!/usr/bin/env node
/**
 * 현대 그랜저 GN7 catalog — 가격 채움 (5 → 12 가격, 14 → 14 trim 유지)
 *
 *   가솔린 2.5 (4g) + LPG 3.5 (2g, 캘리그래피 이상 미지원) + LPG 3.0 장애인 (1) + HEV (5g)
 *
 *   가격 출처: chais.co.kr / personalemblem.com / 현대 공식 (2025년형)
 *   블랙 익스/블랙 잉크 2.5 는 공개 자료 부족 — 가격 미정 유지 (추후 보강)
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_gn7.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 신규 trim 매핑 (newName, from, price | null = 가격 미정)
const T = (newName, from, price) => ({ newName, from, price });
const TRIMS = [
  // 가솔린 2.5
  T('프리미엄 가솔린 2.5',          '프리미엄 2.5',                          37680000),
  T('익스클루시브 가솔린 2.5',      '익스클루시브 2.5',                      41800000),
  T('아너스 가솔린 2.5',            '아너스 2.5',                            45500000),
  T('캘리그래피 가솔린 2.5',        '캘리그래피 2.5',                        47210000),
  T('캘리그래피 블랙 익스테리어 가솔린 2.5', '블랙 익스테리어 2.5',           null),  // 자료 부족
  T('캘리그래피 블랙 잉크 가솔린 2.5',       '블랙 잉크 2.5',                 null),  // 자료 부족
  // LPG 3.5
  T('프리미엄 LPG 3.5',             '프리미엄 LPG 3.5',                      37240000),
  T('익스클루시브 LPG 3.5',         '익스클루시브 LPG 3.5',                  41750000),
  // LPG 3.0 장애인용 (기존 가격 유지)
  T('익스클루시브 플러스 장애인용 LPG 3.0', '익스클루시브 플러스 장애인용 LPG 3.0', 41300000),
  // HEV (기존 가격 유지 — carwiki 와 일치)
  T('프리미엄 하이브리드',          '프리미엄 하이브리드',                    42910000),
  T('익스클루시브 하이브리드',      '익스클루시브 하이브리드',                47810000),
  T('캘리그래피 하이브리드',        '캘리그래피 하이브리드',                  52440000),
  T('캘리그래피 블랙 익스테리어 하이브리드', '블랙 익스테리어 하이브리드',     52440000),
  T('캘리그래피 블랙 잉크 하이브리드',       '블랙 잉크 하이브리드',           53730000),
];

const newTrims = {};
for (const spec of TRIMS) {
  const src = d.trims[spec.from];
  if (!src) { console.warn(`⚠ source "${spec.from}" 없음 — skip`); continue; }
  newTrims[spec.newName] = {
    slug: spec.newName,
    price: spec.price ? { base: spec.price } : {},
    basic: [...(src.basic || [])],
    ...(src.select ? { select: [...src.select] } : {}),
    ...(src.select_groups ? { select_groups: src.select_groups.map(g => ({ ...g })) } : {}),
  };
}

const dropped = Object.keys(d.trims).filter(n => !TRIMS.some(t => t.from === n));
d.trims = newTrims;
d.fetched_at = '2026-05-05';
d.year_start = '2022-11';
d.year_end   = '현재';
d.source_urls = [
  'https://www.hyundai.com/kr/ko/e/vehicles/grandeur/price',
  'https://chais.co.kr/Car/InfoDetail?modelId=3549',
  'https://www.carwiki.co.kr/model/11294_2025',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
const priced = Object.values(newTrims).filter(t => t.price?.base).length;
console.log(`✓ ${Object.keys(newTrims).length} trim (가격 ${priced}):`);
Object.entries(newTrims).forEach(([n, t]) => {
  const p = t.price?.base ? (t.price.base/10000).toFixed(0) + '만' : '미정';
  console.log(`  ${n.padEnd(40)} ${p.padStart(6)} — basic ${t.basic.length}`);
});
if (dropped.length) console.log(`  drop ${dropped.length}: ${dropped.join(' / ')}`);
console.log(`✓ ${path.relative(process.cwd(), FILE)}`);
