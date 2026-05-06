#!/usr/bin/env node
/**
 * wikicar OCR 가 분해 못 한 패키지명에 FP ID 후보 자동 추정.
 *  단어/keyword 분석 후 가능성 높은 FP ID 표시 → 사용자 검토 후 fp-keyword-rules.js 추가
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');

function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}

// 키워드 → 후보 FP ID 의 사전
const KEYWORD_TO_FP = {
  '안전': ['LKAS','FCWS','DAW','HBA','RCTA'],
  '드라이빙': ['HDA','LKAS','FCWS','DAW','RCTA','HBA','SEW'],
  '어시스턴스': ['HDA','LKAS','FCWS','DAW'],
  '컨비니언스': ['SMART_KEY','BUTTON_START','MIRROR_FOLD','RAIN_SENSOR'],
  '컴포트': ['HEAT_SEAT_FRONT','HEAT_STR'],
  '프리미엄': ['HEAD_LED','SMART_KEY','BUTTON_START'],
  '럭셔리': ['SEAT_LEATHER','HEAT_SEAT_FRONT','HEAT_STR'],
  '내비': ['NAVIGATION'],
  '내비게이션': ['NAVIGATION'],
  '미러링': ['MIRRORING'],
  '카플레이': ['MIRRORING'],
  '안드로이드': ['MIRRORING'],
  '무선': ['MIRRORING_WIRELESS'],
  '선루프': ['SUNROOF'],
  '썬루프': ['SUNROOF'],
  '파노라마': ['SUNROOF_PANO'],
  '서라운드': ['AVMS'],
  '어라운드': ['AVMS'],
  '주차': ['SPAS','SENSOR_REAR'],
  '카메라': ['CAM_REAR'],
  '센서': ['SENSOR_REAR'],
  '하이패스': ['HIPASS'],
  '하이빔': ['HBA'],
  '크루즈': ['HDA'],
  '스마트크루즈': ['HDA'],
  '차로': ['LDWS','LKAS'],
  '차선': ['LDWS','LKAS'],
  '충돌': ['FCWS','AEB'],
  '에어백': ['AIRBAG_DR','AIRBAG_PS'],
  '열선': ['HEAT_SEAT_FRONT','HEAT_STR'],
  '통풍': ['VENT_SEAT_DR','VENT_SEAT_PS'],
  '시트': ['POWER_SEAT_DR'],
  '가죽': ['SEAT_LEATHER'],
  '메모리': ['MEMORY_SEAT_DR'],
  '전동': ['POWER_TRUNK','POWER_SEAT_DR'],
  '트렁크': ['POWER_TRUNK'],
  '테일게이트': ['POWER_TRUNK'],
  '스마트키': ['SMART_KEY'],
  '버튼시동': ['BUTTON_START'],
  '원격': ['REMOTE_START'],
  '에어컨': ['AUTO_AC'],
  '레인': ['RAIN_SENSOR'],
  '워크어웨이': ['WALK_AWAY_LOCK'],
  '애프터블로우': ['AFTER_BLOW'],
  '공기청정': ['AIR_PURIFY'],
  '앰비언트': ['AMB_LIGHT'],
  '무드램프': ['AMB_LIGHT'],
  '패들': ['PADDLE_SHIFT'],
  '헤드업': ['HUD'],
  'hud': ['HUD'],
  '블루투스': ['BLUETOOTH'],
  '핸즈프리': ['HANDS_FREE'],
  '오디오': ['MP3','BLUETOOTH'],
  '음성인식': ['VOICE_RECOG'],
  '블랙박스': ['BLACKBOX'],
  '빌트인캠': ['BUILTIN_CAM'],
  '디지털키': ['SMART_KEY'],
  '슬라이딩': ['SLIDING_DOOR'],
  '커튼': ['CURTAIN_E'],
  '무선충전': ['WPC'],
  'wpc': ['WPC'],
  '디스플레이': [],   // 너무 광범위
  '풀옵션': [],
  '익스테리어': ['HEAD_LED'],
  '인테리어': [],
};

// audit 데이터 다시 추출
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const pkgByName = new Map();   // pkgName → [{catalog, trim}]
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const opts = d.options || {};
  for (const [tname, t] of Object.entries(d.trims || {})) {
    for (const g of t.select_groups || []) {
      if (Array.isArray(g)) continue;
      const codes = g.codes || [];
      const pkgName = (g.name || '').trim();
      if (!pkgName) continue;
      const undecomposed = codes.length === 1 && (opts[codes[0]]?.name || '').trim() === pkgName;
      if (!undecomposed && codes.length > 0) continue;
      if (!pkgByName.has(pkgName)) pkgByName.set(pkgName, []);
      pkgByName.get(pkgName).push({ catalog: d.catalog_id, trim: tname });
    }
  }
}

// 매핑 룰 이미 있는지 검사
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const KW_NORM = new Set([...rulesSrc.matchAll(/\{\s*kw:\s*['"]([^'"]+)['"]/g)].map(m => normName(m[1])));

function pkgIsAlreadyMapped(name) {
  const n = normName(name);
  for (const k of KW_NORM) {
    if (k.length >= 4 && n.includes(k)) return true;   // 룰의 kw 가 패키지명에 포함
  }
  return false;
}

function suggestForPkg(pkgName) {
  const n = pkgName.toLowerCase();
  const candidates = new Set();
  for (const [kw, ids] of Object.entries(KEYWORD_TO_FP)) {
    if (n.includes(kw.toLowerCase())) {
      for (const id of ids) candidates.add(id);
    }
  }
  return [...candidates];
}

// unmapped 패키지에 대해 추정
const lines = [];
lines.push('# wikicar 패키지 → FP 매핑 추정 (사용자 검토용)\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)}*\n`);
lines.push('워크플로우:');
lines.push('  1. 추정 결과 검토 — 정확한 후보 ✓ 표시');
lines.push('  2. 정확한 룰을 src/core/fp-keyword-rules.js 에 추가');
lines.push('  3. node scripts/sync-fp-rules-to-page.cjs + audit 재실행\n');

const sorted = [...pkgByName.entries()].sort((a, b) => b[1].length - a[1].length);
const unmapped = sorted.filter(([name]) => !pkgIsAlreadyMapped(name));

lines.push(`## 매핑 안 된 패키지 (${unmapped.length}개)\n`);
lines.push('| 빈도 | 패키지명 | 추정 FP IDs | normalized kw |');
lines.push('|---|---|---|---|');
let hasSuggestion = 0;
for (const [name, list] of unmapped) {
  const ids = suggestForPkg(name);
  if (ids.length) hasSuggestion++;
  const fpStr = ids.length ? ids.join('/') : '(추정 없음)';
  const norm = normName(name);
  lines.push(`| ${list.length} | ${name.replace(/\|/g, '\\|')} | ${fpStr} | \`${norm}\` |`);
}
lines.push(`\n총 ${unmapped.length}개 / 자동 추정 가능: ${hasSuggestion}개\n`);

// 즉시 적용 가능한 룰 텍스트 자동 생성 (사용자 복붙용)
lines.push('## 즉시 추가 가능 룰 (자동 추정 — 검토 후 fp-keyword-rules.js 에 복붙)\n');
lines.push('```js');
for (const [name, list] of unmapped) {
  const ids = suggestForPkg(name);
  if (!ids.length) continue;
  const norm = normName(name);
  lines.push(`  { kw:'${norm}', ids:[${ids.map(i => `'${i}'`).join(',')}] },  // ${name} (사용 ${list.length}회)`);
}
lines.push('```');

const outPath = path.join(__dirname, '..', 'docs', 'wikicar-pkg-mapping-todo.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ ${path.relative(process.cwd(), outPath)} 생성`);
console.log(`  매핑 안 된 패키지: ${unmapped.length}개`);
console.log(`  자동 추정 가능: ${hasSuggestion}개`);
