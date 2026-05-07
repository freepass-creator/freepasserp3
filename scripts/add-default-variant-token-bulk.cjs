#!/usr/bin/env node
/**
 * 한국 OEM catalog 의 trim 키에 변형 토큰 (가솔린/디젤/LPi/하이브리드/EV/배기량/인승) 일괄 추가.
 *  catalog title 분석:
 *    - "하이브리드" 있으면 → "하이브리드 [배기량]"
 *    - "EV"/"일렉트릭" → "EV"
 *    - 그 외 → "가솔린" (default; 일부 차종 디젤/LPi 가능 — 추후 사용자 검수로 보정)
 *  배기량 매핑 사전 (모델별 알려진 default 배기량).
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

// 모델별 default 배기량 (catalog title 에 동력원 명시 없으면 이걸로)
const DEFAULT_VARIANT = {
  // 현대
  '아반떼': '가솔린 1.6',
  '쏘나타': '가솔린 2.0',
  '그랜저': '가솔린 2.5',
  '캐스퍼': '가솔린 1.0',
  '코나': '가솔린 1.6 T',
  '베뉴': '가솔린 1.6',
  '투싼': '가솔린 1.6 T',
  '싼타페': '가솔린 2.5 T',
  '팰리세이드': '가솔린 3.8',
  '스타리아': '디젤 2.2',
  '아이오닉5': 'EV',
  '아이오닉6': 'EV',
  '아이오닉9': 'EV',
  '넥쏘': '수소',
  '베르나': '가솔린 1.6',
  'i30': '가솔린 1.6 T',
  '벨로스터': '가솔린 1.6 T',
  '아슬란': '가솔린 3.0',
  '에쿠스': '가솔린 5.0',
  'ST1': 'EV',
  // 기아
  '모닝': '가솔린 1.0',
  'K3': '가솔린 1.6',
  'K5': '가솔린 2.0',
  'K7': '가솔린 2.4',
  'K8': '가솔린 2.5',
  'K9': '가솔린 3.8',
  '쏘렌토': '디젤 2.2',
  '카니발': '디젤 2.2',
  '스포티지': '가솔린 1.6 T',
  '셀토스': '가솔린 1.6 T',
  '니로': '하이브리드 1.6',
  '레이': '가솔린 1.0',
  '봉고': '디젤 2.5',
  '모하비': '디젤 3.0',
  '쏘울': '가솔린 1.6',
  '스팅어': '가솔린 2.0 T',
  '오피러스': '가솔린 3.3',
  '엔터프라이즈': 'LPi 2.5',
  '오피러스': '가솔린 3.3',
  '카렌스': '가솔린 2.0',
  '타스만': '디젤 2.2',
  'EV3': 'EV',
  'EV4': 'EV',
  'EV5': 'EV',
  'EV6': 'EV',
  'EV9': 'EV',
  'PV5': 'EV',
  // 제네시스
  'G70': '가솔린 2.0 T',
  'G80': '가솔린 2.5 T',
  'G90': '가솔린 3.5 T',
  'GV60': 'EV',
  'GV70': '가솔린 2.5 T',
  'GV80': '가솔린 2.5 T',
  // KGM
  '액티언': '가솔린 1.5 T',
  '코란도': '가솔린 1.5 T',
  '무쏘': '디젤 2.2',
  '렉스턴': '디젤 2.2',
  '티볼리': '가솔린 1.5 T',
  '토레스': '가솔린 1.5 T',
};

const ENG_RE = /(가솔린|디젤|LPG|LPi|하이브리드|일렉트릭|EV|HEV|R\d\.\d|\d\.\d|\d+인승)/i;

// catalog title → 변형 토큰 추정
function inferVariant(title, model) {
  // catalog title 에 동력원 명시
  if (/하이브리드/.test(title)) {
    // 모델별 하이브리드 배기량
    const hyMap = {
      '아반떼': '하이브리드 1.6', '쏘나타': '하이브리드 2.0', '그랜저': '하이브리드 2.4',
      '코나': '하이브리드 1.6', '투싼': '하이브리드 1.6', '싼타페': '하이브리드 1.6',
      '팰리세이드': '하이브리드 2.5', 'K5': '하이브리드 2.0', 'K8': '하이브리드 1.6',
      '쏘렌토': '하이브리드 1.6', '스포티지': '하이브리드 1.6', '카니발': '하이브리드 1.6 T',
      '니로': '하이브리드 1.6',
    };
    return hyMap[model] || '하이브리드';
  }
  if (/(EV|일렉트릭)/i.test(title)) return 'EV';
  return DEFAULT_VARIANT[model] || '가솔린';
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalRenamed = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const trims = d.trims || {};
  if (!Object.keys(trims).length) continue;
  // 트림 중 변형 토큰 없는 것만 변환
  const noEng = Object.keys(trims).filter(k => !ENG_RE.test(k));
  if (!noEng.length) continue;

  const variant = inferVariant(d.title || '', d.model || '');
  if (!variant) continue;

  const newTrims = {};
  let renamed = 0;
  for (const [k, t] of Object.entries(trims)) {
    if (!ENG_RE.test(k)) {
      const newKey = `${k} ${variant}`;
      newTrims[newKey] = t;
      renamed++;
    } else {
      newTrims[k] = t;
    }
  }
  if (renamed === 0) continue;
  d.trims = newTrims;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} — ${renamed}트림 ${variant}`);
  touched++;
  totalRenamed += renamed;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 트림 ${totalRenamed}개 변형 토큰 추가`);
