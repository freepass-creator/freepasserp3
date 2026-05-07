#!/usr/bin/env node
/**
 * 그랜저 하이브리드 GN7 가격표 (wikicar p1.jpg / p2.jpg) 기반 트림별 정확 옵션 매핑.
 *  cumulative: Premium → Exclusive → Calligraphy → Black Exterior → Black Ink
 *  catalog 옵션 사전 코드 정확 매핑 (수동 검증)
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'hyundai_grandeur_gn7_hybrid.json');

// catalog 에 없는 옵션만 새로 추가 (시트 분리/공조/디자인 디테일 등)
const NEW_OPTIONS = {
  GN03201: { name: '페달 미니언스 인디케이터', category: '내장', fp_ids: [] },
  GN03202: { name: '뒷좌석 열선 시트', category: '시트', fp_ids: ['HEAT_SEAT_REAR'] },
  GN03203: { name: '운전석 4way 럼버 서포트(스트레치 모드 포함)', category: '시트', fp_ids: [] },
  GN03204: { name: '운전석 자세 메모리 시스템', category: '시트', fp_ids: ['MEMORY_SEAT_DR'] },
  GN03205: { name: '뒷좌석 통풍 시트', category: '시트', fp_ids: [] },
  GN03207: { name: '발수 도어(앞좌석)', category: '외관', fp_ids: [] },
  GN03208: { name: '1열 릴렉션 컴포트 시트(운전석/동승석)', category: '시트', fp_ids: [] },
  GN03209: { name: '1열 열선/통풍 시트', category: '시트', fp_ids: ['HEAT_SEAT_FRONT', 'VENT_SEAT_DR', 'VENT_SEAT_PS'] },
  GN03210: { name: '2열 열선 시트', category: '시트', fp_ids: ['HEAT_SEAT_REAR'] },
  GN03211: { name: '2열 통풍 시트', category: '시트', fp_ids: [] },
  GN03212: { name: '10.25인치 풀 컬러 공조 컨트롤러(햅틱 기능 포함)', category: '편의', fp_ids: ['DISPLAY_LCD'] },
  GN03214: { name: '블랙 잉크 디자인 (블랙 인사이드 미러)', category: '외관', fp_ids: [] },
  GN03215: { name: '블랙 익스테리어 디자인(라디에이터 그릴, 캘리그래피 엠블럼, 사이드 가니쉬, 아웃사이드 미러, DLO 몰딩, 엠블럼)', category: '외관', fp_ids: [] },
  GN03216: { name: '동승석 4way 전동 시트', category: '시트', fp_ids: ['POWER_SEAT_PS'] },
  GN03217: { name: '운전석 10way 전동 시트', category: '시트', fp_ids: ['POWER_SEAT_DR'] },
  GN03218: { name: '동승석 8way 전동 시트', category: '시트', fp_ids: ['POWER_SEAT_PS'] },
  GN03219: { name: '동승석 2way 럼버 서포트', category: '시트', fp_ids: [] },
  GN03220: { name: '동승석 워크인 디바이스', category: '시트', fp_ids: ['WORKIN'] },
  GN03221: { name: '운전석 2way 럼버 서포트', category: '시트', fp_ids: [] },
  GN03222: { name: '운전석 8way 전동 시트', category: '시트', fp_ids: ['POWER_SEAT_DR'] },
  GN03223: { name: '앰비언트 무드 램프(크래쉬 패드, 도어 트림, 센터 콘솔)', category: '내장', fp_ids: ['AMB_LIGHT'] },
  GN03224: { name: '앳지 타입 가죽 스티어링 휠(열선, 인터랙티브 픽셀 라이트)', category: '내장', fp_ids: ['STR_LEATHER', 'HEAT_STR'] },
};

// Premium 기본 (catalog 코드)
const PREMIUM_BASIC_CODES = [
  // 파워트레인
  'GN03004', 'GN03090', 'GN03003',
  // 안전
  'GN03013', 'GN03014', 'GN03015', 'GN03018',
  // 지능형 안전 기술
  'GN03019', 'GN03020', 'GN03021', 'GN03022', 'GN03023', 'GN03024', 'GN03025', 'GN03026', 'GN03027', 'GN03028', 'GN03030',
  // 외관
  'GN03040', 'GN03041', 'GN03042', 'GN03043', 'GN03044', 'GN03045', 'GN03046', 'GN03047',
  'GN03048', 'GN03049', 'GN03050',
  // 내장
  'GN03063', 'GN03065', 'GN03067', 'GN03224', 'GN03201', 'GN03223',
  // 시트
  'GN03222', 'GN03221', 'GN03216', 'GN03202',
  // 편의/주차
  'GN03089', 'GN03093', 'GN03096', 'GN03097', 'GN03118', 'GN03098', 'GN03101',
  // 인포테인먼트
  'GN03119', 'GN03121',
];

// Exclusive 추가 (Premium 외)
const EXCLUSIVE_EXTRA_CODES = [
  // 지능형 안전 기술
  'GN03132', 'GN03032', 'GN03034', 'GN03033',
  // 외관
  'GN03052',
  // 시트
  'GN03217', 'GN03203', 'GN03204', 'GN03218', 'GN03219', 'GN03220',
  // 편의/주차
  'GN03092', 'GN03106', 'GN03107', 'GN03108', 'GN03109', 'GN03110', 'GN03112',
];

// Calligraphy 추가 (Exclusive 외)
const CALLIGRAPHY_EXTRA_CODES = [
  // 지능형 안전 기술
  'GN03130', 'GN03036', 'GN03037', 'GN03131', 'GN03029',
  // 외관
  'GN03057', 'GN03056', 'GN03207',
  // 내장
  'GN03073', 'GN03072',
  // 시트
  'GN03208', 'GN03209', 'GN03210', 'GN03211',
  // 편의/주차
  'GN03212',
];

// Black Exterior 추가
const BLACK_EXTERIOR_EXTRA_CODES = ['GN03215'];

// Black Ink 추가
const BLACK_INK_EXTRA_CODES = ['GN03214', 'GN03135', 'GN03P11'];

// 메인
const d = JSON.parse(fs.readFileSync(FP, 'utf8'));
const optDict = d.options || {};

// 새 옵션 추가
let added = 0;
for (const [code, info] of Object.entries(NEW_OPTIONS)) {
  if (!optDict[code]) {
    optDict[code] = info;
    added++;
    if (!d.categories[info.category]) d.categories[info.category] = [];
    if (!d.categories[info.category].includes(code)) d.categories[info.category].push(code);
  }
}

function check(codes, label) {
  const valid = [], missing = [];
  for (const c of codes) {
    if (optDict[c]) valid.push(c);
    else missing.push(c);
  }
  console.log(`${label}: ${valid.length}/${codes.length}` + (missing.length ? ` (누락 ${missing.join(', ')})` : ''));
  return valid;
}

console.log('=== 코드 검증 ===');
const premV = check(PREMIUM_BASIC_CODES, 'Premium');
const excV = check(EXCLUSIVE_EXTRA_CODES, 'Exclusive 추가');
const calV = check(CALLIGRAPHY_EXTRA_CODES, 'Calligraphy 추가');
const beV = check(BLACK_EXTERIOR_EXTRA_CODES, 'Black Exterior 추가');
const biV = check(BLACK_INK_EXTRA_CODES, 'Black Ink 추가');

const trimMap = {
  '프리미엄 하이브리드 2.4': premV,
  '익스클루시브 하이브리드 2.4': [...new Set([...premV, ...excV])],
  '캘리그래피 하이브리드 2.4': [...new Set([...premV, ...excV, ...calV])],
  '캘리그래피 블랙 익스테리어 하이브리드 2.4': [...new Set([...premV, ...excV, ...calV, ...beV])],
  '캘리그래피 블랙 잉크 하이브리드 2.4': [...new Set([...premV, ...excV, ...calV, ...beV, ...biV])],
};

console.log('\n=== 트림별 basic 옵션 수 ===');
for (const [name, codes] of Object.entries(trimMap)) {
  console.log(`  ${name}: ${codes.length}개`);
}

if (APPLY) {
  for (const [name, codes] of Object.entries(trimMap)) {
    if (d.trims[name]) d.trims[name].basic = codes;
  }
  fs.writeFileSync(FP, JSON.stringify(d, null, 2));
  console.log(`\n✓ 적용 (새 옵션 ${added}개 추가)`);
}
