#!/usr/bin/env node
/**
 * 카탈로그 완성도 분석 — trim 가격 / 옵션 데이터 / select_groups 갭 식별
 *
 * 출력: docs/catalog-coverage-report.md
 *  - 메이커별 카탈로그 수 / 평균 트림 / 가격 보유 트림 비율
 *  - 카탈로그별 갭 (가격 없는 trim, 옵션 0개 trim)
 *  - 우선순위 표 (영향력 = 매물수 + 트림수, 갭 = 가격/옵션 없는 비율)
 *
 * 사용법:
 *   node scripts/analyze-catalog-coverage.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const OUTPUT = path.join(__dirname, '..', 'docs', 'catalog-coverage-report.md');

function loadCatalogs() {
  const files = fs.readdirSync(CATALOG_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8');
    try {
      const data = JSON.parse(raw);
      return { file: f, data };
    } catch (e) {
      return { file: f, error: e.message };
    }
  });
}

function analyzeCatalog({ file, data, error }) {
  if (error) return { file, error };
  const trims = data.trims || {};
  const trimNames = Object.keys(trims);
  const trimCount = trimNames.length;

  // 가격 보유 트림 — price 가 객체이고 비어있지 않거나, 직접 숫자
  let trimsWithPrice = 0;
  let trimsWithOptions = 0;
  let totalSelectGroups = 0;
  let pricedSelectGroups = 0;

  for (const tn of trimNames) {
    const t = trims[tn];
    if (!t || typeof t !== 'object') continue;

    // 가격 — t.price (number) 또는 t.price (object with values) 또는 직접 number
    const priceVal = t.price;
    if (typeof priceVal === 'number' && priceVal > 0) trimsWithPrice++;
    else if (priceVal && typeof priceVal === 'object' && Object.values(priceVal).some(v => Number(v) > 0)) trimsWithPrice++;

    // 옵션 — t.basic / t.select / t.options 중 하나라도 비어있지 않으면
    const hasBasic = Array.isArray(t.basic) && t.basic.length > 0;
    const hasSelect = Array.isArray(t.select) && t.select.length > 0;
    const hasOptionsObj = t.options && typeof t.options === 'object' && Object.keys(t.options).length > 0;
    if (hasBasic || hasSelect || hasOptionsObj) trimsWithOptions++;

    // select_groups
    if (Array.isArray(t.select_groups)) {
      totalSelectGroups += t.select_groups.length;
      pricedSelectGroups += t.select_groups.filter(g => g && (g.price > 0)).length;
    }
  }

  const isStub = data.source === 'stub' || data.note?.includes('stub');

  return {
    file,
    catalogId: data.catalog_id || file.replace('.json', ''),
    title: data.title || '',
    maker: data.maker || '?',
    isStub,
    trimCount,
    trimsWithPrice,
    trimsWithOptions,
    totalSelectGroups,
    pricedSelectGroups,
    priceRatio: trimCount ? trimsWithPrice / trimCount : 0,
    optionRatio: trimCount ? trimsWithOptions / trimCount : 0,
    sgPriceRatio: totalSelectGroups ? pricedSelectGroups / totalSelectGroups : (totalSelectGroups === 0 ? 1 : 0),
  };
}

function makerSummary(rows) {
  const byMaker = new Map();
  for (const r of rows) {
    if (!r.maker || r.error) continue;
    if (!byMaker.has(r.maker)) byMaker.set(r.maker, []);
    byMaker.get(r.maker).push(r);
  }
  const out = [];
  for (const [maker, list] of byMaker.entries()) {
    const totalTrims = list.reduce((s, r) => s + r.trimCount, 0);
    const trimsPriced = list.reduce((s, r) => s + r.trimsWithPrice, 0);
    const trimsWithOpt = list.reduce((s, r) => s + r.trimsWithOptions, 0);
    out.push({
      maker,
      catalogCount: list.length,
      stubCount: list.filter(r => r.isStub).length,
      totalTrims,
      trimsPriced,
      trimsWithOpt,
      priceRatio: totalTrims ? trimsPriced / totalTrims : 0,
      optionRatio: totalTrims ? trimsWithOpt / totalTrims : 0,
    });
  }
  return out.sort((a, b) => b.totalTrims - a.totalTrims);
}

function pct(n) { return Math.round(n * 100) + '%'; }

function gapsByPriority(rows) {
  // 우선순위: 트림수 많고 (영향력) 가격/옵션 갭 큰 카탈로그
  return rows
    .filter(r => !r.error)
    .map(r => ({
      ...r,
      priceGap: r.trimCount - r.trimsWithPrice,
      optionGap: r.trimCount - r.trimsWithOptions,
      score: (r.trimCount - r.trimsWithPrice) * 2 + (r.trimCount - r.trimsWithOptions),
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function generateReport(rows) {
  const total = rows.length;
  const errors = rows.filter(r => r.error);
  const valid = rows.filter(r => !r.error);
  const stubs = valid.filter(r => r.isStub);
  const totalTrims = valid.reduce((s, r) => s + r.trimCount, 0);
  const trimsPriced = valid.reduce((s, r) => s + r.trimsWithPrice, 0);
  const trimsWithOpt = valid.reduce((s, r) => s + r.trimsWithOptions, 0);

  const lines = [];
  lines.push('# 카탈로그 완성도 보고서');
  lines.push('');
  lines.push(`> 생성: ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`);
  lines.push('');
  lines.push('## 요약');
  lines.push('');
  lines.push(`- **총 카탈로그**: ${total}개 ${errors.length ? `(파싱 실패 ${errors.length}개)` : ''}`);
  lines.push(`- **stub (옵션 미완)**: ${stubs.length}개`);
  lines.push(`- **총 트림**: ${totalTrims}개`);
  lines.push(`- **가격 있는 트림**: ${trimsPriced}/${totalTrims} (${pct(trimsPriced/totalTrims)})`);
  lines.push(`- **옵션 있는 트림**: ${trimsWithOpt}/${totalTrims} (${pct(trimsWithOpt/totalTrims)})`);
  lines.push('');

  // 메이커별
  lines.push('## 메이커별 통계');
  lines.push('');
  lines.push('| 메이커 | 카탈로그 | stub | 트림 | 가격% | 옵션% |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const m of makerSummary(valid)) {
    lines.push(`| ${m.maker} | ${m.catalogCount} | ${m.stubCount} | ${m.totalTrims} | ${pct(m.priceRatio)} | ${pct(m.optionRatio)} |`);
  }
  lines.push('');

  // 보강 우선순위
  lines.push('## OCR 보강 우선순위 TOP 30');
  lines.push('');
  lines.push('> score = 가격갭 × 2 + 옵션갭. 트림이 많고 갭이 큰 카탈로그가 상단.');
  lines.push('');
  lines.push('| 순위 | catalog_id | 트림 | 가격갭 | 옵션갭 | score |');
  lines.push('|---:|---|---:|---:|---:|---:|');
  const top = gapsByPriority(valid).slice(0, 30);
  top.forEach((r, i) => {
    lines.push(`| ${i+1} | ${r.catalogId} | ${r.trimCount} | ${r.priceGap} | ${r.optionGap} | ${r.score} |`);
  });
  lines.push('');

  // stub 목록
  if (stubs.length) {
    lines.push('## Stub 카탈로그 (옵션 데이터 없음)');
    lines.push('');
    lines.push('| catalog_id | maker | 트림수 |');
    lines.push('|---|---|---:|');
    for (const s of stubs.sort((a, b) => b.trimCount - a.trimCount)) {
      lines.push(`| ${s.catalogId} | ${s.maker} | ${s.trimCount} |`);
    }
    lines.push('');
  }

  // 완전 미스 (trim 0)
  const empty = valid.filter(r => r.trimCount === 0);
  if (empty.length) {
    lines.push('## 빈 카탈로그 (trim 0개)');
    lines.push('');
    for (const e of empty) lines.push(`- ${e.catalogId}`);
    lines.push('');
  }

  // 파싱 에러
  if (errors.length) {
    lines.push('## 파싱 실패');
    lines.push('');
    for (const e of errors) lines.push(`- ${e.file}: ${e.error}`);
    lines.push('');
  }

  return lines.join('\n');
}

const catalogs = loadCatalogs();
const rows = catalogs.map(analyzeCatalog);
const report = generateReport(rows);
fs.writeFileSync(OUTPUT, report);

const stubs = rows.filter(r => r.isStub).length;
const totalTrims = rows.filter(r => !r.error).reduce((s, r) => s + r.trimCount, 0);
const priced = rows.filter(r => !r.error).reduce((s, r) => s + r.trimsWithPrice, 0);
console.log(`✓ 카탈로그 ${rows.length}개 분석 완료`);
console.log(`  - stub ${stubs}개`);
console.log(`  - 트림 ${totalTrims}개 / 가격 ${priced}개 (${Math.round(priced/totalTrims*100)}%)`);
console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);
