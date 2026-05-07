#!/usr/bin/env node
/**
 * 같은 모델의 가솔린/하이브리드 catalog 의 옵션 사전 / 카테고리 / 트림 basic 통일.
 *  대응 관계 (file 명 기반):
 *    *_hybrid.json         ↔  *.json
 *    *_facelift_hybrid.json ↔  *_facelift.json (없으면 *.json)
 *    *_pre_hybrid.json      ↔  *_pre.json (없으면 *.json)
 *    *_hybrid_pre.json      ↔  *_pre.json (없으면 *.json)
 *    그랜저 IG 163         ↔  그랜저 IG (이미 처리)
 *
 *  하이브리드 trim 별로 base trim name (첫 토큰 또는 의미 토큰) 매칭하여 가솔린 trim basic 복사.
 *
 *  사용:
 *    node scripts/unify-gas-hybrid-options.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

// 하이브리드 catalog file 명 패턴 → 가솔린 catalog 후보 (우선순위)
function gasCandidates(hyFile) {
  const stems = [];
  let s = hyFile.replace('.json', '');
  if (s.endsWith('_facelift_hybrid')) {
    stems.push(s.replace('_facelift_hybrid', '_facelift') + '.json');
    stems.push(s.replace('_facelift_hybrid', '') + '.json');
  } else if (s.endsWith('_pre_hybrid') || s.endsWith('_hybrid_pre')) {
    stems.push(s.replace(/_pre_hybrid$|_hybrid_pre$/, '_pre') + '.json');
    stems.push(s.replace(/_pre_hybrid$|_hybrid_pre$/, '') + '.json');
  } else if (s.endsWith('_hybrid')) {
    stems.push(s.replace('_hybrid', '') + '.json');
  } else if (s.endsWith('_edge_hybrid')) {
    stems.push(s.replace('_edge_hybrid', '_edge') + '.json');
    stems.push(s.replace('_edge_hybrid', '') + '.json');
  }
  return stems;
}

// 트림 키에서 base name 추출 (첫 의미 토큰 또는 보조 토큰 포함)
const COMPOUND_BASES = ['베스트', '노블레스', '플래티넘'];
function baseTrimName(k) {
  const tokens = k.split(/\s+/);
  if (COMPOUND_BASES.includes(tokens[0]) && tokens.length > 1) {
    // '베스트 셀렉션Ⅰ' → '베스트 셀렉션Ⅰ'  /  '노블레스 스페셜' → '노블레스 스페셜'
    return tokens[0] + ' ' + tokens[1];
  }
  return tokens[0];
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const hyFiles = files.filter(f => f.includes('hybrid'));
let touched = 0, totalTrimsCopied = 0;

for (const hyFile of hyFiles) {
  const cands = gasCandidates(hyFile);
  let gasFile = null;
  for (const c of cands) if (files.includes(c)) { gasFile = c; break; }
  if (!gasFile) continue;

  const hyFp = path.join(CATALOG_DIR, hyFile);
  const gasFp = path.join(CATALOG_DIR, gasFile);
  const hy = JSON.parse(fs.readFileSync(hyFp, 'utf8'));
  const gas = JSON.parse(fs.readFileSync(gasFp, 'utf8'));

  // 옵션 사전 / 카테고리 = 더 풍부한 쪽 + 부족한 쪽 union (양쪽 보존, 가스가 우선)
  const beforeOpts = Object.keys(hy.options || {}).length;
  const gasOpts = gas.options || {};
  const hyOpts = hy.options || {};
  // 둘 중 풍부한 쪽 base + 다른 쪽 보충
  const useGasAsBase = Object.keys(gasOpts).length >= Object.keys(hyOpts).length;
  const base = useGasAsBase ? gasOpts : hyOpts;
  const supp = useGasAsBase ? hyOpts : gasOpts;
  const merged = JSON.parse(JSON.stringify(base));
  for (const [c, info] of Object.entries(supp)) {
    if (!merged[c]) merged[c] = JSON.parse(JSON.stringify(info));
  }
  hy.options = merged;
  // 가솔린 catalog 도 같은 사전으로 갱신 (양방향 통합)
  gas.options = JSON.parse(JSON.stringify(merged));
  // 카테고리도 동일
  const baseCats = useGasAsBase ? (gas.categories || {}) : (hy.categories || {});
  const suppCats = useGasAsBase ? (hy.categories || {}) : (gas.categories || {});
  const mergedCats = JSON.parse(JSON.stringify(baseCats));
  for (const [k, codes] of Object.entries(suppCats)) {
    if (!mergedCats[k]) mergedCats[k] = [];
    const set = new Set(mergedCats[k]);
    for (const c of codes || []) if (merged[c]) set.add(c);
    mergedCats[k] = [...set];
  }
  hy.categories = mergedCats;
  gas.categories = JSON.parse(JSON.stringify(mergedCats));
  const afterOpts = Object.keys(hy.options).length;

  // 트림별 basic / select / select_groups 가솔린에서 복사 (price 는 유지)
  // 같은 base 가 여러 개면 select_groups + basic 합이 가장 풍부한 것 선택
  const gasByBase = {};
  for (const [k, t] of Object.entries(gas.trims || {})) {
    const base = baseTrimName(k);
    const score = (t.basic || []).length + (t.select_groups || []).length * 5;
    const cur = gasByBase[base];
    const curScore = cur ? (cur.basic || []).length + (cur.select_groups || []).length * 5 : -1;
    if (score > curScore) gasByBase[base] = t;
  }

  let trimsCopied = 0;
  for (const [k, t] of Object.entries(hy.trims || {})) {
    const base = baseTrimName(k);
    const src = gasByBase[base];
    if (!src) continue;
    t.basic = Array.isArray(src.basic) ? [...src.basic] : [];
    t.select = Array.isArray(src.select) ? [...src.select] : [];
    t.select_groups = Array.isArray(src.select_groups) ? JSON.parse(JSON.stringify(src.select_groups)) : [];
    delete t.basic_options;
    trimsCopied++;
  }

  if (trimsCopied === 0 && beforeOpts === afterOpts) continue;
  if (APPLY) {
    fs.writeFileSync(hyFp, JSON.stringify(hy, null, 2));
    fs.writeFileSync(gasFp, JSON.stringify(gas, null, 2));
  }
  console.log(`${APPLY ? '✓' : '+'} ${hy.title}  ←  ${gas.title} (옵션 ${beforeOpts}→${afterOpts}, 트림 ${trimsCopied}/${Object.keys(hy.trims || {}).length})`);
  touched++;
  totalTrimsCopied += trimsCopied;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 트림 ${totalTrimsCopied}개 동기화`);
