#!/usr/bin/env node
/**
 * public/data/car-master/_index.json 을 catalog 파일들로부터 재생성.
 * 신규 stub 추가 후 _index 누락된 entry 자동 보완.
 *
 * 기존 entry 의 source/verified/encar 매핑은 보존, 신규 entry 만 추가.
 *
 * 사용:
 *   node scripts/rebuild-catalog-index.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const INDEX_PATH = path.join(CATALOG_DIR, '_index.json');

const existing = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const files = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'));

let added = 0;
let synced = 0;
const updated = { ...existing };

for (const f of files) {
  const cid = f.replace('.json', '');
  try {
    const data = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
    const trimNames = data.trims ? Object.keys(data.trims) : [];
    // 트림 가격 메타 — { trim_name: price.base } — 가격순 정렬용
    const trimsMeta = {};
    if (data.trims && typeof data.trims === 'object') {
      for (const [name, t] of Object.entries(data.trims)) {
        const price = t?.price?.base || 0;
        if (price) trimsMeta[name] = price;
      }
    }

    if (updated[cid]) {
      // 기존 entry — title / trims / maker / model_root 만 catalog.json 기준 동기화
      // source/verified/encar 매핑은 보존 (수동으로 관리하는 데이터)
      const cur = updated[cid];
      let changed = false;
      const newTitle = data.title || cid;
      if (cur.title !== newTitle) { cur.title = newTitle; changed = true; }
      if (data.maker && cur.maker !== data.maker) { cur.maker = data.maker; changed = true; }
      if (data.model_root && cur.model_root !== data.model_root) { cur.model_root = data.model_root; changed = true; }
      if (data.year_start !== undefined && cur.year_start !== data.year_start) { cur.year_start = data.year_start || ''; changed = true; }
      if (data.year_end !== undefined && cur.year_end !== data.year_end) { cur.year_end = data.year_end || ''; changed = true; }
      // trims 비교 — 길이/내용 다르면 갱신
      const curTrims = Array.isArray(cur.trims) ? cur.trims : [];
      const trimsDiff = curTrims.length !== trimNames.length || curTrims.some((t, i) => t !== trimNames[i]);
      if (trimsDiff) { cur.trims = trimNames; changed = true; }
      // trims_meta 동기화 — 가격순 정렬용
      const curMeta = cur.trims_meta || {};
      const metaDiff = Object.keys(curMeta).length !== Object.keys(trimsMeta).length
        || Object.entries(trimsMeta).some(([k, v]) => curMeta[k] !== v);
      if (metaDiff) { cur.trims_meta = trimsMeta; changed = true; }
      if (changed) synced++;
      continue;
    }

    // 신규 entry
    updated[cid] = {
      id: cid,
      title: data.title || cid,
      maker: data.maker || '',
      model_root: data.model_root || '',
      year_start: data.year_start || '',
      year_end: data.year_end || '',
      source: {
        manufacturer: Array.isArray(data.source_urls) && data.source_urls[0] ? data.source_urls[0] : null,
        wikicar: null,
        encar: [],
      },
      verified: {
        manufacturer: false,
        wikicar: false,
        encar: false,
      },
      trims: trimNames,
      trims_meta: trimsMeta,
      fetched_at: data.fetched_at || new Date().toISOString().slice(0, 10),
    };
    added++;
    console.log(`+ ${cid} (${data.maker} | ${data.title})`);
  } catch (e) {
    console.warn(`⚠ ${f}: ${e.message}`);
  }
}

if (!added && !synced) {
  console.log('✓ _index.json 변경 없음 (모든 catalog entry 존재)');
  process.exit(0);
}

// 정렬 (alphabetical by id) + 저장
const sorted = {};
for (const k of Object.keys(updated).sort()) sorted[k] = updated[k];
fs.writeFileSync(INDEX_PATH, JSON.stringify(sorted, null, 2));
console.log(`\n✓ 추가 ${added}건, 동기화 ${synced}건 → _index.json 갱신`);
