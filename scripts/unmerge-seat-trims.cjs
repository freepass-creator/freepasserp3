#!/usr/bin/env node
/**
 * merge-seat-trims.cjs 의 reverse — seat_options 메타가 있는 트림을 다시 인승별 트림으로 분리.
 *  - 트림 키: "<base>" → "<base> N인승" (각 seat 별 trim)
 *  - price: seat_options[N].price 그대로
 *  - basic_options / select_groups / 기타 fields 는 base trim 그대로 복제 (옵션 차이는 wikicar 데이터 없으면 동일)
 *  - seat_options / default_seat 메타 제거
 *
 *  사용:
 *    node scripts/unmerge-seat-trims.cjs            # dry-run
 *    node scripts/unmerge-seat-trims.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalSplit = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const trims = d.trims || {};
  const newTrims = {};
  let didSplit = false;
  for (const [k, t] of Object.entries(trims)) {
    if (!t.seat_options || !Object.keys(t.seat_options).length) {
      newTrims[k] = t;
      continue;
    }
    // seat_options 있는 트림 → 인승별로 분리. 인승 오름차순.
    const seats = Object.keys(t.seat_options).map(Number).sort((a, b) => a - b);
    const { seat_options, default_seat, ...rest } = t;
    for (const s of seats) {
      const newKey = `${k} ${s}인승`;
      newTrims[newKey] = {
        ...rest,
        price: seat_options[s].price || rest.price,
      };
    }
    didSplit = true;
    totalSplit += seats.length;
  }
  if (!didSplit) continue;
  d.trims = newTrims;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} (${Object.keys(trims).length} → ${Object.keys(newTrims).length} 트림)`);
  touched++;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 트림 ${totalSplit}개 분리`);
