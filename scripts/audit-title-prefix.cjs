#!/usr/bin/env node
/**
 * catalog title 의 페리 prefix 분포 audit.
 *  메이커 prefix 제거 후 첫 단어가 "올 뉴" / "디 올 뉴" / "더 뉴" / 등인지 분류.
 */
const idx = require('../public/data/car-master/_index.json');
const all = Object.values(idx);

const stats = {};
const samples = {};
for (const c of all) {
  const maker = c.maker || '';
  const title = c.title || '';
  const noMaker = maker
    ? title.replace(new RegExp('^' + maker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+'), '')
    : title;
  let prefix = '(없음)';
  if (/^디\s*올\s*뉴\s/.test(noMaker)) prefix = '디 올 뉴';
  else if (/^올\s*뉴\s/.test(noMaker)) prefix = '올 뉴';
  else if (/^디\s*뉴\s/.test(noMaker)) prefix = '디 뉴';
  else if (/^더\s*뉴\s/.test(noMaker)) prefix = '더 뉴';
  else if (/^뉴\s/.test(noMaker)) prefix = '뉴';
  stats[prefix] = (stats[prefix] || 0) + 1;
  if (!samples[prefix]) samples[prefix] = [];
  if (samples[prefix].length < 8) samples[prefix].push(`${maker} ${noMaker}`);
}

console.log('catalog title prefix 분포:');
for (const k of Object.keys(stats).sort((a, b) => stats[b] - stats[a])) {
  console.log(`\n## ${k} (${stats[k]}건)`);
  for (const s of samples[k]) console.log('  -', s);
}
