#!/usr/bin/env node
/**
 * 페리 후 / 2024+ 한국 OEM catalog 에 무선 Apple CarPlay & Android Auto 옵션 자동 추가.
 *  - catalog title 에 페리 prefix ("더 뉴" / "디 올 뉴" / "올 뉴") 또는 year_start >= 2024 catalog 대상
 *  - 옵션 사전에 신규 entry "무선 Apple CarPlay & Android Auto" 추가 (fp_ids: MIRRORING_WIRELESS)
 *  - 모든 trim basic 에 추가 (한국 OEM 페리 후 모델은 모든 트림 표준)
 *  - 단일 동력원 catalog (하이브리드/EV) 동일 적용
 *
 *  사용:
 *    node scripts/add-wireless-mirroring-modern.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const FACELIFT_PREFIX = /^(현대|기아|제네시스|KGM)\s+(디\s*올\s*뉴|올\s*뉴|더\s*뉴)\s+/;

function shouldApply(d) {
  // catalog 가 페리 후 (페리 prefix) 또는 year_start >= 2024
  const title = d.title || '';
  if (FACELIFT_PREFIX.test(title)) {
    // 페리 모델인데 출시 시기 너무 옛날 (2020 이하) 은 제외
    const ys = d.year_start || '';
    if (ys && ys < '2022-01') return false;
    return true;
  }
  if ((d.year_start || '') >= '2024-01') return true;
  return false;
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalAdded = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  if (!shouldApply(d)) continue;
  // 이미 catalog 에 무선 미러링 옵션 있는지 확인
  const hasWireless = Object.values(d.options || {}).some(info =>
    /(무선\s*Apple\s*CarPlay|무선\s*Android\s*Auto|Wireless\s*CarPlay|무선\s*카플레이)/i.test(info?.name || '')
    || (info?.fp_ids || []).includes('MIRRORING_WIRELESS')
  );
  if (hasWireless) continue;
  // 메이커 prefix 별 코드 부여
  const codePrefix = { '현대': 'HMC', '기아': 'KIA', '제네시스': 'GEN', 'KGM': 'KGM' }[d.maker] || 'OPT';
  let code = `${codePrefix}_WIRELESS_MIRRORING`;
  let suffix = 1;
  while (d.options[code]) code = `${codePrefix}_WIRELESS_MIRRORING_${++suffix}`;
  d.options[code] = {
    name: '무선 Apple CarPlay & Android Auto',
    category: '인포테인먼트',
    fp_ids: ['MIRRORING_WIRELESS'],
  };
  if (!d.categories) d.categories = {};
  if (!d.categories['인포테인먼트']) d.categories['인포테인먼트'] = [];
  d.categories['인포테인먼트'].push(code);
  // 모든 trim basic 에 추가 (한국 OEM 페리 후 표준)
  for (const t of Object.values(d.trims || {})) {
    if (!Array.isArray(t.basic)) t.basic = [];
    if (!t.basic.includes(code)) t.basic.push(code);
  }
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} (${d.year_start})`);
  touched++;
  totalAdded++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 무선 미러링 옵션 추가`);
