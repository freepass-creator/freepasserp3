#!/usr/bin/env node
/**
 * _maker-options.json 의 매핑된 옵션명 → fp-keyword-rules.js 자동 생성 룰로 변환.
 *
 * 워크플로우:
 *  1. 사용자가 _maker-options.json 의 fp_ids 채움 (수동 또는 auto-suggest)
 *  2. 이 스크립트 실행 → fp-keyword-rules.js 의 AUTO-GENERATED 섹션에 룰 자동 삽입
 *  3. sync-fp-rules-to-page.cjs 로 페이지에도 동기화
 *
 * AUTO-GENERATED 섹션:
 *  // [AUTO] === maker-options 매핑 시작 ===
 *  ... 룰 ...
 *  // [AUTO] === maker-options 매핑 끝 ===
 *
 * 매번 실행 시 위 섹션만 갱신, 수동 작성 룰은 그대로 보존.
 */
const fs = require('fs');
const path = require('path');

const MAP_PATH = path.join(__dirname, '..', 'public', 'data', 'car-master', '_maker-options.json');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');

const START_MARK = '  // [AUTO] === maker-options 매핑 시작 — sync-maker-options-to-rules.cjs ===';
const END_MARK = '  // [AUTO] === maker-options 매핑 끝 ===';

function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}

const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));

// 옵션명 → fp_ids 수집 (메이커 무관, 같은 옵션명은 fp_ids 합집합)
const nameToIds = new Map();
for (const maker of Object.keys(map)) {
  for (const [name, v] of Object.entries(map[maker])) {
    if (!v.fp_ids?.length) continue;
    const norm = normName(name);
    if (norm.length < 2) continue;
    if (!nameToIds.has(norm)) nameToIds.set(norm, new Set());
    v.fp_ids.forEach(id => nameToIds.get(norm).add(id));
  }
}

// 룰 생성 — kw 길이 내림차순 (긴 키 먼저 매칭)
const ruleLines = [];
const sortedNames = [...nameToIds.entries()].sort((a, b) => b[0].length - a[0].length);
for (const [norm, idsSet] of sortedNames) {
  const ids = [...idsSet];
  // 너무 짧은 키 (< 3자) 또는 매우 긴 키 (> 60자) 는 매칭 신뢰도 낮음
  if (norm.length < 3) continue;
  if (norm.length > 60) continue;
  // 따옴표 escape
  const kwEsc = norm.replace(/'/g, "\\'");
  ruleLines.push(`  { kw:'${kwEsc}', ids:[${ids.map(i => `'${i}'`).join(',')}] },`);
}

const newSection = [START_MARK, ...ruleLines, END_MARK].join('\n');
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');

let newSrc;
if (rulesSrc.includes(START_MARK) && rulesSrc.includes(END_MARK)) {
  // 기존 섹션 교체
  newSrc = rulesSrc.replace(
    new RegExp(START_MARK.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '[\\s\\S]*?' + END_MARK.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')),
    newSection
  );
} else {
  // 새로 삽입 — 마지막 export 직전
  newSrc = rulesSrc.replace(
    /(\n\];\s*\n*)(?=\s*export\s+function|\s*\/\*[\s\S]*?normName)/,
    `\n${newSection}\n$1`
  );
  if (newSrc === rulesSrc) {
    // fallback — 마지막 닫는 ]; 직전
    newSrc = rulesSrc.replace(/(\n\];\s*\n)/, `\n${newSection}\n$1`);
  }
}

fs.writeFileSync(RULES_PATH, newSrc);
console.log(`✓ fp-keyword-rules.js 갱신`);
console.log(`  AUTO 룰 ${ruleLines.length}개 (maker-options 매핑 기반)`);
