#!/usr/bin/env node
/**
 * 매핑 안 된 옵션명 → FP 표준옵션 ID 자동 추정.
 *
 * 추정 로직:
 *  1. FP 표준옵션 한글명의 핵심 단어(2자+) 가 옵션명에 substring 매칭되면 후보
 *  2. 영문 ID (HDA, RCTA 등) substring 매칭
 *  3. 명사 키워드 사전 (트렁크/크루즈/카메라 등) 으로 분류
 *
 * 출력:
 *  - 추정 신뢰도 (high/medium/low)
 *  - docs/auto-fp-suggestions.md (추정 결과 보고서)
 *  - 사용자가 보고 수동 확인 후 fp-keyword-rules.js 에 추가
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const MASTER_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-options-master.js');

// FP_OPT_MASTER 파싱 (id → 한글 name)
const masterSrc = fs.readFileSync(MASTER_PATH, 'utf8');
const FP_NAMES = {};
const idMatch = masterSrc.matchAll(/\['([A-Z_0-9]+)'\s*,\s*'([^']+)'/g);
for (const m of idMatch) FP_NAMES[m[1]] = m[2];

// FP_KEYWORD_RULES — 이미 매핑된 ID 들 (auto suggest 의 중복 제거용)
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const KW_LIST = [...rulesSrc.matchAll(/\{\s*kw:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}
const KW_NORM_SET = new Set(KW_LIST.map(normName));

// 핵심 단어 사전 (옵션명 분석 용)
//  ID → [필수 keyword, 부가 keyword]
const SUGGEST_PATTERNS = {
  // 외관
  'SUNROOF':       { req: ['선루프', '썬루프', 'sunroof'], conflict: ['파노라마', '듀얼', '와이드'] },
  'SUNROOF_PANO':  { req: ['파노라마', '와이드', '듀얼'], anyOf: ['선루프', '썬루프'] },
  'HEAD_LED':      { req: ['led'], anyOf: ['헤드램프', '헤드라이트', 'headlamp'] },
  'POSITION_LED':  { req: ['led'], anyOf: ['포지션램프', '포지션라이트'] },
  'DRL':           { req: ['주간주행등', 'drl'] },
  'FOG_LED':       { req: ['안개등'], anyOf: ['led'] },
  'MIRROR_FOLD':   { req: ['전동접이', '오토폴딩'], anyOf: ['미러', '사이드미러'] },
  'ALUMINUM_WHEEL':{ req: ['알루미늄휠', '알로이휠', '인치휠'] },
  // 내장
  'CRUISE':        { req: ['크루즈컨트롤', 'cruisecontrol'], conflict: ['스마트', '어댑티브', '내비'] },
  'STR_REMOTE':    { req: ['스티어링휠리모컨', '오디오리모컨'] },
  'AUTO_LIGHT':    { req: ['오토라이트', 'autolight'] },
  'HEAT_STR':      { req: ['열선스티어링', '열선스티어링휠', '스티어링휠열선'] },
  'POWER_SEAT_DR': { req: ['전동시트'], anyOf: ['운전석'] },
  'POWER_SEAT_PS': { req: ['전동시트'], anyOf: ['동승석', '조수석'] },
  'MEMORY_SEAT_DR':{ req: ['메모리시트', '운전석자세메모리'], anyOf: ['운전석'] },
  'HEAT_SEAT_FRONT':{ req: ['열선시트'], anyOf: ['앞좌석', '1열', '운전석', '동승석'] },
  'HEAT_SEAT_REAR':{ req: ['열선시트'], anyOf: ['뒷좌석', '2열', '리어'] },
  'VENT_SEAT_DR':  { req: ['통풍시트'], anyOf: ['운전석', '1열'] },
  'VENT_SEAT_PS':  { req: ['통풍시트'], anyOf: ['동승석', '1열'] },
  'SEAT_LEATHER':  { req: ['가죽시트', '천연가죽시트', '나파가죽'] },
  'PADDLE_SHIFT':  { req: ['패들쉬프트', '패들시프트'] },
  // 안전
  'CAM_REAR':      { req: ['후방카메라', '후방모니터'] },
  'CAM_FRONT':     { req: ['전방카메라'] },
  'SENSOR_REAR':   { req: ['후방감지', '후방주차거리'] },
  'SENSOR_FRONT':  { req: ['전방감지', '전방주차거리'] },
  'AVMS':          { req: ['어라운드뷰', '서라운드뷰', 'avm'] },
  'SPAS':          { req: ['주차조향보조', '원격스마트주차', '측방주차거리'] },
  'EPB':           { req: ['전자식파킹', 'epb', '오토홀드'] },
  'TPMS':          { req: ['타이어공기압', 'tpms'] },
  'HDA':           { req: [], anyOf: ['스마트크루즈', '내비기반크루즈', '고속도로주행', '어댑티브크루즈', 'hda'] },
  'LDWS':          { req: ['차로이탈', '차선이탈'] },
  'LKAS':          { req: ['차로유지', '차선유지', 'lkas'] },
  'DAW':           { req: ['운전자주의경고', 'daw'] },
  'FCWS':          { req: ['전방충돌방지', '전방추돌', '다중충돌방지', 'fcws'] },
  'RCTA':          { req: ['후측방경보', '후측방충돌방지', '후방교차충돌', 'rcta'] },
  'HUD':           { req: ['헤드업디스플레이', 'hud'] },
  'HBA':           { req: ['하이빔보조', '하이빔어시스트', 'hba'] },
  'ROA':           { req: ['후석승객알림', 'roa'] },
  'ISLA':          { req: ['지능형속도제한', 'isla'] },
  'SEW':           { req: ['안전하차경고', '안전하차보조', 'sew'] },
  'BVM':           { req: ['후측방모니터', '후방차량출발알림', 'bvm'] },
  // 편의
  'NAVIGATION':    { req: ['내비게이션', '내비'] },
  'HIPASS':        { req: ['하이패스', 'hipass'] },
  'SMART_KEY':     { req: ['스마트키', '디지털키'] },
  'BUTTON_START':  { req: ['버튼시동', '시동버튼', '엔진스타트'] },
  'REMOTE_START':  { req: ['원격시동'] },
  'AUTO_AC':       { req: ['자동에어컨', '풀오토에어컨'] },
  'POWER_TRUNK':   { req: [], anyOf: ['파워트렁크', '전동트렁크', '전동식트렁크', '전동테일게이트', '파워테일게이트', '스마트전동식트렁크'] },
  'SMART_TRUNK':   { req: ['스마트트렁크', '스마트테일게이트'] },
  'WPC':           { req: ['무선충전', 'wpc'] },
  'RAIN_SENSOR':   { req: ['레인센서', '레인감지'] },
  'WALK_AWAY_LOCK':{ req: ['워크어웨이', '세이프티언락'] },
  'AFTER_BLOW':    { req: ['애프터블로우'] },
  'AIR_PURIFY':    { req: ['공기청정시스템'] },
  'AMB_LIGHT':     { req: ['앰비언트', '무드램프'] },
  // 미디어
  'BLUETOOTH':     { req: ['블루투스', 'bluetooth'] },
  'USB':           { req: ['usb'] },
  'MIRRORING':     { req: [], anyOf: ['애플카플레이', '안드로이드오토', 'carplay', 'androidauto', '폰프로젝션', '스마트미러링'] },
  'MIRRORING_WIRELESS':{ req: ['무선'], anyOf: ['carplay', 'androidauto', 'apple', 'android', '폰프로젝션', '미러링'] },
  'OTA':           { req: ['무선소프트웨어업데이트', 'ota'] },
};

function suggestFpIds(name) {
  const n = normName(name);
  const matched = new Set();
  for (const [id, p] of Object.entries(SUGGEST_PATTERNS)) {
    const reqs = p.req || [];
    const anyOf = p.anyOf || [];
    const conflicts = p.conflict || [];

    const reqOk = reqs.length === 0 ? true : reqs.some(k => n.includes(normName(k)));
    if (!reqOk) continue;
    const anyOk = anyOf.length === 0 ? true : anyOf.some(k => n.includes(normName(k)));
    if (!anyOk) continue;
    const noConflict = conflicts.every(k => !n.includes(normName(k)));
    if (!noConflict) continue;
    matched.add(id);
  }
  return [...matched];
}

// _maker-options.json 의 매핑 안 된 옵션 → 추정 시도
const map = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, '_maker-options.json'), 'utf8'));
const POPULAR = ['현대', '기아', '제네시스', 'KGM', '쉐보레'];

const lines = [];
lines.push('# 자동 추정 FP 매핑 후보\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)} — 매핑 안 된 옵션 → 자동 추정 결과*\n`);
lines.push('워크플로우:');
lines.push('  1. 추정 결과 검토');
lines.push('  2. 정확한 추정만 src/core/fp-keyword-rules.js 에 반영');
lines.push('  3. `node scripts/extract-maker-options.cjs` + `audit-fp-mapping.cjs` 재실행\n');

let suggestedTotal = 0;
let unmatchedTotal = 0;

for (const maker of POPULAR) {
  if (!map[maker]) continue;
  const missing = Object.entries(map[maker])
    .filter(([n, v]) => !v.fp_ids.length)
    .sort((a, b) => b[1].used_in - a[1].used_in);

  const suggested = [];
  const stillUnmatched = [];
  for (const [name, v] of missing) {
    const ids = suggestFpIds(name);
    if (ids.length) suggested.push({ name, used: v.used_in, ids });
    else stillUnmatched.push({ name, used: v.used_in });
  }

  lines.push(`\n## ${maker}\n`);
  lines.push(`- 매핑 미완: ${missing.length}건`);
  lines.push(`- **자동 추정 성공: ${suggested.length}건** (검토 후 룰 추가 권장)`);
  lines.push(`- 여전히 미매칭: ${stillUnmatched.length}건\n`);

  // 추정 성공 — top 80
  if (suggested.length) {
    lines.push('### 자동 추정 후보\n');
    lines.push('| used | 옵션명 | 추정 FP ID |');
    lines.push('|---|---|---|');
    for (const s of suggested.slice(0, 80)) {
      const fpDisplay = s.ids.map(id => `${id}(${FP_NAMES[id] || ''})`).join(' / ');
      lines.push(`| ${s.used} | ${s.name.replace(/\|/g, '\\|')} | ${fpDisplay} |`);
    }
    if (suggested.length > 80) lines.push(`\n*... +${suggested.length - 80}건*`);
  }

  suggestedTotal += suggested.length;
  unmatchedTotal += stillUnmatched.length;
}

lines.push(`\n## 전체 요약 (인기 5메이커)\n`);
lines.push(`- 자동 추정 성공: **${suggestedTotal}** unique 옵션`);
lines.push(`- 추정 실패 (매뉴얼 검토): **${unmatchedTotal}** unique 옵션`);

const outPath = path.join(__dirname, '..', 'docs', 'auto-fp-suggestions.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ ${path.relative(process.cwd(), outPath)} 생성`);
console.log(`  자동 추정 성공: ${suggestedTotal}건`);
console.log(`  여전히 미매칭: ${unmatchedTotal}건`);
