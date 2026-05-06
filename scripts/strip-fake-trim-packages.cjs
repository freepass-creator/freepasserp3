#!/usr/bin/env node
/**
 * wikicar OCR 가격표가 액세서리 패키지를 트림으로 잘못 인식한 항목 제거.
 *  기준: 트림 price 의 max value < 7,000,000 (700만원) 이면 액세서리 패키지로 간주
 *        — 신차는 최저 1100만원 (모닝/스파크) 이라 700만원 미만 트림은 존재 안함
 *  제거 트림은 catalog.options 사전에도 추가하지 않음 (액세서리는 ERP 표준옵션과 무관)
 *
 *  사용:
 *    node scripts/strip-fake-trim-packages.cjs            # dry-run
 *    node scripts/strip-fake-trim-packages.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');
const PRICE_FLOOR = 7_000_000;

// 가격 정보가 실제로 있고 (key 1개 이상) 그 값이 모두 < FLOOR 인 경우만 false price.
// 빈 dict {} 나 0 만 있는 경우는 "가격 미상" 으로 분류 — 진짜 트림이지만 OCR 실패일 수 있어 보존.
function priceState(price) {
  if (price == null) return { state: 'unknown', max: 0 };
  if (typeof price === 'number') return { state: price > 0 ? 'has' : 'unknown', max: price };
  if (typeof price !== 'object') return { state: 'unknown', max: 0 };
  let max = 0, hasValue = false;
  for (const v of Object.values(price)) {
    if (typeof v === 'number' && v > 0) { hasValue = true; if (v > max) max = v; }
  }
  return { state: hasValue ? 'has' : 'unknown', max };
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalRemoved = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const trims = d.trims || {};
  const toRemove = [];
  for (const [k, t] of Object.entries(trims)) {
    const p = priceState(t.price);
    // 가격 정보가 명확히 있고 (`state==='has'`) 그게 700만원 미만이면 가짜
    if (p.state === 'has' && p.max < PRICE_FLOOR) toRemove.push(k);
  }
  if (!toRemove.length) continue;

  for (const k of toRemove) delete trims[k];
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} — 제거: ${toRemove.join(' / ')}`);
  touched++;
  totalRemoved += toRemove.length;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 가짜 트림 ${totalRemoved}개 제거`);
