#!/usr/bin/env node
/**
 * _index.json 에 entry 있지만 실제 catalog 파일 없는 stale entry 제거.
 *
 * 사용:
 *   node scripts/clean-stale-index-entries.cjs        # dry-run
 *   node scripts/clean-stale-index-entries.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const INDEX_PATH = path.join(CATALOG_DIR, '_index.json');
const APPLY = process.argv.includes('--apply');

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const files = new Set(fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'))
  .map(f => f.replace('.json', '')));

const stale = [];
for (const cid of Object.keys(index)) {
  if (!files.has(cid)) stale.push(cid);
}

if (!stale.length) {
  console.log('✓ stale entry 없음');
  process.exit(0);
}

console.log(`stale entry ${stale.length}개:`);
for (const s of stale) console.log(`  - ${s} (${index[s].title || ''})`);

if (!APPLY) {
  console.log('\n[dry-run] --apply 추가하면 실제 제거');
  process.exit(0);
}

for (const s of stale) delete index[s];
const sorted = {};
for (const k of Object.keys(index).sort()) sorted[k] = index[k];
fs.writeFileSync(INDEX_PATH, JSON.stringify(sorted, null, 2));
console.log(`\n✓ ${stale.length}개 stale entry 제거`);
