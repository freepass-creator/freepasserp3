#!/usr/bin/env node
/**
 * 제네시스 GV80 엔카 기준 규격화 (2026-06-08).
 *  전기형(genesis_gv80_pre, 2020~2024): 디젤 3.0 AWD 추가(핵심 엔진), e-SC 슈퍼차저 제거(=2024 페리/쿠페부터).
 *  쿠페(genesis_gv80_coupe): 연식 2023-03→2024-04 (2023-11 공개, 2024 판매).
 *  디올뉴 페리(genesis_gv80): 그대로(2.5T/3.5T/3.5T e-SC AWD 정상).
 *  옵션은 엔진 무관 → 디젤은 가솔린 3.5T AWD 구조 클론(가격만 비움). 출처: Wikipedia/Genesis.
 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'public', 'data', 'car-master');
const load = (id) => JSON.parse(fs.readFileSync(path.join(D, id + '.json'), 'utf8'));
const save = (id, c) => fs.writeFileSync(path.join(D, id + '.json'), JSON.stringify(c, null, 2) + '\n', 'utf8');

// 전기형
const pre = load('genesis_gv80_pre');
const before = Object.keys(pre.trims);
// e-SC 슈퍼차저 제거 (전기형엔 없음)
for (const k of before) if (/슈퍼차저/.test(k)) delete pre.trims[k];
// 디젤 3.0 AWD 추가 (가솔린 3.5T AWD 구조 클론, 가격 비움)
if (!Object.keys(pre.trims).some(k => /^디젤/.test(k))) {
  const base = pre.trims['가솔린 3.5 T AWD'] || Object.values(pre.trims)[0];
  const diesel = JSON.parse(JSON.stringify(base));
  diesel.slug = '디젤 3.0 AWD';
  diesel.price = {};
  pre.trims = { '가솔린 2.5 T AWD': pre.trims['가솔린 2.5 T AWD'], '가솔린 3.5 T AWD': pre.trims['가솔린 3.5 T AWD'], '디젤 3.0 AWD': diesel };
}
save('genesis_gv80_pre', pre);
console.log('[전기형 genesis_gv80_pre] 트림', before.length, '→', Object.keys(pre.trims).length, ':', JSON.stringify(Object.keys(pre.trims)));

// 쿠페 연식
const coupe = load('genesis_gv80_coupe');
const oc = coupe.year_start;
coupe.year_start = '2024-04';
save('genesis_gv80_coupe', coupe);
console.log('[쿠페 genesis_gv80_coupe] 연식 시작', oc, '→', coupe.year_start);
