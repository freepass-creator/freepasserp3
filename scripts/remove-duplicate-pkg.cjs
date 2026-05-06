#!/usr/bin/env node
/**
 * fill-popular-packages.cjs 가 추가한 PKG_* 코드를 wikicar 데이터 풍부한 catalog 에서 제거.
 *  조건: 옵션 사전 (PKG_* 제외) 10+ 인 catalog → PKG_* 중복 제거
 *  옵션 사전 빈 stub catalog 는 PKG_* 그대로 유지 (wikicar 데이터 없으니 우리 표준 사용)
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const PKG_CODES = ['PKG_ADAS', 'PKG_CONVENIENCE', 'PKG_COMFORT', 'PKG_PARKING', 'PKG_EXTERIOR', 'PKG_BUILTIN_CAM', 'PKG_SUNROOF', 'PKG_HUD'];

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const opts = d.options || {};
  const trims = d.trims || {};
  // PKG_* 제외한 옵션 수
  const realOpts = Object.keys(opts).filter(k => !PKG_CODES.includes(k)).length;
  if (realOpts < 10) continue;   // stub — 우리 표준 패키지 유지

  // PKG_* 코드 제거 (options 사전 + trim 의 select_groups)
  let removed = 0;
  for (const code of PKG_CODES) {
    if (opts[code]) { delete opts[code]; removed++; }
  }
  for (const t of Object.values(trims)) {
    if (!Array.isArray(t.select_groups)) continue;
    t.select_groups = t.select_groups.filter(g => {
      if (Array.isArray(g)) return true;
      const codes = g.codes || [];
      return !codes.some(c => PKG_CODES.includes(c));
    });
  }
  if (removed === 0) continue;

  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} — PKG_* ${removed}개 제거 (옵션 사전 ${realOpts}+)`);
  touched++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog`);
