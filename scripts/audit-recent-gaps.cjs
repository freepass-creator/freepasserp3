#!/usr/bin/env node
/**
 * 10년 이내 (2016+) active 인기차종 catalog 빠진 곳 정밀 점검.
 *  active = 같은 model_root 안에 year_start >= 2016 인 catalog 있는 경우
 *  매트릭스 빈 칸 = · (catalog 자체 없음)
 */
const fs = require('fs');
const path = require('path');

const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_index.json'), 'utf8'));
const all = Object.values(idx);

function isHybrid(t) { return /하이브리드|hev|hybrid/i.test(t || ''); }
function isEV(t) { return /일렉트리파이드|electrified|일렉트릭|electric|\bev\b|아이오닉|ioniq/i.test(t || ''); }
function isPeri(c) { return /^(?:더\s*뉴|더뉴|디\s*뉴)\s/.test((c.title || '').replace(c.maker + ' ', '')); }

const POPULAR = ['현대', '기아', '제네시스', 'KGM', '쉐보레'];
const byModel = new Map();
for (const c of all) {
  if (!POPULAR.includes(c.maker)) continue;
  if (!c.maker || !c.model_root) continue;
  const k = `${c.maker}|${c.model_root}`;
  if (!byModel.has(k)) byModel.set(k, []);
  byModel.get(k).push(c);
}

const FUELS = [
  { key: 'gas', label: '가솔린', test: c => !isHybrid(c.title) && !isEV(c.title) },
  { key: 'hyb', label: '하이브리드', test: c => isHybrid(c.title) },
  { key: 'ev',  label: 'EV', test: c => isEV(c.title) && !isHybrid(c.title) },
];

console.log('# 10년 이내 active 인기차종 — 매트릭스 빈 칸\n');
console.log('범례: ✓ 있음 / ⚠ stub (가격 데이터 0) / · 없음(빈 칸 = 누락 가능성)\n');

const allGaps = [];
for (const [k, list] of byModel) {
  const [maker, model] = k.split('|');
  // active = 가장 최신 year_start >= 2016
  const latestYs = list.map(c => c.year_start || '').sort().pop();
  if (!latestYs || latestYs < '2016-01') continue;
  // 매트릭스
  const matrix = {};
  for (const peri of [false, true]) {
    for (const fuel of FUELS) {
      const matched = list.filter(c => isPeri(c) === peri && fuel.test(c));
      const key = `${peri ? '후' : '전'}·${fuel.label}`;
      if (!matched.length) matrix[key] = '·';
      else if (matched.every(c => Object.keys(c.trims_meta || {}).length === 0)) matrix[key] = '⚠';
      else matrix[key] = '✓';
    }
  }
  // 빈 칸이 있으면 출력
  const blanks = Object.entries(matrix).filter(([_, v]) => v === '·').map(([k]) => k);
  if (!blanks.length) continue;
  // 이 빈 칸이 진짜 빠진 건지 판단 — 가솔린 모델인데 EV 빈 칸은 자연스러움
  // 보고는 모두 표시, 사용자가 확정
  const cells = Object.entries(matrix).map(([k, v]) => `${k}=${v}`).join(' | ');
  console.log(`## ${maker} / ${model}  (latest ${latestYs})`);
  console.log(`  ${cells}`);
  console.log(`  catalog (${list.length}):`);
  list.sort((a, b) => (b.year_start || '').localeCompare(a.year_start || ''));
  for (const c of list) {
    console.log(`    - ${c.title.padEnd(30)} (${c.year_start || '-'} ~ ${c.year_end || '-'})`);
  }
  console.log('');
  allGaps.push({ maker, model, blanks, latestYs });
}

console.log(`\n총 ${allGaps.length}개 모델에 빈 칸 존재 (2016+ active)`);
