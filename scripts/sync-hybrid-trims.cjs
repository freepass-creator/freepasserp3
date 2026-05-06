#!/usr/bin/env node
/**
 * 하이브리드 stub catalog 의 trims 를 base 가솔린 catalog 의 "하이브리드" 트림으로 보충.
 *
 * 동작:
 *  1. catalog source==='stub' 이고 cid 가 _hybrid 로 끝나는 catalog 들 순회
 *  2. base = cid.replace(/_hybrid$/,'') 의 catalog json 읽기
 *  3. base.trims 에서 키 이름에 "하이브리드" 포함된 trim 만 추출
 *  4. trim 키 이름에서 "하이브리드" 단어 제거 (앞/뒤 공백 trim) → 깔끔한 이름
 *  5. stub.trims 에 set, source 를 'derived-from-base' 로 마킹
 *
 *  사용:
 *    node scripts/sync-hybrid-trims.cjs           # dry-run
 *    node scripts/sync-hybrid-trims.cjs --apply   # 실제 적용
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const files = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_') && f.endsWith('_hybrid.json'));

let updated = 0, skipped = 0;

for (const f of files) {
  const stubPath = path.join(CATALOG_DIR, f);
  const stub = JSON.parse(fs.readFileSync(stubPath, 'utf8'));
  if (stub.source !== 'stub' && stub.source !== 'derived-from-base') {
    skipped++;
    continue;
  }
  const baseCid = (stub.catalog_id || f.replace('.json', '')).replace(/_hybrid$/, '');
  const basePath = path.join(CATALOG_DIR, `${baseCid}.json`);
  if (!fs.existsSync(basePath)) {
    console.warn(`✗ base 없음: ${baseCid}.json (skip)`);
    skipped++;
    continue;
  }
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const baseTrims = base.trims || {};
  const hybridTrims = {};
  for (const [name, trim] of Object.entries(baseTrims)) {
    if (!/하이브리드|hybrid|hev/i.test(name)) continue;
    // 트림 이름에서 "하이브리드" 단어 제거
    const cleanName = name
      .replace(/하이브리드/gi, '')
      .replace(/hybrid/gi, '')
      .replace(/hev/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = cleanName || name;
    hybridTrims[key] = trim;
  }
  if (Object.keys(hybridTrims).length === 0) {
    console.warn(`- ${f}: base 에 하이브리드 trim 없음 (stub 유지)`);
    skipped++;
    continue;
  }
  // 트림 갱신
  stub.trims = hybridTrims;
  stub.source = 'derived-from-base';
  stub.note = `${stub.maker} ${stub.model_root} 하이브리드 — ${baseCid} 의 하이브리드 트림 추출`;
  if (APPLY) fs.writeFileSync(stubPath, JSON.stringify(stub, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${f}: ${Object.keys(hybridTrims).length} trim ← ${baseCid}`);
  console.log(`    ${Object.keys(hybridTrims).join(', ')}`);
  updated++;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${updated}건 업데이트, ${skipped}건 스킵`);
if (!APPLY) console.log('--apply 추가하면 실제 catalog json 갱신');
