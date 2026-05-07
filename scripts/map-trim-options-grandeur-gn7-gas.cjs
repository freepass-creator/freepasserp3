#!/usr/bin/env node
/**
 * 그랜저 GN7 가솔린 catalog 트림별 정확 매핑.
 *  하이브리드 catalog 의 트림 매핑 기반 + 동력원 옵션 차이만 적용.
 *  - 가솔린 2.5: GN03001 (스마트스트림 가솔린 2.5 엔진)
 *  - LPG 3.5: GN03011 (스마트스트림 LPG 3.5 엔진) + GN03012 (원형봄베)
 *  - 아너스 2.5: 익스클루시브 와 캘리그래피 사이 (전용 디자인 일부)
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_gn7.json');
const HYFP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_gn7_hybrid.json');

const d = JSON.parse(fs.readFileSync(FP, 'utf8'));
const hy = JSON.parse(fs.readFileSync(HYFP, 'utf8'));

// 동력원 옵션
const GAS_25_ENGINE = ['GN03001', 'GN03003'];   // 스마트스트림 가솔린 2.5 엔진 + 8단 자동변속기
const LPG_35_ENGINE = ['GN03011', 'GN03012', 'GN03003'];  // LPG 3.5 + 원형봄베 + 8AT
const HY_ENGINE_CODES = ['GN03001', 'GN03003'];  // 하이브리드도 8AT (가솔린 엔진 안 들어감)

// 하이브리드 base 트림 코드 추출
function hybridBaseCodes(name) {
  const t = hy.trims[name];
  return t ? [...(t.basic || [])] : [];
}

// 동력원 변환: 하이브리드 엔진 코드 제거하고 새 동력원 코드 추가
function withPowertrain(codes, addCodes, removeCodes = []) {
  const filtered = codes.filter(c => !removeCodes.includes(c));
  return [...new Set([...filtered, ...addCodes])];
}

// 가솔린 트림 매핑
const trimMap = {};

const premHy = hybridBaseCodes('프리미엄 하이브리드 2.4');
const exclHy = hybridBaseCodes('익스클루시브 하이브리드 2.4');
const calHy = hybridBaseCodes('캘리그래피 하이브리드 2.4');
const beHy = hybridBaseCodes('캘리그래피 블랙 익스테리어 하이브리드 2.4');
const biHy = hybridBaseCodes('캘리그래피 블랙 잉크 하이브리드 2.4');

trimMap['프리미엄 가솔린 2.5'] = withPowertrain(premHy, GAS_25_ENGINE);
trimMap['익스클루시브 가솔린 2.5'] = withPowertrain(exclHy, GAS_25_ENGINE);
// 아너스 가솔린 2.5: 캘리그래피보다 약간 적은 옵션 (전용 디자인은 빼고 다이내믹 웰컴 등 일부만)
trimMap['아너스 가솔린 2.5'] = withPowertrain(
  exclHy.concat(['GN03056', 'GN03029']),  // 다이내믹 웰컴 + 그립 감지 추가
  GAS_25_ENGINE
);
trimMap['캘리그래피 가솔린 2.5'] = withPowertrain(calHy, GAS_25_ENGINE);
trimMap['캘리그래피 블랙 익스테리어 가솔린 2.5'] = withPowertrain(beHy, GAS_25_ENGINE);
trimMap['캘리그래피 블랙 잉크 가솔린 2.5'] = withPowertrain(biHy, GAS_25_ENGINE);

// LPG 트림: 가솔린 base 와 동일 트림 등급 + LPG 엔진
trimMap['프리미엄 LPG 3.5'] = withPowertrain(premHy, LPG_35_ENGINE);
trimMap['익스클루시브 LPG 3.5'] = withPowertrain(exclHy, LPG_35_ENGINE);
// 익스클루시브 플러스 장애인용 LPG 3.0: 익스클루시브 베이스
trimMap['익스클루시브 플러스 장애인용 LPG 3.0'] = withPowertrain(exclHy, ['GN03011', 'GN03012', 'GN03003']);

// 옵션 사전 동기화 — 하이브리드 catalog 에 추가된 새 옵션 (GN03200 ~ GN03224) 가솔린에도 복사
let copied = 0;
for (const [code, info] of Object.entries(hy.options || {})) {
  if (!d.options[code]) {
    d.options[code] = JSON.parse(JSON.stringify(info));
    copied++;
    if (info.category) {
      if (!d.categories[info.category]) d.categories[info.category] = [];
      if (!d.categories[info.category].includes(code)) d.categories[info.category].push(code);
    }
  }
}

console.log(`옵션 사전 동기화: ${copied}개 추가`);
console.log('\n=== 트림별 basic 옵션 수 ===');
for (const [name, codes] of Object.entries(trimMap)) {
  const valid = codes.filter(c => d.options[c]);
  const missing = codes.filter(c => !d.options[c]);
  console.log(`  ${name}: ${valid.length}개` + (missing.length ? ` (누락 ${missing.join(',')})` : ''));
}

if (APPLY) {
  for (const [name, codes] of Object.entries(trimMap)) {
    if (d.trims[name]) d.trims[name].basic = codes.filter(c => d.options[c]);
  }
  fs.writeFileSync(FP, JSON.stringify(d, null, 2));
  console.log('\n✓ 적용 완료');
}
