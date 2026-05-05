#!/usr/bin/env node
/**
 * catalog year_start / year_end 정확화 (수동 매핑)
 *   audit 에서 발견된 잘못된 year_start 수정
 *   페리 전/후 분기 명확화
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// catalog id → { year_start, year_end }  실제 출시/단종 시점 (한국 시장 기준)
const FIX = {
  // 한국 인기 (이미 fix 한 catalog 의 year 검증/보강)
  'kia_sportage_nq5':            { year_start: '2021-08', year_end: '현재' },        // NQ5 = 2021-07 출시
  'kia_sportage_ql':              { year_start: '2015-09', year_end: '2018-08' },     // QL 1세대
  'kia_sportage_ql_facelift':     { year_start: '2018-08', year_end: '2021-06' },
  'hyundai_sonata_dn8':           { year_start: '2019-03', year_end: '2023-04' },
  'hyundai_sonata_dn8_edge':      { year_start: '2023-04', year_end: '현재' },
  'hyundai_sonata_dn8_hybrid':    { year_start: '2019-07', year_end: '2023-04' },
  'hyundai_sonata_dn8_edge_hybrid': { year_start: '2023-04', year_end: '현재' },
  'kia_k5_dl3':                   { year_start: '2019-12', year_end: '현재' },        // 페리 후 (2024-08)
  'kia_k5_jf':                    { year_start: '2015-07', year_end: '2018-12' },
  'kia_k5_jf_facelift':           { year_start: '2018-12', year_end: '2019-12' },
  'hyundai_grandeur_gn7':         { year_start: '2022-11', year_end: '현재' },
  'hyundai_grandeur_ig':          { year_start: '2019-11', year_end: '2022-11' },     // 페리 후
  'hyundai_grandeur_ig_pre':      { year_start: '2016-11', year_end: '2019-11' },     // 페리 전
  'hyundai_grandeur_ig_163':      { year_start: '2019-11', year_end: '2022-11' },     // 페리 후 HEV
  'hyundai_grandeur_ig_hybrid_pre': { year_start: '2017-03', year_end: '2019-11' },
  'hyundai_kona_sx2':             { year_start: '2023-04', year_end: '현재' },
  'hyundai_kona_os':              { year_start: '2017-06', year_end: '2020-08' },
  'hyundai_kona_os_facelift':     { year_start: '2020-08', year_end: '2023-04' },
  'hyundai_palisade_lx2':         { year_start: '2018-12', year_end: '2022-08' },
  'hyundai_palisade_lx2_facelift':{ year_start: '2022-08', year_end: '2024-12' },
  'hyundai_palisade_lx3':         { year_start: '2025-01', year_end: '현재' },
  'hyundai_avante_cn7':           { year_start: '2023-03', year_end: '현재' },        // 페리 후 (디 올뉴 페리)
  'hyundai_avante_cn7_pre':       { year_start: '2020-04', year_end: '2023-03' },
  'hyundai_santafe_mx5':          { year_start: '2023-08', year_end: '현재' },
  'hyundai_santa_fe_mx5':         { year_start: '2023-08', year_end: '현재' },        // 같은 모델 다른 id
  'hyundai_santafe_tm_165':       { year_start: '2018-02', year_end: '2023-08' },     // TM (전체 + 페리)
  'hyundai_tucson_nx4':           { year_start: '2020-09', year_end: '현재' },
  'hyundai_tucson_tl':            { year_start: '2015-08', year_end: '2020-09' },
  'hyundai_casper':               { year_start: '2024-04', year_end: '현재' },         // 더 뉴
  'hyundai_casper_pre':           { year_start: '2021-09', year_end: '2024-04' },
  'kia_carnival_ka4':             { year_start: '2020-08', year_end: '2024-12' },
  'kia_carnival_ka4_hi_limousine':{ year_start: '2020-08', year_end: '현재' },
  'kia_carnival_yp':              { year_start: '2014-06', year_end: '2018-08' },
  'kia_carnival_yp_facelift':     { year_start: '2018-08', year_end: '2020-07' },
  'kia_sorento_mq4':              { year_start: '2020-03', year_end: '현재' },
  'kia_sorento_um':               { year_start: '2014-09', year_end: '2017-07' },
  'kia_sorento_um_facelift':      { year_start: '2017-07', year_end: '2020-03' },
  'kia_k8_gl3':                   { year_start: '2024-09', year_end: '현재' },        // 페리 후
  'kia_k8_gl3_pre':               { year_start: '2021-04', year_end: '2024-09' },
  'kia_seltos':                   { year_start: '2022-09', year_end: '현재' },        // 페리 후
  'kia_seltos_sp2':               { year_start: '2019-07', year_end: '2022-09' },
  'kia_seltos_sp3':               { year_start: '2024-12', year_end: '현재' },
  'kia_morning_ja':               { year_start: '2020-08', year_end: '현재' },
  'kia_morning_ja_pre':           { year_start: '2017-01', year_end: '2020-08' },
  'kia_morning_ja_facelift1':     { year_start: '2020-08', year_end: '2022-12' },
  'kia_ray':                      { year_start: '2024-04', year_end: '현재' },
  'kia_ray_tam_facelift1':        { year_start: '2022-09', year_end: '2024-04' },
  'kia_ray_ev':                   { year_start: '2024-09', year_end: '현재' },
  'kia_ev6':                      { year_start: '2024-08', year_end: '현재' },        // 페리 후
  'kia_ev6_pre':                  { year_start: '2021-08', year_end: '2024-08' },
  'kia_ev9':                      { year_start: '2023-05', year_end: '현재' },
  'kia_niro_sg2':                 { year_start: '2022-07', year_end: '현재' },
  'kia_niro_de':                  { year_start: '2016-03', year_end: '2022-07' },
  'genesis_g80_rg3':              { year_start: '2024-09', year_end: '현재' },        // 페리 후
  'genesis_g80_rg3_pre':          { year_start: '2020-03', year_end: '2024-09' },
  'genesis_g80_e':                { year_start: '2021-07', year_end: '현재' },
  'genesis_gv70':                 { year_start: '2025-02', year_end: '현재' },        // 페리 후
  'genesis_gv70_pre':             { year_start: '2020-12', year_end: '2025-02' },
  'genesis_gv70_e':               { year_start: '2021-12', year_end: '현재' },
  'genesis_gv80':                 { year_start: '2024-04', year_end: '현재' },        // 페리 후
  'genesis_gv80_pre':             { year_start: '2020-01', year_end: '2024-04' },
  'genesis_gv80_coupe':           { year_start: '2023-03', year_end: '현재' },
  'genesis_g70':                  { year_start: '2023-08', year_end: '현재' },        // 페리 후
  'genesis_g70_st':               { year_start: '2022-04', year_end: '현재' },
  'genesis_g90_rs4':              { year_start: '2022-03', year_end: '현재' },
  'genesis_gv60':                 { year_start: '2021-09', year_end: '현재' },
  'hyundai_ioniq5':               { year_start: '2024-03', year_end: '현재' },        // 페리 후
  'hyundai_ioniq5_pre':           { year_start: '2021-04', year_end: '2024-03' },
  'hyundai_ioniq5_n':             { year_start: '2023-07', year_end: '현재' },
  'hyundai_ioniq6':               { year_start: '2024-06', year_end: '현재' },        // 페리 후
  'hyundai_ioniq6_pre':           { year_start: '2022-07', year_end: '2024-06' },
  'hyundai_ioniq9':               { year_start: '2024-12', year_end: '현재' },
  'hyundai_staria':               { year_start: '2024-11', year_end: '현재' },        // 더 뉴
  'hyundai_staria_pre':           { year_start: '2021-07', year_end: '2024-11' },
  'hyundai_staria_lounge':        { year_start: '2021-07', year_end: '현재' },
  'hyundai_avante_n':             { year_start: '2021-07', year_end: '현재' },
  'hyundai_nexo_nh2':             { year_start: '2025-04', year_end: '현재' },
  'hyundai_grand_starex_facelift':{ year_start: '2016-01', year_end: '2021-12' },
  'hyundai_grandeur_hg':          { year_start: '2011-01', year_end: '2017-12' },
  'hyundai_avante_ad':            { year_start: '2015-09', year_end: '2018-09' },
  'hyundai_avante_ad_facelift':   { year_start: '2018-09', year_end: '2020-04' },
  'kia_bongo3':                   { year_start: '2004-12', year_end: '현재' },
  'kgm_torres':                   { year_start: '2022-07', year_end: '2025-08' },
  'kgm_torres_facelift':          { year_start: '2025-08', year_end: '현재' },
  'kgm_torres_evx':               { year_start: '2023-11', year_end: '현재' },
  'kgm_korando':                  { year_start: '2019-02', year_end: '현재' },
  'kgm_actyon':                   { year_start: '2024-09', year_end: '현재' },
  'kgm_tivoli_facelift':          { year_start: '2023-04', year_end: '현재' },
};

let touched = 0;
for (const [id, vals] of Object.entries(FIX)) {
  const fp = path.join(CATALOG_DIR, id + '.json');
  if (!fs.existsSync(fp)) continue;
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let changed = false;
  if (d.year_start !== vals.year_start) { d.year_start = vals.year_start; changed = true; }
  if (d.year_end !== vals.year_end) { d.year_end = vals.year_end; changed = true; }
  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n', 'utf8');
    touched++;
  }
}
console.log(`✓ ${touched} catalog year_start/year_end 정확화`);
