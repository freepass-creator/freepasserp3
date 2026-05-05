#!/usr/bin/env node
/**
 * 스포티지 NQ5 catalog — 파워트레인 분기 fix
 *
 * 기존: 4 트림 (1.6T 단일 가격)
 * 신규: 4 grade × 3 powertrain = 12 트림
 *
 * 가격 출처: 위키카 2024-11 docSrl=56987 (p1=1.6T / p3=2.0 LPG / p5=1.6 HEV)
 *
 * 옵션 처리:
 *   - basic 셋은 grade 별 차이 (프레스티지 73 → X-Line 122) 보존
 *   - 파워트레인 옵션 ID 만 동력원에 맞게 치환
 *   - select_groups 그대로 (단 LPG 는 4WD 옵션 제외 — 2WD only)
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'data', 'car-master', 'kia_sportage_nq5.json');
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 파워트레인 옵션 ID
const PT_GASO = ['KRNQ259001', 'KRNQ259005', 'KRNQ259010']; // G1.6 T-GDI / 8AT / ISG
const PT_LPG  = ['KRNQ259002', 'KRNQ259004', 'KRNQ259011']; // L2.0 / 6AT / 원형 봄베
const PT_HEV  = ['KRNQ259003', 'KRNQ259006', 'KRNQ259007']; // HEV / 6AT / 47.7kW 모터

// 위키카 가격표 (만원 단위 → 원)
const PRICES = {
  '1.6 터보': {
    '프레스티지':         28300000,
    '노블레스':           31950000,
    '시그니처':           34600000,
    '시그니처 X-Line':    35250000,
  },
  'LPG 2.0': {
    '프레스티지':         29100000,
    '노블레스':           32600000,
    '시그니처':           35250000,
    '시그니처 X-Line':    35900000,
  },
  '하이브리드': {
    '프레스티지':         34580000,
    '노블레스':           37770000,
    '시그니처':           40430000,
    '시그니처 X-Line':    41070000,
  },
};

// 기존 grade 별 옵션 셋 (1.6T 기준)
const baseTrims = {
  '프레스티지':       d.trims['프레스티지'],
  '노블레스':         d.trims['노블레스'],
  '시그니처':         d.trims['시그니처'],
  '시그니처 X-Line':  d.trims['시그니처 X-Line'],
};

if (Object.values(baseTrims).some(t => !t)) {
  console.error('기존 trims 가 예상과 다름 — 변환 중단');
  process.exit(1);
}

// 파워트레인 ID 치환
function swapPowertrain(idArr, fromIds, toIds) {
  const fromSet = new Set(fromIds);
  return idArr.filter(id => !fromSet.has(id)).concat(toIds);
}

// LPG 는 select_groups 의 '전자식 4WD' 제외 (2WD only)
function filterSelectGroupsForLpg(groups) {
  return groups.filter(g => g.name !== '전자식 4WD');
}

function buildPowertrainTrim(grade, ptKey, fromIds, toIds, isLpg = false) {
  const src = baseTrims[grade];
  const newName = ptKey === '1.6 터보'
    ? `${grade} 1.6 터보`
    : ptKey === 'LPG 2.0'
      ? `${grade} LPG 2.0`
      : `${grade} 하이브리드`;
  const slug = newName;
  const basic = swapPowertrain(src.basic || [], fromIds, toIds);
  const select = src.select ? [...src.select] : undefined;
  let select_groups = src.select_groups ? src.select_groups.map(g => ({ ...g })) : undefined;
  if (isLpg && select_groups) select_groups = filterSelectGroupsForLpg(select_groups);

  const t = {
    slug,
    price: { base: PRICES[ptKey][grade] },
    basic,
  };
  if (select) t.select = select;
  if (select_groups) t.select_groups = select_groups;
  return [newName, t];
}

const newTrims = {};
const grades = ['프레스티지', '노블레스', '시그니처', '시그니처 X-Line'];

// 1.6T (가솔린) — 기준 동력원이라 from=PT_GASO, to=PT_GASO (no-op)
grades.forEach(g => {
  const [name, t] = buildPowertrainTrim(g, '1.6 터보', PT_GASO, PT_GASO);
  newTrims[name] = t;
});

// LPG 2.0
grades.forEach(g => {
  const [name, t] = buildPowertrainTrim(g, 'LPG 2.0', PT_GASO, PT_LPG, true);
  newTrims[name] = t;
});

// 하이브리드
grades.forEach(g => {
  const [name, t] = buildPowertrainTrim(g, '하이브리드', PT_GASO, PT_HEV);
  newTrims[name] = t;
});

// 결과 적용
d.trims = newTrims;
d.fetched_at = '2026-05-05';
d.source_urls = [
  'https://www.kia.com/kr/vehicles/sportage/price',
  'http://wikicar.co.kr/suv_sportage/56987',
];

// 검증
const trimNames = Object.keys(d.trims);
console.log(`✓ 트림 ${trimNames.length}개:`);
trimNames.forEach(n => {
  const t = d.trims[n];
  console.log(`  ${n.padEnd(28)} ${(t.price.base/10000).toFixed(0)}만원 — basic ${t.basic.length} / select_groups ${t.select_groups?.length || 0}`);
});

fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
console.log(`✓ 저장됨 — ${path.relative(process.cwd(), FILE)}`);
