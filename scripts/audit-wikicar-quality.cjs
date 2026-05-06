#!/usr/bin/env node
/**
 * wikicar 출처 catalog 데이터 정합성 audit.
 *
 *  검증 항목:
 *   A. 패키지 codes 분해 정확도 — codes 가 자기 자신 이름만 포함하는 경우 (= OCR 미분해)
 *   B. 트림 basic / select 옵션 코드 vs options 사전 일관성 (orphan 코드)
 *   C. 옵션명 패턴 — 동일 의미 옵션이 여러 표기로 박힌 경우 (정규화 후보)
 *   D. 가격 정합성 — trim.price.base 누락 / 잘못된 형식
 *   E. wikicar source_urls 유효성 (URL 패턴)
 *
 *  출력: docs/wikicar-audit.md
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

const wikicarCatalogs = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const src = d.source || '';
  const isWiki = /wikicar|위키카/i.test(src) || (Array.isArray(d.source_urls) && d.source_urls.some(u => /wikicar/i.test(u)));
  if (isWiki) wikicarCatalogs.push({ f, d });
}

const issues = {
  pkgUndecomposed: [],     // 패키지 codes 가 자기 이름만
  orphanCode: [],           // basic/select 코드가 options 사전에 없음
  missingPrice: [],         // 트림 가격 0/없음
  duplicateOptName: [],     // 옵션 사전에 같은 이름 다른 코드
  emptyTrim: [],            // 트림에 basic 0개
};

for (const { f, d } of wikicarCatalogs) {
  const opts = d.options || {};
  const trims = d.trims || {};

  // C. 옵션 사전 중복 이름
  const nameToCode = new Map();
  for (const [code, info] of Object.entries(opts)) {
    const name = (info?.name || '').trim();
    if (!name) continue;
    if (nameToCode.has(name)) {
      issues.duplicateOptName.push({ catalog: d.catalog_id, name, codes: [nameToCode.get(name), code] });
    } else nameToCode.set(name, code);
  }

  for (const [tname, t] of Object.entries(trims)) {
    // A. 패키지 codes 미분해 — codes 가 패키지 이름만 1개 또는 codes 안 단일 코드의 name 이 패키지 이름과 동일
    const groups = t.select_groups || [];
    for (const g of groups) {
      if (Array.isArray(g)) continue;
      const codes = g.codes || [];
      const pkgName = (g.name || '').trim();
      if (!pkgName) continue;
      const undecomposed = codes.length === 1 && (opts[codes[0]]?.name || '').trim() === pkgName;
      if (undecomposed || codes.length === 0) {
        issues.pkgUndecomposed.push({ catalog: d.catalog_id, trim: tname, pkgName, codes: codes.length });
      }
    }

    // B. orphan code
    const allCodes = [...(t.basic || []), ...(t.select || []), ...groups.flatMap(g => Array.isArray(g) ? g : (g.codes || []))];
    for (const c of allCodes) {
      if (c && !opts[c]) issues.orphanCode.push({ catalog: d.catalog_id, trim: tname, code: c });
    }

    // D. 가격 누락
    const price = t.price?.base || 0;
    if (!price) issues.missingPrice.push({ catalog: d.catalog_id, trim: tname });

    // E. 빈 트림
    if (!(t.basic || []).length) issues.emptyTrim.push({ catalog: d.catalog_id, trim: tname });
  }
}

const lines = [];
lines.push('# wikicar 출처 catalog 정밀 audit\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)} — wikicar catalog ${wikicarCatalogs.length}개*\n`);

lines.push('## 통계\n');
lines.push('| 항목 | 건수 |');
lines.push('|---|---|');
lines.push(`| wikicar catalog 총수 | ${wikicarCatalogs.length} |`);
lines.push(`| A. 패키지 codes 미분해 | ${issues.pkgUndecomposed.length} |`);
lines.push(`| B. orphan 옵션 코드 | ${issues.orphanCode.length} |`);
lines.push(`| C. 옵션 사전 이름 중복 | ${issues.duplicateOptName.length} |`);
lines.push(`| D. 트림 가격 누락 | ${issues.missingPrice.length} |`);
lines.push(`| E. 트림 basic 0개 | ${issues.emptyTrim.length} |`);

// A. 패키지 미분해 — 빈도순
lines.push('\n## A. 패키지 codes 미분해 (OCR 가 패키지 안 옵션 분해 못함)\n');
const pkgByName = new Map();
for (const p of issues.pkgUndecomposed) {
  const k = p.pkgName;
  if (!pkgByName.has(k)) pkgByName.set(k, []);
  pkgByName.get(k).push(p);
}
const pkgSorted = [...pkgByName.entries()].sort((a, b) => b[1].length - a[1].length);
lines.push(`총 ${issues.pkgUndecomposed.length}건 (unique 패키지 ${pkgByName.size}개)\n`);
lines.push('| 패키지명 | 등장 catalog × 트림 | 영향 |');
lines.push('|---|---|---|');
for (const [name, list] of pkgSorted.slice(0, 50)) {
  const cats = [...new Set(list.map(x => x.catalog))];
  lines.push(`| ${name.replace(/\|/g, '\\|')} | ${list.length} | catalog ${cats.length}개 |`);
}
if (pkgSorted.length > 50) lines.push(`\n*... +${pkgSorted.length - 50}개*`);

// 패키지명 중 FP 매핑 룰 없는 것 추출
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const KW_LIST = [...rulesSrc.matchAll(/\{\s*kw:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}
const KW_NORM = new Set(KW_LIST.map(normName));

lines.push('\n## A-1. FP 매핑 룰 없는 패키지명 (보강 후보)\n');
const unmappedPkg = pkgSorted.filter(([name]) => {
  const n = normName(name);
  return ![...KW_NORM].some(k => n.includes(k));
});
lines.push(`총 ${unmappedPkg.length}개 unique 패키지명 — 룰 보강 필요\n`);
lines.push('| 패키지명 | 등장 횟수 |');
lines.push('|---|---|');
for (const [name, list] of unmappedPkg.slice(0, 80)) {
  lines.push(`| ${name.replace(/\|/g, '\\|')} | ${list.length} |`);
}

// B. orphan 코드
if (issues.orphanCode.length) {
  lines.push('\n## B. orphan 옵션 코드 (사전에 없는 코드)\n');
  const byCatalog = new Map();
  for (const o of issues.orphanCode) {
    if (!byCatalog.has(o.catalog)) byCatalog.set(o.catalog, []);
    byCatalog.get(o.catalog).push(o);
  }
  lines.push('| catalog | orphan 코드 수 |');
  lines.push('|---|---|');
  for (const [cat, list] of [...byCatalog.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 30)) {
    lines.push(`| ${cat} | ${list.length} |`);
  }
}

// C. 중복 이름
if (issues.duplicateOptName.length) {
  lines.push('\n## C. 옵션 사전 동일 이름 중복\n');
  lines.push('| catalog | 이름 | 코드들 |');
  lines.push('|---|---|---|');
  for (const d of issues.duplicateOptName.slice(0, 30)) {
    lines.push(`| ${d.catalog} | ${d.name.replace(/\|/g, '\\|')} | ${d.codes.join(', ')} |`);
  }
}

const outPath = path.join(__dirname, '..', 'docs', 'wikicar-audit.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ ${path.relative(process.cwd(), outPath)} 생성`);
console.log(`  wikicar catalog: ${wikicarCatalogs.length}`);
console.log(`  패키지 미분해: ${issues.pkgUndecomposed.length} (unique ${pkgByName.size})`);
console.log(`  매핑 룰 없는 패키지명: ${unmappedPkg.length}`);
console.log(`  orphan code: ${issues.orphanCode.length}`);
console.log(`  중복 이름: ${issues.duplicateOptName.length}`);
console.log(`  가격 누락 trim: ${issues.missingPrice.length}`);
console.log(`  빈 trim: ${issues.emptyTrim.length}`);
