#!/usr/bin/env node
/**
 * 트림별 옵션 풍부도 감사
 *   - 각 catalog 의 trim 들이 basic 옵션을 보유하는지
 *   - basic 0 또는 select_groups 0 인 trim 식별
 *   - work queue (인기 메이커) 만 대상
 *
 * 출력: docs/trim-options-audit.md
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const OUTPUT = path.join(__dirname, '..', 'docs', 'trim-options-audit.md');

const POPULAR = {
  '현대': ['grandeur','sonata','avante','santa_fe','santafe','tucson','kona','palisade','casper','ioniq','staria'],
  '기아': ['carnival','sorento','sportage','k5','k8','seltos','niro','ev6','ev9','morning','ray'],
  '제네시스': ['g70','g80','g90','gv60','gv70','gv80'],
  'KGM': ['torres','korando','tivoli','actyon'],
};
const isPopular = (maker, id) => (POPULAR[maker]||[]).some(k => id.includes(k));

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

const data = files.map(f => {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const id = d.catalog_id || f.replace(/\.json$/, '');
  const trims = d.trims || {};
  const trimNames = Object.keys(trims);
  const empties = trimNames.filter(n => {
    const t = trims[n];
    return (!t.basic || t.basic.length === 0) && (!t.select_groups || t.select_groups.length === 0);
  });
  const partial = trimNames.filter(n => {
    const t = trims[n];
    const b = (t.basic || []).length;
    return b > 0 && b < 30;
  });
  return {
    id,
    title: d.title || '',
    maker: d.maker || '',
    trimCount: trimNames.length,
    emptyCount: empties.length,
    partialCount: partial.length,
    avgBasic: trimNames.length ? Math.round(trimNames.reduce((s, n) => s + (trims[n].basic||[]).length, 0) / trimNames.length) : 0,
    isPopular: isPopular(d.maker, id),
    emptyTrims: empties,
    yearStart: d.year_start || '',
  };
});

const popular = data.filter(d => d.isPopular && /^(현대|기아|제네시스|KGM)$/.test(d.maker));
// 2017 이전 빼기
const filtered = popular.filter(d => {
  const m = (d.yearStart || '').match(/(\d{4})/);
  if (!m) return true;
  return parseInt(m[1]) >= 2017;
});

filtered.sort((a, b) => b.emptyCount - a.emptyCount || b.trimCount - a.trimCount);

const lines = [];
lines.push('# 트림별 옵션 풍부도 감사');
lines.push('');
lines.push(`> 생성: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
lines.push(`> 인기 한국 메이커 catalog (생산 2017+) ${filtered.length}개 대상`);
lines.push('');

lines.push('## 옵션 빈 trim 보유 catalog');
lines.push('');
lines.push('| catalog | title | 메이커 | 트림 | 빈옵션 | 부분 | 평균 basic |');
lines.push('|---|---|---|---:|---:|---:|---:|');
filtered.forEach(d => {
  const flag = d.emptyCount === d.trimCount ? '🔴' : d.emptyCount > 0 ? '🟡' : d.avgBasic >= 50 ? '🟢' : '🟢';
  if (d.emptyCount > 0 || d.avgBasic < 30) {
    lines.push(`| ${flag} ${d.id} | ${d.title} | ${d.maker} | ${d.trimCount} | ${d.emptyCount} | ${d.partialCount} | ${d.avgBasic} |`);
  }
});

lines.push('');
lines.push('## 옵션 충실한 catalog (참고)');
lines.push('');
lines.push(`평균 basic ≥ 30 + 빈 옵션 0 인 catalog: ${filtered.filter(d => d.emptyCount === 0 && d.avgBasic >= 30).length}개`);

fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');

const fullStub = filtered.filter(d => d.emptyCount === d.trimCount).length;
const partialStub = filtered.filter(d => d.emptyCount > 0 && d.emptyCount < d.trimCount).length;
const fullOk = filtered.filter(d => d.emptyCount === 0 && d.avgBasic >= 30).length;

console.log(`✓ 인기 한국 catalog (2017+): ${filtered.length}개`);
console.log(`  🔴 모든 trim 빈옵션: ${fullStub}개`);
console.log(`  🟡 일부 trim 빈옵션:  ${partialStub}개`);
console.log(`  🟢 옵션 충실:         ${fullOk}개`);
console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);
