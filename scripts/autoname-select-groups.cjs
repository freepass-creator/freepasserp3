#!/usr/bin/env node
/**
 * select_groups 자동 이름 보강.
 * - name 비어있는 group 에 첫 옵션 이름을 자동 부여
 * - 여러 옵션인 경우 "X 외 N개" 형식
 * - 멱등 (이미 name 있으면 건드리지 않음)
 *
 * 카탈로그 수정 후 자동 실행 — build-car-master-bundle.cjs 보다 먼저 호출.
 */
const fs = require('fs');
const path = require('path');

const CAR_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

function processCatalog(filePath) {
  const d = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const opts = d.options || {};
  let changed = 0;
  for (const t of Object.values(d.trims || {})) {
    for (const g of (t.select_groups || [])) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) continue;
      if (g.name) continue;
      const codes = g.codes || [];
      if (!codes.length) continue;
      const firstName = opts[codes[0]]?.name || '';
      if (!firstName) continue;
      g.name = codes.length > 1 && !/패키지|컬렉션/.test(firstName)
        ? `${firstName} 외 ${codes.length - 1}개`
        : firstName;
      changed++;
    }
  }
  if (changed > 0) {
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2), 'utf-8');
  }
  return changed;
}

function main() {
  const files = fs.readdirSync(CAR_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  let totalChanged = 0;
  let catalogsUpdated = 0;
  for (const f of files) {
    const c = processCatalog(path.join(CAR_DIR, f));
    if (c > 0) {
      catalogsUpdated++;
      totalChanged += c;
    }
  }
  if (totalChanged > 0) {
    console.log(`[autoname-select-groups] ${totalChanged}개 group, ${catalogsUpdated}개 카탈로그 이름 보강`);
  } else {
    console.log(`[autoname-select-groups] 이름 비어있는 group 없음 (멱등)`);
  }
}

main();
