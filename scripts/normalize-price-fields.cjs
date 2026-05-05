#!/usr/bin/env node
/**
 * 모든 catalog 의 price 필드 정규화
 *   - price 가 객체이고 base_* 만 있으면 → 첫 base_* 값을 base 로 통일
 *   - price 가 number 면 → { base: number }
 *   멱등 (이미 base 있으면 건드리지 않음)
 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'data', 'car-master');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));

let totalChanged = 0;
let catalogsTouched = 0;
for (const f of files) {
  const fp = path.join(dir, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!d.trims) continue;
  let changed = 0;
  for (const [name, t] of Object.entries(d.trims)) {
    if (typeof t.price === 'number') {
      t.price = { base: t.price };
      changed++;
    } else if (t.price && typeof t.price === 'object' && !t.price.base) {
      const baseKey = Object.keys(t.price).find(k => k.startsWith('base_'));
      if (baseKey) {
        t.price = { base: t.price[baseKey] };
        changed++;
      }
    }
  }
  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n', 'utf8');
    totalChanged += changed;
    catalogsTouched++;
  }
}
console.log(`✓ price 정규화: ${catalogsTouched} catalog / ${totalChanged} trim`);
