#!/usr/bin/env node
/**
 * FP 매칭 품질 audit — false positive / over-match 검출.
 *  A. 한 옵션 텍스트가 3+ FP ID 매칭 (over-match — 너무 광범위한 룰 의심)
 *  B. 짧은 키워드 (3자 이하) 단독 매칭 — false positive 위험
 *  C. 의심 매칭 (옵션 텍스트 ↔ 매칭 FP) 샘플
 *
 *  출력: docs/catalog-fp-mapping-quality.md
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const MASTER_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-options-master.js');

const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const RULES = [];
const reLine = /\{\s*kw:\s*['"]([^'"]+)['"]\s*,\s*ids:\s*\[([^\]]+)\]\s*\}/g;
for (const m of [...rulesSrc.matchAll(reLine)]) {
  const ids = m[2].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  RULES.push({ kw: m[1], ids });
}

const masterSrc = fs.readFileSync(MASTER_PATH, 'utf8');
const FP_NAMES = {};
for (const m of masterSrc.matchAll(/\['([A-Z_0-9]+)'\s*,\s*'([^']+)'/g)) FP_NAMES[m[1]] = m[2];

function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}
function matchAll(text) {
  const n = normName(text);
  const matched = new Set();
  for (const r of RULES) {
    if (n.includes(normName(r.kw))) for (const id of r.ids) matched.add(id);
  }
  return [...matched];
}

const POPULAR = ['현대', '기아', '제네시스', 'KGM', '쉐보레'];
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

const overMatch = new Map();   // text → ids[]
const shortKwHits = new Map(); // kw → 매칭된 옵션 텍스트 샘플
const sampleByFp = {};         // fp_id → 옵션 텍스트 샘플 셋

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const opt = d.options || {};
  for (const [code, info] of Object.entries(opt)) {
    const txt = info?.name || '';
    if (!txt) continue;
    const ids = matchAll(txt);
    if (ids.length >= 3) {
      overMatch.set(txt, ids);
    }
    for (const id of ids) {
      if (!sampleByFp[id]) sampleByFp[id] = new Set();
      if (sampleByFp[id].size < 6) sampleByFp[id].add(txt);
    }
  }
}

// 짧은 키워드 (3자 이하 한글 또는 4자 이하 영문) 추출
const shortRules = RULES.filter(r => {
  const k = r.kw;
  return k.length <= 3 || (/^[a-z]+$/i.test(k) && k.length <= 4);
});

const lines = [];
lines.push('# FP 매핑 품질 audit\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)}*\n`);

lines.push('\n## A. Over-match (3+ FP ID 매칭) — 룰 너무 광범위 의심\n');
lines.push(`총 ${overMatch.size}건. 옵션 한 텍스트가 3개+ FP 에 매칭되면 의미 분산.\n`);
lines.push('| 옵션 텍스트 | 매칭 FP IDs |');
lines.push('|---|---|');
const sorted = [...overMatch.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [txt, ids] of sorted.slice(0, 60)) {
  const display = ids.map(id => `${id}(${(FP_NAMES[id] || '').substring(0, 8)})`).join(', ');
  lines.push(`| ${txt.replace(/\|/g, '\\|')} | ${display} |`);
}

lines.push('\n## B. 짧은 키워드 룰 (false positive 위험)\n');
lines.push(`총 ${shortRules.length}개. 3자 이하 한글 또는 4자 이하 영문 키워드.\n`);
lines.push('| kw | ids |');
lines.push('|---|---|');
for (const r of shortRules) {
  lines.push(`| \`${r.kw}\` | ${r.ids.join(', ')} |`);
}

lines.push('\n## C. FP ID 별 매칭 옵션 샘플 (정확도 검토용)\n');
const fpIds = Object.keys(sampleByFp).sort();
for (const id of fpIds) {
  const samples = [...sampleByFp[id]];
  lines.push(`\n### ${id} — ${FP_NAMES[id] || ''}\n`);
  for (const s of samples) lines.push(`- ${s}`);
}

const outPath = path.join(__dirname, '..', 'docs', 'catalog-fp-mapping-quality.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ ${path.relative(process.cwd(), outPath)} 생성`);
console.log(`  - over-match (3+): ${overMatch.size}`);
console.log(`  - 짧은 키워드 룰: ${shortRules.length}`);
console.log(`  - 매칭된 FP ID: ${fpIds.length}`);
