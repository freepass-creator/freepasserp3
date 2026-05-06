#!/usr/bin/env node
/**
 * 광범위 alias 자동 제거 — 같은 maker 내에서 여러 세대를 가진 모델은 단독 model_root 로 alias 매칭하면 안됨.
 *
 * 제거 대상:
 *  1. alias 가 catalog 의 model_root 와 같음 (예: "K5", "쏘나타", "그랜저")
 *     → 매물 sub_model="K5" 가 어느 세대인지 모르니 alias-direct 매칭은 score 로 위임
 *  2. alias 에 "하이브리드"/"EV"/"전기" 키워드 들어가 있는데 catalog title 에는 없는 경우 (또는 반대)
 *     → fuel filter 가 score 매칭에서 처리하므로 alias-direct 는 정확한 표기만 유지
 *
 *  사용:
 *    node scripts/prune-broad-aliases.cjs           # dry-run
 *    node scripts/prune-broad-aliases.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const files = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'));

let totalRemoved = 0;
let touched = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!Array.isArray(d.aliases) || !d.aliases.length) continue;
  const title = d.title || '';
  const titleHasHybrid = /하이브리드|hybrid|hev/i.test(title);
  const titleHasEV = /(일렉트리파이드|electrified|일렉트릭|electric|\bev\b)/i.test(title);
  const root = (d.model_root || '').trim();
  const rootLower = root.toLowerCase();

  const removed = [];
  const kept = [];
  for (const a of d.aliases) {
    const aTrim = (a || '').trim();
    if (!aTrim) continue;
    const aLow = aTrim.toLowerCase();
    // 1) model_root 와 동일 (단독)
    if (root && aLow === rootLower) { removed.push(a + ' (=root)'); continue; }
    // 2) alias 에 하이브리드 키워드 있는데 title 에는 없음
    const aHasHybrid = /하이브리드|hybrid|hev/i.test(aTrim);
    const aHasEV = /(일렉트리파이드|electrified|일렉트릭|electric|\bev\b)/i.test(aTrim);
    if (aHasHybrid && !titleHasHybrid) { removed.push(a + ' (fuel mismatch: 하이브리드)'); continue; }
    if (!aHasHybrid && titleHasHybrid && !titleHasEV) { removed.push(a + ' (fuel mismatch: not 하이브리드)'); continue; }
    if (aHasEV && !titleHasEV) { removed.push(a + ' (fuel mismatch: EV)'); continue; }
    if (!aHasEV && titleHasEV) { removed.push(a + ' (fuel mismatch: not EV)'); continue; }
    kept.push(a);
  }
  if (!removed.length) continue;
  console.log(`\n${f}  | ${title}`);
  console.log(`  유지 (${kept.length}): ${kept.join(', ') || '-'}`);
  console.log(`  제거 (${removed.length}): ${removed.join(', ')}`);
  totalRemoved += removed.length;
  touched++;
  if (APPLY) {
    d.aliases = kept;
    fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  }
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog, ${totalRemoved}개 alias 제거`);
if (!APPLY) console.log('--apply 추가하면 실제 catalog json 갱신');
