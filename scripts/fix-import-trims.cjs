#!/usr/bin/env node
/**
 * 수입 인기 catalog trim 분기 보강 (엔진 단위)
 *   - 가격 skip (할인 多 + 정확도 어려움)
 *   - trim 명 명확화 (영업자 매물 등록 시 선택 가능하게)
 *   - 옵션은 stub 유지 (후속 정밀화)
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// catalog id → trim list (엔진 단위)
const TRIMS = {
  // BMW
  'bmw_3_g20':       ['320i', '320i M Sport', '320d', '320d M Sport', '330i', '330i M Sport', 'M340i'],
  'bmw_5_g30':       ['520i', '520d', '530i', '530e', '540i'],
  'bmw_5_g60':       ['520i', '520d', '530i', '530e', '540i'],
  'bmw_x1_u11':      ['sDrive18i', 'sDrive20i', 'xDrive20d', 'xDrive25e'],
  'bmw_x3_g01':      ['xDrive20i', 'xDrive20d', 'xDrive30i', 'xDrive30e', 'M40i'],
  'bmw_x4_g02':      ['xDrive20i', 'xDrive20d', 'M40i'],
  'bmw_x5_g05':      ['xDrive40i', 'xDrive45e', 'M60i', 'X5 M'],
  'bmw_4_g22':       ['420i', '430i', 'M440i', 'M4'],
  'bmw_7_g70':       ['740i', '740d', '750e', 'i7'],
  // 벤츠
  'mercedes_c_w205': ['C 200', 'C 220 d', 'C 300', 'AMG C 43'],
  'mercedes_c_w206': ['C 200', 'C 220 d', 'C 300', 'AMG C 43'],
  'mercedes_e_w213': ['E 200', 'E 220 d', 'E 300', 'E 350', 'AMG E 53'],
  'mercedes_e_w214': ['E 200', 'E 300', 'E 450 4MATIC'],
  'mercedes_s_w223': ['S 350 d', 'S 400 d 4MATIC', 'S 500 4MATIC', 'S 580 e', 'S 580 4MATIC'],
  'mercedes_a_w177': ['A 200', 'A 220', 'A 250', 'AMG A 35'],
  'mercedes_glc':    ['GLC 220 d', 'GLC 300 4MATIC', 'GLC 300 e', 'GLC 400 4MATIC'],
  // 아우디
  'audi_a3_8y':      ['30 TFSI', '35 TFSI', '40 TFSI', '40 TFSI 콰트로'],
  'audi_a4_b9':      ['35 TFSI', '40 TFSI', '40 TFSI 콰트로', '45 TFSI 콰트로'],
  'audi_a6_c8':      ['40 TFSI', '45 TFSI', '45 TFSI 콰트로', '55 TFSI 콰트로', 'S6'],
  'audi_q5_fy':      ['40 TFSI', '45 TFSI 콰트로', '50 TDI 콰트로', 'SQ5'],
  // 테슬라
  'tesla_model_3':   ['스탠다드 RWD', '롱레인지 AWD', '퍼포먼스 AWD'],
  'tesla_model_y':   ['스탠다드 RWD', '롱레인지 AWD', '퍼포먼스 AWD'],
  'tesla_model_s':   ['듀얼모터 AWD', '플래드 AWD'],
  'tesla_model_x':   ['듀얼모터 AWD', '플래드 AWD'],
  // 볼보
  'volvo_xc40':      ['B4', 'B5', 'T8 Recharge'],
  'volvo_xc40_pre':  ['T4', 'T5', 'D4'],
  'volvo_xc60':      ['B5', 'B6', 'T8 Recharge'],
  'volvo_xc60_gen1': ['D4', 'T5', 'T6', 'T8 Recharge'],
  'volvo_s60':       ['B5', 'T8 Recharge'],
  // 폭스바겐
  'vw_golf_8':       ['1.5 TSI', '2.0 TDI', 'GTI', 'R'],
  'vw_jetta':        ['1.4 TSI'],
  'vw_tiguan':       ['2.0 TSI', '2.0 TDI'],
  // 미니
  'mini_cooper':     ['쿠퍼', '쿠퍼 S', 'JCW'],
  // 포르쉐
  'porsche_cayenne': ['카이엔', '카이엔 E-하이브리드', '카이엔 S', '카이엔 GTS', '카이엔 터보 E-하이브리드'],
  'porsche_macan':   ['마칸 4', '마칸 4S', '마칸 터보'],
  // 랜드로버
  'landrover_defender':   ['D250', 'D300', 'P400', 'V8'],
  'landrover_range_sport':['D300', 'D350', 'P440e', 'P530', 'P635 SV'],
  // 지프
  'jeep_cherokee':   ['리미티드', '오버랜드', '서밋'],
};

const norm = s => (s||'').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g,'').replace(/\s+/g,'');

let touched = 0, totalTrims = 0;
for (const [catalogId, trimList] of Object.entries(TRIMS)) {
  const fp = path.join(CATALOG_DIR, catalogId + '.json');
  if (!fs.existsSync(fp)) { console.warn(`  ⚠ ${catalogId} 없음`); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));

  // 기존 trim 1개 (auto_stub "기본 X") 가 있으면 제거하고 새로
  const hasOnlyDefault = Object.keys(d.trims || {}).length === 1
                       && Object.keys(d.trims)[0].startsWith('기본 ');
  const hasNoTrim = !d.trims || !Object.keys(d.trims).length;
  if (!hasOnlyDefault && !hasNoTrim) {
    // 이미 trim 있으면 보존 — 새 trim 만 추가
    for (const t of trimList) {
      if (!d.trims[t]) {
        d.trims[t] = { slug: t, price: {}, basic: [], select: [], select_groups: [] };
      }
    }
  } else {
    d.trims = {};
    for (const t of trimList) {
      d.trims[t] = { slug: t, price: {}, basic: [], select: [], select_groups: [] };
    }
  }

  // source 갱신 (auto_stub → manual_stub)
  if (d.source === 'auto_stub') d.source = 'manual_stub';
  d.fetched_at = '2026-05-05';

  fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n', 'utf8');
  touched++;
  totalTrims += trimList.length;
}

console.log(`✓ ${touched} catalog trim 보강 (총 ${totalTrims} trim)`);
