#!/usr/bin/env node
/**
 * 그랜저 GN7 + IG 정밀 재정비.
 *  - GN7 하이브리드: 2.4 → 1.6 T 정정
 *  - IG 페리 전 가솔린 → 2.4 / 3.0 / 3.3 분리
 *  - IG 페리 전 디젤 catalog 신설
 *  - IG 페리 후 가솔린 → 2.5 + 3.3 분리
 *  - 모든 trim 키 정확화 (가격 검증)
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

function readJson(f) { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
function writeJson(f, d) { if (APPLY) fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 2)); }
function priceObj(만원) { return { base: 만원 * 10000 }; }

// 공통 옵션/카테고리 baseline (기존 catalog 에서 가져옴)
const igBase = readJson('hyundai_grandeur_ig_pre.json');
const igPostBase = readJson('hyundai_grandeur_ig.json');
const gn7Base = readJson('hyundai_grandeur_gn7.json');

function newCatalog(baseSrc, override) {
  const c = JSON.parse(JSON.stringify(baseSrc));
  Object.assign(c, override);
  return c;
}

// =========================================
// 1) GN7 하이브리드: title + trim 키 정정 (1.6 T)
// =========================================
const gn7Hyb = readJson('hyundai_grandeur_gn7_hybrid.json');
gn7Hyb.title = '현대 그랜저 GN7 하이브리드 1.6 T';
gn7Hyb.trims = {
  '프리미엄 5인승':                priceWith(4376, gn7Hyb.trims['프리미엄 2.4']),
  '익스클루시브 5인승':            priceWith(4863, gn7Hyb.trims['익스클루시브 2.4']),
  '캘리그래피 5인승':              priceWith(5263, gn7Hyb.trims['캘리그래피 2.4']),
  '캘리그래피 블랙 익스테리어 5인승': priceWith(5244, gn7Hyb.trims['캘리그래피 블랙 익스테리어 2.4']),
  '캘리그래피 블랙 잉크 5인승':    priceWith(5566, gn7Hyb.trims['캘리그래피 블랙 잉크 2.4']),
};
writeJson('hyundai_grandeur_gn7_hybrid.json', gn7Hyb);

function priceWith(만원, prev) {
  const base = prev || {};
  return { ...base, price: priceObj(만원) };
}

// =========================================
// 2) GN7 가솔린 2.5: 트림 정확화
// =========================================
const gn7G = readJson('hyundai_grandeur_gn7.json');
gn7G.title = '현대 그랜저 GN7 가솔린 2.5';
gn7G.trims = {
  '프리미엄 5인승':                priceWith(3716, gn7G.trims['프리미엄 2.5']),
  '익스클루시브 5인승':            priceWith(4204, gn7G.trims['익스클루시브 2.5']),
  '아너스 5인승':                  priceWith(4513, gn7G.trims['아너스 2.5']),
  '캘리그래피 5인승':              priceWith(4604, gn7G.trims['캘리그래피 2.5']),
  '캘리그래피 블랙 익스테리어 5인승': priceWith(4716, gn7G.trims['캘리그래피 블랙 익스테리어 2.5']),
  '캘리그래피 블랙 잉크 5인승':    priceWith(4912, gn7G.trims['캘리그래피 블랙 잉크 2.5']),
};
writeJson('hyundai_grandeur_gn7.json', gn7G);

// =========================================
// 3) GN7 LPG 3.5: 트림 정확화
// =========================================
const gn7Lpg = readJson('hyundai_grandeur_gn7_lpg.json');
gn7Lpg.title = '현대 그랜저 GN7 LPG 3.5';
gn7Lpg.trims = {
  '프리미엄 5인승':                priceWith(3743, gn7Lpg.trims['프리미엄 3.5']),
  '익스클루시브 5인승':            priceWith(4231, gn7Lpg.trims['익스클루시브 3.5']),
  '익스클루시브 플러스 장애인용 5인승': priceWith(4250, gn7Lpg.trims['익스클루시브 플러스 장애인용 3.0']),
};
writeJson('hyundai_grandeur_gn7_lpg.json', gn7Lpg);

// =========================================
// 4) IG 페리 전 가솔린 → 2.4 / 3.0 / 3.3 분리
// =========================================
const igG24 = newCatalog(igBase, {
  catalog_id: 'hyundai_grandeur_ig_pre',
  title: '현대 그랜저 IG 가솔린 2.4',
  trims: {
    '모던 5인승':           priceObj_(3055),
    '프리미엄 5인승':       priceObj_(3265),
    '프리미엄 스페셜 5인승': priceObj_(3375),
  },
});
writeJson('hyundai_grandeur_ig_pre.json', igG24);

const igG30 = newCatalog(igBase, {
  catalog_id: 'hyundai_grandeur_ig_pre_g30',
  title: '현대 그랜저 IG 가솔린 3.0',
  trims: {
    '익스클루시브 5인승':         priceObj_(3550),
    '익스클루시브 스페셜 5인승': priceObj_(3870),
  },
});
writeJson('hyundai_grandeur_ig_pre_g30.json', igG30);

const igG33 = newCatalog(igBase, {
  catalog_id: 'hyundai_grandeur_ig_pre_g33',
  title: '현대 그랜저 IG 가솔린 3.3',
  year_start: '2017-03',
  trims: {
    '셀러브리티 5인승': priceObj_(4160),
  },
});
writeJson('hyundai_grandeur_ig_pre_g33.json', igG33);

// =========================================
// 5) IG 페리 전 디젤 2.2 catalog 신설
// =========================================
const igDiesel = newCatalog(igBase, {
  catalog_id: 'hyundai_grandeur_ig_pre_d22',
  title: '현대 그랜저 IG 디젤 2.2',
  year_start: '2016-11',
  year_end: '2018-12',
  trims: {
    '모던 5인승':           priceObj_(3355),
    '프리미엄 5인승':       priceObj_(3565),
    '프리미엄 스페셜 5인승': priceObj_(3675),
  },
});
writeJson('hyundai_grandeur_ig_pre_d22.json', igDiesel);

// =========================================
// 6) IG 페리 후 가솔린 → 2.5 + 3.3 분리
// =========================================
const igPostG25 = readJson('hyundai_grandeur_ig.json');
igPostG25.title = '현대 더 뉴 그랜저 IG 가솔린 2.5';
igPostG25.trims = {
  '프리미엄 5인승':       priceObj_(3294),
  '프리미엄 초이스 5인승': priceObj_(3368),
  '르블랑 5인승':         priceObj_(3534),
  '익스클루시브 5인승':   priceObj_(3681),
  '캘리그래피 5인승':     priceObj_(4108),
};
writeJson('hyundai_grandeur_ig.json', igPostG25);

const igPostG33 = newCatalog(igPostBase, {
  catalog_id: 'hyundai_grandeur_ig_g33',
  title: '현대 더 뉴 그랜저 IG 가솔린 3.3',
  trims: {
    '프리미엄 5인승':     priceObj_(3578),
    '르블랑 5인승':       priceObj_(3929),
    '익스클루시브 5인승': priceObj_(3926),
    '캘리그래피 5인승':   priceObj_(4349),
  },
});
writeJson('hyundai_grandeur_ig_g33.json', igPostG33);

// =========================================
// 7) IG 페리 전/후 하이브리드 trim 정확화
// =========================================
const igHybPre = readJson('hyundai_grandeur_ig_hybrid_pre.json');
igHybPre.title = '현대 그랜저 IG 하이브리드 2.4';
igHybPre.year_start = '2017-03';
igHybPre.year_end = '2019-11';
igHybPre.trims = {
  '프리미엄 5인승':         priceObj_(3540),
  '익스클루시브 5인승':     priceObj_(3855),
  '익스클루시브 스페셜 5인승': priceObj_(4070),
};
writeJson('hyundai_grandeur_ig_hybrid_pre.json', igHybPre);

const igHybPost = readJson('hyundai_grandeur_ig_163.json');
igHybPost.title = '현대 더 뉴 그랜저 IG 하이브리드 2.4';
igHybPost.trims = {
  '프리미엄 5인승':       priceObj_(3669),
  '프리미엄 초이스 5인승': priceObj_(3812),
  '익스클루시브 5인승':   priceObj_(4155),
  '캘리그래피 5인승':     priceObj_(4489),
};
writeJson('hyundai_grandeur_ig_163.json', igHybPost);

// =========================================
// 8) IG 페리 전/후 LPG 3.0 trim 정확화
// =========================================
const igLpgPre = readJson('hyundai_grandeur_ig_pre_lpg.json');
igLpgPre.title = '현대 그랜저 IG LPG 3.0';
igLpgPre.trims = {
  '모던 베이직 5인승':    priceObj_(2620),
  '모던 5인승':           priceObj_(2845),
  '익스클루시브 5인승':   priceObj_(3295),
};
writeJson('hyundai_grandeur_ig_pre_lpg.json', igLpgPre);

// IG 페리 후 LPG 3.0 catalog 신설 (현재 없음)
const igPostLpg = newCatalog(igPostBase, {
  catalog_id: 'hyundai_grandeur_ig_lpg',
  title: '현대 더 뉴 그랜저 IG LPG 3.0',
  trims: {
    '모던 베이직 5인승':  priceObj_(3023),
    '프리미엄 5인승':     priceObj_(3328),
    '익스클루시브 5인승': priceObj_(3716),
  },
});
writeJson('hyundai_grandeur_ig_lpg.json', igPostLpg);

function priceObj_(만원) { return { price: priceObj(만원), basic: [], select_groups: [] }; }

// =========================================
// 요약
// =========================================
console.log('=== 그랜저 GN7 + IG 정밀 재정비 ===');
console.log((APPLY ? '✓' : '+') + ' GN7 가솔린 2.5 (6 trim)');
console.log((APPLY ? '✓' : '+') + ' GN7 하이브리드 1.6 T (5 trim) — title 정정 + 1.6 T');
console.log((APPLY ? '✓' : '+') + ' GN7 LPG 3.5 (3 trim)');
console.log((APPLY ? '✓' : '+') + ' IG 페리 전 가솔린 2.4 (3 trim)');
console.log((APPLY ? '✓' : '+') + ' IG 페리 전 가솔린 3.0 (2 trim) — 신규');
console.log((APPLY ? '✓' : '+') + ' IG 페리 전 가솔린 3.3 (1 trim) — 신규');
console.log((APPLY ? '✓' : '+') + ' IG 페리 전 디젤 2.2 (3 trim) — 신규');
console.log((APPLY ? '✓' : '+') + ' IG 페리 전 LPG 3.0 (3 trim)');
console.log((APPLY ? '✓' : '+') + ' IG 페리 전 하이브리드 2.4 (3 trim)');
console.log((APPLY ? '✓' : '+') + ' IG 페리 후 가솔린 2.5 (5 trim)');
console.log((APPLY ? '✓' : '+') + ' IG 페리 후 가솔린 3.3 (4 trim) — 신규');
console.log((APPLY ? '✓' : '+') + ' IG 페리 후 LPG 3.0 (3 trim) — 신규');
console.log((APPLY ? '✓' : '+') + ' IG 페리 후 하이브리드 2.4 (4 trim)');
console.log('\n' + (APPLY ? '적용' : 'dry-run') + ': 13개 catalog 재정비 / 5개 신규');
