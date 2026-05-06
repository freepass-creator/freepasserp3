#!/usr/bin/env node
/**
 * 하이브리드 모델 stub 일괄 생성 — 가솔린 base catalog 의 chassis/year 정보 재사용.
 *
 *  각 entry: { base: 'kia_k5_dl3', cid: 'kia_k5_dl3_hybrid', titleSuffix: ' 하이브리드', aliases: [...] }
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const ENTRIES = [
  { base: 'hyundai_avante_cn7',     cid: 'hyundai_avante_cn7_hybrid',     model: '아반떼' },
  { base: 'hyundai_kona_sx2',       cid: 'hyundai_kona_sx2_hybrid',       model: '코나' },
  { base: 'hyundai_tucson_nx4',     cid: 'hyundai_tucson_nx4_hybrid',     model: '투싼' },
  { base: 'hyundai_santafe_mx5',    cid: 'hyundai_santafe_mx5_hybrid',    model: '싼타페' },
  { base: 'hyundai_palisade_lx3',   cid: 'hyundai_palisade_lx3_hybrid',   model: '팰리세이드' },
  { base: 'kia_k5_dl3',             cid: 'kia_k5_dl3_hybrid',             model: 'K5' },
  { base: 'kia_k8_gl3',             cid: 'kia_k8_gl3_hybrid',             model: 'K8' },
  { base: 'kia_niro_sg2',           cid: 'kia_niro_sg2_hybrid',           model: '니로' },
  { base: 'kia_sorento_mq4',        cid: 'kia_sorento_mq4_hybrid',        model: '쏘렌토' },
  { base: 'kia_sportage_nq5',       cid: 'kia_sportage_nq5_hybrid',       model: '스포티지' },
  { base: 'kia_carnival_ka4',       cid: 'kia_carnival_ka4_hybrid',       model: '카니발' },
];

const today = new Date().toISOString().slice(0, 10);
let created = 0, skipped = 0;

for (const e of ENTRIES) {
  const basePath = path.join(CATALOG_DIR, `${e.base}.json`);
  const newPath = path.join(CATALOG_DIR, `${e.cid}.json`);
  if (!fs.existsSync(basePath)) {
    console.warn(`✗ base 없음: ${e.base}.json (skip)`);
    skipped++;
    continue;
  }
  if (fs.existsSync(newPath)) {
    console.warn(`- 이미 있음: ${e.cid}.json (skip)`);
    skipped++;
    continue;
  }
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const baseTitle = base.title || '';
  // chassis 추출 (마지막 토큰)
  const titleNoMaker = baseTitle.replace(new RegExp('^' + (base.maker || '') + '\\s+'), '').trim();
  const newTitle = `${base.maker} ${titleNoMaker} 하이브리드`;
  const stub = {
    catalog_id: e.cid,
    model_root: e.model,
    title: newTitle,
    maker: base.maker,
    source: 'stub',
    source_urls: [],
    fetched_at: today,
    note: `${e.model} 하이브리드 stub. 트림 데이터 별도 추가 필요.`,
    options: {},
    categories: {},
    trims: {
      "프리미엄": { "slug": "premium", "price": {}, "basic": [], "select": [], "select_groups": [] },
      "익스클루시브": { "slug": "exclusive", "price": {}, "basic": [], "select": [], "select_groups": [] },
      "프레스티지": { "slug": "prestige", "price": {}, "basic": [], "select": [], "select_groups": [] },
      "캘리그래피": { "slug": "calligraphy", "price": {}, "basic": [], "select": [], "select_groups": [] }
    },
    aliases: [
      `${e.model} 하이브리드`,
      `${titleNoMaker} 하이브리드`,
    ],
    year_start: base.year_start || '',
    year_end: base.year_end || '현재',
  };
  if (APPLY) fs.writeFileSync(newPath, JSON.stringify(stub, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${e.cid}: "${newTitle}" (${stub.year_start} ~ ${stub.year_end})`);
  created++;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${created}건 생성, ${skipped}건 스킵`);
if (!APPLY) console.log('--apply 추가하면 실제 생성');
