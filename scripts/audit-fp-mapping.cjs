#!/usr/bin/env node
/**
 * 트림 옵션 → FP 표준옵션 매핑 audit.
 *
 *  A. catalog × 트림별 옵션 채움 상태 (basic / select / select_groups 비어있는지)
 *  B. 옵션 텍스트 → FP 표준옵션 매칭률 (FP_KEYWORD_RULES 통한 매칭)
 *  C. 매칭 실패한 옵션 텍스트 후보 (FP_KEYWORD_RULES 보강 필요)
 *
 *  출력: docs/catalog-fp-mapping.md
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');

// fp-keyword-rules.js 파싱 — kw 키 추출
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const KW_LIST = [...rulesSrc.matchAll(/\{\s*kw:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '')
    .replace(/\s+/g, '');
}
function matchKeywords(text) {
  const n = normName(text);
  const matched = [];
  for (const kw of KW_LIST) {
    if (n.includes(normName(kw))) matched.push(kw);
  }
  return matched;
}

const POPULAR_MAKERS = ['현대', '기아', '제네시스', 'KGM', '쉐보레'];
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

const stats = {
  totalCatalog: 0,
  catalogWithTrims: 0,
  totalTrims: 0,
  trimsWithOptions: 0,
  totalOptionTexts: 0,
  matchedOptions: 0,
  unmatchedOptions: 0,
};
const trimEmpty = [];
const unmatchedTexts = new Map();
const catalogOptCount = [];

// 옵션 코드 → name 변환 (catalog.options 사전)
function codeToName(code, optDict) {
  if (!code) return '';
  const entry = optDict[code];
  if (entry?.name) return entry.name;
  // 사전에 없으면 코드 그대로 (매칭 불가 표시용)
  return /^[A-Z]{2,}[0-9_]+/.test(code) ? '' : code;   // 코드처럼 생긴 건 무시
}

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  if (!POPULAR_MAKERS.includes(d.maker)) continue;
  stats.totalCatalog++;
  const trims = d.trims || {};
  const optDict = d.options || {};
  if (!Object.keys(trims).length) continue;
  stats.catalogWithTrims++;

  let anyOption = false;
  let optCount = 0;
  for (const [trimName, trim] of Object.entries(trims)) {
    stats.totalTrims++;
    const basic = Array.isArray(trim?.basic) ? trim.basic : [];
    const select = Array.isArray(trim?.select) ? trim.select : [];
    const groups = Array.isArray(trim?.select_groups) ? trim.select_groups : [];
    // groups 는 codes 배열 또는 items 배열 둘 다 지원
    const groupCodes = groups.flatMap(g =>
      [...(Array.isArray(g?.codes) ? g.codes : []),
       ...(Array.isArray(g?.items) ? g.items : [])]
    );
    // 코드 → 이름 변환 (사전 매칭 안 되면 텍스트 그대로 유지)
    const allTexts = [...basic, ...select, ...groupCodes]
      .map(t => codeToName(t, optDict))
      .filter(Boolean);
    if (!allTexts.length) continue;
    stats.trimsWithOptions++;
    anyOption = true;
    optCount += allTexts.length;

    for (const txt of allTexts) {
      stats.totalOptionTexts++;
      const matches = matchKeywords(txt);
      if (matches.length) stats.matchedOptions++;
      else {
        stats.unmatchedOptions++;
        unmatchedTexts.set(txt, (unmatchedTexts.get(txt) || 0) + 1);
      }
    }
  }
  if (!anyOption) {
    trimEmpty.push({ id: d.catalog_id || f.replace('.json', ''), title: d.title, trims: Object.keys(trims).length });
  } else {
    catalogOptCount.push({ id: d.catalog_id, title: d.title, optCount });
  }
}

const lines = [];
lines.push('# Catalog 트림 → FP 표준옵션 매핑 검수\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)} — 인기 메이커 ${POPULAR_MAKERS.join('/')}*\n`);

lines.push('## 통계 요약\n');
lines.push(`| 지표 | 값 |`);
lines.push(`|---|---|`);
lines.push(`| catalog 총수 | ${stats.totalCatalog} |`);
lines.push(`| trim 보유 catalog | ${stats.catalogWithTrims} |`);
lines.push(`| trim 총수 | ${stats.totalTrims} |`);
lines.push(`| 옵션 텍스트 보유 trim | ${stats.trimsWithOptions} (${stats.totalTrims ? (stats.trimsWithOptions / stats.totalTrims * 100).toFixed(1) : 0}%) |`);
lines.push(`| 옵션 텍스트 총수 | ${stats.totalOptionTexts} |`);
lines.push(`| **FP 매칭 성공** | ${stats.matchedOptions} (${stats.totalOptionTexts ? (stats.matchedOptions / stats.totalOptionTexts * 100).toFixed(1) : 0}%) |`);
lines.push(`| FP 매칭 실패 | ${stats.unmatchedOptions} |`);
lines.push(`| FP_KEYWORD_RULES 등록 키워드 | ${KW_LIST.length} |`);

lines.push('\n## A. 옵션 텍스트 비어있는 catalog (trim 키만, basic/select 모두 빈 stub)\n');
lines.push(`총 ${trimEmpty.length}건 — 트림 옵션 데이터 보강 필요\n`);
lines.push(`| catalog_id | title | trim 수 |`);
lines.push(`|---|---|---|`);
trimEmpty.sort((a, b) => a.id.localeCompare(b.id));
for (const t of trimEmpty.slice(0, 80)) {
  lines.push(`| ${t.id} | ${t.title} | ${t.trims} |`);
}
if (trimEmpty.length > 80) lines.push(`\n*... +${trimEmpty.length - 80}건*`);

lines.push('\n## B. FP 매칭 실패 옵션 텍스트 (FP_KEYWORD_RULES 보강 후보)\n');
const sortedUnmatched = [...unmatchedTexts.entries()].sort((a, b) => b[1] - a[1]);
lines.push(`총 ${sortedUnmatched.length}종 (중복 제거 후)\n`);
lines.push(`| 빈도 | 옵션 텍스트 |`);
lines.push(`|---|---|`);
for (const [txt, cnt] of sortedUnmatched.slice(0, 150)) {
  lines.push(`| ${cnt} | ${txt} |`);
}
if (sortedUnmatched.length > 150) lines.push(`\n*... +${sortedUnmatched.length - 150}종*`);

lines.push('\n## C. 옵션 텍스트 풍부 catalog Top 30 (참조용)\n');
catalogOptCount.sort((a, b) => b.optCount - a.optCount);
lines.push(`| catalog_id | title | 옵션 수 |`);
lines.push(`|---|---|---|`);
for (const c of catalogOptCount.slice(0, 30)) {
  lines.push(`| ${c.id} | ${c.title} | ${c.optCount} |`);
}

const outPath = path.join(__dirname, '..', 'docs', 'catalog-fp-mapping.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));

console.log(`✓ ${path.relative(process.cwd(), outPath)} 생성`);
console.log(`  - catalog ${stats.totalCatalog} / trim ${stats.totalTrims} / 옵션 텍스트 ${stats.totalOptionTexts}`);
console.log(`  - FP 매칭률: ${stats.matchedOptions}/${stats.totalOptionTexts} (${stats.totalOptionTexts ? (stats.matchedOptions / stats.totalOptionTexts * 100).toFixed(1) : 0}%)`);
console.log(`  - 옵션 비어있는 catalog: ${trimEmpty.length}개`);
console.log(`  - 매칭 실패 unique: ${sortedUnmatched.length}종`);
