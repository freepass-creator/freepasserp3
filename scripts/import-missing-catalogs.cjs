#!/usr/bin/env node
/**
 * encar-master-seed 에서 우리 catalog 에 없는 (maker, sub) 를 자동 stub 생성.
 *  - title = "{maker} {sub}"
 *  - year_start/end = production_start/end
 *  - aliases = [sub]
 *  - trims = {} (빈 — 추후 수동 채움)
 *  - source = "encar-seed-auto"
 *
 *  사용:
 *    node scripts/import-missing-catalogs.cjs           # dry-run
 *    node scripts/import-missing-catalogs.cjs --apply   # 실제 catalog json 생성
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const SEED_PATH = path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.json');
const APPLY = process.argv.includes('--apply');

function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '')
    .replace(/\s+/g, '');
}

const MAKER_ENG = {
  '현대': 'hyundai', '기아': 'kia', '제네시스': 'genesis', 'KGM': 'kgm', '쌍용': 'kgm',
  '쉐보레': 'chevrolet', '르노': 'renault', '르노삼성': 'renault',
  'BMW': 'bmw', '벤츠': 'mercedes', '아우디': 'audi', '폭스바겐': 'volkswagen', '미니': 'mini',
  '포르쉐': 'porsche', '재규어': 'jaguar', '랜드로버': 'landrover', '볼보': 'volvo',
  '렉서스': 'lexus', '도요타': 'toyota', '토요타': 'toyota', '혼다': 'honda', '닛산': 'nissan',
  '인피니티': 'infiniti', '미쓰비시': 'mitsubishi', '스바루': 'subaru',
  '포드': 'ford', '링컨': 'lincoln', '캐딜락': 'cadillac', '크라이슬러': 'chrysler',
  '지프': 'jeep', '닷지': 'dodge', '뷰익': 'buick', '폰티악': 'pontiac', '새턴': 'saturn',
  '머큐리': 'mercury', '올즈모빌': 'oldsmobile',
  '테슬라': 'tesla', '리비안': 'rivian',
  '마세라티': 'maserati', '페라리': 'ferrari', '람보르기니': 'lamborghini', '벤틀리': 'bentley',
  '롤스로이스': 'rollsroyce', '부가티': 'bugatti', '맥라렌': 'mclaren', '애스턴마틴': 'astonmartin',
  '알피네': 'alpine', '알파로메오': 'alfaromeo', '피아트': 'fiat', '란치아': 'lancia',
  '시트로엥': 'citroen', '푸조': 'peugeot', 'DS': 'ds',
  '스코다': 'skoda', '세아트': 'seat',
  '오펠': 'opel', '복스홀': 'vauxhall',
  '기타 제조사': 'misc',
};

function makeCatalogId(maker, sub, idx) {
  const eng = MAKER_ENG[maker] || normName(maker) || 'misc';
  let slug = (sub || '').toLowerCase()
    .replace(/[\(\)\[\]\.,&\+°/]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_가-힣]/g, '')   // 한글 보존
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (slug.length < 2) slug = `m${idx}`;
  return `${eng}_${slug}`;
}

const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
const aliasMap = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, '_aliases-map.json'), 'utf8'));

// alias map normalized
const normMap = {};
for (const [k, cid] of Object.entries(aliasMap)) {
  const [mk, alias] = k.split('|');
  normMap[`${mk}|${normName(alias)}`] = cid;
}

// 기존 catalog id 세트 (충돌 방지)
const existingIds = new Set(
  fs.readdirSync(CATALOG_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => f.replace('.json', ''))
);

// 누락 → stub 후보 추출
const stubs = [];
const seenCid = new Set();
let idx = 0;

for (const e of seed) {
  if (e.archived) continue;
  if (!e.maker || !e.sub) continue;
  const k = `${e.maker}|${normName(e.sub)}`;
  if (normMap[k]) continue;
  // 같은 (maker, sub) 중복 방지
  if (seenCid.has(k)) continue;
  seenCid.add(k);

  let cid = makeCatalogId(e.maker, e.sub, idx);
  // 충돌 시 idx 붙이기
  while (existingIds.has(cid) || stubs.some(s => s.cid === cid)) {
    cid = `${cid}_${idx}`;
    idx++;
  }
  idx++;

  stubs.push({
    cid,
    seed: e,
  });
}

console.log(`기존 catalog: ${existingIds.size}개`);
console.log(`누락 stub 후보: ${stubs.length}개`);

// 메이커별 분포
const byMaker = {};
for (const s of stubs) {
  byMaker[s.seed.maker] = (byMaker[s.seed.maker] || 0) + 1;
}
console.log('\n메이커별:');
for (const mk of Object.keys(byMaker).sort()) {
  console.log(`  ${mk}: ${byMaker[mk]}`);
}

if (!APPLY) {
  console.log('\n[dry-run] --apply 추가하면 catalog json 실제 생성');
  console.log('샘플 5건:');
  for (const s of stubs.slice(0, 5)) {
    console.log(`  ${s.cid}.json — ${s.seed.maker} ${s.seed.sub} (${s.seed.production_start}~${s.seed.production_end})`);
  }
  process.exit(0);
}

// --apply 실행
let created = 0;
const today = new Date().toISOString().slice(0, 10);
for (const s of stubs) {
  const e = s.seed;
  const stub = {
    catalog_id: s.cid,
    model_root: '',  // extract-model-root.cjs 로 자동 추출
    title: `${e.maker} ${e.sub}`,
    maker: e.maker,
    source: 'encar-seed-auto',
    source_urls: [],
    fetched_at: today,
    note: `encar-master-seed 자동 import (${e._key || ''})`,
    options: {},
    categories: {},
    trims: {},
    aliases: [e.sub, e.car_name].filter((v, i, a) => v && a.indexOf(v) === i),
    year_start: e.production_start || '',
    year_end: e.production_end || '',
  };
  if (e.category) stub.category_seed = e.category;
  fs.writeFileSync(path.join(CATALOG_DIR, `${s.cid}.json`), JSON.stringify(stub, null, 2));
  created++;
}
console.log(`\n✓ ${created}건 catalog stub 생성 완료`);
console.log('  다음: node scripts/extract-model-root.cjs --apply  (model_root 추출)');
console.log('  다음: node scripts/rebuild-catalog-index.cjs       (_index.json 갱신)');
console.log('  다음: node scripts/build-aliases-map.cjs           (_aliases-map.json 갱신)');
console.log('  다음: node scripts/build-car-master-bundle.cjs     (_bundle.js 갱신)');
