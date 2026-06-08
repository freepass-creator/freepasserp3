#!/usr/bin/env node
/**
 * 하이브리드 세부모델 일괄 병합 (2026-06-08) — 하이브리드=연료=파워트레인 → 기본세대로 합침.
 *  id 가 `_hybrid` 로 끝나고 기본세대(=id에서 _hybrid 제거)가 존재하면: 트림 병합 → 하이브리드 파일·_index 제거.
 *  비표준 id(예: *_163, *_hybrid_pre)는 자동매칭 안 되면 SKIP(수동 처리). 출처: 하이브리드=파워트레인 정책.
 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'public', 'data', 'car-master');
const fp = (id) => path.join(D, id + '.json');
const load = (id) => JSON.parse(fs.readFileSync(fp(id), 'utf8'));
const save = (id, c) => fs.writeFileSync(fp(id), JSON.stringify(c, null, 2) + '\n', 'utf8');
const exists = (id) => fs.existsSync(fp(id));

const files = fs.readdirSync(D).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const idx = load('_index');
let merged = 0; const skipped = [];

for (const f of files) {
  const id = f.replace('.json', '');
  const c = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
  if (!/HEV|하이브리드/.test(c.title || '')) continue;     // 연료가 title 에 박힌 것만 대상
  const baseId = id.replace(/_hybrid$/, '');
  if (baseId === id || !exists(baseId)) { skipped.push(id); continue; }   // 자동매칭 불가 → 수동
  const base = load(baseId);
  base.trims = base.trims || {};
  let added = 0;
  for (const [k, v] of Object.entries(c.trims || {})) { if (!base.trims[k]) { base.trims[k] = v; added++; } }
  save(baseId, base);
  fs.unlinkSync(fp(id));
  delete idx[id];
  merged++;
  console.log(`✓ ${id} → ${baseId} (하이브리드 +${added}, base 트림 ${Object.keys(base.trims).length})`);
}
save('_index', idx);
console.log(`\n병합 ${merged}건 완료. 수동 처리 필요(자동매칭 불가): ${skipped.length}건 → ${JSON.stringify(skipped)}`);
