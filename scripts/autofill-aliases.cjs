#!/usr/bin/env node
/**
 * catalog aliases 자동 보강
 *   미매칭 매물 sub 와 catalog title (모델명 키워드 매칭) 으로 alias 추가
 *   2017+ 매물만 처리, 한국 단종 정책 외는 skip
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const aliases = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, '_aliases-map.json'), 'utf8'));
const seedRaw = fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'encar-master-seed.js'), 'utf8');
const encar = JSON.parse(seedRaw.replace(/^window\.ENCAR_MASTER\s*=\s*/, '').replace(/;\s*$/, ''));

const norm = s => (s||'').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g,'').replace(/\s+/g,'');

// catalog 별 모델명 키워드 추출 (title 에서 메이커 + 모델명)
const catalogs = {};
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const id = d.catalog_id || f.replace(/\.json$/, '');
  catalogs[id] = { d, fp, maker: d.maker, title: d.title || '' };
}

// title → 모델명 키워드 추출 (메이커 제거)
function titleKey(title, maker) {
  return norm(title.replace(maker, '').replace(/^\s*[현대|기아|제네시스|벤츠|BMW|아우디|테슬라|볼보|포르쉐]\s*/, '').trim());
}

let added = 0;
const addedByCatalog = {};
const stillMissed = [];

for (const e of encar) {
  if (e.archived || !e.sub) continue;
  const y = parseInt((e.production_start||'').match(/(\d{4})/)?.[1] || 0);
  if (y && y < 2017) continue;
  const key = e.maker + '|' + norm(e.sub);
  if (aliases[key]) continue; // 이미 매칭

  // 같은 메이커 catalog 들 중 title 매칭
  const subNorm = norm(e.sub);
  const candidates = Object.values(catalogs).filter(c => c.maker === e.maker);
  let bestMatch = null;
  let bestScore = 0;
  for (const c of candidates) {
    const tKey = titleKey(c.title, c.maker);
    if (!tKey) continue;
    // 양방향 부분 매칭 — 둘 중 하나가 다른 하나에 포함
    if (subNorm.includes(tKey) || tKey.includes(subNorm)) {
      const score = Math.min(subNorm.length, tKey.length);
      if (score > bestScore) { bestScore = score; bestMatch = c; }
    }
  }
  if (bestMatch && bestScore >= 3) {
    // alias 추가
    const aliasKey = norm(e.sub);
    bestMatch.d.aliases = bestMatch.d.aliases || [];
    if (!bestMatch.d.aliases.includes(aliasKey)) {
      bestMatch.d.aliases.push(aliasKey);
      added++;
      addedByCatalog[bestMatch.d.catalog_id] = (addedByCatalog[bestMatch.d.catalog_id] || 0) + 1;
    }
  } else {
    stillMissed.push({ maker: e.maker, sub: e.sub });
  }
}

// catalog 저장
for (const c of Object.values(catalogs)) {
  if (addedByCatalog[c.d.catalog_id]) {
    fs.writeFileSync(c.fp, JSON.stringify(c.d, null, 2) + '\n', 'utf8');
  }
}

console.log(`✓ ${added} alias 추가 (${Object.keys(addedByCatalog).length} catalog)`);
console.log(`  남은 미매칭 (alias 추가 못함): ${stillMissed.length}`);
if (Object.keys(addedByCatalog).length) {
  Object.entries(addedByCatalog).sort((a,b)=>b[1]-a[1]).slice(0, 15).forEach(([id, n]) => {
    console.log(`  ${id.padEnd(40)} +${n}`);
  });
}
