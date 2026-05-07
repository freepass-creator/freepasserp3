#!/usr/bin/env node
/**
 * dedupe-hybrid-trims 가 트림은 hybrid catalog 로 migrate 했지만
 * options 사전 / categories 는 가솔린 catalog 에 그대로 남음.
 * → hybrid catalog 의 트림이 참조하는 코드 중 hybrid options 에 없고 가솔린에 있는 것을 복사.
 *
 *  사용:
 *    node scripts/sync-hybrid-options-from-gas.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalCopied = 0;

for (const f of files) {
  if (!f.endsWith('_hybrid.json')) continue;
  const baseStem = f.replace('_hybrid.json', '');
  const gasFp = path.join(CATALOG_DIR, baseStem + '.json');
  if (!fs.existsSync(gasFp)) continue;
  const hyFp = path.join(CATALOG_DIR, f);
  const gas = JSON.parse(fs.readFileSync(gasFp, 'utf8'));
  const hy = JSON.parse(fs.readFileSync(hyFp, 'utf8'));
  // hy 트림이 참조하는 코드들
  const codes = new Set();
  for (const t of Object.values(hy.trims || {})) {
    for (const c of (t.basic || [])) codes.add(c);
    for (const c of (t.select || [])) codes.add(c);
    for (const g of (t.select_groups || [])) {
      for (const c of (g.codes || [])) codes.add(c);
    }
  }
  hy.options = hy.options || {};
  hy.categories = hy.categories || {};
  let copied = 0;
  for (const c of codes) {
    if (hy.options[c]) continue;
    if (gas.options?.[c]) {
      hy.options[c] = JSON.parse(JSON.stringify(gas.options[c]));
      copied++;
    }
  }
  // categories 도 복사 — gas 의 표준 카테고리 codes 중 hy 옵션 사전에 있는 것만
  if (copied > 0) {
    for (const [catName, catCodes] of Object.entries(gas.categories || {})) {
      if (!hy.categories[catName]) hy.categories[catName] = [];
      const set = new Set(hy.categories[catName]);
      for (const c of catCodes) {
        if (hy.options[c]) set.add(c);
      }
      hy.categories[catName] = [...set];
    }
  }
  if (copied === 0) continue;
  if (APPLY) fs.writeFileSync(hyFp, JSON.stringify(hy, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${hy.title} — ${copied}개 옵션 사전 복사`);
  touched++;
  totalCopied += copied;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 옵션 ${totalCopied}개 복원`);
