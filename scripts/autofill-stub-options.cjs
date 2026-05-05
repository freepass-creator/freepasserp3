#!/usr/bin/env node
/**
 * 옵션 stub catalog 자동 분배
 *   - catalog 의 categories.* 안 옵션 ID 를 trim grade 비례로 분배
 *   - entry-level → 적게, top-level → 많이
 *   - basic 0 인 trim 에만 적용 (멱등)
 *
 *   주의: 정확치 100% 아님. 매물 매칭의 baseline 제공 (stub 0 → 옵션 있는 trim).
 *   정밀화는 위키카 OCR 후속 라운드.
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// grade 순서 (낮을수록 entry, 높을수록 top)
const GRADE_ORDER = [
  // 한국식
  '베이직','스마트','트렌디','디럭스','스탠다드','모던','럭셔리','프레스티지','에어',
  '에이치-픽','어스','VIP','노블레스','시그니처','GT-Line','캘리그래피','마스터','GT','플래티넘','프레지던트',
  // 외국식
  'Trend','Active','Premium','Inspiration','Luxury','Sport',
];
function gradeIndex(name) {
  // 옵션 패키지 처리 — 이름에 grade 가 없으면 -1
  for (let i = 0; i < GRADE_ORDER.length; i++) {
    if (name.includes(GRADE_ORDER[i])) return i;
  }
  return -1;
}

// 카테고리별 grade 매핑 (entry 도 포함되는 카테고리 vs top 만 포함되는 카테고리)
// ratio = entry/mid/top 별 포함 비율
const CATEGORY_RATIO = {
  // 모든 trim 기본 (안전 기본)
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

function distributeOptions(catalog) {
  const cats = catalog.categories || {};
  const trims = catalog.trims || {};
  const trimNames = Object.keys(trims);
  if (!trimNames.length) return 0;

  // grade 인덱스 정렬 (오름차순) — entry-level 우선
  const sorted = trimNames.map(n => ({ name: n, grade: gradeIndex(n) })).filter(x => x.grade >= 0).sort((a, b) => a.grade - b.grade);
  if (!sorted.length) return 0;

  const minG = sorted[0].grade;
  const maxG = sorted[sorted.length - 1].grade;
  const range = maxG - minG || 1;

  let totalAdded = 0;
  for (const { name } of sorted) {
    const t = trims[name];
    if (!t || (t.basic && t.basic.length > 0)) continue; // 이미 옵션 있으면 skip
    if (!t.basic) t.basic = [];

    const tier = (gradeIndex(name) - minG) / range; // 0 ~ 1
    const tierIdx = tier <= 0.34 ? 0 : tier <= 0.67 ? 1 : 2;

    for (const [catName, ids] of Object.entries(cats)) {
      const ratios = CATEGORY_RATIO[catName] || DEFAULT_RATIO;
      const ratio = ratios[tierIdx];
      const takeCount = Math.round(ids.length * ratio);
      // 안정적인 분배 — 처음 N개 가져옴 (옵션 ID 순서가 의미있는 순서일 가능성)
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
let touched = 0, optionsAdded = 0;
for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const id = d.catalog_id || f.replace(/\.json$/, '');
  if (!isPopular(d.maker, id)) continue;
  if (!d.categories || !Object.keys(d.categories).length) continue; // 옵션 마스터 없으면 분배 불가

  const yearStart = d.year_start || '';
  const ym = yearStart.match(/(\d{4})/);
  if (ym && parseInt(ym[1]) < 2017) continue; // 2017 이전 빼기

  const before = JSON.stringify(d.trims);
  const added = distributeOptions(d);
  const after = JSON.stringify(d.trims);
  if (after !== before) {
    fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n', 'utf8');
    touched++;
    optionsAdded += added;
    console.log(`  ${id.padEnd(35)} +${added} 옵션`);
  }
}
console.log(`✓ ${touched} catalog touched, 총 ${optionsAdded} 옵션 분배`);
