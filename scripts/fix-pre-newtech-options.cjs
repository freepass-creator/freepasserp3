#!/usr/bin/env node
/**
 * 페리 전 (~2020) catalog 의 trim.basic 에서 신기술 옵션 제거
 *   자동 분배 시 페리 후 옵션이 페리 전에 들어간 케이스 정정
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

const NEW_TECH_KEYWORDS = [
  '12.3인치', '12.3', '14.9', '14.5', '12.3 인치',
  'OTA', '무선업데이트', 'V2L', 'V2X',
  '디지털 키', '디지털키',
  '인텔리전트 속도', '지능형 속도',
  '리모트 스마트 파킹',
  'NCS', 'NCC',
];

let touchedCount = 0, removedTotal = 0;
for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const yearStart = d.year_start || '';
  const ym = yearStart.match(/(\d{4})/);
  const startYear = ym ? parseInt(ym[1]) : 0;
  // 페리 전 (~2020) 만 처리
  if (startYear === 0 || startYear > 2020) continue;

  const options = d.options || {};
  // 신기술 옵션 ID 식별
  const newTechIds = new Set();
  for (const [id, opt] of Object.entries(options)) {
    const name = opt.name || '';
    if (NEW_TECH_KEYWORDS.some(kw => name.includes(kw))) newTechIds.add(id);
  }
  if (!newTechIds.size) continue;

  // trim basic 에서 제거
  let removed = 0;
  for (const t of Object.values(d.trims || {})) {
    if (!Array.isArray(t.basic)) continue;
    const before = t.basic.length;
    t.basic = t.basic.filter(id => !newTechIds.has(id));
    removed += before - t.basic.length;
  }

  if (removed > 0) {
    fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n', 'utf8');
    touchedCount++;
    removedTotal += removed;
  }
}
console.log(`✓ ${touchedCount} catalog 정정 (${removedTotal} basic 옵션 제거)`);
