#!/usr/bin/env node
/**
 * 수입 인기 모델 catalog stub 자동 생성
 *   - encar seed 의 미매칭 매물 (2017+ 생산) 중 수입 인기 메이커
 *   - 매물 sub_model → catalog id 변환 + stub catalog 생성 + alias 추가
 *   - 가격 0 / 옵션 0 stub (후속 보강 라운드에서 fill)
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const aliases = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, '_aliases-map.json'), 'utf8'));
const seedRaw = fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.js'), 'utf8');
const encar = JSON.parse(seedRaw.replace(/^window\.ENCAR_MASTER\s*=\s*/, '').replace(/;\s*$/, ''));

const norm = s => (s||'').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g,'').replace(/\s+/g,'');

// 메이커 한글 → catalog id prefix
const MAKER_PREFIX = {
  'BMW': 'bmw',
  '벤츠': 'mercedes',
  '아우디': 'audi',
  '테슬라': 'tesla',
  '볼보': 'volvo',
  '폭스바겐': 'vw',
  '미니': 'mini',
  '포르쉐': 'porsche',
  '랜드로버': 'landrover',
  '지프': 'jeep',
};
const TARGET_MAKERS = Object.keys(MAKER_PREFIX);

// sub_model → catalog id slug 변환 (chassis code 보존)
function subToSlug(sub) {
  return sub
    .toLowerCase()
    .replace(/시리즈/g, '_series')
    .replace(/[\(\)\[\]\-\/\.,&\+°]/g, ' ')
    .replace(/클래스/g, '_class')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// 미매칭 매물 (수입 인기 + 2017+) 추출
const candidates = encar.filter(e => {
  if (e.archived || !e.sub) return false;
  if (!TARGET_MAKERS.includes(e.maker)) return false;
  const y = parseInt((e.production_start||'').match(/(\d{4})/)?.[1] || 0);
  if (y && y < 2017) return false;
  if (!y) return false; // 생산년도 없으면 skip (자료 부족)
  return !aliases[e.maker + '|' + norm(e.sub)];
});

console.log(`수입 미매칭 (2017+ + 생산년도 명시): ${candidates.length}`);

// catalog 생성 + alias 키 셋
const newCatalogs = [];
const aliasAdded = {};
for (const c of candidates) {
  const prefix = MAKER_PREFIX[c.maker];
  const slug = subToSlug(c.sub);
  const catalogId = `${prefix}_${slug}`;
  const fp = path.join(CATALOG_DIR, catalogId + '.json');

  if (fs.existsSync(fp)) {
    // catalog 이미 있음 — alias 만 추가
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    d.aliases = d.aliases || [];
    const aliasKey = norm(c.sub);
    if (!d.aliases.includes(aliasKey)) {
      d.aliases.push(aliasKey);
      fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n', 'utf8');
      aliasAdded[catalogId] = (aliasAdded[catalogId] || 0) + 1;
    }
    continue;
  }

  // 신규 stub catalog
  const catalog = {
    catalog_id: catalogId,
    title: `${c.maker} ${c.sub}`,
    maker: c.maker,
    source: 'auto_stub',
    source_urls: [],
    fetched_at: '2026-05-05',
    categories: {},
    options: {},
    trims: {
      // 단일 stub trim — 가격/옵션 후속 보강
      [`기본 ${c.sub}`]: {
        slug: `기본 ${c.sub}`,
        price: {},
        basic: [],
        select: [],
        select_groups: []
      }
    },
    aliases: [norm(c.sub)],
    year_start: c.production_start || '',
    year_end: c.production_end || '현재',
  };
  fs.writeFileSync(fp, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  newCatalogs.push(catalogId);
}

console.log(`✓ 신규 stub catalog: ${newCatalogs.length}`);
console.log(`✓ 기존 catalog alias 추가: ${Object.keys(aliasAdded).length} catalog (${Object.values(aliasAdded).reduce((a,b)=>a+b,0)} aliases)`);
if (newCatalogs.length) console.log('  신규: ' + newCatalogs.slice(0,15).join(', ') + (newCatalogs.length > 15 ? '...' : ''));
