#!/usr/bin/env node
/**
 * catalog 의 aliases 중 다른 세대 sub_model 이 잘못 매핑된 것 제거.
 *  alias 의 encar entry production year 가 catalog year_range 밖이면 alias 제거.
 *
 *  사용:
 *    node scripts/prune-mismatched-aliases.cjs        # dry-run
 *    node scripts/prune-mismatched-aliases.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const ENCAR_PATH = path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.js');
const APPLY = process.argv.includes('--apply');

function loadEncar() {
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

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  // null 끝점은 무한대로 처리
  const aS = aStart || 0, aE = aEnd || 999912;
  const bS = bStart || 0, bE = bEnd || 999912;
  return aS <= bE && bS <= aE;
}

const encar = loadEncar();
// maker|normSub → encar entry (배열, 같은 sub 가 archived/active 둘 다 있을 수 있음)
const encarBySubMaker = new Map();
for (const e of encar) {
  if (!e?.maker || !e?.sub) continue;
  const k = `${e.maker}|${normName(e.sub)}`;
  if (!encarBySubMaker.has(k)) encarBySubMaker.set(k, []);
  encarBySubMaker.get(k).push(e);
}

const files = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'));

let totalRemoved = 0;
let cataloguesAffected = 0;
const removalsLog = [];

for (const f of files) {
  const filePath = path.join(CATALOG_DIR, f);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const cid = data.catalog_id || f.replace('.json', '');
  const aliases = Array.isArray(data.aliases) ? data.aliases : [];
  const maker = data.maker;
  if (!aliases.length || !maker) continue;

  const cStart = ymToNum(data.year_start);
  const cEnd = ymToNum(data.year_end);
  if (!cStart) continue;   // catalog year_range 없으면 검증 불가, skip

  const keep = [];
  const removed = [];
  for (const alias of aliases) {
    const k = `${maker}|${alias}`;
    const encarEntries = encarBySubMaker.get(k) || [];
    if (!encarEntries.length) {
      // encar 에 없는 alias → 보존 (catalog 자체 등록한 alias)
      keep.push(alias);
      continue;
    }
    // 모든 encar entry 검증 — 하나라도 catalog year_range 와 겹치면 OK
    const anyOverlap = encarEntries.some(e => {
      const eStart = ymToNum(e.production_start);
      const eEnd = ymToNum(e.production_end);
      if (!eStart) return true;   // 연식 정보 없는 entry 는 OK 처리
      return rangesOverlap(cStart, cEnd, eStart, eEnd);
    });
    if (anyOverlap) keep.push(alias);
    else {
      removed.push(alias);
      const sample = encarEntries[0];
      removalsLog.push(`${cid} (${data.year_start}~${data.year_end}): "${alias}" (encar ${sample.production_start}~${sample.production_end})`);
    }
  }

  if (removed.length) {
    cataloguesAffected++;
    totalRemoved += removed.length;
    if (APPLY) {
      data.aliases = keep;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }
}

console.log(`📊 ${cataloguesAffected}개 catalog 에서 ${totalRemoved}개 잘못된 alias 검출`);
console.log('');
removalsLog.slice(0, 30).forEach(l => console.log(`  - ${l}`));
if (removalsLog.length > 30) console.log(`  ... +${removalsLog.length - 30}건`);
console.log('');
console.log(APPLY ? '✓ 적용 완료. build-aliases-map.cjs 재실행 권장.' : '[dry-run] --apply 추가하면 실제 제거');
