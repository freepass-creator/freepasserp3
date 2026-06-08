#!/usr/bin/env node
/**
 * K5 엔카 기준 규격화 (2026-06-08) — 하이브리드 세부모델을 기본세대로 병합(파워트레인화).
 *  하이브리드는 연료=파워트레인이므로 별도 세부모델 X. 기본세대 트림에 하이브리드 트림 합침 + 하이브리드 파일/_index 제거.
 *  쌍: dl3 / dl3_facelift / jf / jf_facelift 각각 ←_hybrid.
 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'public', 'data', 'car-master');
const fp = (id) => path.join(D, id + '.json');
const load = (id) => JSON.parse(fs.readFileSync(fp(id), 'utf8'));
const save = (id, c) => fs.writeFileSync(fp(id), JSON.stringify(c, null, 2) + '\n', 'utf8');

const pairs = [
  ['kia_k5_dl3', 'kia_k5_dl3_hybrid'],
  ['kia_k5_dl3_facelift', 'kia_k5_dl3_facelift_hybrid'],
  ['kia_k5_jf', 'kia_k5_jf_hybrid'],
  ['kia_k5_jf_facelift', 'kia_k5_jf_facelift_hybrid'],
];

const idx = load('_index');
for (const [baseId, hybId] of pairs) {
  const base = load(baseId), hyb = load(hybId);
  base.trims = base.trims || {};
  let added = 0;
  for (const [k, v] of Object.entries(hyb.trims || {})) { if (!base.trims[k]) { base.trims[k] = v; added++; } }
  save(baseId, base);
  fs.unlinkSync(fp(hybId));
  delete idx[hybId];
  console.log(`병합 ${hybId} → ${baseId}: 하이브리드 +${added} | base 트림 ${Object.keys(base.trims).length} | 파일·_index 제거`);
}
save('_index', idx);
console.log('완료. rebuild-catalog-index 로 base 트림 동기화하세요.');
