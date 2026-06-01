#!/usr/bin/env node
/**
 * 한국 OEM 모델별 동력원/배기량 매트릭스 HTML 생성.
 * 사용자 검수용 — 잘못된 catalog 즉시 식별.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const OUT = path.join(__dirname, '..', 'fuel-matrix-review.html');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

function extractFuelDisp(title) {
  const m = title.match(/(가솔린|디젤|LPG|LPi|하이브리드|HEV|EV|일렉트릭|수소|플러그인하이브리드|PHEV)(\s+R?\d\.\d(\s*T)?)?$/);
  if (!m) return { fuel: '(미정)', disp: '' };
  let fuel = m[1];
  if (fuel === 'LPi') fuel = 'LPG';
  if (fuel === 'HEV') fuel = '하이브리드';
  if (fuel === '일렉트릭') fuel = 'EV';
  if (fuel === 'PHEV') fuel = '플러그인하이브리드';
  return { fuel, disp: (m[2] || '').trim() };
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const matrix = {};   // model_root → fuel → [{disp, catalog, year, trims, file}]

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const trims = Object.keys(d.trims || {});
  if (!trims.length) continue;
  const { fuel, disp } = extractFuelDisp(d.title);
  const mk = d.maker + ' ' + (d.model_root || '?');
  if (!matrix[mk]) matrix[mk] = {};
  if (!matrix[mk][fuel]) matrix[mk][fuel] = [];
  matrix[mk][fuel].push({
    disp,
    title: d.title,
    year: (d.year_start || '?') + '~' + (d.year_end || '?'),
    trimCount: trims.length,
    f,
  });
}

const FUELS = ['가솔린', '디젤', 'LPG', '하이브리드', '플러그인하이브리드', 'EV', '수소', '(미정)'];

let html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8">
<title>한국 OEM 동력원/배기량 매트릭스 검수</title>
<style>
  body { font-family: Consolas, 'Malgun Gothic', monospace; font-size: 12px; padding: 16px; background: #f5f5f5; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  h2 { font-size: 16px; margin: 16px 0 4px; padding: 4px 8px; background: #2c3e50; color: #fff; }
  table { border-collapse: collapse; width: 100%; background: #fff; margin-bottom: 6px; font-size: 11px; }
  th, td { border: 1px solid #ddd; padding: 3px 6px; vertical-align: top; }
  th { background: #eef; font-weight: 600; }
  tr:hover td { background: #fff8e0; }
  .gas    { background: #fef8e8; }
  .diesel { background: #e8f0f8; }
  .lpg    { background: #f0f8e8; }
  .hev    { background: #f8e8f0; }
  .phev   { background: #f0e8f8; }
  .ev     { background: #e8f8f8; }
  .hyd    { background: #f8f0e8; }
  .none   { background: #fdd; color: #c00; }
  .disp { font-weight: 600; }
  .ka { color: #888; font-size: 10px; }
  .summary { background: #fff; padding: 8px; border-radius: 4px; margin-bottom: 12px; }
</style>
</head><body>
<h1>한국 OEM 동력원/배기량 매트릭스 — ${new Date().toISOString().slice(0,10)}</h1>
<div class="summary">
  모델별로 어느 동력원/배기량 catalog 가 있는지 확인. <b style="color:#c00">"(미정)"</b> 또는 잘못된 매핑 표시.<br>
  각 catalog 의 title · year · trim 수 · 파일명 표시. 색상별 동력원 그룹.
</div>
`;

// 모델별 정렬 (메이커 → 모델 가나다)
const keys = Object.keys(matrix).sort();
for (const mk of keys) {
  html += `<h2>${mk}</h2><table><thead><tr><th style="width:120px">동력원</th><th>catalog list</th></tr></thead><tbody>`;
  for (const fuel of FUELS) {
    const list = matrix[mk][fuel];
    if (!list || !list.length) continue;
    const cls = ({'가솔린':'gas','디젤':'diesel','LPG':'lpg','하이브리드':'hev','플러그인하이브리드':'phev','EV':'ev','수소':'hyd','(미정)':'none'})[fuel];
    html += `<tr class="${cls}"><td><b>${fuel}</b></td><td>`;
    list.sort((a,b)=>a.disp.localeCompare(b.disp));
    for (const c of list) {
      html += `<div><span class="disp">${c.disp || '(?)'}</span> · ${c.title} <span class="ka">[${c.year}, ${c.trimCount}trim, ${c.f}]</span></div>`;
    }
    html += `</td></tr>`;
  }
  html += `</tbody></table>`;
}
html += `</body></html>`;
fs.writeFileSync(OUT, html);
console.log('✓ ' + OUT + ' (' + (html.length/1024).toFixed(1) + ' KB)');
