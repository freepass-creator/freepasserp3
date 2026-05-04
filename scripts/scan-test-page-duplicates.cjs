#!/usr/bin/env node
/**
 * vehicle-options-catalog-test.html sub_model dropdown 중복 시뮬레이터.
 * normalizeSub() 가 같은 텍스트를 반환하는 (maker, model, displayed_sub) 그룹을 찾아 출력.
 *
 * normalizeSub 수정본:
 *  - catalog title (메이커 prefix 제거) + row.sub 의 동력원 keyword
 *
 * row.sub 에 동력원 keyword 가 없는데 catalog 가 통합 (ex: 가솔린/디젤 통합) 인 경우
 *  여전히 중복 가능 → 추가 탐지 필요.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'public', 'data', 'car-master');
const IDX = path.join(BASE, '_index.json');
const ENCAR = path.join(ROOT, 'public', 'data', 'encar-master-seed.js');

const idx = JSON.parse(fs.readFileSync(IDX, 'utf-8'));
const raw = fs.readFileSync(ENCAR, 'utf-8');
const arr = eval('(' + raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1) + ')');
const encarMap = Object.fromEntries(arr.map(e => [e._key, e]));

// titleByEncar: encar_key → 메이커 prefix 제거된 catalog title
const titleByEncar = {};
for (const [cid, entry] of Object.entries(idx)) {
  const maker = entry.maker || '';
  const titleNoMaker = (entry.title || '').replace(new RegExp('^' + maker + '\\s+'), '').trim();
  for (const ek of (entry.source?.encar || [])) {
    titleByEncar[ek] = titleNoMaker;
  }
}

function powertrainKw(rowSub) {
  const s = String(rowSub || '');
  if (/플러그인|PHEV/i.test(s)) return '플러그인 하이브리드';
  if (/하이브리드|HEV|hybrid/i.test(s)) return '하이브리드';
  if (/일렉트릭|electric/i.test(s)) return '일렉트릭';
  if (/\bEV\b/.test(s)) return 'EV';
  if (/전기차|전기/.test(s)) return '전기';
  return '';
}

function normalizeSub(row) {
  const cat = titleByEncar[row._key];
  if (cat) {
    const kw = powertrainKw(row.sub);
    if (kw && !cat.includes(kw)) return cat + ' ' + kw;
    return cat;
  }
  return row.sub || '';  // fallback (catalog 매핑 없으면 sub 그대로)
}

// (maker | model | normalizeSub) 그룹화 — 2개 이상이면 dropdown 중복
const groups = new Map();
for (const r of arr) {
  if (!r || r.archived || r.status === 'deleted') continue;
  const ps = r.production_start || '';
  if (ps && ps < '2011-01') continue;  // 테스트 페이지의 withinScope 적용
  const key = `${r.maker}|${r.model}|${normalizeSub(r)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const dups = [...groups.entries()].filter(([_, rows]) => rows.length > 1);
console.log(`■ 테스트 페이지 dropdown 중복 발생 케이스: ${dups.length}개\n`);
for (const [key, rows] of dups) {
  console.log(`▶ ${key}`);
  for (const r of rows) {
    const cat = titleByEncar[r._key];
    console.log(`    - ${r._key}  sub="${r.sub}"  ps=${r.production_start}  catTitle="${cat || '(없음)'}"`);
  }
  console.log('');
}
console.log(`총 ${dups.length}개 (가솔린/하이브리드/EV 외 다른 차종이 같이 묶인 케이스)`);
