#!/usr/bin/env node
/**
 * 매물 매칭 시뮬레이터
 *   encar-master seed 의 sub_model 을 매물처럼 가공해 catalog 매칭률 측정
 *   Phase 1 (encar 의존 제거 + 연식 매칭) 효과 정량화
 *
 *   기준:
 *     - aliases-map: 매물의 maker|sub → catalog_id 매칭
 *     - year-ranges: 매물의 year 가 catalog year_start ~ year_end 안에 있으면 정매칭
 *
 *   출력: docs/product-matching-report.md
 */
const fs = require('fs');
const path = require('path');

const aliases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_aliases-map.json'), 'utf8'));
const yearRanges = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_year-ranges.json'), 'utf8'));

// encar seed 로드
const seedRaw = fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.js'), 'utf8');
const seedJson = seedRaw.replace(/^window\.ENCAR_MASTER\s*=\s*/, '').replace(/;\s*$/, '');
const encar = JSON.parse(seedJson);

function normalize(s) {
  return (s || '')
    .replace(/[\(\)\[\]\-_\/\.,&\+°]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function inRange(year, range) {
  if (!year || !range) return null;
  const y = parseInt(year, 10);
  if (!y) return null;
  const startY = parseInt((range.start || '').match(/(\d{4})/)?.[1] || 0);
  const endY = range.end === '현재' ? 9999 : parseInt((range.end || '').match(/(\d{4})/)?.[1] || 0);
  if (!startY) return null;
  return y >= startY && y <= endY;
}

const stats = {
  total: encar.length,
  archived: 0,
  withSub: 0,
  noSub: 0,
  aliasMatched: 0,
  aliasMissed: 0,
  yearInRange: 0,
  yearOutRange: 0,
  yearUnknown: 0,
};
const popStats = { matched: 0, missed: 0, total: 0 };
const POPULAR = {
  '현대': ['그랜저','쏘나타','아반떼','싼타페','투싼','코나','팰리세이드','캐스퍼','아이오닉','스타리아'],
  '기아': ['카니발','쏘렌토','스포티지','k5','k8','셀토스','니로','ev6','ev9','모닝','레이'],
  '제네시스': ['g70','g80','g90','gv60','gv70','gv80'],
  'KGM': ['토레스','코란도','티볼리','액티언','액티온'],
};
const isPopularSub = (maker, sub) => {
  const list = POPULAR[maker] || [];
  const s = (sub || '').toLowerCase();
  return list.some(k => s.includes(k.toLowerCase()));
};
const missedSamples = [];
const popMissedSamples = [];
const yearOutSamples = [];
const matchedByMaker = {};

for (const e of encar) {
  if (e.archived) { stats.archived++; continue; }
  const maker = e.maker;
  const sub = e.sub || e.car_name;
  if (!sub) { stats.noSub++; continue; }
  stats.withSub++;

  const isPop = isPopularSub(maker, sub);
  if (isPop) popStats.total++;

  const key = `${maker}|${normalize(sub)}`;
  const catalogId = aliases[key];
  if (!catalogId) {
    stats.aliasMissed++;
    if (isPop) {
      popStats.missed++;
      if (popMissedSamples.length < 30) popMissedSamples.push({ maker, sub, prod_start: e.production_start, prod_end: e.production_end });
    }
    if (missedSamples.length < 30) missedSamples.push({ maker, sub, prod_start: e.production_start, prod_end: e.production_end });
    continue;
  }
  stats.aliasMatched++;
  if (isPop) popStats.matched++;
  matchedByMaker[maker] = (matchedByMaker[maker] || 0) + 1;

  // 연식 매칭 — production_start 사용
  const year = parseInt((e.production_start || '').match(/(\d{4})/)?.[1] || 0);
  const range = yearRanges[catalogId];
  if (!year || !range) { stats.yearUnknown++; continue; }
  const inR = inRange(year, range);
  if (inR === null) { stats.yearUnknown++; }
  else if (inR) stats.yearInRange++;
  else {
    stats.yearOutRange++;
    yearOutSamples.push({
      maker, sub: e.sub, year,
      catalogId, range_start: range.start, range_end: range.end,
      prod_start: e.production_start, prod_end: e.production_end,
    });
  }
}

const lines = [];
lines.push('# 매물 매칭 시뮬레이션 보고서');
lines.push('');
lines.push(`> 생성: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
lines.push(`> 데이터: encar-master-seed.js (${encar.length} entries)`);
lines.push('');
lines.push('## 매칭률');
lines.push('');
const subTotal = stats.withSub;
const matchedPct = (stats.aliasMatched / subTotal * 100).toFixed(1);
const missedPct = (stats.aliasMissed / subTotal * 100).toFixed(1);
lines.push(`- 전체 매물: ${stats.total} (archived ${stats.archived} 제외, sub 미입력 ${stats.noSub} 제외)`);
lines.push(`- 분석 대상: **${subTotal}**`);
lines.push(`- 🟢 alias 매칭: **${stats.aliasMatched}** (${matchedPct}%)`);
lines.push(`- 🔴 alias 미매칭: **${stats.aliasMissed}** (${missedPct}%)`);
lines.push('');
lines.push('## 인기 모델 한정 매칭률 (work queue 화이트리스트)');
lines.push('');
lines.push(`- 인기 모델 매물: **${popStats.total}**`);
const popMatchPct = popStats.total ? (popStats.matched / popStats.total * 100).toFixed(1) : '0';
lines.push(`- 🟢 매칭: **${popStats.matched}** (${popMatchPct}%)`);
lines.push(`- 🔴 미매칭: **${popStats.missed}**`);
lines.push('');
if (popMissedSamples.length) {
  lines.push('### 인기 모델 미매칭 샘플 (alias 추가 필요)');
  lines.push('');
  lines.push('| 메이커 | sub_model | 생산기간 |');
  lines.push('|---|---|---|');
  popMissedSamples.forEach(s => lines.push(`| ${s.maker} | ${s.sub} | ${s.prod_start || '?'} ~ ${s.prod_end || '?'} |`));
  lines.push('');
}
lines.push('## 연식 정합성 (alias 매칭된 매물 중)');
lines.push('');
lines.push(`- 🟢 catalog year_range 안: **${stats.yearInRange}** (${(stats.yearInRange/stats.aliasMatched*100).toFixed(1)}%)`);
lines.push(`- 🟡 범위 밖: **${stats.yearOutRange}** (${(stats.yearOutRange/stats.aliasMatched*100).toFixed(1)}%)`);
lines.push(`- ⚪ 연식/range 정보 없음: **${stats.yearUnknown}**`);
lines.push('');

// 범위 밖 케이스 — catalog year_range 부정확 또는 잘못된 alias 매핑
if (yearOutSamples.length) {
  lines.push('### 연식 범위 밖 상세 (catalog year_range 검토 필요)');
  lines.push('');
  lines.push('| 메이커 | sub_model (매물) | 매물 연식 | catalog | catalog 범위 |');
  lines.push('|---|---|---:|---|---|');
  // catalog 별 그룹화 (가장 자주 문제되는 catalog 상위)
  const byCatalog = new Map();
  for (const s of yearOutSamples) {
    if (!byCatalog.has(s.catalogId)) byCatalog.set(s.catalogId, []);
    byCatalog.get(s.catalogId).push(s);
  }
  // catalog 별 상위 20 표시
  [...byCatalog.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20).forEach(([cid, list]) => {
    list.slice(0, 3).forEach(s => {
      lines.push(`| ${s.maker} | ${s.sub} | ${s.year} | \`${cid}\` | ${s.range_start || '?'} ~ ${s.range_end || '?'} |`);
    });
    if (list.length > 3) lines.push(`| | (+${list.length - 3} 동일 catalog) | | | |`);
  });
  lines.push('');
}
lines.push('## 메이커별 매칭 매물 수');
lines.push('');
lines.push('| 메이커 | 매칭 수 |');
lines.push('|---|---:|');
Object.entries(matchedByMaker).sort((a,b) => b[1]-a[1]).forEach(([m, n]) => {
  lines.push(`| ${m} | ${n} |`);
});
lines.push('');
lines.push('## 미매칭 sub_model 샘플 (최대 30)');
lines.push('');
lines.push('| 메이커 | sub_model | 생산기간 |');
lines.push('|---|---|---|');
missedSamples.forEach(s => {
  lines.push(`| ${s.maker} | ${s.sub} | ${s.prod_start || '?'} ~ ${s.prod_end || '?'} |`);
});

const OUTPUT = path.join(__dirname, '..', 'docs', 'product-matching-report.md');
fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');

console.log(`✓ 매물 ${subTotal}개 시뮬:`);
console.log(`  alias 매칭 ${stats.aliasMatched} (${matchedPct}%) / 미매칭 ${stats.aliasMissed} (${missedPct}%)`);
console.log(`  연식 정합 ${stats.yearInRange} / 범위밖 ${stats.yearOutRange} / 알수없음 ${stats.yearUnknown}`);
console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);
