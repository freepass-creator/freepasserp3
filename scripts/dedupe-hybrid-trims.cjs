#!/usr/bin/env node
/**
 * 가솔린 catalog 가 하이브리드 트림까지 포함하고 있고, 별도 _hybrid.json catalog 도 존재하는 경우
 *  → 가솔린 catalog 에서 하이브리드 트림 제거 (하이브리드 catalog 가 단일 진실원)
 *
 *  사용:
 *    node scripts/dedupe-hybrid-trims.cjs            # dry-run
 *    node scripts/dedupe-hybrid-trims.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');
const HY_RE = /하이브리드|hybrid|HEV/i;

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalRemoved = 0;

for (const f of files) {
  if (f.endsWith('_hybrid.json')) continue;
  const baseStem = f.replace('.json', '');
  const hyFile = baseStem + '_hybrid.json';
  const hyFp = path.join(CATALOG_DIR, hyFile);
  if (!fs.existsSync(hyFp)) continue;

  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const hyD = JSON.parse(fs.readFileSync(hyFp, 'utf8'));
  const trims = d.trims || {};
  const hyTrims = hyD.trims || (hyD.trims = {});
  const toRemove = Object.keys(trims).filter(k => HY_RE.test(k));
  if (!toRemove.length) continue;

  function isMeaningful(t) {
    const p = t.price || {};
    const hasPrice = Object.values(p).some(v => typeof v === 'number' && v > 0);
    return hasPrice || (t.basic_options || []).length > 0 || (t.select_groups || []).length > 0;
  }
  const removed = [], migrated = [], dropped = [];
  for (const k of toRemove) {
    // hybrid 토큰 제거한 키가 hybrid catalog 에 있나?
    const stripped = k.replace(/\s*하이브리드\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (hyTrims[stripped]) {
      // 이미 있음 → 가스 catalog 에서만 제거
      delete trims[k];
      removed.push(k);
    } else if (!stripped || !isMeaningful(trims[k])) {
      // 빈 placeholder 또는 stripped 가 빈 문자열 → 그냥 제거 (migrate X)
      dropped.push(k);
      delete trims[k];
    } else {
      // 의미있는 데이터 → hybrid catalog 로 migrate
      hyTrims[stripped] = trims[k];
      delete trims[k];
      migrated.push(k + ' → ' + stripped);
    }
  }
  if (APPLY) {
    fs.writeFileSync(fp, JSON.stringify(d, null, 2));
    if (migrated.length) fs.writeFileSync(hyFp, JSON.stringify(hyD, null, 2));
  }
  console.log(`${APPLY ? '✓' : '+'} ${d.title}`);
  if (removed.length) console.log(`    제거 (이미 hy catalog 있음): ${removed.join(' / ')}`);
  if (dropped.length) console.log(`    빈 placeholder 제거: ${dropped.join(' / ')}`);
  if (migrated.length) console.log(`    migrate (hy catalog 추가): ${migrated.join(' / ')}`);
  touched++;
  totalRemoved += toRemove.length;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 가솔린 catalog · 하이브리드 트림 ${totalRemoved}개 제거`);
