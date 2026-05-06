#!/usr/bin/env node
/**
 * 2022+ 신차 (현대/기아/제네시스/KGM) catalog 의 모든 trim 에 표준 ADAS 패키지가
 * basic 으로 들어있는지 검사 + 누락 시 추가.
 *
 * 표준 신차 ADAS — 2022~ 거의 모든 트림 기본옵션:
 *   HDA / LKAS / FCWS / DAW / RCTA / LDWS / HBA / ROA / SEW / TPMS
 *
 * 이미 옵션 사전에 같은 의미의 옵션 있으면 그 코드를 trim.basic 에 추가만.
 * 옵션 사전에 자체가 없으면 추가 안 함 (사용자 검수 후 직접 추가).
 *
 * 사용:
 *   node scripts/enforce-standard-adas.cjs           # dry-run
 *   node scripts/enforce-standard-adas.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];
const SINCE = '2022-01';

// 표준 ADAS 옵션명 후보 — catalog.options 의 name 매칭에 사용
const ADAS_PATTERNS = [
  { id: 'HDA', patterns: [/스마트\s*크루즈/, /고속도로\s*주행\s*보조/, /고속도로\s*주행\s*지원/, /HDA/i] },
  { id: 'LKAS', patterns: [/차로\s*유지\s*보조/, /차선\s*유지\s*보조/, /LKAS/i] },
  { id: 'LDWS', patterns: [/차로\s*이탈\s*방지/, /차선\s*이탈\s*방지/, /차선\s*이탈\s*경보/, /LDWS/i] },
  { id: 'FCWS', patterns: [/전방\s*충돌\s*방지/, /전방\s*추돌/, /다중\s*충돌\s*방지/, /FCWS/i] },
  { id: 'DAW', patterns: [/운전자\s*주의\s*경고/, /DAW/i] },
  { id: 'RCTA', patterns: [/후방\s*교차\s*충돌/, /후측방\s*충돌\s*방지/, /후측방\s*경보/, /RCTA/i] },
  { id: 'HBA', patterns: [/하이빔\s*보조/, /하이빔\s*어시스트/, /HBA/i] },
  { id: 'ROA', patterns: [/후석\s*승객\s*알림/, /ROA/i] },
  { id: 'SEW', patterns: [/안전\s*하차\s*경고/, /안전\s*하차\s*보조/, /SEW/i] },
  { id: 'TPMS', patterns: [/타이어\s*공기압\s*경보/, /타이어\s*공기압\s*감지/, /TPMS/i] },
];

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;
const report = [];

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  if ((d.year_start || '') < SINCE) continue;
  const opts = d.options || {};
  const trims = d.trims || {};
  if (!Object.keys(trims).length) continue;

  // 각 표준 ADAS ID → 매칭되는 옵션 코드 (catalog 사전에서)
  const idToCode = {};
  for (const { id, patterns } of ADAS_PATTERNS) {
    for (const [code, info] of Object.entries(opts)) {
      const name = info?.name || '';
      if (patterns.some(p => p.test(name))) {
        idToCode[id] = code;
        break;
      }
    }
  }

  let trimsTouched = 0;
  const addedPerTrim = {};
  for (const [trimName, trim] of Object.entries(trims)) {
    if (!Array.isArray(trim.basic)) trim.basic = [];
    const before = trim.basic.length;
    for (const id of Object.keys(idToCode)) {
      const code = idToCode[id];
      if (!trim.basic.includes(code)) trim.basic.push(code);
    }
    if (trim.basic.length > before) trimsTouched++;
    addedPerTrim[trimName] = trim.basic.length - before;
  }
  if (trimsTouched === 0) continue;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  const matched = Object.keys(idToCode).length;
  const missing = ADAS_PATTERNS.filter(p => !idToCode[p.id]).map(p => p.id);
  console.log(`${APPLY ? '✓' : '+'} ${d.title}`);
  console.log(`    옵션 사전 매칭 ${matched}/${ADAS_PATTERNS.length} (누락: ${missing.join(', ') || '-'})`);
  console.log(`    trim ${trimsTouched}개 basic 추가`);
  touched++;
  report.push({ id: d.catalog_id, title: d.title, matched, missing, trimsTouched });
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog 갱신`);
const allMissing = {};
for (const r of report) for (const id of r.missing) allMissing[id] = (allMissing[id] || 0) + 1;
console.log('\n옵션 사전 자체에 없는 표준 ADAS (catalog 별 누락 횟수):');
for (const [id, cnt] of Object.entries(allMissing).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(8)} ${cnt}개 catalog`);
}
