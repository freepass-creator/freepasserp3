#!/usr/bin/env node
/**
 * 하이브리드 catalog 의 trim 매핑 — 가솔린 catalog trim 옵션 수 기반 등급 비례 매칭.
 *  - 하이브리드 trim 명 등급 (프리미엄=0 < 익스클루시브=1 < 프레스티지=2 < 캘리그래피=3 등)
 *  - 가솔린 trim 옵션 수 sort asc
 *  - 같은 ranking percentile 매핑
 *  - 가솔린 엔진 코드 제거 후 하이브리드 trim basic 갱신
 *
 *  사용:
 *    node scripts/map-hybrid-trims-by-grade.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// 하이브리드 trim 등급 (낮음→높음)
const HY_GRADE = {
  '프리미엄': 0, '익스클루시브': 1, '프레스티지': 2, '캘리그래피': 3,
  // K5 / 셀토스 등
  '트렌디': 0, '노블레스': 2, '시그니처': 3,
};
function hyTrimGrade(k) {
  const tokens = k.split(/\s+/);
  if (HY_GRADE[tokens[0]] != null) return HY_GRADE[tokens[0]];
  return 99;
}

function gasEngineCodes(t, opts) {
  const re = /(스마트스트림.*가솔린.*엔진|^.*가솔린.*엔진|^.*가솔린.*\d\.\d.*엔진)/i;
  return (t.basic || []).filter(c => re.test(opts[c]?.name || ''));
}

// 페어 매핑
const PAIRS = {
  kia_k8_gl3_pre_hybrid: 'kia_k8_gl3_pre',
  kia_carnival_ka4_facelift_hybrid: 'kia_carnival_ka4',
  hyundai_tucson_nx4_hybrid: 'hyundai_tucson_nx4',
  hyundai_kona_os_hybrid: 'hyundai_kona_os',
  hyundai_kona_os_facelift_hybrid: 'hyundai_kona_os_facelift',
  hyundai_kona_sx2_hybrid: 'hyundai_kona_sx2',
  hyundai_avante_ad_facelift_hybrid: 'hyundai_avante_ad_facelift',
  hyundai_avante_cn7_hybrid: 'hyundai_avante_cn7',
  hyundai_santafe_mx5_hybrid: 'hyundai_santafe_mx5',
  kia_sorento_mq4_hybrid: 'kia_sorento_mq4',
  kia_sorento_mq4_facelift_hybrid: 'kia_sorento_mq4_facelift',
  kia_sportage_nq5_hybrid: 'kia_sportage_nq5',
  kia_niro_sg2_hybrid: 'kia_niro_sg2',
  kia_k5_dl3_hybrid: 'kia_k5_dl3',
  kia_k5_dl3_facelift_hybrid: 'kia_k5_dl3_facelift',
  kia_k5_jf_hybrid: 'kia_k5_jf',
  kia_k5_jf_facelift_hybrid: 'kia_k5_jf_facelift',
};

let touched = 0;
for (const [hyStem, gasStem] of Object.entries(PAIRS)) {
  const hyFp = path.join(CATALOG_DIR, hyStem + '.json');
  const gasFp = path.join(CATALOG_DIR, gasStem + '.json');
  if (!fs.existsSync(hyFp) || !fs.existsSync(gasFp)) continue;
  const hy = JSON.parse(fs.readFileSync(hyFp, 'utf8'));
  const gas = JSON.parse(fs.readFileSync(gasFp, 'utf8'));

  // 가솔린 trim 들 옵션 수 sort asc (basic 0 도 포함)
  const gasTrims = Object.entries(gas.trims || {})
    .filter(([k, t]) => (t.basic || []).length > 0)
    .sort((a, b) => (a[1].basic || []).length - (b[1].basic || []).length);
  if (!gasTrims.length) continue;

  // 하이브리드 trim 들 등급 sort asc
  const hyTrims = Object.entries(hy.trims || {})
    .map(([k, t]) => ({ k, t, grade: hyTrimGrade(k) }))
    .sort((a, b) => a.grade - b.grade);

  // 비례 매핑
  let didChange = false;
  for (let i = 0; i < hyTrims.length; i++) {
    const ratio = hyTrims.length > 1 ? i / (hyTrims.length - 1) : 0;
    const gasIdx = Math.round(ratio * (gasTrims.length - 1));
    const [_, gasT] = gasTrims[gasIdx];
    const eng = gasEngineCodes(gasT, gas.options);
    const codes = (gasT.basic || []).filter(c => !eng.includes(c));
    if ((hyTrims[i].t.basic || []).length === codes.length) continue;
    hyTrims[i].t.basic = codes;
    if (gasT.select_groups) hyTrims[i].t.select_groups = JSON.parse(JSON.stringify(gasT.select_groups));
    didChange = true;
  }
  if (!didChange) continue;
  if (APPLY) fs.writeFileSync(hyFp, JSON.stringify(hy, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${hy.title}`);
  for (const { k, t } of hyTrims) console.log(`  ${k} basic=${(t.basic || []).length}`);
  touched++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog`);
