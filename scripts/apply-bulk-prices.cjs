#!/usr/bin/env node
/**
 * 5개 agent 조사 결과 일괄 적용 — 가격 누락 trim 보강.
 *  결과 파일: _prices_*.json (만원 단위 → 원 단위로 ×10000)
 *  적용 시 trim 키 매칭 안 되는 것은 경고만 표시 (catalog 키 ≠ 조사 키).
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const SCRIPTS = __dirname;

const SOURCES = ['_prices_hyundai_sedan.json', '_prices_hyundai_suv.json', '_prices_kia_sedan.json', '_prices_kia_suv.json', '_prices_kgm.json', '_prices_remaining.json', '_prices_final.json'];

const merged = {};
for (const s of SOURCES) {
  const fp = path.join(SCRIPTS, s);
  if (!fs.existsSync(fp)) { console.log('! ' + s + ' 누락'); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const [f, prices] of Object.entries(d)) {
    if (!Object.keys(prices).length) continue;
    merged[f] = Object.assign(merged[f] || {}, prices);
  }
}

let touched = 0, applied = 0, missed = 0;
for (const [f, prices] of Object.entries(merged)) {
  const fp = path.join(DIR, f);
  if (!fs.existsSync(fp)) { console.log('! ' + f + ' catalog 누락'); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let changed = 0;
  const trims = d.trims || {};
  const trimKeys = Object.keys(trims);
  for (const [k, p] of Object.entries(prices)) {
    if (trims[k] && !trims[k].price?.base) {
      trims[k].price = { base: p * 10000 };
      changed++;
    } else if (trims[k]?.price?.base) {
      // 이미 있음 (skip)
    } else {
      // 키 매칭 안 됨 — 비슷한 키 찾기
      const fuzzy = trimKeys.find(tk => {
        const norm = s => s.replace(/\s+/g,'').replace(/-/g,'').toLowerCase();
        return norm(tk) === norm(k);
      });
      if (fuzzy && !trims[fuzzy].price?.base) {
        trims[fuzzy].price = { base: p * 10000 };
        changed++;
      } else {
        console.log('  ! [' + f + '] 매칭 실패: "' + k + '"');
        missed++;
      }
    }
  }
  if (changed) {
    if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
    console.log((APPLY ? '✓' : '+') + ' ' + d.title + ' — ' + changed + '개 trim');
    applied += changed;
    touched++;
  }
}
console.log('\n=== ' + (APPLY ? '적용' : 'dry-run') + ' ===');
console.log('  ' + touched + '개 catalog · ' + applied + '개 trim 가격 보강 · ' + missed + '개 매칭 실패');
