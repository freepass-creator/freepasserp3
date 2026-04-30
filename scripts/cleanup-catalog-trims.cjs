#!/usr/bin/env node
/**
 * 카탈로그 트림명 / title 일괄 정리.
 *
 * 1. _index.json title 의 "X세대" 제거 + 깔끔하게 (괄호 안 코드는 유지)
 * 2. 각 catalog.json 의 trims 에서:
 *    - 트림 아닌 항목 제거: 기본 모델 / 선택 품목 / 추천차량 / GENESIS ACCESSORIES / CUSTOMIZING
 *    - "세대" 표기 제거
 *    - 너무 긴 트림명 단축 (괄호 안 중복 정보 제거)
 */
const fs = require('fs');
const path = require('path');

const CAR_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// 트림 아닌 항목
const NOT_A_TRIM = [
  /^기본\s*모델$/, /^선택\s*품목$/, /^선택품목$/, /^선택사양$/,
  /^추천차량$/, /^GENESIS\s*ACCESSORIES$/i, /^Genesis\s*Accessories$/,
  /^CUSTOMIZING$/i, /^Customizing$/, /^옵션$/,
];

// 영문 → 한글 통일 (공식 영어명 X-Line, GT-Line, RS 등은 보존)
const EN_TO_KO = [
  ['Inspiration', '인스퍼레이션'],
  ['Calligraphy', '캘리그래피'],
  ['Prestige', '프레스티지'],
  ['Noblesse', '노블레스'],
  ['Signature', '시그니처'],
  ['Exclusive', '익스클루시브'],
  ['Premium', '프리미엄'],
  ['Modern', '모던'],
  ['Style', '스타일'],
  ['Smart', '스마트'],
  ['Luxury', '럭셔리'],
  ['Platinum', '플래티넘'],
  ['Masters', '마스터즈'],
  ['Gravity', '그래비티'],
  ['Business', '비즈니스'],
  ['Cross', '크로스'],
];

// 트림명에서 제거할 패턴
function cleanTrimName(name) {
  let s = name;
  // "X세대" 단독 토큰 제거
  s = s.replace(/\s*\d+세대\s*/g, ' ').replace(/\s+/g, ' ').trim();
  // 중첩된 괄호 풀기 — "(스마트스트림 LPi 2.0(일반판매용))" → 내용 평문화
  s = s.replace(/스마트스트림\s*/g, '');
  s = s.replace(/\(([^)]*)\(([^)]*)\)([^)]*)\)/g, (_, a, b) => a.trim());
  // 모든 괄호를 평문으로 — "(2.0)" → " 2.0", "(LPG 2.0)" → " LPG 2.0"
  s = s.replace(/\s*\(\s*([^)]+?)\s*\)/g, ' $1');
  // n-line-prestige / n-line-exclusive 같은 slug 정규화
  s = s.replace(/^n-line-(\w+)/i, (_, t) => {
    const ko = EN_TO_KO.find(([en]) => en.toLowerCase() === t.toLowerCase());
    return `${ko ? ko[1] : t} N 라인`;
  });
  // N라인 / N Line 표기 통일 → "N 라인"
  s = s.replace(/\bN\s*Line\b/gi, 'N 라인');
  s = s.replace(/\bN라인\b/g, 'N 라인');
  // 영문 → 한글 (공식명 X-Line/GT-Line 등은 그대로)
  for (const [en, ko] of EN_TO_KO) {
    const re = new RegExp(`\\b${en}\\b`, 'g');
    s = s.replace(re, ko);
  }
  // 인승 규격화: "9인" → "9인승" (단, 이미 "인승"인 경우는 그대로)
  s = s.replace(/(\d)인(?!승)/g, '$1인승');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// 카탈로그 title 정리 — 괄호 제거 (평문화) + "X세대" 제거
function cleanTitle(title) {
  let s = title;
  // "N세대" 제거
  s = s.replace(/\s*\d+세대\s*/g, ' ');
  // 괄호 평문화 — "(GN7)" → " GN7"
  s = s.replace(/\s*\(([^)]+)\)\s*/g, ' $1 ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function isNonTrim(name) {
  return NOT_A_TRIM.some(re => re.test((name || '').trim()));
}

function processCatalog(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const trims = data.trims || {};
  const log = [];

  // 1. 트림 아닌 항목 제거 + 트림명 정리
  const newTrims = {};
  for (const [name, trim] of Object.entries(trims)) {
    if (isNonTrim(name)) {
      log.push(`  − 제거: "${name}"`);
      continue;
    }
    const cleanName = cleanTrimName(name);
    if (cleanName !== name) log.push(`  ↻ ${name}  →  ${cleanName}`);
    if (newTrims[cleanName]) {
      // 중복 — 기존 trim의 basic 합치기
      const merged = new Set([...(newTrims[cleanName].basic || []), ...(trim.basic || [])]);
      newTrims[cleanName] = { ...newTrims[cleanName], basic: [...merged] };
      log.push(`  ⚠ 중복 병합: "${cleanName}"`);
    } else {
      newTrims[cleanName] = trim;
    }
  }
  data.trims = newTrims;

  // title 도 정리
  if (data.title) {
    const newTitle = cleanTitle(data.title);
    if (newTitle !== data.title) {
      log.push(`  ↻ title: ${data.title}  →  ${newTitle}`);
      data.title = newTitle;
    }
  }

  if (log.length > 0) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
  return log;
}

function processIndex(indexPath) {
  const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const log = [];
  for (const [id, info] of Object.entries(data)) {
    const oldTitle = info.title || '';
    const newTitle = cleanTitle(oldTitle);
    if (newTitle !== oldTitle) {
      info.title = newTitle;
      log.push(`  ${id}: ${oldTitle}  →  ${newTitle}`);
    }
    // _index 의 trims 배열도 정리
    if (Array.isArray(info.trims)) {
      info.trims = info.trims
        .filter(t => !isNonTrim(t))
        .map(t => cleanTrimName(t));
    }
  }
  fs.writeFileSync(indexPath, JSON.stringify(data, null, 2), 'utf-8');
  return log;
}

function main() {
  const files = fs.readdirSync(CAR_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  console.log('═══ 카탈로그별 트림 정리 ═══\n');
  for (const f of files) {
    const log = processCatalog(path.join(CAR_DIR, f));
    if (log.length) {
      console.log(`■ ${f}`);
      for (const line of log) console.log(line);
      console.log();
    }
  }
  console.log('═══ _index.json 정리 ═══\n');
  const idxLog = processIndex(path.join(CAR_DIR, '_index.json'));
  for (const line of idxLog) console.log(line);
  console.log('\n[cleanup-catalog-trims] 완료');
}

main();
