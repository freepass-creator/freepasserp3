#!/usr/bin/env node
/**
 * auto-enrich-aliases — 매트릭스 분석 결과로 catalog aliases 자동 보강
 *
 *   입력: dev.js 매트릭스 탭에서 export 한 matrix-analysis JSON
 *   출력: catalog json 의 aliases 필드에 신규 alias 추가 (또는 dry-run)
 *
 *   안전장치:
 *     - high/medium confidence 매칭 매물만 신뢰 (low/none 무시)
 *     - 정규화 후 중복 제거
 *     - 한 alias 후보가 여러 catalog 에 등장하면 충돌로 표시 (자동 추가 X)
 *     - dry-run default — --apply 로 실제 적용
 *     - 적용 시 catalog 파일 백업 (.backup-YYYYMMDD)
 *
 *   사용:
 *     node scripts/auto-enrich-aliases.cjs <matrix-analysis.json>             # dry-run
 *     node scripts/auto-enrich-aliases.cjs <matrix-analysis.json> --apply    # 실제 적용
 */
const fs = require('fs');
const path = require('path');

const ARG = process.argv.slice(2);
const APPLY = ARG.includes('--apply');
const INPUT = ARG.find(a => !a.startsWith('--'));

if (!INPUT || !fs.existsSync(INPUT)) {
  console.error('사용: node scripts/auto-enrich-aliases.cjs <matrix-analysis.json> [--apply]');
  console.error('예시: node scripts/auto-enrich-aliases.cjs C:/Users/admin/Downloads/matrix-analysis-20260505.json');
  process.exit(1);
}

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');

function normName(s) {
  return (s || '')
    .replace(/[\(\)\[\]\-_\/\.,&\+°]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

// === 입력 데이터 로드 ===
const matrix = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
console.log(`✓ 매트릭스 분석 결과 ${matrix.length} 매물 로드`);

// === catalog 별 신규 alias 후보 수집 ===
// catalog_id → { existingAliases: Set, candidates: Map<normedAlias, { display, count, samples }> }
const enrichByCatalog = {};

// 충돌 감지용: normedAlias → Set<catalogId>
const aliasToCatalogs = {};

let acceptedCount = 0;
let rejectedCount = 0;

for (const item of matrix) {
  const r = item.result;
  if (!r?.ok) { rejectedCount++; continue; }
  // high/medium 만 신뢰. low/none 은 학습 데이터로 안 씀.
  if (r.confidence !== 'high' && r.confidence !== 'medium') { rejectedCount++; continue; }
  const cid = r.catalogId;
  if (!cid) { rejectedCount++; continue; }
  const sub = (item.sub_model || '').trim();
  if (!sub || sub.length < 2) { rejectedCount++; continue; }

  acceptedCount++;
  if (!enrichByCatalog[cid]) enrichByCatalog[cid] = { candidates: new Map() };
  const normed = normName(sub);
  if (!normed) continue;

  const e = enrichByCatalog[cid];
  if (!e.candidates.has(normed)) {
    e.candidates.set(normed, { display: sub, count: 0, samples: [] });
  }
  const c = e.candidates.get(normed);
  c.count++;
  if (c.samples.length < 3) c.samples.push(item.car_number || '?');

  if (!aliasToCatalogs[normed]) aliasToCatalogs[normed] = new Set();
  aliasToCatalogs[normed].add(cid);
}

console.log(`  신뢰 매물 ${acceptedCount} / 거부 ${rejectedCount} (low/none/sub 없음)`);

// === catalog json 로드해서 기존 aliases 가져오고 신규만 필터 ===
const totalChanges = [];
const conflictAliases = new Set();

for (const [cid, info] of Object.entries(enrichByCatalog)) {
  const catalogPath = path.join(CATALOG_DIR, `${cid}.json`);
  if (!fs.existsSync(catalogPath)) continue;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const existing = Array.isArray(catalog.aliases) ? catalog.aliases : [];
  const existingNormed = new Set(existing.map(a => normName(a)));
  // catalog title 자체도 alias 같은 매칭이라 등록 안 해도 됨
  const titleNormed = normName(catalog.title || '');
  const titleNoMakerNormed = normName((catalog.title || '').replace(new RegExp('^' + (catalog.maker || '') + '\\s+'), ''));

  const newAliases = [];
  for (const [normed, c] of info.candidates) {
    if (existingNormed.has(normed)) continue;       // 이미 있음
    if (normed === titleNormed) continue;           // catalog.title 그대로
    if (normed === titleNoMakerNormed) continue;    // catalog.title 의 sub 부분 그대로
    if (aliasToCatalogs[normed]?.size > 1) {
      conflictAliases.add(`${c.display} → ${[...aliasToCatalogs[normed]].join(', ')}`);
      continue;  // 충돌 — 수동 검토
    }
    newAliases.push({ display: c.display, count: c.count, samples: c.samples });
  }

  if (newAliases.length === 0) continue;

  totalChanges.push({
    catalogId: cid,
    title: catalog.title,
    existing: existing.length,
    newAliases,
  });
}

// === dry-run 출력 ===
console.log('\n=== 신규 alias 추가 후보 ===');
totalChanges
  .sort((a, b) => b.newAliases.length - a.newAliases.length)
  .forEach(t => {
    console.log(`\n[${t.catalogId}] ${t.title}  (기존 ${t.existing}개 → +${t.newAliases.length})`);
    t.newAliases
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .forEach(a => {
        const samp = a.samples.join(', ');
        console.log(`  + "${a.display}"  ×${a.count}  (예: ${samp})`);
      });
    if (t.newAliases.length > 8) {
      console.log(`  ... 외 ${t.newAliases.length - 8}개`);
    }
  });

console.log('\n=== 요약 ===');
console.log(`  alias 추가될 catalog: ${totalChanges.length}개`);
console.log(`  신규 alias 총: ${totalChanges.reduce((s, t) => s + t.newAliases.length, 0)}개`);
if (conflictAliases.size) {
  console.log(`  ⚠ 충돌 (자동 추가 X): ${conflictAliases.size}건`);
  [...conflictAliases].slice(0, 10).forEach(c => console.log(`     - ${c}`));
  if (conflictAliases.size > 10) console.log(`     ... 외 ${conflictAliases.size - 10}건`);
}

// === apply 모드 — catalog json 갱신 ===
if (!APPLY) {
  console.log('\n[dry-run] 실제 적용은 --apply 추가');
  process.exit(0);
}

// 백업 폴더
const backupDir = path.join(CATALOG_DIR, `_backup-${STAMP}`);
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
console.log(`\n백업 폴더: ${backupDir}`);

let writtenCount = 0;
for (const t of totalChanges) {
  const catalogPath = path.join(CATALOG_DIR, `${t.catalogId}.json`);
  const backupPath = path.join(backupDir, `${t.catalogId}.json`);
  // 백업
  fs.copyFileSync(catalogPath, backupPath);
  // 갱신
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  catalog.aliases = catalog.aliases || [];
  for (const a of t.newAliases) {
    catalog.aliases.push(a.display);
  }
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
  writtenCount++;
}

console.log(`✓ ${writtenCount}개 catalog 갱신 완료`);
console.log(`다음 단계: npm run build:car-master`);
