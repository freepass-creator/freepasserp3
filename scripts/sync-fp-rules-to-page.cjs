#!/usr/bin/env node
/**
 * src/core/fp-keyword-rules.js 의 FP_KEYWORD_RULES 를
 * vehicle-options-catalog-test.html 의 같은 변수에 동기화.
 *
 * 두 곳에 룰이 분리되어 있어 src/core 만 수정 시 차종 매트릭스 페이지에 반영 안 되던 문제 해결.
 */
const fs = require('fs');
const path = require('path');

const CORE = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const PAGE = path.join(__dirname, '..', 'vehicle-options-catalog-test.html');

const coreSrc = fs.readFileSync(CORE, 'utf8');
const pageSrc = fs.readFileSync(PAGE, 'utf8');

// src/core 의 export const FP_KEYWORD_RULES = [...] 추출
const m = coreSrc.match(/export\s+const\s+FP_KEYWORD_RULES\s*=\s*\[([\s\S]*?)\n\];/);
if (!m) { console.error('✗ src/core 에서 FP_KEYWORD_RULES 못 찾음'); process.exit(1); }
const rulesBody = m[1];

// FP_OPT_MASTER body 추출 (src/core/fp-options-master.js)
const masterPath = path.join(__dirname, '..', 'src', 'core', 'fp-options-master.js');
const masterSrc = fs.readFileSync(masterPath, 'utf8');
const optMatch = masterSrc.match(/export\s+const\s+FP_OPT_MASTER\s*=\s*\{([\s\S]*?)\n\};/);
if (!optMatch) { console.error('✗ FP_OPT_MASTER 못 찾음'); process.exit(1); }
const optBody = optMatch[1];

// 페이지에서 const FP_KEYWORD_RULES + const OPTIONS 둘 다 교체
let newPage = pageSrc.replace(
  /const\s+FP_KEYWORD_RULES\s*=\s*\[[\s\S]*?\n\];/,
  `const FP_KEYWORD_RULES = [${rulesBody}\n];`
);
newPage = newPage.replace(
  /const\s+OPTIONS\s*=\s*\{[\s\S]*?\n\};/,
  `const OPTIONS = {${optBody}\n};`
);
if (newPage === pageSrc) {
  console.error('✗ vehicle-options-catalog-test.html 에서 FP_KEYWORD_RULES/OPTIONS 못 찾음');
  process.exit(1);
}

fs.writeFileSync(PAGE, newPage);
console.log('✓ vehicle-options-catalog-test.html 동기화 완료');

const ruleCount = [...rulesBody.matchAll(/\{\s*kw:/g)].length;
const optCount = [...optBody.matchAll(/\['([A-Z_]+)'/g)].length;
console.log(`  FP_KEYWORD_RULES: ${ruleCount}개 룰`);
console.log(`  OPTIONS (FP_OPT_MASTER): ${optCount}개 ID`);
