#!/usr/bin/env node
/**
 * 동력원 split 후 같은 동력원 안 다중 배기량 catalog 를 배기량별로 split.
 *  - trim 키에서 (동력원, 배기량) 토큰 추출
 *  - 같은 catalog 안 다른 배기량 있으면 split
 *  - suffix: 가장 작은 배기량 = 원본 유지, 나머지 = _g30, _g35 등
 *
 *  suffix 규칙:
 *   - 가솔린 X.Y → _gXY (예: 가솔린 3.0 → _g30, 가솔린 3.3 → _g33)
 *   - 가솔린 X.Y T → _gXYt (예: 가솔린 1.6 T → _g16t)
 *   - 디젤 X.Y → _dXY
 *   - LPG X.Y → _lpgXY
 *   - 하이브리드 X.Y → _hevXY
 *   - 플러그인하이브리드 X.Y → _phevXY
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const FUEL_DISP_RE = /(가솔린|디젤|LPG|LPi|하이브리드|HEV|플러그인하이브리드|PHEV)\s+R?(\d\.\d)(\s*T)?/;

function extractFuelDisp(trimKey) {
  const m = trimKey.match(FUEL_DISP_RE);
  if (!m) return null;
  let fuel = m[1];
  if (fuel === 'LPi') fuel = 'LPG';
  if (fuel === 'HEV') fuel = '하이브리드';
  if (fuel === 'PHEV') fuel = '플러그인하이브리드';
  return { fuel, disp: m[2], turbo: !!m[3] };
}

function suffixFor(fuelDisp) {
  const { fuel, disp, turbo } = fuelDisp;
  const dispCode = disp.replace('.', '');
  const turboCode = turbo ? 't' : '';
  const fuelCode = {
    '가솔린': 'g',
    '디젤': 'd',
    'LPG': 'lpg',
    '하이브리드': 'hev',
    '플러그인하이브리드': 'phev',
  }[fuel] || 'x';
  return '_' + fuelCode + dispCode + turboCode;
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const ops = [];

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const trims = Object.entries(d.trims || {});
  if (!trims.length) continue;

  // trim 별 (동력원, 배기량) 그룹화
  const groups = {};   // 'fuel|disp|turbo' → { fuelDisp, trims: [[k, v]] }
  let unknown = [];
  for (const [k, v] of trims) {
    const fd = extractFuelDisp(k);
    if (!fd) { unknown.push(k); continue; }
    const key = `${fd.fuel}|${fd.disp}|${fd.turbo}`;
    if (!groups[key]) groups[key] = { fuelDisp: fd, trims: [] };
    groups[key].trims.push([k, v]);
  }
  const groupKeys = Object.keys(groups);
  if (groupKeys.length <= 1) continue;   // 단일 (동력원, 배기량) → split 불필요

  // 메인 (가장 많은 trim) — 원본 유지
  groupKeys.sort((a, b) => groups[b].trims.length - groups[a].trims.length);
  const mainKey = groupKeys[0];
  const otherKeys = groupKeys.slice(1);
  ops.push({ f, title: d.title, mainKey, otherKeys, groups, unknown, catalog: d, allTrims: Object.fromEntries(trims) });
}

console.log('=== 배기량별 catalog split 계획 (' + ops.length + ') ===\n');
for (const op of ops) {
  const main = op.groups[op.mainKey];
  console.log('• ' + op.title + ' [' + op.f + ']');
  console.log('   main: ' + main.fuelDisp.fuel + ' ' + main.fuelDisp.disp + (main.fuelDisp.turbo?' T':'') + ' (' + main.trims.length + ' trim)');
  op.otherKeys.forEach(k => {
    const g = op.groups[k];
    const sx = suffixFor(g.fuelDisp);
    console.log('   split: ' + g.fuelDisp.fuel + ' ' + g.fuelDisp.disp + (g.fuelDisp.turbo?' T':'') + ' (' + g.trims.length + ' trim) → *' + sx + '.json');
  });
  if (op.unknown.length) console.log('   ! 토큰 미식별: ' + op.unknown.join(', '));
}

if (!APPLY) {
  console.log('\n(dry-run — --apply 추가)');
  process.exit(0);
}

// === 적용 ===
let created = 0;
for (const op of ops) {
  const { f, mainKey, otherKeys, groups, catalog: d, allTrims } = op;
  const baseName = f.replace(/\.json$/, '');

  // 1) 원본 catalog: main 배기량 trim 만 남김
  d.trims = Object.fromEntries(groups[mainKey].trims);
  fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 2));

  // 2) 신규 catalog 생성 (다른 배기량별)
  for (const k of otherKeys) {
    const g = groups[k];
    const sx = suffixFor(g.fuelDisp);
    let newName = baseName + sx + '.json';
    let n = 1;
    while (fs.existsSync(path.join(DIR, newName))) {
      newName = baseName + sx + '_' + (++n) + '.json';
    }
    const split = JSON.parse(JSON.stringify(d));
    split.catalog_id = newName.replace(/\.json$/, '');
    split.trims = Object.fromEntries(g.trims);
    // title 의 동력원+배기량 토큰 갱신
    split.title = split.title.replace(/\s+(가솔린|디젤|LPG|하이브리드|EV|수소|플러그인하이브리드)(\s+R?\d\.\d(\s*T)?)?$/, '')
                              + ' ' + g.fuelDisp.fuel + ' ' + g.fuelDisp.disp + (g.fuelDisp.turbo ? ' T' : '');
    fs.writeFileSync(path.join(DIR, newName), JSON.stringify(split, null, 2));
    console.log('  ✓ ' + newName + ' (' + g.trims.length + ' trim)');
    created++;
  }
  // 원본 title 도 main 동력원+배기량 으로 갱신
  const main = groups[mainKey];
  d.title = d.title.replace(/\s+(가솔린|디젤|LPG|하이브리드|EV|수소|플러그인하이브리드)(\s+R?\d\.\d(\s*T)?)?$/, '')
                    + ' ' + main.fuelDisp.fuel + ' ' + main.fuelDisp.disp + (main.fuelDisp.turbo ? ' T' : '');
  fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 2));
}
console.log('\n적용: ' + ops.length + '개 catalog split · ' + created + '개 신규 catalog');
