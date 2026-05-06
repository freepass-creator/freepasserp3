#!/usr/bin/env node
/**
 * 신차 (year_start >= 2022) 현대/기아/제네시스/KGM/쉐보레 catalog 의 옵션 사전에
 * '무선 Apple CarPlay & Android Auto' 가 누락된 경우 자동 추가.
 *
 *  - catalog.options 에 MIRROR_WIRELESS_AUTO 코드로 추가 (한 메이커 안에서 통합)
 *  - 모든 trim 의 basic 배열에 그 코드 push (기본옵션 처리)
 *  - 이미 미러링/카플레이/안드로이드 오토 옵션 있으면 skip
 *
 *  사용:
 *    node scripts/add-wireless-mirroring-stubs.cjs           # dry-run
 *    node scripts/add-wireless-mirroring-stubs.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');
const POPULAR = ['현대', '기아', '제네시스', 'KGM', '쉐보레'];
const SINCE = '2022-01';

const MIRRORING_NAME_RE = /carplay|android\s*auto|애플\s*카플레이|안드로이드\s*오토|미러링/i;

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let updated = 0, skipped = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  if ((d.year_start || '') < SINCE) continue;
  const opts = d.options || (d.options = {});
  const trims = d.trims || {};
  if (!Object.keys(trims).length) { skipped++; continue; }

  // 이미 미러링/카플레이 옵션 있는지
  const hasMirror = Object.values(opts).some(o => MIRRORING_NAME_RE.test(o?.name || ''));
  if (hasMirror) { skipped++; continue; }

  // 새 옵션 코드
  const newCode = 'WIRELESS_MIRROR';
  opts[newCode] = {
    name: '무선 Apple CarPlay & Android Auto',
    category: '편의/멀티미디어',
    is_package: false,
  };
  // 모든 trim 의 basic 에 추가
  let trimsTouched = 0;
  for (const trim of Object.values(trims)) {
    if (!Array.isArray(trim.basic)) trim.basic = [];
    if (!trim.basic.includes(newCode)) {
      trim.basic.push(newCode);
      trimsTouched++;
    }
  }
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${f} (${d.title}) — trim ${trimsTouched}개 basic 추가`);
  updated++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${updated}개 catalog 업데이트, ${skipped}개 skip`);
