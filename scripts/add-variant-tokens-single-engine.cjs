#!/usr/bin/env node
/**
 * 단일 동력원(하이브리드/EV) catalog 의 트림 키에 변형 토큰(예: "하이브리드 1.6") 추가.
 *  - catalog 가 단일 변형이라 가격 매핑 안전 (catalog 가격이 그 변형 가격)
 *  - 트림 키만 변경. 옵션·가격 데이터 유지.
 *
 *  사용:
 *    node scripts/add-variant-tokens-single-engine.cjs            # dry-run
 *    node scripts/add-variant-tokens-single-engine.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

// catalog id (파일명 stem) → 추가할 변형 토큰 suffix
const SUFFIX_MAP = {
  // 가솔린 2.0 하이브리드
  hyundai_sonata_dn8_hybrid:           '하이브리드 2.0',
  hyundai_sonata_dn8_edge_hybrid:      '하이브리드 2.0',
  kia_k5_dl3_hybrid:                   '하이브리드 2.0',
  kia_k5_dl3_facelift_hybrid:          '하이브리드 2.0',
  kia_k5_jf_hybrid:                    '하이브리드 2.0',
  kia_k5_jf_facelift_hybrid:           '하이브리드 2.0',
  // 가솔린 2.4 하이브리드 (그랜저)
  hyundai_grandeur_ig_hybrid_pre:      '하이브리드 2.4',
  hyundai_grandeur_ig_163:             '하이브리드 2.4',
  hyundai_grandeur_gn7_hybrid:         '하이브리드 2.4',
  // 가솔린 1.6 하이브리드 (소형/중형)
  hyundai_avante_ad_facelift_hybrid:   '하이브리드 1.6',
  hyundai_avante_cn7_hybrid:           '하이브리드 1.6',
  hyundai_kona_os_hybrid:              '하이브리드 1.6',
  hyundai_kona_os_facelift_hybrid:     '하이브리드 1.6',
  hyundai_kona_sx2_hybrid:             '하이브리드 1.6',
  hyundai_tucson_nx4_hybrid:           '하이브리드 1.6',
  hyundai_santafe_mx5_hybrid:          '하이브리드 1.6',
  kia_sorento_mq4_hybrid:              '하이브리드 1.6',
  kia_sorento_mq4_facelift_hybrid:     '하이브리드 1.6',
  kia_sportage_nq5_hybrid:             '하이브리드 1.6',
  kia_niro_sg2_hybrid:                 '하이브리드 1.6',
  kia_k8_gl3_hybrid:                   '하이브리드 1.6',
  kia_k8_gl3_pre_hybrid:               '하이브리드 1.6',
  // 가솔린 1.6 T 하이브리드 (카니발 4세대)
  kia_carnival_ka4_hybrid:             '하이브리드 1.6 T',
  kia_carnival_ka4_facelift_hybrid:    '하이브리드 1.6 T',
  // 가솔린 2.5 하이브리드 (팰리세이드)
  hyundai_palisade_lx3_hybrid:         '하이브리드 2.5',
};

let touched = 0, totalTrims = 0;
for (const [id, suffix] of Object.entries(SUFFIX_MAP)) {
  const fp = path.join(CATALOG_DIR, id + '.json');
  if (!fs.existsSync(fp)) { console.log(`  ! 파일 없음: ${id}`); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const trims = d.trims || {};
  const newTrims = {};
  let didChange = false;
  for (const [k, t] of Object.entries(trims)) {
    // 이미 변형 토큰 있는 트림은 그대로
    if (/(가솔린|디젤|LPG|LPi|하이브리드|HEV|EV)/i.test(k)) {
      newTrims[k] = t;
      continue;
    }
    const newKey = `${k} ${suffix}`;
    newTrims[newKey] = t;
    didChange = true;
    totalTrims++;
  }
  if (!didChange) continue;
  d.trims = newTrims;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} — ${suffix}: ${Object.keys(newTrims).length}트림`);
  touched++;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 트림 ${totalTrims}개 변형 토큰 추가`);
