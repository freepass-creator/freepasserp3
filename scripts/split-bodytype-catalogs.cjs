#!/usr/bin/env node
/**
 * 유형 C — catalog 1개에 서로 다른 body type / 세대 가 같이 매핑된 케이스를 분리.
 *  예: genesis_g70 = 세단 + 슈팅브레이크 → genesis_g70_st 분리
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'public', 'data', 'car-master');
const IDX = path.join(BASE, '_index.json');

// [부모catalogId, 분리 entries: [splitId, splitTitle, splitEncarKeys, splitTrims]]
const SPLITS = [
  ['genesis_g70', [
    ['genesis_g70_st', '제네시스 G70 슈팅브레이크',
      ['encar_007_003_013'],
      ['스탠다드', '스포츠', '스포츠 프레스티지']],
  ]],
  ['genesis_gv80', [
    ['genesis_gv80_coupe', '제네시스 GV80 쿠페',
      ['encar_007_005_014'],
      ['2.5 터보', '3.5 터보', '3.5 터보 스포츠 패키지', '3.5 터보 스포츠 플러스 패키지']],
  ]],
  ['kgm_torres', [
    ['kgm_torres_evx', 'KGM 토레스 EVX',
      ['encar_004_013_125'],
      ['T7', 'V7', 'X7']],
    ['kgm_torres_facelift', 'KGM 더 뉴 토레스',
      ['encar_004_013_126'],
      ['T7', 'V7', 'V7 PRO']],
  ]],
  ['kgm_musso', [
    ['kgm_musso_ev_o100', 'KGM 무쏘 EV',
      ['encar_004_005_131'],
      ['스탠다드', '프레스티지']],
    ['kgm_musso_q300', 'KGM 무쏘 Q300',
      ['encar_004_005_132'],
      ['L5', 'V5', 'X5']],
    ['kgm_musso_sports', 'KGM 무쏘 스포츠',
      ['encar_004_005_129'],
      ['L5', 'V5', 'X5']],
    ['kgm_musso_sports_khan', 'KGM 무쏘 스포츠 칸',
      ['encar_004_005_130'],
      ['L5', 'V5', 'X5']],
  ]],
  ['kgm_rexton_sports', [
    ['kgm_rexton_sports_khan', 'KGM 렉스턴 스포츠 칸',
      ['encar_004_003_114'],
      ['프로페셔널', '프로페셔널 트림', '슈프림', '헤리티지']],
    ['kgm_rexton_sports_khan_facelift', 'KGM 더 뉴 렉스턴 스포츠 칸',
      ['encar_004_003_119'],
      ['헤리티지', '프리미어', '슈프림', '슈프림 블랙', '슈프림 어드벤처', '리미티드 X']],
  ]],
  ['kgm_tivoli', [
    ['kgm_tivoli_air', 'KGM 티볼리 에어',
      ['encar_004_012_108'],
      ['EX', 'LX', 'LX 디스커버리']],
    ['kgm_tivoli_armour', 'KGM 티볼리 아머',
      ['encar_004_012_112'],
      ['EX', 'LX', 'TX', '기어 에디션']],
    ['kgm_tivoli_very_new', 'KGM 베리 뉴 티볼리',
      ['encar_004_012_116'],
      ['MX', 'EX', 'LX']],
    ['kgm_tivoli_facelift', 'KGM 더 뉴 티볼리',
      ['encar_004_012_123'],
      ['MX', 'V5', 'V7']],
    ['kgm_tivoli_air_facelift', 'KGM 더 뉴 티볼리 에어',
      ['encar_004_012_124'],
      ['MX', 'V5', 'V7']],
  ]],
];

const idx = JSON.parse(fs.readFileSync(IDX, 'utf-8'));
let created = 0, updated = 0;

for (const [parentId, splits] of SPLITS) {
  const parent = idx[parentId];
  if (!parent) { console.log(`✗ ${parentId} 미존재 — 스킵`); continue; }

  const removeKeys = new Set();
  for (const [splitId, splitTitle, splitEncar, splitTrims] of splits) {
    const splitPath = path.join(BASE, splitId + '.json');
    if (!fs.existsSync(splitPath)) {
      const trimsDict = {};
      for (const t of splitTrims) {
        trimsDict[t] = { slug: t.toLowerCase().replace(/[\s-]/g, '_'), price: {}, basic: [], select: [], select_groups: [] };
      }
      fs.writeFileSync(splitPath, JSON.stringify({
        catalog_id: splitId,
        title: splitTitle,
        maker: parent.maker,
        source: 'stub',
        source_urls: [],
        fetched_at: '2026-05-04',
        note: 'body type/세대 분리 stub — 트림명만.',
        options: {},
        categories: {},
        trims: trimsDict,
      }, null, 2), 'utf-8');
      created++;
    }
    if (!idx[splitId]) {
      idx[splitId] = {
        id: splitId,
        title: splitTitle,
        maker: parent.maker,
        source: { manufacturer: null, wikicar: null, encar: splitEncar },
        verified: { manufacturer: false, wikicar: false, encar: true },
        trims: splitTrims,
        fetched_at: '2026-05-04',
        note: 'body type/세대 분리 stub',
      };
    }
    splitEncar.forEach(k => removeKeys.add(k));
  }
  // 부모에서 분리된 encar 제거
  parent.source.encar = (parent.source.encar || []).filter(k => !removeKeys.has(k));
  updated++;
}

fs.writeFileSync(IDX, JSON.stringify(idx, null, 2), 'utf-8');
console.log(`body type 분리: 신규 ${created}개 / 부모 ${updated}개 encar 정리`);
console.log(`전체 카탈로그: ${Object.keys(idx).length}개`);
