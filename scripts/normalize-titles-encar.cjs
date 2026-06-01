#!/usr/bin/env node
/**
 * catalog title 을 엔카 표기 기준으로 정규화.
 *  변환 룰:
 *   - "하이브리드" → "HEV"
 *   - 괄호 제거 (예: "그랜저 (GN7)" → "그랜저 GN7")
 *  엔카 표기 외 다른 변경 없음.
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

function normalize(s) {
  return String(s || '')
    .replace(/하이브리드/g, 'HEV')
    .replace(/[()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!d.title) continue;
  const oldTitle = d.title;
  const newTitle = normalize(oldTitle);
  if (newTitle === oldTitle) continue;
  console.log((APPLY ? '✓' : '+') + ' ' + oldTitle + ' → ' + newTitle);
  if (APPLY) {
    d.title = newTitle;
    fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 2));
  }
  touched++;
}
console.log('\n' + (APPLY ? '적용' : 'dry-run') + ': ' + touched + '개 catalog title 정규화');
