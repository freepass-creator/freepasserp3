#!/usr/bin/env node
/**
 * 수입차 인기차종 stub 카탈로그 생성.
 *  - 트림명만 채움 (옵션 데이터 미입력)
 *  - encar 매핑 + _index 등록
 *  - 매트릭스 매칭 시 카탈로그가 매칭되어 ✕ 대신 트림 매칭 가능
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'public', 'data', 'car-master');
const IDX_PATH = path.join(BASE, '_index.json');

const STUBS = [
  { id: 'bmw_5_g60', maker: 'BMW', title: 'BMW 5시리즈 G60',
    encar: ['encar_012_003_095'],
    trims: ['520i M Sport', '530i M Sport', '530i xDrive M Sport', '540i xDrive M Sport',
            '520d M Sport', 'i5 eDrive40', 'i5 M60 xDrive'] },
  { id: 'bmw_3_g20', maker: 'BMW', title: 'BMW 3시리즈 G20',
    encar: ['encar_012_002_068'],
    trims: ['320i M Sport', '320i xDrive', '330i M Sport', '320d xDrive', 'M340i xDrive'] },
  { id: 'bmw_x3_g01', maker: 'BMW', title: 'BMW X3 G01',
    encar: ['encar_012_007_098'],
    trims: ['xDrive20i M Sport', 'xDrive30i M Sport', 'xDrive30e M Sport', 'M40i'] },
  { id: 'bmw_x5_g05', maker: 'BMW', title: 'BMW X5 G05',
    encar: ['encar_012_008_066'],
    trims: ['xDrive40i', 'xDrive40d', 'xDrive50e M Sport', 'M60i', 'M Competition'] },
  { id: 'mercedes_e_w214', maker: '벤츠', title: '벤츠 E-클래스 W214',
    encar: ['encar_013_004_102'],
    trims: ['E200', 'E300 4MATIC', 'E350 4MATIC', 'E450 4MATIC', 'E63 AMG'] },
  { id: 'mercedes_c_w206', maker: '벤츠', title: '벤츠 C-클래스 W206',
    encar: ['encar_013_001_095'],
    trims: ['C200', 'C300', 'C300 4MATIC', 'C43 AMG', 'C63 AMG'] },
  { id: 'mercedes_s_w223', maker: '벤츠', title: '벤츠 S-클래스 W223',
    encar: ['encar_013_005_092'],
    trims: ['S400d 4MATIC', 'S500 4MATIC', 'S580 4MATIC', 'S63 AMG E Performance', 'Maybach S580'] },
  { id: 'audi_a6_c8', maker: '아우디', title: '아우디 A6 C8',
    encar: ['encar_011_004_045'],
    trims: ['40 TFSI', '45 TFSI quattro', '55 TFSI quattro', 'S6 TDI', 'RS6 Avant'] },
  { id: 'audi_q5_fy', maker: '아우디', title: '아우디 Q5 FY',
    encar: ['encar_011_020_077'],
    trims: ['40 TDI quattro', '45 TFSI quattro', 'SQ5'] },
  { id: 'mini_cooper', maker: '미니', title: '미니 쿠퍼',
    encar: ['encar_054_001_137'],
    trims: ['Cooper C', 'Cooper S', 'Cooper SE Electric', 'JCW'] },
  { id: 'volvo_xc40', maker: '볼보', title: '볼보 XC40',
    encar: ['encar_017_023_031'],
    trims: ['B4', 'B5', 'Recharge Pure Electric Single', 'Recharge Pure Electric Twin'] },
  { id: 'volvo_xc60', maker: '볼보', title: '볼보 XC60',
    encar: ['encar_017_016_026'],
    trims: ['B5 Mild Hybrid', 'B6 Mild Hybrid', 'T8 Recharge', 'Polestar Engineered'] },
  { id: 'volvo_s60', maker: '볼보', title: '볼보 S60',
    encar: ['encar_017_009_029'],
    trims: ['B5 Mild Hybrid', 'T8 Recharge', 'Polestar Engineered'] },
  { id: 'porsche_cayenne', maker: '포르쉐', title: '포르쉐 카이엔 PO536',
    encar: ['encar_015_002_018'],
    trims: ['Cayenne', 'Cayenne S', 'Cayenne E-Hybrid', 'Cayenne Turbo GT', 'Cayenne Turbo E-Hybrid'] },
  { id: 'porsche_macan', maker: '포르쉐', title: '포르쉐 마칸 EV',
    encar: ['encar_015_013_022'],
    trims: ['Macan EV', 'Macan 4 EV', 'Macan 4S EV', 'Macan Turbo EV'] },
  { id: 'vw_tiguan', maker: '폭스바겐', title: '폭스바겐 티구안 올스페이스',
    encar: ['encar_014_002_035'],
    trims: ['프리미엄', '프레스티지'] },
  { id: 'vw_golf_8', maker: '폭스바겐', title: '폭스바겐 골프 8세대',
    encar: ['encar_014_007_042'],
    trims: ['1.5 eTSI Active', '2.0 TDI Style', 'GTI', 'R'] },
  { id: 'landrover_defender', maker: '랜드로버', title: '랜드로버 디펜더 L663',
    encar: ['encar_020_005_018'],
    trims: ['90 P300', '110 P400', '110 D300', '130 P400', 'Defender V8'] },
  { id: 'landrover_range_sport', maker: '랜드로버', title: '랜드로버 레인지로버 스포츠 L461',
    encar: ['encar_020_006_020'],
    trims: ['SE D250', 'Dynamic SE P400', 'Autobiography P530', 'SV P635'] },
  { id: 'tesla_model_3', maker: '테슬라', title: '테슬라 모델 3',
    encar: ['encar_087_003_003'],
    trims: ['Standard Range', 'Long Range', 'Performance'] },
  { id: 'tesla_model_y', maker: '테슬라', title: '테슬라 모델 Y',
    encar: ['encar_087_004_004'],
    trims: ['Standard Range', 'Long Range', 'Performance'] },
  { id: 'tesla_model_s', maker: '테슬라', title: '테슬라 모델 S',
    encar: ['encar_087_001_001'],
    trims: ['Long Range', 'Plaid'] },
  { id: 'tesla_model_x', maker: '테슬라', title: '테슬라 모델 X',
    encar: ['encar_087_002_002'],
    trims: ['Long Range', 'Plaid'] },
];

const idx = JSON.parse(fs.readFileSync(IDX_PATH, 'utf-8'));
let created = 0, skipped = 0;

for (const stub of STUBS) {
  const cp = path.join(BASE, stub.id + '.json');
  if (fs.existsSync(cp)) { skipped++; continue; }
  const trimsDict = {};
  for (const t of stub.trims) {
    trimsDict[t] = {
      slug: t.toLowerCase().replace(/[\s-]/g, '_'),
      price: {},
      basic: [],
      select: [],
      select_groups: [],
    };
  }
  const catalog = {
    catalog_id: stub.id,
    title: stub.title,
    maker: stub.maker,
    source: 'stub',
    source_urls: [],
    fetched_at: '2026-05-04',
    note: '수입차 stub 카탈로그 — 트림명만 (옵션 데이터 추후 OCR). encar 매칭용.',
    options: {},
    categories: {},
    trims: trimsDict,
  };
  fs.writeFileSync(cp, JSON.stringify(catalog, null, 2), 'utf-8');
  idx[stub.id] = {
    id: stub.id,
    title: stub.title,
    maker: stub.maker,
    source: { manufacturer: null, wikicar: null, encar: stub.encar },
    verified: { manufacturer: false, wikicar: false, encar: true },
    trims: stub.trims,
    fetched_at: '2026-05-04',
    note: '수입차 stub',
  };
  created++;
}

fs.writeFileSync(IDX_PATH, JSON.stringify(idx, null, 2), 'utf-8');
console.log(`수입차 stub: 신규 ${created}개 / 스킵 ${skipped}개`);
console.log(`전체 카탈로그: ${Object.keys(idx).length}개`);
