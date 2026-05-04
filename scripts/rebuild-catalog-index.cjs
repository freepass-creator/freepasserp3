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
const updated = { ...existing };

for (const f of files) {
  const cid = f.replace('.json', '');
  if (updated[cid]) continue;   // 이미 있음
  try {
    const data = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
    const trimNames = data.trims ? Object.keys(data.trims) : [];
    updated[cid] = {
      id: cid,
      title: data.title || cid,
      maker: data.maker || '',
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
      fetched_at: data.fetched_at || new Date().toISOString().slice(0, 10),
    };
    added++;
    console.log(`+ ${cid} (${data.maker} | ${data.title})`);
  } catch (e) {
    console.warn(`⚠ ${f}: ${e.message}`);
  }
}

if (!added) {
  console.log('✓ _index.json 변경 없음 (모든 catalog entry 존재)');
  process.exit(0);
}

// 정렬 (alphabetical by id) + 저장
const sorted = {};
for (const k of Object.keys(updated).sort()) sorted[k] = updated[k];
fs.writeFileSync(INDEX_PATH, JSON.stringify(sorted, null, 2));
console.log(`\n✓ ${added}개 entry 추가 → _index.json 갱신`);
