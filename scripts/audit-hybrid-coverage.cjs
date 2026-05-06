#!/usr/bin/env node
/**
 * 인기차종 하이브리드 catalog 누락 점검.
 *  - 가솔린 catalog 가 있는데 같은 chassis 의 하이브리드 catalog 가 없음 → 누락
 *  - 가솔린 페리 후가 있는데 하이브리드 페리 후가 누락 → 누락
 */
const fs = require('fs');
const path = require('path');

const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_index.json'), 'utf8'));
const all = Object.values(idx);

// chassis 추출 — title 마지막 토큰 (영문+숫자, "하이브리드" 제외)
function extractChassis(title) {
  const t = (title || '').replace(/하이브리드/g, '').trim();
  const tokens = t.split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (/^[A-Z][A-Z0-9]*\d*$/.test(last)) return last;
  return '';
}
function isHybrid(title) { return /하이브리드|hybrid|hev/i.test(title || ''); }
function isPeri(title, maker) {
  const t = (title || '').replace(maker + ' ', '');
  return /^더\s*뉴\s/.test(t);
}

// (maker, model_root, chassis, periSign) → catalog 매핑
const map = new Map();
for (const c of all) {
  const ch = extractChassis(c.title);
  if (!ch) continue;
  const key = `${c.maker}|${c.model_root}|${ch}`;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push({
    id: c.id,
    title: c.title,
    isHybrid: isHybrid(c.title),
    isPeri: isPeri(c.title, c.maker),
    year_start: c.year_start || '',
    year_end: c.year_end || '',
  });
}

// 누락 후보
const missing = [];
for (const [key, list] of map) {
  const [maker, model, chassis] = key.split('|');
  // 인기 메이커만
  if (!['현대', '기아', '제네시스', 'KGM', '쉐보레'].includes(maker)) continue;

  const hasGasoline = list.some(c => !c.isHybrid && !c.isPeri);
  const hasGasolinePeri = list.some(c => !c.isHybrid && c.isPeri);
  const hasHybrid = list.some(c => c.isHybrid && !c.isPeri);
  const hasHybridPeri = list.some(c => c.isHybrid && c.isPeri);

  if (hasGasoline && !hasHybrid) {
    missing.push({ key, type: '하이브리드 페리 전', maker, model, chassis, base: list.find(c => !c.isHybrid && !c.isPeri) });
  }
  if (hasGasolinePeri && !hasHybridPeri) {
    missing.push({ key, type: '하이브리드 페리 후', maker, model, chassis, base: list.find(c => !c.isHybrid && c.isPeri) });
  }
}

// 출시 연식이 새로운 (year_start >= 2018) 만 우선 표시
missing.sort((a, b) => (b.base?.year_start || '').localeCompare(a.base?.year_start || ''));

console.log(`전체 누락 후보: ${missing.length}건\n`);
for (const m of missing) {
  if ((m.base?.year_start || '') < '2015-01') continue;
  console.log(`  [${m.type}] ${m.maker} ${m.model} ${m.chassis}`);
  console.log(`     base: ${m.base?.title} (${m.base?.year_start} ~ ${m.base?.year_end})`);
}
