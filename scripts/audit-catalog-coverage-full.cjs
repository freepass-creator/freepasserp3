#!/usr/bin/env node
/**
 * catalog 전수검수 — 모델/트림 커버리지 audit + 마크다운 보고서 생성.
 *
 * 출력: docs/catalog-coverage.md
 *  Section A: 인기차종 매트릭스 (메이커 × 모델 × 페리 × fuel)
 *    - 빈 칸 = 누락 stub 후보
 *  Section B: 트림 가격 누락 (catalog 있는데 trims_meta 비어있는 케이스)
 *  Section C: 페리 분리 모호 (year_start ~ year_end 가 페리 시점 걸치는 catalog)
 */
const fs = require('fs');
const path = require('path');

const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_index.json'), 'utf8'));
const all = Object.values(idx);

function isHybrid(t) { return /하이브리드|hev|hybrid/i.test(t || ''); }
function isEV(t) { return /일렉트리파이드|electrified|일렉트릭|electric|\bev\b|아이오닉|ioniq|ix\d|\beq[a-z]/i.test(t || ''); }
function isPeri(c) { return /^(?!.*올\s*뉴)(?:더\s*뉴|더\s*뉴\s)/.test((c.title || '').replace(c.maker + ' ', '')); }
function chassisOf(c) {
  const t = (c.title || '').replace(c.maker + ' ', '').replace(/하이브리드|hybrid/gi, '').trim();
  const tokens = t.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^[A-Z][A-Z0-9]+$/.test(tokens[i])) return tokens[i];
  }
  return '';
}
function trimMetaCount(c) {
  const meta = c.trims_meta || {};
  return Object.keys(meta).length;
}
function totalTrims(c) {
  return Array.isArray(c.trims) ? c.trims.length : 0;
}

// (maker, model_root) → catalogs
const byModel = new Map();
for (const c of all) {
  if (!c.maker || !c.model_root) continue;
  const k = `${c.maker}|${c.model_root}`;
  if (!byModel.has(k)) byModel.set(k, []);
  byModel.get(k).push(c);
}

// 인기 메이커
const POPULAR_MAKERS = ['현대', '기아', '제네시스', 'KGM', '쉐보레'];

const lines = [];
lines.push('# Catalog 전수검수 보고서');
lines.push(`\n*generated: ${new Date().toISOString().slice(0, 10)} — total ${all.length} catalogs*\n`);

// === Section A — 인기차종 매트릭스 ===
lines.push('## A. 인기차종 매트릭스 (페리 × fuel)\n');
lines.push('컬럼: 페리 전 가솔린 / 페리 전 하이브리드 / 페리 전 EV / 페리 후 가솔린 / 페리 후 하이브리드 / 페리 후 EV\n');
lines.push('범례: ✓ 있음 / · 없음 (해당 없거나 누락) / ⚠ stub (가격 데이터 0)\n');

for (const mk of POPULAR_MAKERS) {
  const models = [...byModel.entries()]
    .filter(([k]) => k.startsWith(mk + '|'))
    .map(([k, list]) => ({ model: k.split('|')[1], list }))
    .sort((a, b) => a.model.localeCompare(b.model, 'ko'));
  if (!models.length) continue;
  lines.push(`### ${mk}\n`);
  lines.push('| 모델 | 전·가솔린 | 전·하이브리드 | 전·EV | 후·가솔린 | 후·하이브리드 | 후·EV |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const { model, list } of models) {
    const cells = [model];
    for (const peri of [false, true]) {
      for (const fuel of ['gasoline', 'hybrid', 'ev']) {
        const matched = list.filter(c => {
          if (isPeri(c) !== peri) return false;
          if (fuel === 'hybrid') return isHybrid(c.title);
          if (fuel === 'ev') return isEV(c.title) && !isHybrid(c.title);
          return !isHybrid(c.title) && !isEV(c.title);
        });
        if (!matched.length) cells.push('·');
        else if (matched.every(c => trimMetaCount(c) === 0)) cells.push('⚠');
        else cells.push('✓');
      }
    }
    lines.push('| ' + cells.join(' | ') + ' |');
  }
  lines.push('');
}

// === Section B — 트림 가격 누락 ===
lines.push('\n## B. 트림 가격 누락 catalog (trims_meta 비어있음)\n');
lines.push('catalog 자체는 있는데 trim별 가격 정보가 없는 stub. 보강 필요.\n');
lines.push('| catalog_id | title | trims | 가격 |');
lines.push('|---|---|---|---|');
const noTrimMeta = all.filter(c => totalTrims(c) > 0 && trimMetaCount(c) === 0);
const popularNoMeta = noTrimMeta.filter(c => POPULAR_MAKERS.includes(c.maker));
popularNoMeta.sort((a, b) => (b.year_start || '').localeCompare(a.year_start || ''));
for (const c of popularNoMeta) {
  lines.push(`| ${c.id} | ${c.title} | ${totalTrims(c)} | 0 |`);
}
lines.push(`\n총 ${popularNoMeta.length}개 (인기 메이커) / 전체 ${noTrimMeta.length}개`);

// === Section C — 페리 분리 모호 ===
lines.push('\n\n## C. 페리 전/후 분리 모호 (year_start~year_end 가 페리 시기 걸침 의심)\n');
lines.push('동일 (maker, model_root) 안에 페리 후 catalog 가 별도로 있는지 확인 필요.\n');
const ambiguous = [];
for (const c of all) {
  if (!POPULAR_MAKERS.includes(c.maker)) continue;
  const ys = c.year_start || '';
  const ye = c.year_end || '';
  if (!ys) continue;
  // year_start ~ year_end 가 4년 이상이고 페리 catalog 가 동일 모델에 없으면 의심
  const yearsSpan = (ye === '현재' || !ye) ? 99 : (parseInt(ye.slice(0, 4)) - parseInt(ys.slice(0, 4)));
  if (yearsSpan < 4) continue;
  const k = `${c.maker}|${c.model_root}`;
  const sibs = byModel.get(k) || [];
  const ch = chassisOf(c);
  if (!ch) continue;
  // 같은 chassis 의 페리 catalog 가 있는지
  const hasFacelift = sibs.some(s => s.id !== c.id && chassisOf(s) === ch && isPeri(s));
  if (!hasFacelift && !isPeri(c)) {
    ambiguous.push({ c, ch });
  }
}
lines.push('| catalog_id | title | chassis | 연식 |');
lines.push('|---|---|---|---|');
for (const { c, ch } of ambiguous) {
  lines.push(`| ${c.id} | ${c.title} | ${ch} | ${c.year_start} ~ ${c.year_end || '-'} |`);
}
lines.push(`\n총 ${ambiguous.length}건 (인기 메이커, 4년+ 동일 catalog)`);

// 저장
const outPath = path.join(__dirname, '..', 'docs', 'catalog-coverage.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ ${path.relative(process.cwd(), outPath)} 생성`);
console.log(`  - 인기 메이커 ${POPULAR_MAKERS.length}개`);
console.log(`  - 트림 가격 누락 ${popularNoMeta.length}/${noTrimMeta.length}건`);
console.log(`  - 페리 분리 모호 ${ambiguous.length}건`);
