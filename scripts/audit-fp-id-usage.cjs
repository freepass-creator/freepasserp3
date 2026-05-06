#!/usr/bin/env node
/**
 * FP_OPT_MASTER 의 각 ID 사용 빈도 audit.
 *  - 인기 5메이커 catalog 의 모든 trim basic/select 코드 → 옵션명 → matchFpByName
 *  - 각 FP ID 가 매물에 propagate 되는 빈도 카운트
 *  - 빈도 0 인 ID = 삭제 후보 (실제 한국 시장에서 안 쓰임)
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const MASTER_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-options-master.js');

// FP ID list 추출
const masterSrc = fs.readFileSync(MASTER_PATH, 'utf8');
const FP_IDS = [...masterSrc.matchAll(/\['([A-Z_0-9]+)'\s*,\s*'([^']+)'/g)].map(m => ({ id: m[1], name: m[2] }));

// 룰 추출
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const RULES = [];
const ruleRe = /\{\s*kw:\s*['"]([^'"]+)['"]\s*,\s*ids:\s*\[([^\]]+)\]\s*\}/g;
let m;
while ((m = ruleRe.exec(rulesSrc)) !== null) {
  const kw = m[1];
  const ids = m[2].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  RULES.push({ kw, ids });
}
RULES.sort((a, b) => b.kw.length - a.kw.length);

function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}
function matchFp(name) {
  const n = normName(name);
  const matched = new Set();
  for (const { kw, ids } of RULES) {
    if (n.includes(normName(kw))) ids.forEach(id => matched.add(id));
  }
  return [...matched];
}

const POPULAR = ['현대', '기아', '제네시스', 'KGM', '쉐보레'];
const idCount = {};
for (const { id } of FP_IDS) idCount[id] = 0;

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const opts = d.options || {};
  for (const t of Object.values(d.trims || {})) {
    const codes = [
      ...(t.basic || []),
      ...(t.select || []),
      ...((t.select_groups || []).flatMap(g => Array.isArray(g) ? g : (g.codes || []))),
    ];
    for (const c of codes) {
      const name = opts[c]?.name;
      if (!name) continue;
      for (const id of matchFp(name)) {
        idCount[id] = (idCount[id] || 0) + 1;
      }
    }
  }
}

const sorted = FP_IDS.map(({ id, name }) => ({ id, name, count: idCount[id] || 0 }))
  .sort((a, b) => b.count - a.count);

console.log('# FP 표준옵션 ID 사용 빈도 audit\n');
console.log('| 순위 | FP ID | 한글명 | 매핑 횟수 |');
console.log('|---|---|---|---|');
for (let i = 0; i < sorted.length; i++) {
  const s = sorted[i];
  const flag = s.count === 0 ? '⚠ 미사용' : s.count < 10 ? '· 낮음' : '✓';
  console.log(`| ${i + 1} | ${s.id} | ${s.name} | ${s.count} ${flag} |`);
}

const unused = sorted.filter(s => s.count === 0);
const low = sorted.filter(s => s.count > 0 && s.count < 10);
const high = sorted.filter(s => s.count >= 10);
console.log(`\n총 ${sorted.length}개 ID 중:`);
console.log(`  ✓ 활성 (10+): ${high.length}`);
console.log(`  · 낮음 (1-9): ${low.length}`);
console.log(`  ⚠ 미사용 (0): ${unused.length}`);
console.log(`\n삭제 후보 (미사용 ${unused.length}개):`);
for (const s of unused) console.log(`  ${s.id} (${s.name})`);

// 보고서 저장
const lines = [];
lines.push('# FP 표준옵션 ID 사용 빈도 audit\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)} — catalog 의 trim basic/select 매핑 횟수 기준*\n`);
lines.push(`총 ${sorted.length} ID — 활성 ${high.length} / 낮음 ${low.length} / **미사용 ${unused.length}**\n`);
lines.push('| 순위 | FP ID | 한글명 | 매핑 횟수 | 상태 |');
lines.push('|---|---|---|---|---|');
for (let i = 0; i < sorted.length; i++) {
  const s = sorted[i];
  const flag = s.count === 0 ? '⚠ 미사용' : s.count < 10 ? '· 낮음' : '✓';
  lines.push(`| ${i + 1} | \`${s.id}\` | ${s.name} | ${s.count} | ${flag} |`);
}
const outPath = path.join(__dirname, '..', 'docs', 'fp-id-usage-audit.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`\n✓ ${path.relative(process.cwd(), outPath)} 저장`);
