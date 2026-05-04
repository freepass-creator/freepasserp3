#!/usr/bin/env node
/**
 * encar-master-seed 의 페리 전환 overlap 자동 수정.
 * 같은 세대 (페리 전 → 페리 후) 사이 production_end overlap 만 수정.
 * 변형 공존 (sedan+wagon 등) 은 건드리지 않음.
 *
 * 로직: 페리 전.production_end = 페리 후.production_start - 1개월
 *
 * 사용:
 *   node scripts/fix-production-year-overlaps.cjs       # dry-run (수정 사항 출력만)
 *   node scripts/fix-production-year-overlaps.cjs --apply  # 실제 수정
 */
const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.js');
const APPLY = process.argv.includes('--apply');

function ymToNum(s) {
  if (!s || s === '현재') return s === '현재' ? 999912 : null;
  const m = String(s).match(/^(\d{4})-?(\d{1,2})?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + (Number(m[2] || 1));
}
function numToYM(n) {
  if (!n || n === 999912) return null;
  const y = Math.floor(n / 100), m = n % 100;
  return `${y}-${String(m).padStart(2, '0')}`;
}
function prevMonth(n) {
  if (!n) return null;
  const y = Math.floor(n / 100), m = n % 100;
  if (m === 1) return (y - 1) * 100 + 12;
  return y * 100 + (m - 1);
}
function fuelOf(sub) {
  const s = String(sub || '');
  if (/하이브리드|hybrid/i.test(s)) return 'hybrid';
  if (/디젤|diesel/i.test(s)) return 'diesel';
  if (/전기|EV|일렉/i.test(s)) return 'ev';
  if (/LPG|LPI/i.test(s)) return 'lpg';
  return 'gas';
}
function stripFLPrefix(sub) {
  return String(sub || '')
    .replace(/^(디 ?올 ?뉴|디 ?뉴|더 ?뉴|올 ?뉴|신형)\s+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    // chassis code — 같은 sub_model 의 다른 세대 비교용 (생산년도 중복 불가)
    .replace(/\s+(W\d{3}|G\d{2,3}|F\d{2,3}|E\d{2,3}|U\d{2,3})$/i, '')
    .replace(/\s+(NQ\d|GN\d|MX\d|DL\d|SX\d|GL\d|CN\d|RG\d|RS\d|LX\d|MQ\d|RJ\d?|SP\d|KA\d|SG\d|TM\d|TL|LF|HG|IG|AD|BD|YG|YD|YP|UM|JF|JS|QM|QL|GL|EE)$/i, '')
    .replace(/\s+(B\d|C\d|FY|F5|4K|F3|4S)$/i, '')
    .replace(/\s+(L\d{3})$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const raw = fs.readFileSync(SEED_PATH, 'utf8');
const start = raw.indexOf('[');
const end = raw.lastIndexOf(']');
const items = JSON.parse(raw.slice(start, end + 1));

// 그룹화 + 오버랩 검출
const groups = new Map();
for (const r of items) {
  if (!r || r.archived) continue;
  if (!r.maker || !r.model) continue;
  const ps = ymToNum(r.production_start);
  const pe = ymToNum(r.production_end);
  if (!ps && !pe) continue;
  const fuel = fuelOf(r.sub);
  const key = `${r.maker} | ${r.model} | ${fuel}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ ...r, _ps: ps, _pe: pe });
}

const fixes = [];   // { keyId, oldEnd, newEnd, sub }
for (const [key, list] of groups.entries()) {
  const sorted = [...list].sort((a, b) => (a._ps || 0) - (b._ps || 0));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i-1], cur = sorted[i];
    if (!prev._pe || !cur._ps) continue;
    if (prev._pe < cur._ps) continue;   // overlap 아님
    if (stripFLPrefix(prev.sub) !== stripFLPrefix(cur.sub)) continue;   // 변형 공존
    const newEndNum = prevMonth(cur._ps);
    const newEnd = numToYM(newEndNum);
    if (!newEnd) continue;
    fixes.push({
      _key: prev._key,
      sub: prev.sub,
      oldEnd: prev.production_end,
      newEnd,
      reason: `${prev.sub} → ${cur.sub} (페리 전환)`,
    });
  }
}

console.log(`총 ${fixes.length}건 수정 대상`);
console.log('');

// dry-run / apply
if (!APPLY) {
  console.log('[dry-run] 실제 수정하려면 --apply 추가:');
  console.log('');
  for (const f of fixes.slice(0, 20)) {
    console.log(`  ${f._key}: production_end "${f.oldEnd}" → "${f.newEnd}"`);
    console.log(`    (${f.reason})`);
  }
  if (fixes.length > 20) console.log(`  ...외 ${fixes.length - 20}건`);
  process.exit(0);
}

// 실제 수정 — string replace per _key
let updated = raw;
let applied = 0;
for (const f of fixes) {
  // _key 의 항목을 찾아서 production_end 만 변경
  // pattern: "_key": "encar_xxx", ... "production_end": "OLD"
  const re = new RegExp(
    `("_key"\\s*:\\s*"${f._key}"[^]*?"production_end"\\s*:\\s*")${f.oldEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`,
    'm'
  );
  if (re.test(updated)) {
    updated = updated.replace(re, `$1${f.newEnd}$2`);
    applied++;
  } else {
    console.warn(`⚠ ${f._key} 패턴 매칭 실패 — 건너뜀`);
  }
}

fs.writeFileSync(SEED_PATH, updated);
console.log(`✓ ${applied}/${fixes.length}건 적용`);
