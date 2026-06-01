#!/usr/bin/env node
/**
 * 동력원 혼합 catalog 를 동력원별로 split.
 *  - 한국 OEM (현대/기아/제네시스/KGM) 만 대상
 *  - 각 trim 의 키에서 동력원 토큰 추출 → 그룹화
 *  - 메인 동력원 (가장 많은 trim) = 원본 catalog 유지
 *  - 나머지 동력원 = 신규 catalog (suffix: _diesel / _lpg / _ev / _hybrid)
 *
 *  메타데이터 (categories, options, year_start/end 등) 는 모두 복사.
 *  title 에 동력원 표시 추가.
 *
 *  사용:
 *    node scripts/split-catalogs-by-fuel.cjs           # dry-run
 *    node scripts/split-catalogs-by-fuel.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const FUEL_RULES = [
  { key: '하이브리드', re: /하이브리드|HEV/, suffix: '_hybrid', display: '하이브리드' },
  { key: 'EV',         re: /\bEV\b|일렉트릭|전기/i, suffix: '_ev', display: 'EV' },
  { key: '수소',       re: /수소/, suffix: '_hydrogen', display: '수소' },
  { key: '디젤',       re: /디젤/, suffix: '_diesel', display: '디젤' },
  { key: 'LPG',        re: /\b(LPG|LPi)\b/i, suffix: '_lpg', display: 'LPG' },
  { key: '가솔린',     re: /가솔린/, suffix: '', display: '가솔린' },
];

function classifyTrim(trimKey) {
  for (const r of FUEL_RULES) if (r.re.test(trimKey)) return r;
  return null;  // 동력원 토큰 없음
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const ops = []; // { srcFile, mainFuel, splitFuels: { fuelKey: { trims, suffix, display } }, baseCatalog }

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const trims = d.trims || {};
  const trimKeys = Object.keys(trims);
  if (trimKeys.length === 0) continue;

  // trim 을 동력원별로 분류
  const buckets = {};   // fuelKey → { trimKeys, rule }
  const unknown = [];
  for (const k of trimKeys) {
    const r = classifyTrim(k);
    if (!r) { unknown.push(k); continue; }
    if (!buckets[r.key]) buckets[r.key] = { trimKeys: [], rule: r };
    buckets[r.key].trimKeys.push(k);
  }
  const fuelKeys = Object.keys(buckets);
  if (fuelKeys.length <= 1) continue;  // 단일 동력원 → split 불필요

  // 가솔린 있으면 항상 메인 (suffix '' 충돌 방지). 없으면 가장 많은 동력원
  fuelKeys.sort((a, b) => {
    if (a === '가솔린') return -1;
    if (b === '가솔린') return 1;
    return buckets[b].trimKeys.length - buckets[a].trimKeys.length;
  });
  const mainFuel = fuelKeys[0];
  const otherFuels = fuelKeys.slice(1);

  ops.push({
    srcFile: f,
    title: d.title,
    mainFuel,
    otherFuels,
    buckets,
    unknown,
    catalog: d,
    _origTrimsAll: JSON.parse(JSON.stringify(trims)),  // split 시 원본 trim 객체 복원용
  });
}

console.log('=== 동력원별 catalog split 계획 (' + ops.length + '개 src catalog) ===\n');
for (const op of ops) {
  const others = op.otherFuels.map(fk => {
    const sx = op.buckets[fk].rule.suffix;
    const cnt = op.buckets[fk].trimKeys.length;
    return fk + '(' + cnt + ') → *' + sx + '.json';
  }).join(' / ');
  console.log('• ' + op.title + ' [' + op.srcFile + ']');
  console.log('   main: ' + op.mainFuel + '(' + op.buckets[op.mainFuel].trimKeys.length + 'trim)');
  console.log('   split: ' + others);
  if (op.unknown.length) console.log('   ! 동력원 미식별 trim: ' + op.unknown.join(', '));
}

if (!APPLY) {
  console.log('\n(dry-run — --apply 추가)');
  process.exit(0);
}

// === 실제 적용 ===
let created = 0;
for (const op of ops) {
  const { srcFile, mainFuel, otherFuels, buckets, catalog: d } = op;
  const baseName = srcFile.replace(/\.json$/, '');

  // 1) 원본 catalog: main 동력원 trim 만 남김
  const newMainTrims = {};
  for (const k of buckets[mainFuel].trimKeys) newMainTrims[k] = d.trims[k];
  d.trims = newMainTrims;
  // title 에 동력원 표시 (가솔린은 표시 생략 — 메인)
  if (mainFuel !== '가솔린' && !d.title.includes(buckets[mainFuel].rule.display)) {
    d.title += ' ' + buckets[mainFuel].rule.display;
  }
  fs.writeFileSync(path.join(DIR, srcFile), JSON.stringify(d, null, 2));

  // 2) 신규 catalog 생성 (각 다른 동력원별)
  for (const fk of otherFuels) {
    const rule = buckets[fk].rule;
    let suffix = rule.suffix;
    let newName = baseName + suffix + '.json';
    let n = 1;
    while (fs.existsSync(path.join(DIR, newName))) {
      newName = baseName + suffix + '_' + (++n) + '.json';
    }
    const split = JSON.parse(JSON.stringify(d));   // 원본 (정리 후) deep copy
    split.catalog_id = newName.replace(/\.json$/, '');
    // trim 교체
    split.trims = {};
    const origTrims = op.catalog.trims;
    // wait — origTrims 는 이미 main 만 남긴 상태. 원본 보관 필요
    // op.buckets 의 trimKeys 는 원본 키. 원본 trim 객체는 op._origTrims 로 복원해야
    for (const k of buckets[fk].trimKeys) {
      // 원본 catalog 의 d.trims 는 이미 main 으로 덮인 상태 → op.catalog._origTrims 사용
      split.trims[k] = op._origTrimsAll[k];
    }
    // title 에 동력원 표시
    const baseTitle = d.title.replace(' ' + buckets[mainFuel].rule.display, '');
    split.title = baseTitle + (rule.display !== '가솔린' ? ' ' + rule.display : '');
    fs.writeFileSync(path.join(DIR, newName), JSON.stringify(split, null, 2));
    created++;
    console.log('  ✓ ' + newName + ' (' + buckets[fk].trimKeys.length + ' trim)');
  }
}
console.log('\n적용: ' + ops.length + '개 catalog split / ' + created + '개 신규 catalog');
