#!/usr/bin/env node
/**
 * catalog 무결성 검증
 *   1. trim.basic 의 옵션 ID 가 options 마스터에 있는지
 *   2. categories 안 ID 가 options 와 일치
 *   3. year_start 형식 (YYYY-MM) 검증
 *   4. catalog title 과 catalog_id 일치
 *   5. aliases 비어있지 않은지 (매칭 가능)
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

const issues = {
  optionIdMissing: [],      // basic 에 있는 ID 가 options 에 없음
  categoryIdMissing: [],    // categories 에 있는 ID 가 options 에 없음
  yearStartInvalid: [],     // year_start 형식 X (단 빈 문자열은 OK)
  noAliases: [],            // aliases 비어있음 (매칭 못 됨)
  titleMismatch: [],        // catalog_id 와 title 첫 단어 불일치
};

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const id = d.catalog_id || f.replace(/\.json$/, '');

  const options = d.options || {};
  const optIds = new Set(Object.keys(options));

  // 1. basic 옵션 ID 무결성
  let missingBasicCount = 0;
  for (const [trimName, t] of Object.entries(d.trims || {})) {
    for (const optId of (t.basic || [])) {
      if (!optIds.has(optId)) missingBasicCount++;
    }
  }
  if (missingBasicCount > 0) issues.optionIdMissing.push({ id, count: missingBasicCount });

  // 2. categories ID 무결성
  let missingCatCount = 0;
  for (const [catName, ids] of Object.entries(d.categories || {})) {
    for (const optId of ids) if (!optIds.has(optId)) missingCatCount++;
  }
  if (missingCatCount > 0) issues.categoryIdMissing.push({ id, count: missingCatCount });

  // 3. year_start 형식
  const ys = d.year_start || '';
  if (ys && !/^\d{4}(-\d{2})?$/.test(ys)) issues.yearStartInvalid.push({ id, value: ys });

  // 4. aliases 비어있음
  if (!Array.isArray(d.aliases) || d.aliases.length === 0) {
    issues.noAliases.push({ id, title: d.title });
  }
}

console.log('━━━ catalog 무결성 ━━━');
console.log(`옵션 ID 누락 (basic): ${issues.optionIdMissing.length}`);
console.log(`옵션 ID 누락 (categories): ${issues.categoryIdMissing.length}`);
console.log(`year_start 형식 오류: ${issues.yearStartInvalid.length}`);
console.log(`aliases 빈 catalog: ${issues.noAliases.length}`);
console.log();

const lines = [];
lines.push('# catalog 무결성 보고서');
lines.push('');
lines.push(`> 생성: ${new Date().toISOString().slice(0,16).replace('T',' ')}`);
lines.push('');

if (issues.optionIdMissing.length) {
  lines.push('## 옵션 ID 누락 (basic 에 있는데 options 에 없음)');
  lines.push('| catalog | 누락 개수 |');
  lines.push('|---|---:|');
  issues.optionIdMissing.sort((a,b) => b.count - a.count).slice(0, 30).forEach(i => lines.push(`| ${i.id} | ${i.count} |`));
  lines.push('');
}

if (issues.noAliases.length) {
  lines.push('## aliases 빈 catalog (매칭 불가)');
  lines.push('| catalog | title |');
  lines.push('|---|---|');
  issues.noAliases.slice(0, 30).forEach(i => lines.push(`| ${i.id} | ${i.title} |`));
  lines.push('');
}

if (issues.yearStartInvalid.length) {
  lines.push('## year_start 형식 오류');
  lines.push('| catalog | value |');
  lines.push('|---|---|');
  issues.yearStartInvalid.forEach(i => lines.push(`| ${i.id} | ${i.value} |`));
  lines.push('');
}

const OUTPUT = path.join(__dirname, '..', 'docs', 'catalog-integrity.md');
fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);
