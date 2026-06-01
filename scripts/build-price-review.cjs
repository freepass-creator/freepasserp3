#!/usr/bin/env node
/**
 * 가격표 검수용 HTML 일람표 생성.
 *  - 한국 OEM (현대/기아/제네시스/KGM) catalog 의 trim 별 가격 정리
 *  - 동력원별 / 세대별 grouping
 *  - 가격 데이터 source 표시 (agent 추정 vs 사용자 검증)
 *
 *  출력: price-review.html (root)
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const OUT = path.join(__dirname, '..', 'price-review.html');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const byMaker = {};
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  if (!byMaker[d.maker]) byMaker[d.maker] = [];
  byMaker[d.maker].push({ f, d });
}

// model_root 기준 정렬
for (const m of Object.keys(byMaker)) {
  byMaker[m].sort((a, b) => {
    const ma = a.d.model_root || '', mb = b.d.model_root || '';
    if (ma !== mb) return ma.localeCompare(mb, 'ko');
    const ya = a.d.year_start || '', yb = b.d.year_start || '';
    return yb.localeCompare(ya);
  });
}

function detectFuel(catalogFile, title) {
  if (/_hybrid\.json$/.test(catalogFile)) return '하이브리드';
  if (/_diesel\.json$/.test(catalogFile)) return '디젤';
  if (/_lpg\.json$/.test(catalogFile)) return 'LPG';
  if (/_ev\.json$/.test(catalogFile) || /_e\.json$/.test(catalogFile)) return 'EV';
  if (/_hydrogen\.json$/.test(catalogFile)) return '수소';
  if (/(하이브리드|HEV)/.test(title)) return '하이브리드';
  if (/\b(EV|일렉트릭|전기)/i.test(title)) return 'EV';
  if (/수소/.test(title)) return '수소';
  return '가솔린';
}

let html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8">
<title>한국 OEM catalog 가격 검수표</title>
<style>
  body { font-family: Consolas, 'Malgun Gothic', monospace; font-size: 13px; padding: 16px; background: #f5f5f5; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  h2 { font-size: 16px; margin: 16px 0 4px; padding: 4px 8px; background: #2c3e50; color: #fff; }
  h3 { font-size: 14px; margin: 12px 0 2px; color: #555; }
  table { border-collapse: collapse; width: 100%; background: #fff; margin-bottom: 6px; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; font-size: 12px; }
  th { background: #eef; font-weight: 600; }
  tr:hover td { background: #fff8e0; }
  .price { text-align: right; font-weight: 600; color: #2c3e50; font-family: Consolas, monospace; }
  .meta { color: #999; font-size: 11px; }
  .fuel-가솔린 { background: #fef8e8; }
  .fuel-디젤   { background: #e8f0f8; }
  .fuel-LPG    { background: #f0f8e8; }
  .fuel-하이브리드 { background: #f8e8f0; }
  .fuel-EV     { background: #e8f8f8; }
  .fuel-수소   { background: #f8f0e8; }
  .summary { background: #fff; padding: 8px; border-radius: 4px; margin-bottom: 12px; }
  .toc { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
  .toc a { padding: 2px 6px; background: #fff; border: 1px solid #ddd; text-decoration: none; color: #2c3e50; font-size: 11px; border-radius: 3px; }
  .toc a:hover { background: #ffeb3b; }
  details { background: #fff; padding: 4px 8px; border-radius: 4px; margin-bottom: 4px; }
  summary { cursor: pointer; font-weight: 600; padding: 2px 0; }
  .ka { color: #999; font-size: 11px; }
</style>
</head><body>
<h1>한국 OEM catalog 가격 검수표 — 2026-05-11</h1>
<div class="summary">
  총 <b>${Object.values(byMaker).reduce((s, arr) => s + arr.length, 0)}</b>개 catalog ·
  <b>${Object.values(byMaker).reduce((s, arr) => s + arr.reduce((ss, x) => ss + Object.keys(x.d.trims || {}).length, 0), 0)}</b>개 trim<br>
  agent 5개 병렬 조사 가격 (다나와/카눈/제조사 PDF 참고 + 일부 인접 trim 보간 추정). 검수해서 수정 사항 표시 부탁드립니다.
</div>
<div class="toc">
${Object.keys(byMaker).map(m => `<a href="#${m}">${m} (${byMaker[m].length})</a>`).join('')}
</div>
`;

for (const maker of Object.keys(byMaker)) {
  html += `<h2 id="${maker}">${maker} (${byMaker[maker].length} catalog)</h2>`;
  // model_root 별 그룹
  const byModel = {};
  for (const x of byMaker[maker]) {
    const mr = x.d.model_root || '(미정)';
    if (!byModel[mr]) byModel[mr] = [];
    byModel[mr].push(x);
  }
  for (const mr of Object.keys(byModel)) {
    html += `<details open><summary>${mr} <span class="ka">(${byModel[mr].length} catalog)</span></summary>`;
    for (const { f, d } of byModel[mr]) {
      const fuel = detectFuel(f, d.title);
      const yr = (d.year_start || '?') + '~' + (d.year_end || '?');
      const trimCount = Object.keys(d.trims || {}).length;
      html += `<h3 class="fuel-${fuel}">${d.title} <span class="ka">[${fuel}] ${yr} · ${trimCount} trim · ${f}</span></h3>`;
      html += `<table><thead><tr><th style="width:60%">트림</th><th>가격</th><th>비고</th></tr></thead><tbody>`;
      for (const [tk, tv] of Object.entries(d.trims || {})) {
        const price = tv.price?.base ? Math.round(tv.price.base / 10000).toLocaleString() + '만원' : '<span class="meta">(미정)</span>';
        const memo = tv.discontinued ? `단종 ${tv.discontinued}` : '';
        html += `<tr><td>${tk}</td><td class="price">${price}</td><td class="meta">${memo}</td></tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</details>`;
  }
}

html += `</body></html>`;
fs.writeFileSync(OUT, html);
console.log('✓ ' + OUT + ' (' + (html.length / 1024).toFixed(1) + ' KB)');
