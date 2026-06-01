#!/usr/bin/env node
/**
 * 3 agent 결과 (_trim_remap_*.json) 을 catalog 에 적용.
 *  - agent 결과 key 는 strip 적용 전 (예: "모던 가솔린")
 *  - catalog 현재 trim key 는 strip 적용 후 (예: "모던")
 *  - 매칭: normalize (strip 동력원) 후 비교
 *  - 매칭되면 catalog trim 키를 agent value 로 교체
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const SCRIPTS = __dirname;

const SOURCES = ['_trim_remap_hyundai_genesis.json', '_trim_remap_kia.json', '_trim_remap_kgm.json'];

const FUEL_RE = /\s*(?:가솔린|디젤|LPG|LPi|하이브리드|HEV|EV|일렉트릭|수소|플러그인하이브리드|PHEV)\s*/g;
const stripFuel = s => s.replace(FUEL_RE, ' ').replace(/\s+/g, ' ').trim();

const merged = {};
for (const s of SOURCES) {
  const fp = path.join(SCRIPTS, s);
  if (!fs.existsSync(fp)) { console.log('! ' + s + ' 누락'); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const [f, mapping] of Object.entries(d)) {
    if (!merged[f]) merged[f] = {};
    Object.assign(merged[f], mapping);
  }
}

let touched = 0, applied = 0, missed = 0;
for (const [f, mapping] of Object.entries(merged)) {
  const fp = path.join(DIR, f);
  if (!fs.existsSync(fp)) { console.log('! ' + f + ' catalog 누락'); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const trims = d.trims || {};
  const trimKeys = Object.keys(trims);
  // strip 적용 후 매칭 사전 build
  const strippedToOrig = {};
  for (const tk of trimKeys) strippedToOrig[stripFuel(tk)] = tk;

  const newTrims = {};
  let changed = 0;
  const usedKeys = new Set();

  for (const [oldKey, newKey] of Object.entries(mapping)) {
    const stripOld = stripFuel(oldKey);
    const origKey = strippedToOrig[stripOld];
    if (origKey && trims[origKey]) {
      newTrims[newKey] = trims[origKey];
      usedKeys.add(origKey);
      changed++;
    } else {
      console.log('  ! [' + f + '] 매칭 실패: "' + oldKey + '" (strip: "' + stripOld + '")');
      missed++;
    }
  }
  // 매칭 안 된 기존 trim 들은 그대로 유지
  for (const tk of trimKeys) {
    if (!usedKeys.has(tk)) newTrims[tk] = trims[tk];
  }

  if (changed > 0) {
    d.trims = newTrims;
    if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
    console.log((APPLY ? '✓' : '+') + ' ' + d.title + ' — ' + changed + '개 trim 정확화');
    applied += changed;
    touched++;
  }
}
console.log('\n=== ' + (APPLY ? '적용' : 'dry-run') + ' ===');
console.log('  ' + touched + '개 catalog · ' + applied + '개 trim 정확화 · ' + missed + '개 매칭 실패');
