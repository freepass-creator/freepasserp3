#!/usr/bin/env node
/**
 * catalog filename suffix 에서 동력원+배기량 토큰 추출 → title 에 보강.
 *  - 예: hyundai_grandeur_hg_g24.json → 가솔린 2.4 → title 에 추가
 *  - 트림 키만 보는 standardize-catalog-titles.cjs 가 strip 후 토큰 추출 못 하는 catalog 보완.
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const SUFFIX_TOKENS = [
  // 배기량+동력원 코드 (긴 패턴 우선)
  { re: /_g(\d)(\d)t$/i, fmt: m => `가솔린 ${m[1]}.${m[2]} T` },
  { re: /_g(\d)(\d)$/i, fmt: m => `가솔린 ${m[1]}.${m[2]}` },
  { re: /_d(\d)(\d)$/i, fmt: m => `디젤 ${m[1]}.${m[2]}` },
  { re: /_lpg(\d)(\d)$/i, fmt: m => `LPG ${m[1]}.${m[2]}` },
  { re: /_hev(\d)(\d)t$/i, fmt: m => `하이브리드 ${m[1]}.${m[2]} T` },
  { re: /_hev(\d)(\d)$/i, fmt: m => `하이브리드 ${m[1]}.${m[2]}` },
  { re: /_phev(\d)(\d)t$/i, fmt: m => `플러그인하이브리드 ${m[1]}.${m[2]} T` },
  { re: /_phev(\d)(\d)$/i, fmt: m => `플러그인하이브리드 ${m[1]}.${m[2]}` },
  // 동력원만
  { re: /_hybrid$/i, fmt: () => '하이브리드' },
  { re: /_diesel$/i, fmt: () => '디젤' },
  { re: /_lpg$/i, fmt: () => 'LPG' },
  { re: /_ev$/i, fmt: () => 'EV' },
  { re: /_hydrogen$/i, fmt: () => '수소' },
];

// title 에 이미 동력원+배기량 토큰 끝에 있는지 검사
function titleHasToken(title) {
  return /(가솔린|디젤|LPG|하이브리드|EV|일렉트릭|수소|플러그인하이브리드)(\s+R?\d\.\d(\s*T)?)?$/.test(title);
}

// trim 키들에서 단일 배기량 추출 (catalog 가 단일 동력원이므로 trim 키에 배기량만 잔여)
function dispFromTrims(d) {
  const disps = new Set();
  for (const k of Object.keys(d.trims || {})) {
    const m = k.match(/(\d\.\d)(\s*T)?/);
    if (m) disps.add(m[1] + (m[2] ? ' T' : ''));
  }
  return [...disps];
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  if (!Object.keys(d.trims || {}).length) continue;
  if (titleHasToken(d.title)) continue;

  const base = f.replace(/\.json$/, '');
  let token = null;

  // 1) filename suffix 시도
  for (const r of SUFFIX_TOKENS) {
    const m = base.match(r.re);
    if (m) { token = r.fmt(m); break; }
  }

  // 2) filename suffix 에서 동력원만 추출 + trim 키에서 배기량 보강
  if (token) {
    const onlyFuel = !/\d\.\d/.test(token);
    if (onlyFuel) {
      const disps = dispFromTrims(d);
      if (disps.length === 1) token = token + ' ' + disps[0];
    }
  }

  // 3) filename 에서 매칭 안 됐을 때 catalog 별 동력원 hint 적용
  const DIESEL_HINTS = [
    '무쏘', '렉스턴 스포츠', '모하비',  // 픽업/대형 SUV — 디젤 단일
  ];
  const HYDROGEN_HINTS = ['넥쏘'];
  const EV_HINTS = [
    'GV60', '일렉트리파이드', 'EV3', 'EV4', 'EV5', 'EV6', 'EV9',
    '아이오닉5', '아이오닉6', '아이오닉9',
    'ST1', '무쏘 EV', '토레스 EVX', '레이 EV', '코나 OS EV', '코나 SX2 EV',
    '아반떼 N',   // N 모델은 가솔린이지만 — 아 빼야: 아반떼 N CN7 은 가솔린 2.0 T
  ];
  // 잘못 들어간 hint 보정
  const FORCE_GASOLINE = ['아반떼 N'];
  if (!token) {
    const disps = dispFromTrims(d);
    const isDiesel = DIESEL_HINTS.some(h => d.title.includes(h));
    const isHydrogen = HYDROGEN_HINTS.some(h => d.title.includes(h));
    const isEv = EV_HINTS.some(h => d.title.includes(h)) && !FORCE_GASOLINE.some(h => d.title.includes(h));
    if (isHydrogen) {
      token = '수소';
    } else if (isEv) {
      token = 'EV';
    } else if (disps.length === 1) {
      const fuel = isDiesel ? '디젤' : '가솔린';
      token = fuel + ' ' + disps[0];
    } else if (disps.length === 0 && isDiesel) {
      token = '디젤 2.2';   // 무쏘/렉스턴 스포츠 default
    }
  }

  // 4) trim 키 자체에 배기량 없고 EV 토큰 잔여 있을 수도
  if (!token) {
    const hasEv = Object.keys(d.trims).some(k => /\bEV\b/.test(k));
    if (hasEv) token = 'EV';
  }

  if (!token) {
    console.log('  ! 토큰 없음: ' + d.title + ' [' + f + ']');
    continue;
  }

  const newTitle = d.title + ' ' + token;
  console.log((APPLY ? '✓' : '+') + ' ' + d.title + ' → ' + newTitle);
  if (APPLY) {
    d.title = newTitle;
    fs.writeFileSync(path.join(DIR, f), JSON.stringify(d, null, 2));
  }
  touched++;
}
console.log('\n' + (APPLY ? '적용' : 'dry-run') + ': ' + touched + '개 catalog title 보강');
