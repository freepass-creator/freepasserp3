#!/usr/bin/env node
/**
 * 인기차종 하이브리드 페리 후 누락 stub 일괄 생성.
 *  audit 결과 명시 누락 — 한국 시장에 실제 출시된 하이브리드만.
 */
const fs = require('fs');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// [base catalog_id, new cid, model_root, title, year_start, year_end]
const ENTRIES = [
  // K8 GL3 페리 전 하이브리드 (가솔린 페리 전 base 사용)
  ['kia_k8_gl3_pre', 'kia_k8_gl3_pre_hybrid', 'K8', '기아 K8 GL3 하이브리드', '2021-04', '2024-09'],
  // 코나 OS 페리 전/후 하이브리드 (한국 시장)
  ['hyundai_kona_os', 'hyundai_kona_os_hybrid', '코나', '현대 코나 OS 하이브리드', '2019-07', '2020-08'],
  ['hyundai_kona_os_facelift', 'hyundai_kona_os_facelift_hybrid', '코나', '현대 더 뉴 코나 OS 하이브리드', '2020-08', '2023-04'],
  // 쏘렌토 MQ4 페리 후 하이브리드
  ['kia_sorento_mq4_facelift', 'kia_sorento_mq4_facelift_hybrid', '쏘렌토', '기아 더 뉴 쏘렌토 MQ4 하이브리드', '2023-08', '현재'],
  // 카니발 KA4 하이브리드 (2025년 출시 예정 — 일단 stub)
  ['kia_carnival_ka4', 'kia_carnival_ka4_facelift_hybrid', '카니발', '기아 더 뉴 카니발 KA4 하이브리드', '2024-12', '현재'],
  // K3 BD 하이브리드 — 한국 시장에 K3 페리 하이브리드 없음. 단종.
  // 아반떼 AD 하이브리드 (2017~)
  ['hyundai_avante_ad_facelift', 'hyundai_avante_ad_facelift_hybrid', '아반떼', '현대 더 뉴 아반떼 AD 하이브리드', '2018-09', '2020-04'],
  // 니로 DE — 1세대 자체가 하이브리드 모델이라 별도 catalog 불필요. skip.
];

let created = 0, skipped = 0;
const today = new Date().toISOString().slice(0, 10);
for (const [baseCid, newCid, modelRoot, title, ys, ye] of ENTRIES) {
  const basePath = path.join(CATALOG_DIR, `${baseCid}.json`);
  const newPath = path.join(CATALOG_DIR, `${newCid}.json`);
  if (!fs.existsSync(basePath)) {
    console.warn(`✗ base 없음: ${baseCid} (skip)`);
    skipped++; continue;
  }
  if (fs.existsSync(newPath)) {
    console.warn(`- 이미 있음: ${newCid} (skip)`);
    skipped++; continue;
  }
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const stub = {
    catalog_id: newCid,
    model_root: modelRoot,
    title,
    maker: base.maker,
    source: 'stub',
    source_urls: [],
    fetched_at: today,
    note: `${title} stub. 트림 데이터 별도 보강 필요.`,
    options: {},
    categories: {},
    trims: {
      "프리미엄": { slug: "premium", price: {}, basic: [], select: [], select_groups: [] },
      "익스클루시브": { slug: "exclusive", price: {}, basic: [], select: [], select_groups: [] },
      "프레스티지": { slug: "prestige", price: {}, basic: [], select: [], select_groups: [] },
      "캘리그래피": { slug: "calligraphy", price: {}, basic: [], select: [], select_groups: [] },
    },
    aliases: [
      title.replace(base.maker + ' ', ''),
    ],
    year_start: ys,
    year_end: ye,
  };
  if (APPLY) fs.writeFileSync(newPath, JSON.stringify(stub, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${newCid}: ${title} (${ys}~${ye})`);
  created++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${created} 생성, ${skipped} 스킵`);
