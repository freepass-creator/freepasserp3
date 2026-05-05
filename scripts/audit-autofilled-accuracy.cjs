#!/usr/bin/env node
/**
 * 자동 분배 catalog 의 옵션 정확도 검증
 *   - 페리 전/세대 분기 catalog 가 페리 후 옵션 그대로 받음
 *   - 페리 전에는 없을 옵션 (예: 신기술/EV 옵션) 이 들어갔을 가능성
 *
 *   검증:
 *   1. 자동 분배 catalog (autofill-from-family 처리됨) 식별
 *   2. catalog 의 trim basic 안 옵션 ID 의 카테고리/이름 분석
 *   3. 페리 후 자료 (예: 2024 신기술) 가 페리 전 (2018) 에 들어갔는지 확인
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

// 신기술 키워드 — 페리 전 (2017-2020) 에 잘 안 들어갈 옵션
const NEW_TECH_KEYWORDS = [
  '12.3인치', '12.3', '14.9', '14.5', '12.3 인치', // 디스플레이 신형
  'OTA', '무선업데이트', 'V2L', 'V2X',  // 신기술
  '디지털 키', '디지털키',  // 2022+
  '인텔리전트 속도', '지능형 속도',  // 2022+
  '리모트 스마트 파킹', // 2022+
  'NCS', 'NCC',  // 신형 CCS
];

const issues = [];
for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const id = d.catalog_id || f.replace(/\.json$/, '');
  const yearStart = d.year_start || '';
  const ym = yearStart.match(/(\d{4})/);
  const startYear = ym ? parseInt(ym[1]) : 0;

  // 페리 전 (~2020) catalog 만 점검
  if (startYear === 0 || startYear > 2020) continue;

  const options = d.options || {};
  const newTechFound = [];
  for (const [optId, opt] of Object.entries(options)) {
    const name = opt.name || '';
    for (const kw of NEW_TECH_KEYWORDS) {
      if (name.includes(kw)) {
        newTechFound.push({ optId, name, kw });
        break;
      }
    }
  }

  if (newTechFound.length > 0) {
    // trim basic 에 신기술 옵션이 들어갔는지
    let trimsWithNewTech = 0;
    for (const [trimName, t] of Object.entries(d.trims || {})) {
      const basicSet = new Set(t.basic || []);
      if (newTechFound.some(nf => basicSet.has(nf.optId))) trimsWithNewTech++;
    }
    if (trimsWithNewTech > 0) {
      issues.push({
        id,
        title: d.title,
        year: yearStart,
        newTechCount: newTechFound.length,
        trimsAffected: trimsWithNewTech,
        sample: newTechFound.slice(0, 3).map(nf => `${nf.name}(${nf.kw})`),
      });
    }
  }
}

console.log(`━━━ 자동 분배 정확도 검증 ━━━`);
console.log(`페리 전 (~2020) catalog 중 신기술 옵션 의심: ${issues.length}\n`);

const lines = [];
lines.push('# 자동 분배 옵션 정확도 보고서');
lines.push('');
lines.push(`> 생성: ${new Date().toISOString().slice(0,16).replace('T',' ')}`);
lines.push(`> 페리 전 (~2020) catalog 중 신기술 옵션 (페리 후에서 가져왔을 가능성) 의심`);
lines.push('');

if (issues.length) {
  lines.push('| catalog | title | year | trims 영향 | 의심 옵션 sample |');
  lines.push('|---|---|---|---:|---|');
  issues.sort((a,b) => b.trimsAffected - a.trimsAffected).forEach(i => {
    lines.push(`| ${i.id} | ${i.title} | ${i.year} | ${i.trimsAffected} | ${i.sample.join(' / ')} |`);
  });
} else {
  lines.push('의심 catalog 없음 ✓');
}

const OUTPUT = path.join(__dirname, '..', 'docs', 'autofilled-accuracy.md');
fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');

issues.slice(0, 10).forEach(i => {
  console.log(`  ${i.id.padEnd(38)} ${i.year} | ${i.trimsAffected} trims | ${i.sample[0]}`);
});
console.log(`\n  → ${path.relative(process.cwd(), OUTPUT)}`);
