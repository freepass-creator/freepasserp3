#!/usr/bin/env node
/**
 * 카니발 하이리무진 세대 분리:
 *  1) YP 하이리무진 (2014-2021) catalog 신규 생성
 *  2) KA4 하이리무진 페리 전후 분리
 *     - kia_carnival_ka4_hi_limousine.json (페리 전, 2021.07-2023.10): 시그니처 디젤 2.2 9인승
 *     - kia_carnival_ka4_hi_limousine_facelift.json (페리 후 = 더 뉴 카니발 하이리무진, 2023.11-): 8개 트림
 *
 *  세부모델 dropdown 표시 (model_root: '카니발 하이리무진'):
 *    - 더 뉴 카니발 하이리무진 (KA4 페리)
 *    - 카니발 하이리무진 KA4 (페리 전)
 *    - 올 뉴 카니발 하이리무진 (YP)
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// 1) 현재 KA4 hi-limousine catalog 읽기 (현재 9 trims = 페리 전 1 + 페리 후 8 통합)
const KA4 = JSON.parse(fs.readFileSync(path.join(DIR, 'kia_carnival_ka4_hi_limousine.json'), 'utf8'));

const PRE_FL_TRIMS = ['시그니처 디젤 2.2 9인승'];
const POST_FL_TRIMS = [
  '노블레스 가솔린 3.5 9인승',
  '노블레스 하이브리드 1.6T 9인승',
  '시그니처 가솔린 3.5 9인승',
  '시그니처 가솔린 3.5 7인승',
  '시그니처 가솔린 3.5 4인승',
  '시그니처 하이브리드 1.6T 9인승',
  '시그니처 하이브리드 1.6T 7인승',
  '시그니처 하이브리드 1.6T 4인승',
];

// KA4 페리 전 (디젤 단일)
const ka4Pre = JSON.parse(JSON.stringify(KA4));
ka4Pre.catalog_id = 'kia_carnival_ka4_hi_limousine';
ka4Pre.title = '기아 카니발 하이리무진 KA4';
ka4Pre.year_start = '2021-07';
ka4Pre.year_end = '2023-10';
ka4Pre.trims = {};
for (const k of PRE_FL_TRIMS) {
  if (KA4.trims[k]) {
    const t = JSON.parse(JSON.stringify(KA4.trims[k]));
    delete t.discontinued;
    ka4Pre.trims[k] = t;
  }
}

// KA4 페리 후 (= 더 뉴 카니발 하이리무진)
const ka4Post = JSON.parse(JSON.stringify(KA4));
ka4Post.catalog_id = 'kia_carnival_ka4_hi_limousine_facelift';
ka4Post.title = '기아 더 뉴 카니발 하이리무진 KA4';
ka4Post.year_start = '2023-11';
ka4Post.year_end = '현재';
ka4Post.trims = {};
for (const k of POST_FL_TRIMS) {
  if (KA4.trims[k]) ka4Post.trims[k] = JSON.parse(JSON.stringify(KA4.trims[k]));
}

// 2) YP 하이리무진 catalog (옵션 사전 / 카테고리는 KA4 페리 전 기반으로 복사)
const yp = JSON.parse(JSON.stringify(KA4));
yp.catalog_id = 'kia_carnival_yp_hi_limousine';
yp.model_root = '카니발 하이리무진';
yp.title = '기아 올 뉴 카니발 하이리무진 YP';
yp.maker = '기아';
yp.year_start = '2014-06';
yp.year_end = '2021-06';
yp.source_urls = [
  'https://auto.danawa.com/auto/?Work=model&Model=3152',
  'https://namu.wiki/w/%EA%B8%B0%EC%95%84%20%EC%B9%B4%EB%8B%88%EB%B0%9C/3%EC%84%B8%EB%8C%80',
];

// YP 트림 (페리 전후 통합, 럭셔리 / 프레스티지 / 노블레스 디젤 2.2 9인승)
// basic 은 KA4 페리 전 시그니처 트림을 약식으로 복사 (정확한 옵션 매핑은 추후 보강)
const sigBasic = (KA4.trims['시그니처 디젤 2.2 9인승']?.basic || []).slice();
const sigSG    = (KA4.trims['시그니처 디젤 2.2 9인승']?.select_groups || []).slice();
yp.trims = {
  '럭셔리 디젤 2.2 9인승':    { price: { base: 48150000 }, basic: sigBasic.slice(0, Math.floor(sigBasic.length * 0.5)), select_groups: sigSG },
  '프레스티지 디젤 2.2 9인승': { price: { base: 51630000 }, basic: sigBasic.slice(0, Math.floor(sigBasic.length * 0.75)), select_groups: sigSG },
  '노블레스 디젤 2.2 9인승':  { price: { base: 55440000 }, basic: sigBasic.slice(), select_groups: sigSG },
};

console.log('=== 카니발 하이리무진 세대 분리 ===\n');
console.log('1) YP 하이리무진 (' + yp.year_start + ' ~ ' + yp.year_end + ') — ' + Object.keys(yp.trims).length + '개 trim');
for (const [k, t] of Object.entries(yp.trims)) console.log('   • ' + k + ' — ' + (t.price.base/10000).toLocaleString() + '만원');

console.log('\n2) KA4 하이리무진 페리 전 (' + ka4Pre.year_start + ' ~ ' + ka4Pre.year_end + ') — ' + Object.keys(ka4Pre.trims).length + '개 trim');
for (const [k, t] of Object.entries(ka4Pre.trims)) console.log('   • ' + k + ' — ' + (t.price.base/10000).toLocaleString() + '만원');

console.log('\n3) KA4 하이리무진 페리 후 = 더 뉴 (' + ka4Post.year_start + ' ~ ' + ka4Post.year_end + ') — ' + Object.keys(ka4Post.trims).length + '개 trim');
for (const [k, t] of Object.entries(ka4Post.trims)) console.log('   • ' + k + ' — ' + (t.price.base/10000).toLocaleString() + '만원');

if (APPLY) {
  fs.writeFileSync(path.join(DIR, 'kia_carnival_yp_hi_limousine.json'), JSON.stringify(yp, null, 2));
  fs.writeFileSync(path.join(DIR, 'kia_carnival_ka4_hi_limousine.json'), JSON.stringify(ka4Pre, null, 2));
  fs.writeFileSync(path.join(DIR, 'kia_carnival_ka4_hi_limousine_facelift.json'), JSON.stringify(ka4Post, null, 2));
  console.log('\n✓ 적용: 3개 catalog (YP 신규 / KA4 페리 전·후 분리)');
} else {
  console.log('\n(dry-run — --apply 추가)');
}
