#!/usr/bin/env node
/**
 * 카니발 KA4 엔카 기준 규격화 (2026-06-08).
 *  전기형(kia_carnival_ka4): 2020-08~2023-11. X-Line 트림 제거(X라인=페이스리프트부터).
 *  페이스리프트(kia_carnival_ka4_facelift): 연식 2024-12→2023-11.
 *  출처: ino1 KA4 가이드 / namu.wiki 기아카니발 4세대.
 *  ※ 그래비티 트림 추가 + 페이스리프트 엔진(가솔린/하이브리드) 정비는 후속(리치 옵션데이터 필요).
 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'public', 'data', 'car-master');
const load = (id) => JSON.parse(fs.readFileSync(path.join(D, id + '.json'), 'utf8'));
const save = (id, c) => fs.writeFileSync(path.join(D, id + '.json'), JSON.stringify(c, null, 2) + '\n', 'utf8');

// 전기형 — X-Line 제거 + 연식 끝 정정
const pre = load('kia_carnival_ka4');
const beforeTrims = Object.keys(pre.trims || {});
const removed = beforeTrims.filter(k => /^X-?Line/i.test(k));
for (const k of removed) delete pre.trims[k];
pre.year_end = '2023-11';
save('kia_carnival_ka4', pre);
console.log('[전기형 kia_carnival_ka4] X-Line 제거:', JSON.stringify(removed), '| 연식끝→2023-11 | 트림', beforeTrims.length, '→', Object.keys(pre.trims).length);

// 페이스리프트 — 연식 시작 정정
const fl = load('kia_carnival_ka4_facelift');
fl.year_start = '2023-11';
save('kia_carnival_ka4_facelift', fl);
console.log('[페이스리프트 kia_carnival_ka4_facelift] 연식 시작→2023-11 (', fl.year_start, '~', fl.year_end, ')');
