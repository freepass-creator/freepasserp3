#!/usr/bin/env node
/**
 * 같은 모델 family 에서 옵션 마스터 복제 + grade 분배
 *   - stub catalog (categories 비어있음) 가 페리/세대 분기일 때
 *   - 같은 family 의 옵션 풍부한 catalog 에서 categories + options 복제
 *   - trim 별 basic 은 grade 비례로 분배
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// catalog id → family base name (페리/세대/HEV/EV 분기 무관)
//   kona_os / kona_os_facelift / kona_sx2 → 'kona'
//   palisade_lx2 / palisade_lx2_facelift / palisade_lx3 → 'palisade'
function familyKey(id) {
  // maker_modelroot 매칭 — 첫 토큰 + 두 번째 토큰 (모델명만)
  const parts = id.split('_');
  if (parts.length < 2) return id;
  return parts[0] + '_' + parts[1];
}

const GRADE_ORDER = [
  '베이직','스마트','트렌디','디럭스','스탠다드','모던','액티브','럭셔리','크로스',
  '프레스티지','에어','에이치-픽','어스','VIP','인스퍼레이션','노블레스','시그니처',
  'GT-Line','캘리그래피','마스터','GT','플래티넘','프레지던트','X-Line','이-라이트','이-밸류','이밸류',
  'H-Pick','N라인','N 라인',
];
function gradeIndex(name) {
  for (let i = 0; i < GRADE_ORDER.length; i++) {
    if (name.includes(GRADE_ORDER[i])) return i;
  }
  return -1;
}

const CATEGORY_RATIO = {
  '안전':                [0.85, 0.95, 1.00],
  '파워트레인':           [1.00, 1.00, 1.00],
  '파워트레인/성능':      [1.00, 1.00, 1.00],
  '편의':                [0.30, 0.65, 0.95],
  '인포테인먼트':         [0.40, 0.70, 0.95],
  '내장':                [0.30, 0.65, 0.95],
  '시트':                [0.20, 0.55, 0.95],
  '외장':                [0.40, 0.70, 0.95],
  '외관':                [0.40, 0.70, 0.95],
  '첨단 운전자 보조(ADAS)': [0.50, 0.80, 1.00],
  '첨단 운전자 보조 (ADAS)': [0.50, 0.80, 1.00],
  '지능형 안전 기술':     [0.50, 0.80, 1.00],
  '선택사양':             [0.10, 0.30, 0.60],
  '미디어':              [0.40, 0.70, 0.95],
};
const DEFAULT_RATIO = [0.40, 0.70, 0.95];

function distributeBasic(catalog) {
  const cats = catalog.categories || {};
  const trims = catalog.trims || {};
  const trimNames = Object.keys(trims);
  if (!trimNames.length || !Object.keys(cats).length) return 0;

  // grade 인덱스 정렬 — 매칭 안 되는 trim 은 mid (1) 로 fallback
  const indexed = trimNames.map(n => ({ name: n, grade: gradeIndex(n) }));
  const matched = indexed.filter(x => x.grade >= 0).sort((a, b) => a.grade - b.grade);

  // 모든 trim 의 tier 계산 (매칭 안 되면 mid)
  let getTier;
  if (matched.length >= 2) {
    const minG = matched[0].grade;
    const maxG = matched[matched.length - 1].grade;
    const range = maxG - minG || 1;
    getTier = (n) => {
      const g = gradeIndex(n);
      if (g < 0) return 1; // mid fallback
      const tier = (g - minG) / range;
      return tier <= 0.34 ? 0 : tier <= 0.67 ? 1 : 2;
    };
  } else {
    // grade 매칭 1개 이하 → 모두 mid
    getTier = () => 1;
  }

  let totalAdded = 0;
  for (const name of trimNames) {
    const t = trims[name];
    if (!t || (t.basic && t.basic.length > 0)) continue;
    if (!t.basic) t.basic = [];
    const tierIdx = getTier(name);
    for (const [catName, ids] of Object.entries(cats)) {
      const ratios = CATEGORY_RATIO[catName] || DEFAULT_RATIO;
      const takeCount = Math.round(ids.length * ratios[tierIdx]);
      const chosen = ids.slice(0, takeCount);
      for (const id of chosen) if (!t.basic.includes(id)) t.basic.push(id);
    }
    totalAdded += t.basic.length;
  }
  return totalAdded;
}

const POPULAR = {
  '현대': ['grandeur','sonata','avante','santa_fe','santafe','tucson','kona','palisade','casper','ioniq','staria'],
  '기아': ['carnival','sorento','sportage','k5','k8','seltos','niro','ev6','ev9','morning','ray'],
  '제네시스': ['g70','g80','g90','gv60','gv70','gv80'],
  'KGM': ['torres','korando','tivoli','actyon'],
};
const isPopular = (maker, id) => (POPULAR[maker]||[]).some(k => id.includes(k));

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

// 1. 모든 catalog 로드 + family 매핑
const catalogs = files.map(f => {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const id = d.catalog_id || f.replace(/\.json$/, '');
  return { id, family: familyKey(id), data: d, fp };
});

// 2. family 별 옵션 풍부 catalog 식별 (donor)
const familyDonors = {};
for (const c of catalogs) {
  if (!c.data.categories || !Object.keys(c.data.categories).length) continue;
  const optCount = Object.keys(c.data.options || {}).length;
  if (optCount > (familyDonors[c.family]?.optCount || 0)) {
    familyDonors[c.family] = { catalog: c, optCount };
  }
}

let touched = 0, optionsAdded = 0;
for (const c of catalogs) {
  const id = c.id;
  if (!isPopular(c.data.maker, id)) continue;
  const ym = (c.data.year_start || '').match(/(\d{4})/);
  if (ym && parseInt(ym[1]) < 2017) continue;

  const trims = c.data.trims || {};
  const hasEmpty = Object.values(trims).some(t => !t.basic || t.basic.length === 0);
  if (!hasEmpty) continue; // 모든 trim 이미 채워짐 → skip

  // donor 찾기 — 자기 자신이 donor 면 categories 복제 skip 만 하고 분배는 진행
  const donor = familyDonors[c.family];
  const isSelfDonor = donor && donor.catalog.id === id;

  if (!isSelfDonor && donor) {
    // categories + options 복제 (이미 있으면 유지)
    if (!c.data.categories || !Object.keys(c.data.categories).length) {
      c.data.categories = JSON.parse(JSON.stringify(donor.catalog.data.categories || {}));
    }
    if (!c.data.options || !Object.keys(c.data.options).length) {
      c.data.options = JSON.parse(JSON.stringify(donor.catalog.data.options || {}));
    }
  }
  // categories 가 여전히 비어있으면 분배 불가
  if (!c.data.categories || !Object.keys(c.data.categories).length) continue;

  // trim basic 분배
  const added = distributeBasic(c.data);
  if (added > 0) {
    fs.writeFileSync(c.fp, JSON.stringify(c.data, null, 2) + '\n', 'utf8');
    touched++;
    optionsAdded += added;
    console.log(`  ${id.padEnd(38)} ← ${donor.catalog.id.padEnd(30)} +${added}`);
  }
}
console.log(`\n✓ ${touched} catalog touched, 총 ${optionsAdded} basic 옵션 분배`);
