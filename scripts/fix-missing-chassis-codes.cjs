#!/usr/bin/env node
/**
 * 현대/기아/제네시스 catalog 의 title 에 chassis code 가 누락된 항목 일괄 보강.
 *  - 현대: 캐스퍼=AX1, 그랜드 스타렉스=TQ, 아이오닉5=NE, 아이오닉6=CE, 아이오닉9=MV,
 *    싼타페 페이스리프트=TM, 쏘나타 뉴 라이즈=LF, 스타리아=US4, 베뉴=QX1, 아반떼 N=CN7
 *  - 기아: 봉고3=PU, 모하비 더 마스터=HM, 더 뉴 셀토스=SP2, 셀토스(콤마 오타)=SP3, 타스만=TQ4
 *
 *  사용:
 *    node scripts/fix-missing-chassis-codes.cjs           # dry-run
 *    node scripts/fix-missing-chassis-codes.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const TITLE_FIX = {
  'hyundai_santafe_tm_165.json':       '현대 더 뉴 싼타페 TM',
  'hyundai_casper.json':               '현대 더 뉴 캐스퍼 AX',
  'hyundai_casper_pre.json':           '현대 캐스퍼 AX',
  'hyundai_grand_starex_facelift.json':'현대 더 뉴 그랜드 스타렉스 TQ',
  'hyundai_ioniq5.json':               '현대 더 뉴 아이오닉5 NE',
  'hyundai_ioniq5_n.json':             '현대 아이오닉5 N NE',
  'hyundai_ioniq5_pre.json':           '현대 아이오닉5 NE',
  'hyundai_ioniq6.json':               '현대 더 뉴 아이오닉6 CE',
  'hyundai_ioniq6_pre.json':           '현대 아이오닉6 CE',
  'hyundai_ioniq9.json':               '현대 아이오닉9 MV',
  'hyundai_sonata_newrise.json':       '현대 쏘나타 뉴 라이즈 LF',
  'hyundai_staria.json':               '현대 더 뉴 스타리아 US4',
  'hyundai_staria_lounge.json':        '현대 스타리아 라운지 US4',
  'hyundai_staria_pre.json':           '현대 스타리아 US4',
  'hyundai_venue.json':                '현대 베뉴 QX1',
  'hyundai_avante_n.json':             '현대 아반떼 N CN7',
  'kia_bongo3.json':                   '기아 봉고3 PU',
  'kia_mohave.json':                   '기아 모하비 더 마스터 HM',
  'kia_seltos.json':                   '기아 더 뉴 셀토스 SP2',
  'kia_seltos_sp3.json':               '기아 셀토스 SP3',
  'kia_tasman.json':                   '기아 타스만 TQ4',
};

let touched = 0;
for (const [file, newTitle] of Object.entries(TITLE_FIX)) {
  const fp = path.join(CATALOG_DIR, file);
  if (!fs.existsSync(fp)) { console.log(`  ! 파일 없음: ${file}`); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (d.title === newTitle) { continue; }
  const oldTitle = d.title;
  d.title = newTitle;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${oldTitle}  →  ${newTitle}`);
  touched++;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog 타이틀 보정`);
