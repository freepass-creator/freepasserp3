#!/usr/bin/env node
/**
 * 현대 코나 SX2 catalog — 가격 채움
 *   가솔린 2.0 (4g), 가솔린 1.6T (4g) 가격 명시. EV 기존 유지.
 *   블랙 익스테리어 1.6T / N 라인 1.6T 는 인스퍼레이션 옵션이라 별도가 부족 → 미정 유지.
 *   가격 출처: 2025년형 zdnet / carisyou
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_kona_sx2.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const PRICES = {
  '모던 2.0':                24090000,
  'H-Pick 2.0':              24990000,
  '모던 1.6T':               24780000,
  'H-Pick 1.6T':             25590000,
  '프리미엄 1.6T':           28210000,
  '인스퍼레이션 1.6T':       31020000,
  '블랙 익스테리어 1.6T':    null,        // 인스퍼레이션 옵션, 자료 부족
  'N 라인 1.6T':             null,        // 인스퍼레이션 옵션, 자료 부족
  '이밸류 플러스 일렉트릭':   41420000,    // 기존 유지
  '프리미엄 일렉트릭':       43520000,    // 기존 유지
};

// 가솔린 2.0 의 누락 trim (프리미엄 2.0 / 인스퍼레이션 2.0) 추가
const PRICES_NEW = {
  '프리미엄 2.0':            27530000,
  '인스퍼레이션 2.0':        30340000,
};

// 기존 trim 가격 채움 + 신규 추가
const newTrims = {};
for (const [name, t] of Object.entries(d.trims)) {
  if (!(name in PRICES)) {
    newTrims[name] = t;
    continue;
  }
  newTrims[name] = {
    ...t,
    price: PRICES[name] ? { base: PRICES[name] } : {},
  };
}

// 신규 trim 추가 (모던 2.0 의 옵션 셋 복사)
for (const [name, price] of Object.entries(PRICES_NEW)) {
  const src = d.trims['모던 2.0'];
  newTrims[name] = {
    slug: name,
    price: { base: price },
    basic: [...(src.basic || [])],
    ...(src.select ? { select: [...src.select] } : {}),
    ...(src.select_groups ? { select_groups: src.select_groups.map(g => ({ ...g })) } : {}),
  };
}

d.trims = newTrims;
d.fetched_at = '2026-05-05';
d.year_start = '2023-04';
d.year_end   = '현재';
d.source_urls = [
  'https://www.hyundai.com/kr/ko/e/vehicles/kona/price',
  'https://m.carisyou.com/car/7581',
  'https://zdnet.co.kr/view/?no=20250423134518',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
const priced = Object.values(newTrims).filter(t => t.price?.base).length;
console.log(`✓ ${Object.keys(newTrims).length} trim (가격 ${priced}):`);
Object.entries(newTrims).forEach(([n, t]) => {
  const p = t.price?.base ? (t.price.base/10000).toFixed(0) + '만' : '미정';
  console.log(`  ${n.padEnd(28)} ${p.padStart(6)}`);
});
console.log(`✓ ${path.relative(process.cwd(), FILE)}`);
