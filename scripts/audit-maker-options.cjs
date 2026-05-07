#!/usr/bin/env node
/**
 * 메이커별 전체 옵션 정리 리포트.
 *  - 모든 catalog 에서 메이커별 옵션 수집 (옵션명 정규화 후 통합)
 *  - FP 매핑됨 / 안됨 분류
 *  - 빈도(used_in) 높은 미매핑 옵션 → 새 FP ID 또는 룰 추가 후보
 *  - 카테고리 분포
 *  - 같은 의미 다른 표기 (정규화 후 동일) 검출
 *
 *  출력: docs/maker-options-audit.md
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const MASTER_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-options-master.js');

const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const RULES = [];
for (const m of rulesSrc.matchAll(/\{\s*kw:\s*['"]([^'"]+)['"]\s*,\s*ids:\s*\[([^\]]+)\]\s*\}/g)) {
  const ids = m[2].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  RULES.push({ kw: m[1], ids });
}
RULES.sort((a, b) => b.kw.length - a.kw.length);
const masterSrc = fs.readFileSync(MASTER_PATH, 'utf8');
const FP_NAMES = {};
for (const m of masterSrc.matchAll(/\['([A-Z_0-9]+)'\s*,\s*'([^']+)'/g)) FP_NAMES[m[1]] = m[2];

function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}
function matchFpIds(text) {
  const n = normName(text);
  const matched = new Set();
  for (const r of RULES) if (n.includes(normName(r.kw))) for (const id of r.ids) matched.add(id);
  return [...matched].sort();
}

const POPULAR_MAKERS = ['현대', '기아', '제네시스', 'KGM'];
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

// 메이커별 옵션 수집
const byMaker = {};   // maker → norm_name → { name, fpIds, used_in, categories, samples }
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const maker = d.maker;
  if (!POPULAR_MAKERS.includes(maker)) continue;
  if (!byMaker[maker]) byMaker[maker] = {};
  const m = byMaker[maker];
  const opts = d.options || {};
  for (const [code, info] of Object.entries(opts)) {
    if (code.startsWith('PKG_')) continue;
    const name = info.name || '';
    if (!name) continue;
    const norm = normName(name);
    if (!m[norm]) {
      m[norm] = {
        name,
        fpIds: matchFpIds(name),
        used_in: 0,
        categories: new Set(),
        catalogs: new Set(),
        variants: new Set(),  // 정규화 후 같은 의미인 다른 표기들
      };
    }
    m[norm].used_in++;
    m[norm].catalogs.add(d.title);
    if (info.category) m[norm].categories.add(info.category);
    m[norm].variants.add(name);
  }
}

const lines = [];
lines.push('# 메이커별 옵션 사전 정리 audit\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)} — 한국 OEM 4개 메이커 (${POPULAR_MAKERS.join('/')})*\n`);

// 메이커별 통계
lines.push('## 통계 요약\n');
lines.push('| 메이커 | 총 옵션 | FP 매핑됨 | FP 매핑 안됨 | 매칭률 |');
lines.push('|---|---|---|---|---|');
for (const maker of POPULAR_MAKERS) {
  const m = byMaker[maker] || {};
  const total = Object.keys(m).length;
  const mapped = Object.values(m).filter(o => o.fpIds.length).length;
  const rate = total ? (mapped / total * 100).toFixed(1) : 0;
  lines.push(`| ${maker} | ${total} | ${mapped} | ${total - mapped} | ${rate}% |`);
}

// 메이커별 미매핑 빈도 top 30
for (const maker of POPULAR_MAKERS) {
  const m = byMaker[maker] || {};
  const unmapped = Object.values(m).filter(o => !o.fpIds.length);
  if (!unmapped.length) continue;
  unmapped.sort((a, b) => b.used_in - a.used_in);
  lines.push(`\n## ${maker} — FP 매핑 안된 옵션 top ${Math.min(30, unmapped.length)} (총 ${unmapped.length}개)\n`);
  lines.push('| 빈도 | 옵션명 | 카테고리 | 변형 표기 |');
  lines.push('|---|---|---|---|');
  for (const o of unmapped.slice(0, 30)) {
    const cats = [...o.categories].join(', ') || '-';
    const variants = o.variants.size > 1 ? `${o.variants.size}종 (${[...o.variants].slice(0, 2).map(v => v.length > 30 ? v.substring(0, 30) + '…' : v).join(' / ')})` : '-';
    const name = o.name.length > 60 ? o.name.substring(0, 60) + '…' : o.name;
    lines.push(`| ${o.used_in} | ${name.replace(/\|/g, '\\|')} | ${cats} | ${variants} |`);
  }
}

// 메이커별 변형 표기 (정규화 후 동일하지만 다른 표기)
for (const maker of POPULAR_MAKERS) {
  const m = byMaker[maker] || {};
  const dupes = Object.values(m).filter(o => o.variants.size > 1);
  if (!dupes.length) continue;
  dupes.sort((a, b) => b.variants.size - a.variants.size);
  lines.push(`\n## ${maker} — 변형 표기 검출 (정규화 후 동일, ${dupes.length}건)\n`);
  lines.push('| 변형 수 | 빈도 | 표기들 |');
  lines.push('|---|---|---|');
  for (const o of dupes.slice(0, 25)) {
    const vs = [...o.variants].map(v => v.length > 50 ? v.substring(0, 50) + '…' : v).join(' / ');
    lines.push(`| ${o.variants.size} | ${o.used_in} | ${vs.replace(/\|/g, '\\|')} |`);
  }
}

// 메이커별 매핑됨 샘플 (FP 카테고리별)
lines.push('\n## FP 매핑된 옵션 샘플 (메이커별 5개)\n');
for (const maker of POPULAR_MAKERS) {
  const m = byMaker[maker] || {};
  const mapped = Object.values(m).filter(o => o.fpIds.length).sort((a, b) => b.used_in - a.used_in);
  if (!mapped.length) continue;
  lines.push(`\n### ${maker}\n`);
  for (const o of mapped.slice(0, 5)) {
    const fpDisplay = o.fpIds.map(id => `${id}(${(FP_NAMES[id] || '').substring(0, 8)})`).join(' / ');
    const name = o.name.length > 40 ? o.name.substring(0, 40) + '…' : o.name;
    lines.push(`- ${name} → ${fpDisplay} (${o.used_in}회)`);
  }
}

const outPath = path.join(__dirname, '..', 'docs', 'maker-options-audit.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ ${path.relative(process.cwd(), outPath)}`);
console.log();
for (const maker of POPULAR_MAKERS) {
  const m = byMaker[maker] || {};
  const total = Object.keys(m).length;
  const mapped = Object.values(m).filter(o => o.fpIds.length).length;
  console.log(`  ${maker}: ${total}개 (FP ${mapped}/${total}, ${total ? (mapped / total * 100).toFixed(1) : 0}%)`);
}
