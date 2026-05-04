#!/usr/bin/env node
/**
 * encar-master-seed 의 production_start/end 를 각 catalog 의 year_range 필드로 이전.
 *  - catalog 의 source.encar 또는 aliases 와 cross-ref 해서 production year 모음
 *  - catalog json 에 "year_start": "YYYY-MM", "year_end": "YYYY-MM" 추가
 *
 * 1회 마이그레이션 — 이후 encar-master-seed 제거 가능.
 *
 * 사용:
 *   node scripts/migrate-year-range-to-catalogs.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const ENCAR_PATH = path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.js');
const INDEX_PATH = path.join(CATALOG_DIR, '_index.json');

function loadEncarMaster() {
  const raw = fs.readFileSync(ENCAR_PATH, 'utf8');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  return JSON.parse(raw.slice(start, end + 1));
}

function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}

function ymToNum(s) {
  if (!s || s === '현재') return s === '현재' ? 999912 : null;
  const m = String(s).match(/^(\d{4})-?(\d{1,2})?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + (Number(m[2] || 1));
}

function numToYM(n) {
  if (!n || n === 999912) return '현재';
  const y = Math.floor(n / 100), m = n % 100;
  return `${y}-${String(m).padStart(2, '0')}`;
}

const encar = loadEncarMaster();
const encarByKey = new Map();
for (const e of encar) if (e?._key) encarByKey.set(e._key, e);

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));

let updated = 0;
for (const [cid, entry] of Object.entries(index)) {
  const filePath = path.join(CATALOG_DIR, `${cid}.json`);
  if (!fs.existsSync(filePath)) continue;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // 1) source.encar 의 entry 들에서 year 모음
  const years = [];
  const encarKeys = entry?.source?.encar || [];
  for (const ek of encarKeys) {
    const e = encarByKey.get(ek);
    if (!e) continue;
    const ps = ymToNum(e.production_start);
    const pe = ymToNum(e.production_end);
    if (ps) years.push(ps);
    if (pe) years.push(pe);
  }

  // 2) aliases 와 일치하는 encar entry 도 검색 (자동 휴리스틱 매핑된 것들)
  const aliases = Array.isArray(data.aliases) ? new Set(data.aliases) : new Set();
  if (aliases.size && data.maker) {
    for (const e of encar) {
      if (e.maker !== data.maker) continue;
      if (!aliases.has(normName(e.sub))) continue;
      const ps = ymToNum(e.production_start);
      const pe = ymToNum(e.production_end);
      if (ps) years.push(ps);
      if (pe) years.push(pe);
    }
  }

  if (!years.length) continue;
  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  const newStart = numToYM(minY);
  const newEnd = numToYM(maxY);

  if (data.year_start === newStart && data.year_end === newEnd) continue;
  data.year_start = newStart;
  data.year_end = newEnd;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  updated++;
}

console.log(`✓ ${updated}개 catalog 에 year_range 추가/갱신`);
