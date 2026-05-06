#!/usr/bin/env node
/**
 * catalog title 에서 chassis code 누락 점검.
 *  표준 형식: "{메이커} ({페리prefix}) {모델} {chassis_code}"
 *  예: "기아 더 뉴 K5 DL3", "현대 디 올 뉴 팰리세이드 LX3", "BMW 5시리즈 G60"
 *
 *  chassis code = 마지막 token 이 영문+숫자 패턴
 *
 *  사용:
 *    node scripts/audit-title-chassis-code.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const files = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'));

// chassis code 패턴 — 영문 2~4자 (+ 선택적 숫자) + 선택적 영문
//   매칭: G70, DL3, LX3, KA4, MQ4, NQ5, RG3, F30, G20, W213, U11, RJ, YP, YG, BD, YD, JF
//   비매칭: K5, K7, K3 (영문1자+숫자 = 모델명) — 단, "K5 DL3" 처럼 별도 chassis 있어야 함
const CHASSIS_RE = /^([A-Z]{2,4}\d{0,3}|[A-Z]\d{2,3})[A-Z]?$/;
// 모델명 자체로 끝나는 케이스 — 위계 chassis code 없음 (예: BMW M3, M5, X3M)
const MODEL_ONLY_OK = new Set(['M3', 'M4', 'M5', 'M8', 'X3M', 'X4M', 'X5M', 'X6M', 'AMG', 'RS3', 'RS4', 'RS5', 'RS6', 'RS7', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'Q3', 'Q5', 'Q7', 'Q8', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']);

const missing = [];
const ok = [];

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const title = data.title || '';
  const maker = data.maker || '';
  // 메이커 prefix 제거
  const titleNoMaker = title.replace(new RegExp('^' + maker + '\\s+'), '').trim();
  const tokens = titleNoMaker.split(/\s+/).map(t => t.replace(/[,.]+$/, ''));
  const lastTok = tokens[tokens.length - 1] || '';
  const hasChassis = CHASSIS_RE.test(lastTok) || MODEL_ONLY_OK.has(lastTok);

  if (hasChassis) {
    ok.push({ id: data.catalog_id, title });
  } else {
    missing.push({ id: data.catalog_id, title, lastTok, maker });
  }
}

console.log(`✓ chassis code OK: ${ok.length}개`);
console.log(`✗ chassis code 누락: ${missing.length}개`);
console.log('');
console.log('## 누락 catalog (메이커별 정렬)');
console.log('');
missing.sort((a, b) => a.maker.localeCompare(b.maker) || a.id.localeCompare(b.id));
for (const m of missing) {
  console.log(`  [${m.maker}] ${m.id} — "${m.title}"`);
}
