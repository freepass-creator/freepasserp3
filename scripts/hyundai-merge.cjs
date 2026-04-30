/**
 * 같은 차종(catalog_id)의 여러 variant fragment를 1개 JSON으로 머지
 *
 * 사용:
 *   node hyundai-merge.cjs <catalog_id> <title> <var1.html> <var1-suffix> [<var2.html> <var2-suffix>...]
 *
 * 예:
 *   node hyundai-merge.cjs hyundai_palisade_lx3 "현대 디 올 뉴 팰리세이드 (LX3)" \
 *     ./_pal_g25.html "(7인승)" \
 *     ./_pal_g25_9.html "(9인승)"
 *
 * 출력: public/data/car-master/<catalog_id>.json
 *   { catalog_id, title, maker, source, source_urls[], fetched_at, categories, options, trims }
 */

const fs = require('fs');
const path = require('path');
const { parseHyundaiPriceContent } = require('./hyundai-parse.cjs');

function merge(catalogId, title, fragments) {
  const merged = {
    catalog_id: catalogId,
    title,
    maker: title.split(' ')[0] || '현대', // 첫 단어를 maker로 추정 (수동 보정 필요시 별도)
    source: 'hyundai_official',
    source_urls: [],
    fetched_at: new Date().toISOString().slice(0, 10),
    categories: {},
    options: {},
    trims: {}
  };

  fragments.forEach(({ html, suffix, source_url }) => {
    const r = parseHyundaiPriceContent(html, { source_url });
    if (source_url) merged.source_urls.push(source_url);

    Object.entries(r.options).forEach(([code, info]) => {
      if (!merged.options[code]) merged.options[code] = info;
    });

    Object.entries(r.trims).forEach(([trimName, t]) => {
      const key = suffix ? `${trimName} ${suffix}` : trimName;
      // 충돌 시 첫 항목 우선 (장애인용 변형 7개 같이 동일 라벨로 수렴 케이스 안정성)
      if (!merged.trims[key]) merged.trims[key] = t;
    });
  });

  // 카테고리 재구축
  Object.entries(merged.options).forEach(([code, info]) => {
    merged.categories[info.category] = merged.categories[info.category] || [];
    merged.categories[info.category].push(code);
  });

  return merged;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4 || (args.length - 2) % 2 !== 0) {
    console.error('usage: node hyundai-merge.cjs <catalog_id> <title> <html1> <suffix1> [<html2> <suffix2>...]');
    process.exit(1);
  }
  const [catalogId, title, ...rest] = args;
  const fragments = [];
  for (let i = 0; i < rest.length; i += 2) {
    fragments.push({
      html: fs.readFileSync(rest[i], 'utf8'),
      suffix: rest[i + 1],
      source_url: null
    });
  }
  const result = merge(catalogId, title, fragments);
  const outDir = 'public/data/car-master';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${catalogId}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log('wrote:', out);
  console.log('  trims:', Object.keys(result.trims).length);
  console.log('  options:', Object.keys(result.options).length);
  console.log('  categories:', Object.keys(result.categories).length);
  Object.entries(result.trims).forEach(([n, t]) => {
    console.log(`  ${n}: basic=${t.basic.length} select=${t.select.length}`);
  });
}

module.exports = { merge };
