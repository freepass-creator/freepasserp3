#!/usr/bin/env node
/**
 * encar-master-seed 의 production_start/end 검증.
 * 같은 maker+model+동력원 안에서 페리 시점이 겹치거나 갭 있는 경우 식별.
 *
 * 출력: docs/year-validation-report.md
 *
 * 사용:
 *   node scripts/validate-production-years.cjs
 */
const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.js');
const OUTPUT = path.join(__dirname, '..', 'docs', 'year-validation-report.md');

function loadSeed() {
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  // 파일은 `var ENCAR_MASTER = [...];` 또는 export. JSON 부분만 추출.
  const match = raw.match(/=\s*(\[[\s\S]*?\]);?\s*$/m);
  if (match) {
    try { return JSON.parse(match[1]); } catch (e) { /* fall through */ }
  }
  // 객체 리터럴 — eval 위험하니 첫 [ 부터 끝 ] 찾아서 JSON.parse
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }
  throw new Error('seed 파일에서 배열 못 찾음');
}

function ymToNum(s) {
  if (!s) return null;
  if (s === '현재') return 999912;
  const m = String(s).match(/^(\d{4})-?(\d{1,2})?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + (Number(m[2] || 1));
}

/* yyyymm 두 숫자 사이 월 단위 차이 (b - a). yyyymm 의 단순 뺄셈은 무의미 (e.g. 201501-201412=89). */
function monthsBetween(a, b) {
  if (!a || !b) return 0;
  if (a === 999912 || b === 999912) return 0;   // 현재 끼면 무시
  const ya = Math.floor(a / 100), ma = a % 100;
  const yb = Math.floor(b / 100), mb = b % 100;
  return (yb - ya) * 12 + (mb - ma);
}

function fuelOf(sub) {
  const s = String(sub || '');
  if (/하이브리드|hybrid/i.test(s)) return 'hybrid';
  if (/디젤|diesel/i.test(s)) return 'diesel';
  if (/전기|EV|일렉/i.test(s)) return 'ev';
  if (/LPG|LPI/i.test(s)) return 'lpg';
  return 'gas';
}

/* sub 에서 페이스리프트 prefix 제거 — 같은 세대인지 비교용.
 *  "더 뉴 그랜저 IG" / "그랜저 IG" → 둘 다 "그랜저 IG" 로 정규화 → 같은 세대. */
function stripFLPrefix(sub) {
  return String(sub || '')
    .replace(/^(디 ?올 ?뉴|디 ?뉴|더 ?뉴|올 ?뉴|신형)\s+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')          // 끝의 (페리), (신형) 등 제거
    .replace(/\s+/g, ' ')
    .trim();
}

const seed = loadSeed();
const items = Array.isArray(seed) ? seed : [];

// 그룹화: maker + model + fuelType
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
  groups.get(key).push({ ...r, _ps: ps, _pe: pe, _fuel: fuel });
}

const overlaps = [];           // 같은 세대 페리 전환 overlap (실제 버그)
const variantOverlaps = [];    // 다른 변형 (cw/살룬 등) 공존 — false positive
const gaps = [];
const noStart = [];

for (const [key, list] of groups.entries()) {
  // 정렬: production_start
  const sorted = [...list].sort((a, b) => (a._ps || 0) - (b._ps || 0));
  for (let i = 0; i < sorted.length; i++) {
    if (!sorted[i]._ps) noStart.push({ key, item: sorted[i] });
    if (i === 0) continue;
    const prev = sorted[i-1], cur = sorted[i];
    if (!prev._pe || !cur._ps) continue;

    // 같은 세대 페리 전환인지 — strip FL prefix 후 동일하면 "예"
    const sameGen = stripFLPrefix(prev.sub) === stripFLPrefix(cur.sub);
    const gapMonths = monthsBetween(prev._pe, cur._ps);

    // 갭 — prev 끝 후 cur 시작까지 6개월 이상 차이 (페리 전환에서만 의미)
    if (sameGen && gapMonths > 6) {
      gaps.push({ key, prev, cur, gapMonths });
    }
    // 오버랩 — prev 끝이 cur 시작보다 미래거나, 동월
    if (prev._pe >= cur._ps) {
      if (sameGen) overlaps.push({ key, prev, cur });
      else         variantOverlaps.push({ key, prev, cur });
    }
  }
}

function fmtYM(n) {
  if (!n) return '?';
  if (n === 999912) return '현재';
  const y = Math.floor(n / 100), m = n % 100;
  return `${y}.${String(m).padStart(2, '0')}`;
}

function fmtItem(it) {
  return `${it.sub} (${fmtYM(it._ps)}~${fmtYM(it._pe)})`;
}

const lines = [];
lines.push('# 생산연도 검증 보고서');
lines.push('');
lines.push(`> 생성: ${new Date().toISOString().replace('T',' ').slice(0,16)}`);
lines.push('');
lines.push('## 요약');
lines.push('');
lines.push(`- 총 항목: ${items.length}개`);
lines.push(`- 그룹 (maker × model × fuel): ${groups.size}개`);
lines.push(`- ⚠ **페리 전환 오버랩**: ${overlaps.length}건 (같은 세대 페리 전후 기간 겹침 — 실제 버그)`);
lines.push(`- ℹ️ 변형 공존 오버랩: ${variantOverlaps.length}건 (sedan+wagon 등 다른 변형 — 정상)`);
lines.push(`- ⚠ **페리 갭 6개월+**: ${gaps.length}건 (페리 전후 생산 공백)`);
lines.push(`- ⚠ **start 없음**: ${noStart.length}건`);
lines.push('');

if (overlaps.length) {
  lines.push('## 오버랩 (페리 시점 겹침 — 우선 수정)');
  lines.push('');
  for (const o of overlaps) {
    lines.push(`### ${o.key}`);
    lines.push(`- 이전: \`${fmtItem(o.prev)}\``);
    lines.push(`- 다음: \`${fmtItem(o.cur)}\``);
    lines.push(`  → 이전.production_end 를 \`${fmtYM(o.cur._ps - 1)}\` 또는 그 이전으로 줄이기 권장`);
    lines.push('');
  }
}

if (gaps.length) {
  lines.push('## 갭 (생산 공백 — 확인 필요)');
  lines.push('');
  for (const g of gaps) {
    lines.push(`### ${g.key}`);
    lines.push(`- 이전: \`${fmtItem(g.prev)}\``);
    lines.push(`- 다음: \`${fmtItem(g.cur)}\``);
    lines.push(`  → ${g.gapMonths}개월 갭. 페리 시점이 잘못 입력됐을 수 있음.`);
    lines.push('');
  }
}

if (noStart.length) {
  lines.push('## production_start 없음');
  lines.push('');
  for (const n of noStart.slice(0, 30)) {
    lines.push(`- ${n.key} | ${n.item.sub}`);
  }
  if (noStart.length > 30) lines.push(`...외 ${noStart.length - 30}건`);
  lines.push('');
}

fs.writeFileSync(OUTPUT, lines.join('\n'));
console.log(`✓ 검증 완료: 오버랩 ${overlaps.length} / 갭 ${gaps.length} / start없음 ${noStart.length}`);
console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);
