#!/usr/bin/env node
/**
 * 배기량 토큰 필수화.
 *  단일 (동력원, 배기량) catalog (= 라인업이 1개) → 모든 trim 키에 "{동력원} {배기량}" 강제 추가.
 *  다중 catalog → 보고만 (trim 별 매핑 필요).
 *
 *  라인업 자료: scripts/_disp_lineup_*.json
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const FUEL_DISP_RE = /(가솔린|디젤|LPG|LPi|하이브리드|HEV|EV|일렉트릭|수소)(?:\s+(R?\d\.\d)(\s*T)?)?/;

function hasDispToken(trimKey) {
  // 배기량 토큰 (\d\.\d) 또는 EV / 수소 표시 있으면 OK
  if (/\d\.\d/.test(trimKey)) return true;
  if (/\bEV\b/i.test(trimKey)) return true;   // EV 는 배기량 없음
  if (/수소/.test(trimKey)) return true;
  return false;
}

function tokenFromCatalog(d) {
  // catalog title 끝 토큰 추출 (예: "현대 그랜저 GN7 가솔린 2.5" → "가솔린 2.5")
  const m = d.title.match(/(가솔린|디젤|LPG|LPi|하이브리드|HEV|EV|일렉트릭|수소)(\s+R?\d\.\d(\s*T)?)?$/);
  return m ? m[0].trim() : null;
}

function insertToken(trimKey, token) {
  // trim 키에 동력원 단어가 있으면 그 자리에 배기량 추가, 없으면 끝에 토큰 추가
  // 예: "스마트 가솔린" + "가솔린 1.6" → "스마트 가솔린 1.6"
  // 예: "스마트" + "가솔린 1.6" → "스마트 가솔린 1.6"
  const tokenFuel = token.match(/^(가솔린|디젤|LPG|LPi|하이브리드|HEV|EV|일렉트릭|수소)/)?.[1];
  const tokenDisp = token.replace(/^(가솔린|디젤|LPG|LPi|하이브리드|HEV|EV|일렉트릭|수소)\s*/, '');
  if (!tokenFuel) return trimKey;

  // trim 키에 동일 동력원 단어가 있으면 그 뒤에 배기량 삽입
  const fuelRe = new RegExp(`(${tokenFuel})(?!\\s*\\d)`);
  if (fuelRe.test(trimKey)) {
    if (!tokenDisp) return trimKey;
    return trimKey.replace(fuelRe, `$1 ${tokenDisp}`).replace(/\s+/g, ' ').trim();
  }
  // 없으면 끝에 동력원+배기량 모두 추가
  return (trimKey + ' ' + token).replace(/\s+/g, ' ').trim();
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalTrims = 0;
const skipped = [];

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const trims = d.trims || {};
  if (!Object.keys(trims).length) continue;

  const token = tokenFromCatalog(d);
  if (!token) {
    // title 에 토큰 없음 = 다중 catalog (이전 standardize 에서 안 함)
    const noTokens = Object.keys(trims).filter(k => !hasDispToken(k));
    if (noTokens.length) skipped.push({ f, t: d.title, noTokens, tn: Object.keys(trims).length });
    continue;
  }

  // 단일 catalog — 모든 trim 에 토큰 강제
  const newTrims = {};
  let changed = false;
  for (const [k, v] of Object.entries(trims)) {
    if (hasDispToken(k)) {
      newTrims[k] = v;
      continue;
    }
    const newK = insertToken(k, token);
    if (newK !== k) {
      changed = true;
      totalTrims++;
      console.log('  ' + (APPLY ? '✓' : '+') + ' [' + d.title + '] ' + k + ' → ' + newK);
    }
    newTrims[newK] = v;
  }
  if (changed) {
    d.trims = newTrims;
    if (APPLY) fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 2));
    touched++;
  }
}

console.log('\n=== ' + (APPLY ? '적용' : 'dry-run') + ': ' + touched + '개 catalog · ' + totalTrims + '개 trim 키 보강 ===');
console.log('\n=== 다중 (동력원, 배기량) catalog — trim 키 매핑 필요 (' + skipped.length + '개) ===');
skipped.forEach(x => console.log('  • ' + x.t + ' [' + x.f + ']: ' + x.noTokens.length + '/' + x.tn + ' trim 누락'));
