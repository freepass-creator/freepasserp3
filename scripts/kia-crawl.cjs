/**
 * 기아 차종 일괄 크롤러
 *
 * 현대와 달리 기아는 1 모델 = 1 price 페이지에 모든 트림 포함.
 * https://www.kia.com/kr/vehicles/<slug>/price
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseKiaPriceContent } = require('./kia-parse.cjs');

const CACHE_DIR = '_cache/kia';
const OUT_DIR = 'public/data/car-master';
const INDEX_FILE = path.join(OUT_DIR, '_index.json');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (catalog-builder)' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `https://www.kia.com${loc}`;
        return fetchHtml(next).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode} for ${url}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function fetchCached(url, cacheKey) {
  ensureDir(CACHE_DIR);
  const cachePath = path.join(CACHE_DIR, cacheKey);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, 'utf8');
  const html = await fetchHtml(url);
  fs.writeFileSync(cachePath, html);
  return html;
}

function loadIndex() {
  ensureDir(OUT_DIR);
  if (fs.existsSync(INDEX_FILE)) return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  return {};
}

function saveIndex(idx) {
  ensureDir(OUT_DIR);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
}

async function crawlOne(catalogId, slug, title, encarKeys) {
  console.log(`\n=== ${catalogId} (slug: ${slug}) ===`);
  const url = `https://www.kia.com/kr/vehicles/${slug}/price`;
  let html;
  try {
    html = await fetchCached(url, `${slug}_price.html`);
  } catch (e) {
    console.error(`  ✗ ${slug} price 페이지 실패: ${e.message}`);
    return null;
  }
  const result = parseKiaPriceContent(html, { catalog_id: catalogId, title, source_url: url });
  if (Object.keys(result.trims).length === 0) {
    console.error(`  ✗ ${slug}: 트림 추출 실패`);
    return null;
  }
  ensureDir(OUT_DIR);
  const out = path.join(OUT_DIR, `${catalogId}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  // 인덱스 갱신
  const idx = loadIndex();
  idx[catalogId] = {
    id: catalogId,
    title,
    maker: '기아',
    source: { manufacturer: url, wikicar: null, encar: encarKeys || [] },
    verified: { manufacturer: true, wikicar: false, encar: (encarKeys||[]).length > 0 },
    trims: Object.keys(result.trims),
    fetched_at: result.fetched_at
  };
  saveIndex(idx);
  console.log(`  → ${out}`);
  console.log(`     trims=${Object.keys(result.trims).length} options=${Object.keys(result.options).length}`);
  return result;
}

async function crawlAll() {
  const models = require('./kia-models.cjs');
  const summary = { ok: [], fail: [] };
  for (const [catalogId, slug, title, encarKeys] of models) {
    try {
      const r = await crawlOne(catalogId, slug, title, encarKeys);
      (r ? summary.ok : summary.fail).push(catalogId);
    } catch (e) {
      console.error(`✗ ${catalogId}: ${e.message}`);
      summary.fail.push(catalogId);
    }
  }
  console.log('\n========== KIA SUMMARY ==========');
  console.log(`✓ ${summary.ok.length}/${models.length}:`, summary.ok.join(', '));
  if (summary.fail.length) console.log(`✗ ${summary.fail.length}:`, summary.fail.join(', '));
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === 'all' || !arg) {
    crawlAll();
  } else {
    const models = require('./kia-models.cjs');
    const target = models.find(m => m[0] === arg || m[1] === arg);
    if (!target) {
      console.error('not found:', arg);
      process.exit(1);
    }
    crawlOne(...target);
  }
}

module.exports = { crawlOne, crawlAll };
