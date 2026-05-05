#!/usr/bin/env node
/**
 * 쏘나타 DN8 catalog — 트림 재구성
 *
 *   기존 16 trim (가격 6개, 가격기준 3.5% 한시인하 혼재)
 *   →   11 trim (가격 11개, 5% 정가 통일)
 *
 *   - 가솔린 2.0 / LPi 2.0 일반 / LPi 2.0 장애인용 / LPi 2.0 렌터카 4 동력원
 *   - 장애 유형 6개 (원발/왼손원발/왼손오른발/오른발/양발/오른손) → 인스퍼레이션 LPi 2.0 장애인용 1개로 통합
 *   - HEV 는 별도 catalog (hyundai_sonata_dn8_hybrid)
 *
 *   가격 출처: 위키카 2022-07 docSrl=49419 (2023년형)
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_sonata_dn8.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 신규 trim 매핑: { newName: { from: 기존 trim 이름, price: 5% 정가, ptIds: 추가/유지할 파워트레인 옵션 ids } }
// 옵션 ID 는 기존 trim 의 basic 그대로 가져오고, 동력원만 정확히 갱신
const SWAP_GASO_TO_LPI = {
  // 가솔린 → LPi 치환 룰
  remove: ['WK_스마트스트림_가솔린_2_0_엔진'],
  add:    ['WK_스마트스트림_LPi_2_0_엔진', 'WK_원형_봄베'],
};

const TRIMS = [
  // 가솔린 2.0
  { newName: '모던 가솔린 2.0',                from: '모던',               price: 25950000 },
  { newName: '프리미엄 플러스 가솔린 2.0',      from: '프리미엄 플러스',    price: 28470000 },
  { newName: '인스퍼레이션 가솔린 2.0',         from: '인스퍼레이션',       price: 33800000 },
  // LPi 2.0 일반판매
  { newName: '모던 LPi 2.0',                   from: '모던 LPi 2.0',       price: 26600000 },
  { newName: '프리미엄 플러스 LPi 2.0',        from: '프리미엄 플러스 LPi 2.0', price: 29120000 },
  { newName: '인스퍼레이션 LPi 2.0',           from: '인스퍼레이션 LPi 2.0', price: 33850000 },
  // LPi 2.0 장애인용
  { newName: '모던 LPi 2.0 장애인용',          from: '모던 장애인용',       price: 25940000, swap: 'gaso2lpi' },
  { newName: '프리미엄 플러스 LPi 2.0 장애인용', from: '프리미엄 장애인용',  price: 28610000, swap: 'gaso2lpi' },
  { newName: '인스퍼레이션 LPi 2.0 장애인용',  from: '오른발장애',         price: 31520000, swap: 'gaso2lpi' },
  // LPi 2.0 렌터카
  { newName: '스타일 렌터카 LPi 2.0',          from: '스타일 렌터카',       price: 21710000, swap: 'gaso2lpi' },
  { newName: '스마트 렌터카 LPi 2.0',          from: '스마트 렌터카',       price: 24310000, swap: 'gaso2lpi' },
];

function applySwap(basic, swap) {
  if (swap !== 'gaso2lpi') return basic;
  const remove = new Set(SWAP_GASO_TO_LPI.remove);
  let next = basic.filter(id => !remove.has(id));
  for (const id of SWAP_GASO_TO_LPI.add) if (!next.includes(id)) next.push(id);
  return next;
}

const newTrims = {};
let dropped = [];
for (const spec of TRIMS) {
  const src = d.trims[spec.from];
  if (!src) { console.warn(`⚠ "${spec.from}" trim 없음 — skip`); continue; }
  const basic = applySwap(src.basic || [], spec.swap);
  newTrims[spec.newName] = {
    slug: spec.newName,
    price: { base: spec.price },
    basic,
    ...(src.select ? { select: [...src.select] } : {}),
    ...(src.select_groups ? { select_groups: src.select_groups.map(g => ({ ...g })) } : {}),
  };
}

// 폐기되는 trim (장애인 변형 5개)
const removed = Object.keys(d.trims).filter(n => !TRIMS.some(t => t.from === n));
dropped = removed;

d.trims = newTrims;
d.fetched_at = '2026-05-05';
// year_start 잘못된 것 (1994-01) 수정 — 쏘나타 DN8 은 2019-03 출시, 페리 전 (2023-04 단종)
d.year_start = '2019-03';
d.year_end = '2023-04';
d.source_urls = [
  'https://www.hyundai.com/kr/ko/e/vehicles/sonata',
  'http://wikicar.co.kr/sonata_dn8/49419',
];

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');

console.log(`✓ ${Object.keys(newTrims).length} trim:`);
Object.entries(newTrims).forEach(([n, t]) => {
  console.log(`  ${n.padEnd(34)} ${(t.price.base/10000).toFixed(0).padStart(4)}만 — basic ${t.basic.length}`);
});
console.log(`  drop ${dropped.length}: ${dropped.join(' / ')}`);
console.log(`✓ ${path.relative(process.cwd(), FILE)}`);
