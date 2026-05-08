#!/usr/bin/env node
/**
 * 변형 모델을 model_root 별도 모델로 분리.
 *  - 아반떼 N / 아이오닉5 N — N은 별도 모델 (N라인은 트림이라 분리 안 함)
 *  - 카니발 하이리무진 — 별도 모델
 *  - 제네시스 변형 (G70 슈팅브레이크 / 일렉트리파이드 G80 / 일렉트리파이드 GV70 / GV80 쿠페)
 *  - KGM 무쏘 EV / 토레스 EVX
 *  - 모하비 더 마스터 / 레이 EV
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

const SPLITS = [
  { file: 'hyundai_avante_n.json',           model_root: '아반떼 N' },
  { file: 'hyundai_ioniq5_n.json',           model_root: '아이오닉5 N' },
  { file: 'kia_carnival_ka4_hi_limousine.json', model_root: '카니발 하이리무진' },
  { file: 'genesis_g70_st.json',             model_root: 'G70 슈팅브레이크' },
  { file: 'genesis_g80_e.json',              model_root: '일렉트리파이드 G80' },
  { file: 'genesis_gv70_e.json',             model_root: '일렉트리파이드 GV70' },
  { file: 'genesis_gv80_coupe.json',         model_root: 'GV80 쿠페' },
  { file: 'kgm_musso_ev_o100.json',          model_root: '무쏘 EV' },
  { file: 'kgm_torres_evx.json',             model_root: '토레스 EVX' },
  { file: 'kia_mohave.json',                 model_root: '모하비 더 마스터' },
  { file: 'kia_ray_ev.json',                 model_root: '레이 EV' },
];

let touched = 0;
for (const { file, model_root } of SPLITS) {
  const fp = path.join(CATALOG_DIR, file);
  if (!fs.existsSync(fp)) {
    console.log(`! 누락: ${file}`);
    continue;
  }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const old = d.model_root;
  if (old === model_root) continue;
  d.model_root = model_root;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${file}  ${old} → ${model_root}`);
  touched++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog model_root 분리`);
