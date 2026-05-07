#!/usr/bin/env node
/**
 * 한국 OEM catalog 의 title × 연도 정합성 검수.
 *  - 모델 + chassis 코드 그룹화
 *  - 시기 순서대로 정렬
 *  - 의심: 페리 prefix("더 뉴" 등) 와 year_start 순서 불일치
 *  - 출력: docs/catalog-timeline-audit.md
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

// title 에서 모델 + chassis 추출
// 예: "현대 더 뉴 쏘렌토 MQ4" → 모델: 쏘렌토, chassis: MQ4
function parseModel(title, maker) {
  let s = title.replace(new RegExp(`^${maker}\\s+`), '');
  s = s.replace(/^(디 올 뉴|올 뉴|더 뉴)\s+/, '');
  // chassis 추출 (마지막 영숫자 token)
  const chassisMatch = s.match(/\s+([A-Z][A-Z0-9]*\s*(PE|PE\d)?)\s*$/);
  let chassis = '';
  if (chassisMatch) {
    chassis = chassisMatch[0].trim();
    s = s.replace(chassisMatch[0], '').trim();
  }
  // 동력원 prefix 제거 (하이브리드/EV 등)
  let powertrain = '';
  if (/하이브리드/.test(s)) { powertrain = '하이브리드'; s = s.replace(/\s*하이브리드\s*/, ' ').trim(); }
  else if (/(EV|일렉트릭)/i.test(s)) { powertrain = 'EV'; s = s.replace(/\s*(EV|일렉트릭)\s*/i, ' ').trim(); }
  return { model: s, chassis, powertrain };
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const groups = {};   // maker|model|chassis → [{title, year_start, year_end, file}]

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const { model, chassis, powertrain } = parseModel(d.title || '', d.maker);
  const key = `${d.maker}|${model}|${chassis}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push({
    title: d.title,
    year_start: d.year_start || '',
    year_end: d.year_end || '',
    file: f,
    powertrain,
  });
}

const lines = [];
lines.push('# Catalog title × 연도 정합성 검수\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)} — 한국 OEM 4개 메이커*\n`);

const sorted = Object.entries(groups).sort();
let suspicious = 0;
for (const [key, list] of sorted) {
  if (list.length < 2) continue;
  list.sort((a, b) => (a.year_start || '').localeCompare(b.year_start || ''));
  // 의심 검출:
  //   1) "더 뉴"/"디 올 뉴" prefix 가 시기 순서상 옛 catalog 에 들어가 있음
  //   2) 같은 페리 시기 (prefix 동일) 인데 year 차이 큼
  let issue = '';
  for (let i = 0; i < list.length - 1; i++) {
    const cur = list[i].title || '';
    const nxt = list[i + 1].title || '';
    const curHasFL = /(더 뉴|디 올 뉴|올 뉴)/.test(cur);
    const nxtHasFL = /(더 뉴|디 올 뉴|올 뉴)/.test(nxt);
    // 옛 catalog 가 페리 prefix 가지고 새 catalog 가 prefix 없으면 의심
    if (curHasFL && !nxtHasFL) {
      issue += `⚠ 시기 ${list[i].year_start} 가 페리 prefix 가지는데 ${list[i+1].year_start} 는 없음\n`;
    }
  }
  if (issue) suspicious++;
  lines.push(`\n## ${key.replace(/\|/g, ' / ')}\n`);
  if (issue) lines.push(issue);
  lines.push(`| 시기 | title | 동력원 | file |`);
  lines.push(`|---|---|---|---|`);
  for (const e of list) {
    lines.push(`| ${e.year_start}~${e.year_end} | ${e.title} | ${e.powertrain || '-'} | ${e.file} |`);
  }
}

const outPath = path.join(__dirname, '..', 'docs', 'catalog-timeline-audit.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ ${path.relative(process.cwd(), outPath)}`);
console.log(`  그룹: ${Object.keys(groups).length}`);
console.log(`  의심 그룹: ${suspicious}`);
