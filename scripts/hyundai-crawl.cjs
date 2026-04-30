/**
 * 현대 차종 일괄 크롤러
 *
 * 1. 차종 슬러그(예: the-all-new-palisade) → /vehicles/<slug>/price 페이지에서 fragment URL 자동 발견
 * 2. 각 fragment 다운로드
 * 3. variant suffix 추정 (G2.5-7 → "(2.5T 7인승)")
 * 4. 머지 → public/data/car-master/<catalog_id>.json
 * 5. _index.json 누적 갱신
 *
 * 사용:
 *   node scripts/hyundai-crawl.cjs <catalog_id> <slug> [title]
 *
 * 예:
 *   node scripts/hyundai-crawl.cjs hyundai_palisade_lx3 the-all-new-palisade "현대 디 올 뉴 팰리세이드 (LX3)"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseHyundaiPriceContent } = require('./hyundai-parse.cjs');
const { merge } = require('./hyundai-merge.cjs');

const CACHE_DIR = '_cache/hyundai';
const OUT_DIR = 'public/data/car-master';
const INDEX_FILE = path.join(OUT_DIR, '_index.json');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (catalog-builder)' }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `https://www.hyundai.com${loc}`;
        return fetchHtml(next).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`status ${res.statusCode} for ${url}`));
        return;
      }
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
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf8');
  }
  const html = await fetchHtml(url);
  fs.writeFileSync(cachePath, html);
  return html;
}

function suffixFromFragment(fragmentName) {
  // 슬러그 패턴 분석:
  //   -J-       일반 (생략)
  //   -H-, -H_  장애인 보조장치 (왼발/오른발 가속페달)
  //   -R-, -R_  영업용 (렌터카/택시 fleet)
  //   -E-       전기/특수 (소수)
  //   -n-, -nline  N라인
  //   -G2.0     가솔린 2.0
  //   -L2.0     LPG 2.0
  //   -D2.2     디젤 2.2
  //   -G2.0T    가솔린 2.0 터보
  //   -G2.5-7   가솔린 2.5 7인승
  const stripped = fragmentName.replace(/_price\.content$/, '').replace(/_price\.html$/, '');
  const labels = [];

  if (/-H(?:-|_|$)/.test(stripped)) labels.push('장애인용');
  if (/-R(?:-|_|$)/.test(stripped)) labels.push('영업용');
  if (/(?:^|-)nline(?:-|_|$)|-n-/.test(stripped)) labels.push('N라인');

  // 엔진/연료/시트
  const eng = stripped.match(/-([GLDH])(\d+(?:\.\d+)?)(T)?(?:-(\d+))?$/);
  if (eng) {
    const fuel = { G: '', L: 'LPG ', D: '디젤 ', H: 'HEV ' }[eng[1]] || '';
    const size = eng[2] + (eng[3] || '');
    let lbl = `${fuel}${size}`;
    if (eng[4]) lbl += ` ${eng[4]}인승`;
    labels.push(lbl);
  } else {
    // 시트수만 있는 경우 (ioniq9-2027_6_price → 6인승). 연식(_2025)은 제외 — 1~2자리만.
    const seatOnly = stripped.match(/_(\d{1,2})$/);
    if (seatOnly) labels.push(`${seatOnly[1]}인승`);
  }

  return labels.length ? `(${labels.join(' ')})` : '';
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

async function crawlOne(catalogId, slug, title) {
  console.log(`\n=== ${catalogId} (slug: ${slug}) ===`);
  const priceUrl = `https://www.hyundai.com/kr/ko/e/vehicles/${slug}/price`;
  let priceHtml;
  try {
    priceHtml = await fetchCached(priceUrl, `${slug}_price.html`);
  } catch (e) {
    console.error(`  ✗ ${slug} price 페이지 실패: ${e.message}`);
    return null;
  }

  // NUXT escape 풀어서 path 컨텍스트로 정확하게 잡기 (underscore 포함)
  const unescaped = priceHtml.replace(/\\u002[Ff]/g, '/');
  const fragRe = /\/price\/([a-z][a-zA-Z0-9._-]*_price\.content)/g;
  const fragments = [...new Set([...unescaped.matchAll(fragRe)].map(m => m[1]))];

  if (fragments.length === 0) {
    console.error(`  ✗ ${slug}: fragment URL 발견 실패`);
    return null;
  }
  console.log(`  fragments(${fragments.length}):`, fragments);

  // 각 fragment 다운로드
  const fragmentData = [];
  for (const fragName of fragments) {
    const fragUrl = `https://www.hyundai.com/contents/repn-car/html/homepage/price/${fragName}`;
    try {
      const html = await fetchCached(fragUrl, fragName);
      const suffix = fragments.length > 1 ? suffixFromFragment(fragName) : '';
      fragmentData.push({ html, suffix, source_url: fragUrl });
      console.log(`  ✓ ${fragName} ${suffix}`);
    } catch (e) {
      console.error(`  ✗ ${fragName}: ${e.message}`);
    }
  }
  if (fragmentData.length === 0) return null;

  // 머지
  const result = merge(catalogId, title || catalogId, fragmentData);
  ensureDir(OUT_DIR);
  const out = path.join(OUT_DIR, `${catalogId}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));

  // 인덱스 갱신
  const idx = loadIndex();
  idx[catalogId] = {
    id: catalogId,
    title: title || catalogId,
    maker: result.maker,
    source: { manufacturer: priceUrl, wikicar: null, encar: [] },
    verified: { manufacturer: true, wikicar: false, encar: false },
    trims: Object.keys(result.trims),
    fetched_at: result.fetched_at
  };
  saveIndex(idx);

  console.log(`  → ${out}`);
  console.log(`     trims=${Object.keys(result.trims).length} options=${Object.keys(result.options).length}`);
  return result;
}

if (require.main === module) {
  const [catalogId, slug, title] = process.argv.slice(2);
  if (!catalogId || !slug) {
    console.error('usage: node hyundai-crawl.cjs <catalog_id> <slug> [title]');
    process.exit(1);
  }
  crawlOne(catalogId, slug, title).then(r => {
    if (!r) process.exit(1);
  }, e => { console.error(e); process.exit(1); });
}

module.exports = { crawlOne, fetchCached, suffixFromFragment };
