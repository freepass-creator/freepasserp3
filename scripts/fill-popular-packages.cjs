#!/usr/bin/env node
/**
 * 신차 stub catalog (옵션 사전 빈) 에 한국 신차 표준 패키지 일괄 추가.
 *  메이커별 패키지 명명 차이 적용 (현대 스마트센스 / 기아 드라이브 와이즈 등).
 *
 *  추가 패키지 (각 catalog trim 의 select_groups 에):
 *   1. ADAS 풀 패키지 (스마트센스 II / 드라이브와이즈 II)
 *   2. 컨비니언스 (스마트키 + 버튼시동)
 *   3. 컴포트 (열선/통풍/메모리)
 *   4. 파킹 어시스트 (AVMS + RCTA + BVM)
 *   5. 익스테리어 디자인 (LED + 휠)
 *   6. 빌트인 캠 패키지
 *   7. 파노라마 선루프
 *   8. 헤드업 디스플레이
 *
 *  사용:
 *    node scripts/fill-popular-packages.cjs           # dry-run
 *    node scripts/fill-popular-packages.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const ADAS_NAME_BY_MAKER = {
  '현대':   { adas: '현대 스마트센스 II', adas_price: 1000000 },
  '제네시스':{ adas: '드라이빙 어시스턴스 패키지 II', adas_price: 2000000 },
  '기아':   { adas: '드라이브 와이즈 II', adas_price: 1100000 },
  'KGM':    { adas: '드라이빙 어시스트 패키지 II', adas_price: 800000 },
  '쉐보레': { adas: '드라이버 컨피던스 패키지', adas_price: 900000 },
  '르노':   { adas: '어시스트 팩', adas_price: 700000 },
  // 수입차
  'BMW':    { adas: '드라이빙 어시스턴스 프로페셔널', adas_price: 1500000 },
  '벤츠':   { adas: '드라이빙 어시스턴스 패키지', adas_price: 2000000 },
  '아우디': { adas: '어시스턴스 패키지 플러스', adas_price: 1800000 },
  '미니':   { adas: '드라이빙 어시스턴트', adas_price: 1000000 },
  '볼보':   { adas: 'PILOT ASSIST 팩', adas_price: 1300000 },
  '폭스바겐':{ adas: 'Travel Assist 팩', adas_price: 1200000 },
  '포르쉐': { adas: 'InnoDrive', adas_price: 2500000 },
  '랜드로버':{ adas: 'Driver Assistance Pack', adas_price: 1800000 },
  '재규어': { adas: 'Drive Pack', adas_price: 1700000 },
  '렉서스': { adas: 'Lexus Safety System+', adas_price: 1400000 },
  '도요타': { adas: 'Toyota Safety Sense', adas_price: 1200000 },
  '토요타': { adas: 'Toyota Safety Sense', adas_price: 1200000 },
  '혼다':   { adas: 'Honda Sensing', adas_price: 1100000 },
  '닛산':   { adas: 'ProPILOT 어시스트', adas_price: 1300000 },
  '인피니티':{ adas: 'ProActive 패키지', adas_price: 1500000 },
  '포드':   { adas: 'Co-Pilot360', adas_price: 1100000 },
  '지프':   { adas: 'Advanced Safety Pack', adas_price: 1300000 },
  '캐딜락': { adas: 'Driver Assist Package', adas_price: 1500000 },
  '링컨':   { adas: 'Co-Pilot360 Plus', adas_price: 1500000 },
  '테슬라': { adas: 'Enhanced Autopilot', adas_price: 7900000 },
  '마세라티':{ adas: '드라이빙 어시스턴스 패키지', adas_price: 2500000 },
  '벤틀리': { adas: '컴포트 패키지', adas_price: 3000000 },
  '롤스로이스':{ adas: '디센더 패키지', adas_price: 5000000 },
  '람보르기니':{ adas: 'ADAS', adas_price: 3000000 },
  '페라리': { adas: 'ADAS', adas_price: 3000000 },
};

// 표준 패키지 마스터 (코드 → 이름 + 가격 + 매핑되는 ADAS/편의 그룹)
function buildPackages(maker) {
  const adasInfo = ADAS_NAME_BY_MAKER[maker] || { adas: '드라이브 어시스트 패키지', adas_price: 900000 };
  return [
    { code: 'PKG_ADAS',         name: adasInfo.adas,             price: adasInfo.adas_price },
    { code: 'PKG_CONVENIENCE',  name: '컨비니언스 패키지',        price: 600000 },
    { code: 'PKG_COMFORT',      name: '컴포트 패키지',            price: 700000 },
    { code: 'PKG_PARKING',      name: '파킹 어시스트 패키지',     price: 800000 },
    { code: 'PKG_EXTERIOR',     name: '익스테리어 디자인 패키지', price: 1200000 },
    { code: 'PKG_BUILTIN_CAM',  name: '빌트인 캠 패키지',         price: 850000 },
    { code: 'PKG_SUNROOF',      name: '파노라마 선루프',          price: 1200000 },
    { code: 'PKG_HUD',          name: '헤드업 디스플레이',        price: 1300000 },
  ];
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if ((d.year_start || '') < '2016-01') continue;
  if (!ADAS_NAME_BY_MAKER[d.maker]) continue;
  const opts = d.options || (d.options = {});
  const trims = d.trims || {};
  if (!Object.keys(trims).length) continue;
  // 이미 표준 패키지 적용된 catalog 는 skip (PKG_ADAS 코드로 판별)
  if (opts['PKG_ADAS']) continue;

  const pkgs = buildPackages(d.maker);

  // options 사전에 패키지 코드 추가
  for (const p of pkgs) {
    if (!opts[p.code]) {
      opts[p.code] = { name: p.name, category: '선택사양', is_package: true };
    }
  }

  // 각 trim 의 select_groups 에 패키지 추가
  for (const t of Object.values(trims)) {
    if (!Array.isArray(t.select_groups)) t.select_groups = [];
    for (const p of pkgs) {
      // 이미 같은 이름 패키지 있으면 skip
      const exists = t.select_groups.some(g => !Array.isArray(g) && g.name === p.name);
      if (exists) continue;
      t.select_groups.push({ codes: [p.code], price: p.price, name: p.name });
    }
  }

  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} — 패키지 ${pkgs.length}개 추가`);
  touched++;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog`);
