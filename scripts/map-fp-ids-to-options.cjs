#!/usr/bin/env node
/**
 * 모든 catalog 의 옵션 사전 entry 마다 fp_ids[] 필드를 추가/갱신.
 *  - FP_KEYWORD_RULES 의 키워드 매칭으로 옵션명 → FP 표준옵션 ID 매핑
 *  - 매핑 실패시 fp_ids: []
 *  - 매트릭스 페이지가 트림 옵션 → FP 표준옵션 chip 시각화 시 직접 활용
 *
 *  사용:
 *    node scripts/map-fp-ids-to-options.cjs           # dry-run
 *    node scripts/map-fp-ids-to-options.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const APPLY = process.argv.includes('--apply');

const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const RULES = [];
for (const m of rulesSrc.matchAll(/\{\s*kw:\s*['"]([^'"]+)['"]\s*,\s*ids:\s*\[([^\]]+)\]\s*\}/g)) {
  const ids = m[2].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  RULES.push({ kw: m[1], ids });
}
// 긴 키워드 우선 (substring 충돌 회피)
RULES.sort((a, b) => b.kw.length - a.kw.length);

function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}
function matchFpIds(text) {
  const n = normName(text);
  const matched = new Set();
  for (const r of RULES) {
    if (n.includes(normName(r.kw))) for (const id of r.ids) matched.add(id);
  }
  return [...matched].sort();
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalOpts = 0, mappedOpts = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const opts = d.options || {};
  if (!Object.keys(opts).length) continue;

  let changed = false;
  for (const [code, info] of Object.entries(opts)) {
    if (code.startsWith('PKG_') || info.is_package) {
      // 패키지는 별도 매핑 (codes 안의 FP ID 들이 select_groups 에 직접 들어감)
      continue;
    }
    const name = info.name || '';
    const fpIds = matchFpIds(name);
    const old = JSON.stringify(info.fp_ids || []);
    const next = JSON.stringify(fpIds);
    if (old !== next) {
      info.fp_ids = fpIds;
      changed = true;
    }
    totalOpts++;
    if (fpIds.length) mappedOpts++;
  }

  if (!changed) continue;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  touched++;
}

console.log(`${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog`);
console.log(`  옵션 ${totalOpts}개 중 ${mappedOpts}개 FP 매핑 (${(mappedOpts / totalOpts * 100).toFixed(1)}%)`);
