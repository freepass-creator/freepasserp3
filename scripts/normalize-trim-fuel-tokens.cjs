#!/usr/bin/env node
/**
 * 한국 OEM catalog trim 키 동력원/배기량 표기 통일.
 *  - "1.6T" / "1.6 터보" → "가솔린 1.6 T"
 *  - "2.5" (앞에 동력원 없음) → catalog title 의 동력원 + "2.5"
 *  - 명시된 동력원 (가솔린/디젤/LPi/하이브리드/EV) 있으면 유지
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

function inferDefaultFuel(title) {
  if (/하이브리드/i.test(title)) return null;  // catalog 자체 하이브리드면 trim 명에 이미 있음
  if (/(EV|일렉트릭|전기)/i.test(title)) return null;
  return '가솔린';   // 기본 동력원 — 가솔린
}

function normalizeKey(k, defaultFuel) {
  // 이미 동력원 명시 있으면 유지 + 표기 통일
  let s = k;
  // "1.6T" / "1.6 T" / "1.6 터보" → "1.6 T"
  s = s.replace(/(\d\.\d)\s*T(?!-)/gi, '$1 T');
  s = s.replace(/(\d\.\d)\s*터보/g, '$1 T');
  // 동력원 토큰 검사
  const hasFuel = /(가솔린|디젤|LPG|LPi|하이브리드|HEV|EV|일렉트릭|전기|수소|R\d\.\d)/i.test(s);
  if (!hasFuel && defaultFuel) {
    // 배기량 토큰 (X.X) 또는 인승 토큰 앞에 default 동력원 삽입
    const m = s.match(/^(.+?)(\s*\d\.\d.*|\s*\d+인승.*|)$/);
    if (m && m[2]) {
      s = m[1] + ' ' + defaultFuel + m[2];
    } else if (!s.includes(defaultFuel)) {
      s = s + ' ' + defaultFuel;
    }
  }
  return s.trim();
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;
for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const defaultFuel = inferDefaultFuel(d.title || '');
  const newTrims = {};
  let changed = false;
  for (const [k, t] of Object.entries(d.trims || {})) {
    const newK = normalizeKey(k, defaultFuel);
    if (newK !== k) changed = true;
    newTrims[newK] = t;
  }
  if (!changed) continue;
  d.trims = newTrims;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title}`);
  touched++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog`);
