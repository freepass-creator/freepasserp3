#!/usr/bin/env node
/**
 * auto-suggest-fp-mapping.cjs 의 추정 결과를 _maker-options.json fp_ids 에 직접 적용.
 *
 * 효과:
 *  - 사용자가 일일이 룰 추가하지 않아도 자동 추정된 80+ 옵션이 즉시 매핑 보유
 *  - sync-maker-options-to-rules.cjs 로 키워드 룰 자동 생성
 */
const fs = require('fs');
const path = require('path');
const child = require('child_process');

const MAP_PATH = path.join(__dirname, '..', 'public', 'data', 'car-master', '_maker-options.json');
const APPLY = process.argv.includes('--apply');

// auto-suggest 의 SUGGEST_PATTERNS 와 normName 가져오기 (재사용)
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}

// auto-suggest-fp-mapping.cjs 의 SUGGEST_PATTERNS — 동일 사본 (DRY 위해 require)
const suggestSrc = fs.readFileSync(path.join(__dirname, 'auto-suggest-fp-mapping.cjs'), 'utf8');
const suggestModule = require(path.join(__dirname, 'auto-suggest-fp-mapping.cjs'));
// auto-suggest-fp-mapping.cjs 는 export 안 하므로 직접 다시 패턴 정의
// ... 또는 그냥 SUGGEST_PATTERNS 추출
const patternMatch = suggestSrc.match(/const\s+SUGGEST_PATTERNS\s*=\s*\{([\s\S]*?)\n\};/);
if (!patternMatch) { console.error('SUGGEST_PATTERNS 못 찾음'); process.exit(1); }
const SUGGEST_PATTERNS = eval('({' + patternMatch[1] + '\n})');

function suggestFpIds(name) {
  const n = normName(name);
  const matched = new Set();
  for (const [id, p] of Object.entries(SUGGEST_PATTERNS)) {
    const reqs = p.req || [];
    const anyOf = p.anyOf || [];
    const conflicts = p.conflict || [];
    const reqOk = reqs.length === 0 ? true : reqs.some(k => n.includes(normName(k)));
    if (!reqOk) continue;
    const anyOk = anyOf.length === 0 ? true : anyOf.some(k => n.includes(normName(k)));
    if (!anyOk) continue;
    const noConflict = conflicts.every(k => !n.includes(normName(k)));
    if (!noConflict) continue;
    matched.add(id);
  }
  return [...matched];
}

const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
let touched = 0;
const log = [];

for (const maker of Object.keys(map)) {
  for (const [name, v] of Object.entries(map[maker])) {
    if (v.fp_ids.length) continue;   // 이미 매핑 있으면 skip
    const ids = suggestFpIds(name);
    if (!ids.length) continue;
    if (APPLY) v.fp_ids = ids;
    touched++;
    if (log.length < 30) log.push(`  [${maker}] ${name} → ${ids.join(',')}`);
  }
}

console.log(`자동 추정 적용: ${touched}건`);
log.forEach(l => console.log(l));
if (touched > 30) console.log(`  ... +${touched - 30}건`);

if (APPLY) {
  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
  console.log(`\n✓ ${path.relative(process.cwd(), MAP_PATH)} 저장`);
} else {
  console.log('\n[dry-run] --apply 추가 시 실제 저장');
}
