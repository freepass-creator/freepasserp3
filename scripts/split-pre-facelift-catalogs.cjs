#!/usr/bin/env node
/**
 * 유형 B — catalog 1개에 페리 전 (구) 모델 + 페리 후 (현 = "더 뉴 X") encar 가 같이 매핑된 케이스를 페리 전 별도 catalog 로 분리.
 *
 *  예: hyundai_staria 가 encar_001_060_171 (스타리아 2021) + encar_001_060_198 (더 뉴 스타리아 2024) 둘 다 가짐
 *      → hyundai_staria_pre 신설 (스타리아 페리 전), hyundai_staria 는 더 뉴 만 유지
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'public', 'data', 'car-master');
const IDX = path.join(BASE, '_index.json');

// 분리 대상: [현catalogId, preCatalogId, preTitle, preEncarKey(들), preTrims]
const SPLITS = [
  ['hyundai_staria',  'hyundai_staria_pre',  '현대 스타리아',
    ['encar_001_060_171'],
    ['투어러 9인승', '투어러 11인승', '카고', '라운지 9인승', '라운지 7인승']],
  ['hyundai_ioniq5',  'hyundai_ioniq5_pre',  '현대 아이오닉5',
    ['encar_001_061_172'],
    ['스탠다드 익스클루시브', '스탠다드 프레스티지', '롱레인지 익스클루시브', '롱레인지 프레스티지']],
  ['hyundai_ioniq6',  'hyundai_ioniq6_pre',  '현대 아이오닉6',
    ['encar_001_063_176'],
    ['스탠다드 익스클루시브', '롱레인지 익스클루시브', '롱레인지 프레스티지']],
  ['hyundai_casper',  'hyundai_casper_pre',  '현대 캐스퍼',
    ['encar_001_062_174'],
    ['스마트', '모던', '인스퍼레이션', '액티브 2', '크로스']],
  ['kia_k8_gl3',      'kia_k8_gl3_pre',      '기아 K8 GL3',
    ['encar_002_065_156', 'encar_002_065_158'],
    ['노블레스 라이트', '노블레스', '시그니처']],
  ['kia_ev6',         'kia_ev6_pre',         '기아 EV6',
    ['encar_002_066_162'],
    ['라이트', '에어', '어스', 'GT-Line', 'GT']],
];

const idx = JSON.parse(fs.readFileSync(IDX, 'utf-8'));
let created = 0, updated = 0;

for (const [curId, preId, preTitle, preEncar, preTrims] of SPLITS) {
  const curEntry = idx[curId];
  if (!curEntry) { console.log(`✗ ${curId} 미존재 — 스킵`); continue; }

  // 1) preCatalog stub 생성
  const prePath = path.join(BASE, preId + '.json');
  if (!fs.existsSync(prePath)) {
    const trimsDict = {};
    for (const t of preTrims) {
      trimsDict[t] = { slug: t.toLowerCase().replace(/[\s-]/g, '_'), price: {}, basic: [], select: [], select_groups: [] };
    }
    const maker = curEntry.maker;
    fs.writeFileSync(prePath, JSON.stringify({
      catalog_id: preId,
      title: preTitle,
      maker,
      source: 'stub',
      source_urls: [],
      fetched_at: '2026-05-04',
      note: '페리 전 stub — 트림명만. 가격/옵션 추후.',
      options: {},
      categories: {},
      trims: trimsDict,
    }, null, 2), 'utf-8');
    created++;
  }

  // 2) _index 등록
  if (!idx[preId]) {
    idx[preId] = {
      id: preId,
      title: preTitle,
      maker: curEntry.maker,
      source: { manufacturer: null, wikicar: null, encar: preEncar },
      verified: { manufacturer: false, wikicar: false, encar: true },
      trims: preTrims,
      fetched_at: '2026-05-04',
      note: '페리 전 stub',
    };
  }

  // 3) cur 의 encar 에서 preEncar 제거
  const curEncar = (curEntry.source.encar || []).filter(k => !preEncar.includes(k));
  curEntry.source.encar = curEncar;
  updated++;
}

fs.writeFileSync(IDX, JSON.stringify(idx, null, 2), 'utf-8');
console.log(`페리 전 catalog 분리: 신규 ${created}개 / 기존 ${updated}개 encar 정리`);
console.log(`전체 카탈로그: ${Object.keys(idx).length}개`);
