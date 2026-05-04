#!/usr/bin/env node
/**
 * encar 매핑 데이터를 각 catalog json 의 aliases 필드로 이전.
 *  - 입력: _encar-catalog-map.json (이미 생성됨)
 *  - 결과: 각 catalog json 에 "aliases": ["..."] 필드 추가
 *
 * 1회 마이그레이션 — 이후 vehicle-matrix.js 는 catalog aliases 만 사용,
 * encar-master-seed.js 의존성 완전 제거.
 *
 * 사용:
 *   node scripts/migrate-aliases-to-catalogs.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const MAP_PATH = path.join(CATALOG_DIR, '_encar-catalog-map.json');

if (!fs.existsSync(MAP_PATH)) {
  console.error('⚠ _encar-catalog-map.json 없음. 먼저 build-encar-catalog-map.cjs 실행.');
  process.exit(1);
}

const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));

// catalog_id → set of aliases (sub_model 표기들)
const aliasesByCatalog = new Map();
for (const [key, catalogId] of Object.entries(map)) {
  // key 형식: "maker|sub_normalized" — sub 만 추출 (이미 정규화돼서 한글/영숫자 섞임)
  // 원본 표기를 복원할 수는 없으므로 정규화된 키 그대로 alias 로 저장
  // 매칭 시에도 normName 한 후 비교하므로 호환됨
  const sub = key.split('|', 2)[1] || '';
  if (!sub) continue;
  if (!aliasesByCatalog.has(catalogId)) aliasesByCatalog.set(catalogId, new Set());
  aliasesByCatalog.get(catalogId).add(sub);
}

// 각 catalog json 업데이트
let updated = 0;
let skipped = 0;
for (const [catalogId, aliasSet] of aliasesByCatalog.entries()) {
  const filePath = path.join(CATALOG_DIR, `${catalogId}.json`);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠ ${catalogId}.json 없음 — skip`);
    skipped++;
    continue;
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const newAliases = [...aliasSet].sort();
  // 이미 같은 aliases 있으면 skip
  const cur = Array.isArray(data.aliases) ? data.aliases : [];
  if (cur.length === newAliases.length && cur.every(a => newAliases.includes(a))) {
    skipped++;
    continue;
  }
  data.aliases = newAliases;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  updated++;
}

console.log(`✓ ${updated}개 catalog 업데이트, ${skipped}개 변경없음/누락`);
console.log('  이제 catalog json 의 aliases 필드만 사용 — encar-master-seed.js 의존 제거 가능');
