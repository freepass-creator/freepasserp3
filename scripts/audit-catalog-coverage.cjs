#!/usr/bin/env node
/**
 * encar-master-seed.json (한국시장 1092건) ↔ 우리 catalog (399개) 비교.
 *  catalog 에 없는 (maker, sub) 후보를 자동 추출 → 빠진 catalog stub 후보.
 *
 *  매칭: maker + normName(sub) → _aliases-map.json (catalog aliases 합집합)
 *  매칭 실패 = 빠진 catalog
 *
 *  사용:
 *    node scripts/audit-catalog-coverage.cjs
 *    node scripts/audit-catalog-coverage.cjs --maker=현대  # 특정 메이커만
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const SEED_PATH = path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.json');

const FILTER_MAKER = (process.argv.find(a => a.startsWith('--maker=')) || '').replace('--maker=', '');

function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '')
    .replace(/\s+/g, '');
}

const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
const aliasMap = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, '_aliases-map.json'), 'utf8'));

// alias map normalized — key: maker|normName(alias)
const normMap = {};
for (const [k, cid] of Object.entries(aliasMap)) {
  const [mk, alias] = k.split('|');
  normMap[`${mk}|${normName(alias)}`] = cid;
}

// catalog meta — model_root 등 표시용
const catalogMeta = {};
for (const f of fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  catalogMeta[d.catalog_id || f.replace('.json', '')] = {
    title: d.title, maker: d.maker, model_root: d.model_root,
  };
}

// 우리 catalog 의 (maker, model_root) 세트 — 메이커별 어떤 모델 가지고 있는지
const ourMakerModels = new Set();
for (const m of Object.values(catalogMeta)) {
  if (m.maker && m.model_root) ourMakerModels.add(`${m.maker}|${m.model_root}`);
}

// seed entries 순회 → 매칭 시도
const missing = [];
const matchedCount = { byMaker: {}, total: 0 };
const totalCount = { byMaker: {}, total: 0 };

for (const e of seed) {
  if (e.archived) continue;
  if (!e.maker || !e.sub) continue;
  if (FILTER_MAKER && e.maker !== FILTER_MAKER) continue;

  totalCount.total++;
  totalCount.byMaker[e.maker] = (totalCount.byMaker[e.maker] || 0) + 1;

  const key = `${e.maker}|${normName(e.sub)}`;
  const cid = normMap[key];

  if (cid) {
    matchedCount.total++;
    matchedCount.byMaker[e.maker] = (matchedCount.byMaker[e.maker] || 0) + 1;
    continue;
  }
  // 매칭 실패
  missing.push({
    maker: e.maker,
    model: e.model || '',
    sub: e.sub,
    production_start: e.production_start || '',
    production_end: e.production_end || '',
    category: e.category || '',
    // 우리 catalog 에 같은 model 그룹이 있는지
    sameModelExists: ourMakerModels.has(`${e.maker}|${e.model || ''}`),
  });
}

// 메이커별 정렬
missing.sort((a, b) => {
  if (a.maker !== b.maker) return a.maker.localeCompare(b.maker, 'ko');
  if (a.model !== b.model) return a.model.localeCompare(b.model, 'ko');
  return (b.production_start || '').localeCompare(a.production_start || '');
});

// 출력
console.log(`\n전체 ${totalCount.total}건 중 ${matchedCount.total}건 매칭, ${missing.length}건 누락`);
console.log('');

const byMaker = {};
for (const m of missing) {
  if (!byMaker[m.maker]) byMaker[m.maker] = [];
  byMaker[m.maker].push(m);
}

for (const mk of Object.keys(byMaker).sort()) {
  const list = byMaker[mk];
  const matched = matchedCount.byMaker[mk] || 0;
  const total = totalCount.byMaker[mk] || 0;
  console.log(`\n## ${mk} — 누락 ${list.length} / 전체 ${total} (매칭 ${matched})`);
  // 모델별 그룹화
  const byModel = {};
  for (const m of list) {
    const k = m.model || '(no-model)';
    if (!byModel[k]) byModel[k] = [];
    byModel[k].push(m);
  }
  for (const md of Object.keys(byModel).sort((a, b) => a.localeCompare(b, 'ko'))) {
    const items = byModel[md];
    const sameOk = items[0]?.sameModelExists;
    console.log(`  [${md}] ${sameOk ? '(model 있음)' : '(model 없음)'}`);
    for (const m of items.slice(0, 8)) {
      const yr = m.production_start ? `${m.production_start.slice(0, 4)}~${(m.production_end || '').slice(0, 4) || '현재'}` : '';
      console.log(`    ${m.sub}${yr ? ` (${yr})` : ''}`);
    }
    if (items.length > 8) console.log(`    ... +${items.length - 8}건`);
  }
}
