#!/usr/bin/env node
/**
 * 트림 이름이 "<base> N인승" 패턴인 catalog 에서 인승 토큰만 다른 트림을 통합.
 *  - 같은 base 트림이 2+ 인승으로 나뉘어 있으면 → 단일 트림 + seat_options 메타
 *  - 단일 인승만 있는 base (예: 카니발 9인승만) 는 트림 키에서 인승 토큰 제거 + seat_options 단일
 *  - basic_options / select_groups 는 인승과 무관하게 base 트림 한 벌로 통합 (첫 트림 기준)
 *  - price 는 default_seat (가장 낮은 인승, 보통 표준 라인업) 기준으로 셋팅
 *
 *  본질형 (스타리아·카니발 하이리무진·PV5 등) 은 trim 키에 모델 변형이 포함되어 있어
 *  base 분리 후에도 다중 트림이 되니 그대로 보존됨.
 *
 *  사용:
 *    node scripts/merge-seat-trims.cjs           # dry-run
 *    node scripts/merge-seat-trims.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');
const SEAT_RE = /\s*(\d+)인승\s*$/;

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const trims = d.trims || {};

  // base 그룹 만들기
  const groups = new Map();
  let hasSeatTrim = false;
  for (const [k, t] of Object.entries(trims)) {
    const m = k.match(SEAT_RE);
    if (!m) {
      // 인승 토큰 없는 트림은 단독 그룹 (base = 키 그대로)
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ origKey: k, seats: null, trim: t });
      continue;
    }
    hasSeatTrim = true;
    const seats = parseInt(m[1], 10);
    const base = k.replace(SEAT_RE, '').trim();
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({ origKey: k, seats, trim: t });
  }

  if (!hasSeatTrim) continue;

  // 통합되는 그룹이 하나라도 있는지 (인승 2+ 또는 인승1 + 인승토큰만 제거할 base)
  let willChange = false;
  for (const [base, members] of groups) {
    if (members.some(m => m.seats != null) &&
        (members.length >= 2 || members[0].origKey !== base)) {
      willChange = true; break;
    }
  }
  if (!willChange) continue;

  // 새 trims 사전 구성
  const newTrims = {};
  const log = [];
  for (const [base, members] of groups) {
    const seatMembers = members.filter(m => m.seats != null);
    if (!seatMembers.length) {
      // 인승 토큰 없던 트림 → 그대로
      newTrims[base] = members[0].trim;
      continue;
    }
    // 인승 토큰 있는 멤버 — 가격 낮은 쪽이 default (보통 표준 라인업)
    function basePrice(t) {
      const p = t.price || {};
      return p.tax_5_after || p.tax_5_before || p.base || Infinity;
    }
    const sortedByPrice = [...seatMembers].sort((a, b) => basePrice(a.trim) - basePrice(b.trim));
    const def = sortedByPrice[0];
    const merged = { ...def.trim };
    // seat_options: { seats: { price: ... } } — 인승 번호 오름차순 보존
    const sortedBySeat = [...seatMembers].sort((a, b) => a.seats - b.seats);
    merged.seat_options = {};
    for (const m of sortedBySeat) {
      merged.seat_options[m.seats] = { price: m.trim.price };
    }
    merged.default_seat = def.seats;
    newTrims[base] = merged;
    log.push(`${base}: ${seatMembers.map(m => m.seats + '인승').join('+')}`);
  }

  d.trims = newTrims;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title}`);
  for (const l of log) console.log(`    ${l}`);
  touched++;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog`);
