#!/usr/bin/env node
/**
 * 한국 OEM catalog 의 trim 을 모델별 동력원 set 으로 자동 분기.
 *  - 트림 키에 default 변형 토큰 ("가솔린" 만 들어간) 인 catalog 만 대상
 *  - 모델별 동력원 사전 정의 → trim 마다 동력원 수만큼 분기
 *  - 가격은 base trim 가격 그대로 (모든 동력원 같음 가정 — 가격표 있으면 추후 정확화)
 *  - 이미 정확 분리된 catalog (가솔린 2.5 + LPG 3.5 등 이미 명시) 은 skip
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// 모델별 동력원 set (한국 OEM)
const MODEL_FUELS = {
  // 현대
  '아반떼': ['가솔린 1.6', 'LPi 1.6'],
  '쏘나타': ['가솔린 2.0', 'LPi 2.0'],
  '그랜저': ['가솔린 2.4', '가솔린 3.0', '가솔린 3.3', 'LPi 3.0'],   // pre
  '캐스퍼': ['가솔린 1.0', '가솔린 1.0 터보'],
  '코나': ['가솔린 1.6 T', '디젤 1.6'],
  '베뉴': ['가솔린 1.6'],
  '투싼': ['가솔린 1.6 T', '디젤 2.0'],
  '싼타페': ['가솔린 2.5 T', '디젤 2.2'],
  '팰리세이드': ['가솔린 3.8', '디젤 2.2'],
  '스타리아': ['디젤 2.2', 'LPi 3.5'],
  '그랜드 스타렉스': ['디젤 2.5', 'LPi 3.0'],
  // 기아
  '모닝': ['가솔린 1.0', 'LPi 1.0'],
  'K3': ['가솔린 1.6', 'LPi 1.6'],
  'K5': ['가솔린 2.0', 'LPi 2.0', '가솔린 1.6 T'],
  'K7': ['가솔린 2.4', '가솔린 3.0', '가솔린 3.3', 'LPi 3.0', '디젤 2.2'],
  'K8': ['가솔린 2.5', '가솔린 3.5', 'LPi 3.5'],
  'K9': ['가솔린 3.3', '가솔린 3.8', '가솔린 5.0'],
  '쏘렌토': ['디젤 2.2', '가솔린 2.5 T'],
  '카니발': ['디젤 2.2', '가솔린 3.5', 'LPi 3.5'],
  '스포티지': ['가솔린 1.6 T', '디젤 2.0', '가솔린 2.0'],
  '셀토스': ['가솔린 1.6', '가솔린 1.6 T', '디젤 1.6'],
  '레이': ['가솔린 1.0', 'LPi 1.0'],
  '봉고3': ['디젤 2.5', 'LPi 2.4'],
  '모하비': ['디젤 3.0'],
  '스팅어': ['가솔린 2.0 T', '가솔린 3.3 T'],
  '니로': ['하이브리드 1.6', '디젤 1.6'],
  // 제네시스
  'G70': ['가솔린 2.0 T', '가솔린 3.3 T', '디젤 2.2'],
  'G80': ['가솔린 2.5 T', '가솔린 3.5 T', 'LPi 3.5'],
  'G90': ['가솔린 3.5 T', '가솔린 5.0'],
  'GV70': ['가솔린 2.5 T', '가솔린 3.5 T', '디젤 2.2'],
  'GV80': ['가솔린 2.5 T', '가솔린 3.5 T', '디젤 3.0'],
  // KGM
  '액티언': ['가솔린 1.5 T'],
  '코란도': ['가솔린 1.5 T', '디젤 1.6'],
  '무쏘': ['디젤 2.2'],
  '렉스턴': ['디젤 2.2'],
  '티볼리': ['가솔린 1.5 T', '디젤 1.6'],
  '토레스': ['가솔린 1.5 T'],
};

const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

// title 에서 model 추출
function extractModel(title) {
  if (!title) return null;
  // 메이커 prefix 제거
  let s = title.replace(/^(현대|기아|제네시스|KGM|쌍용)\s+/, '');
  // 페이스리프트 prefix 제거
  s = s.replace(/^(디 올 뉴|올 뉴|더 뉴|올뉴|더뉴)\s+/, '');
  // MODEL_FUELS 사전의 모델명이 title 에 포함되어 있으면 매칭
  const modelKeys = Object.keys(MODEL_FUELS).sort((a, b) => b.length - a.length);
  for (const m of modelKeys) {
    if (s.includes(m)) return m;
  }
  return null;
}

// 트림 키에서 "가솔린" default 토큰 제거 (variant 만 가졌는지 검사)
function stripDefaultGas(k) {
  return k.replace(/\s*가솔린\s*$/, '').trim();
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalNewTrims = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  // 단일 동력원 catalog (하이브리드/EV) 는 skip
  if (/하이브리드|HEV|EV|일렉트릭/i.test(d.title || '')) continue;
  // 모델 동력원 set (title 에서 추출)
  const model = extractModel(d.title || '');
  const fuels = model ? MODEL_FUELS[model] : null;
  if (!fuels || fuels.length < 2) continue;
  // 트림이 모두 "가솔린" default 만 가진 catalog 만 (이미 정확 분리된 것 skip)
  const trimKeys = Object.keys(d.trims || {});
  if (!trimKeys.length) continue;
  // 트림이 default "가솔린" 으로 끝나는 것만 대상
  const isDefaultOnly = trimKeys.every(k => /\s가솔린\s*$/.test(k));
  if (!isDefaultOnly) continue;

  // 분기
  const newTrims = {};
  let count = 0;
  for (const [k, t] of Object.entries(d.trims)) {
    const base = stripDefaultGas(k);
    for (const fuel of fuels) {
      newTrims[`${base} ${fuel}`] = JSON.parse(JSON.stringify(t));
      count++;
    }
  }
  d.trims = newTrims;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} — ${trimKeys.length}트림 × ${fuels.length}연료 = ${count}트림`);
  touched++;
  totalNewTrims += count;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 트림 ${totalNewTrims}개`);
