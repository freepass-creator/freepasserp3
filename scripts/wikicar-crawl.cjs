/**
 * wikicar 자동 크롤 — 한 모델 끝까지
 *
 * 1. 모델 페이지(/sonata_dn8) → 가격표 게시글 리스트
 * 2. 최신 게시글 (또는 모든 게시글) 첨부 이미지
 * 3. 각 이미지 Gemini OCR → 트림×옵션×가격
 * 4. 머지 → 우리 카탈로그 JSON
 *
 * 사용:
 *   node scripts/wikicar-crawl.cjs <catalog_id> <wikicar_slug> <title> [latest_only=true]
 *
 * 예:
 *   node scripts/wikicar-crawl.cjs hyundai_sonata_dn8_edge sonata_dn8 "현대 쏘나타 디 엣지"
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ocrImage } = require('./wikicar-ocr.cjs');

const CACHE_DIR = '_cache/wikicar';
const OUT_DIR = 'public/data/car-master';
const INDEX_FILE = path.join(OUT_DIR, '_index.json');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function fetchUrl(url, asBuffer = false) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString(), asBuffer).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(asBuffer ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

async function fetchCached(url, cacheKey, asBuffer = false) {
  ensureDir(CACHE_DIR);
  const cachePath = path.join(CACHE_DIR, cacheKey);
  if (fs.existsSync(cachePath)) return asBuffer ? fs.readFileSync(cachePath) : fs.readFileSync(cachePath, 'utf8');
  const data = await fetchUrl(url, asBuffer);
  fs.writeFileSync(cachePath, data);
  return data;
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

// 모델 페이지에서 가격표 게시글 추출
function extractPostUrls(modelHtml, slug) {
  // <a href="/sonata_dn8/56695">쏘나타 가격표 - 2024년 10월(2025)</a>
  const re = new RegExp(`<a[^>]+href="/${slug}/(\\d+)"[^>]*>([^<]*가격표[^<]*)</a>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(modelHtml)) !== null) {
    out.push({ id: m[1], title: m[2].trim() });
  }
  return out;
}

// 게시글에서 첨부 이미지 URL 추출
function extractImages(postHtml) {
  const imgs = [...postHtml.matchAll(/<img[^>]+src="([^"]+)"/g)]
    .map(m => m[1])
    .filter(s => /attach\/images\/\d+/.test(s) && !/menu_button|334\//.test(s));
  // 절대 URL로 정규화
  return [...new Set(imgs.map(s => s.replace(/^http:\/\/wikicar\.co\.kr\/\.\//, 'http://wikicar.co.kr/')))];
}

// 가짜 트림 제거 (가격 0 + basic/select 0 + 이름이 너무 길거나 사양 키워드 포함)
function isValidTrim(t) {
  const name = t.name || '';
  if (name.length > 25) return false;
  // 엔진/타이어/배기량 키워드 포함하면 사양 라인
  if (/엔진|배기량|타이어|휠|^\d+(\.\d+)?[TL]?$|\d+인치/.test(name)) return false;
  // 가격이 다 0이고 옵션도 없으면 빈 트림
  const hasPrice = (t.price_before_tax_5 || t.price_after_tax_5 || t.price_before_tax_3_5 || t.price_after_tax_3_5);
  const hasOpts = (t.basic && t.basic.length > 0) || (t.select && t.select.length > 0);
  if (!hasPrice && !hasOpts) return false;
  return true;
}

// OCR 결과 → 우리 카탈로그 형식으로 변환
function ocrToCatalog(catalogId, title, maker, ocrResults, sourceUrls) {
  const optionMaster = {};
  const trims = {};
  const categories = {};

  // OCR 결과 여러 페이지 있으면 같은 트림은 합치기
  ocrResults.forEach(r => {
    if (!r || !r.trims) return;
    r.trims.filter(isValidTrim).forEach(t => {
      const trimKey = r.variant ? `${t.name} (${r.variant})` : t.name;

      if (!trims[trimKey]) {
        trims[trimKey] = {
          slug: trimKey.replace(/\s+/g, '_'),
          price: {},
          basic: [],
          select: [],
          select_groups: []
        };
      }
      const trim = trims[trimKey];

      // 가격
      if (t.price_before_tax_5) trim.price.tax_5_before = t.price_before_tax_5;
      if (t.price_after_tax_5) trim.price.tax_5_after = t.price_after_tax_5;
      if (t.price_before_tax_3_5) trim.price.tax_3_5_before = t.price_before_tax_3_5;
      if (t.price_after_tax_3_5) trim.price.tax_3_5_after = t.price_after_tax_3_5;

      // 기본품목 — 카테고리별 옵션
      (t.basic || []).forEach(({ category, options }) => {
        (options || []).forEach(name => {
          // 옵션을 코드화 — wikicar는 코드 없으니 이름을 코드로 (slug)
          const code = `WK_${name.replace(/[^a-zA-Z0-9가-힣]/g, '_').slice(0, 50)}`;
          if (!optionMaster[code]) {
            optionMaster[code] = { name, category, is_package: false };
          }
          if (!trim.basic.includes(code)) trim.basic.push(code);
        });
      });

      // 선택품목 — 패키지/단품
      (t.select || []).forEach(({ name, options, price }) => {
        const codes = (options || [name]).map(opt => {
          const code = `WK_${opt.replace(/[^a-zA-Z0-9가-힣]/g, '_').slice(0, 50)}`;
          if (!optionMaster[code]) {
            optionMaster[code] = { name: opt, category: '선택사양', is_package: (options || []).length > 1 };
          }
          if (!trim.select.includes(code)) trim.select.push(code);
          return code;
        });
        trim.select_groups.push({ codes, price: price || null, name });
      });
    });
  });

  // 카테고리 인덱스
  Object.entries(optionMaster).forEach(([code, info]) => {
    categories[info.category] = categories[info.category] || [];
    if (!categories[info.category].includes(code)) categories[info.category].push(code);
  });

  return {
    catalog_id: catalogId,
    title,
    maker,
    source: 'wikicar_ocr',
    source_urls: sourceUrls,
    fetched_at: new Date().toISOString().slice(0, 10),
    categories,
    options: optionMaster,
    trims
  };
}

async function tryFetchModel(slug) {
  // 슬러그 case 변형 — 소문자 / 첫글자 대문자 / 전체 대문자 순서
  const variants = [slug, slug.charAt(0).toUpperCase() + slug.slice(1), slug.toUpperCase()];
  for (const v of variants) {
    try {
      const html = await fetchCached(`http://wikicar.co.kr/${v}`, `${v}_model.html`);
      // 가격표 게시글이 1개라도 있어야 valid
      if (/href="\/[^"]+\/\d+"[^>]*>[^<]*가격표/.test(html)) return { slug: v, html };
    } catch {}
  }
  return null;
}

async function crawlOne(catalogId, slug, title, opts = {}) {
  console.log(`\n=== ${catalogId} (wikicar:${slug}) ===`);
  const maker = opts.maker || (title.split(' ')[0]);
  const latestOnly = opts.latestOnly !== false; // 기본 최신 1개만

  // 1. 모델 페이지 (case-insensitive)
  const found = await tryFetchModel(slug);
  if (!found) { console.error(`  ✗ 모델 페이지 없음 (모든 case 시도)`); return null; }
  const modelHtml = found.html;
  slug = found.slug;
  if (found.slug !== opts.originalSlug) console.log(`  슬러그 보정: ${opts.originalSlug || slug} → ${found.slug}`);

  // 2. 가격표 게시글 리스트
  const posts = extractPostUrls(modelHtml, slug);
  if (posts.length === 0) { console.error(`  ✗ 가격표 게시글 없음`); return null; }
  let targetPosts;
  if (opts.postId) {
    const found = posts.find(p => p.id === String(opts.postId));
    targetPosts = [found || { id: String(opts.postId), title: '(직접지정)' }];
    console.log(`  게시글 ID 직접 지정: ${opts.postId}`);
  } else if (latestOnly) {
    targetPosts = [posts[0]];
  } else {
    targetPosts = posts;
  }
  console.log(`  ${posts.length}개 가격표 발견, ${targetPosts.length}개 처리`);

  // 3. 각 게시글에서 이미지 추출 + OCR
  const allOcr = [];
  const sourceUrls = [];
  for (const post of targetPosts) {
    console.log(`\n  [${post.id}] ${post.title}`);
    const postUrl = `http://wikicar.co.kr/${slug}/${post.id}`;
    sourceUrls.push(postUrl);
    let postHtml;
    try {
      postHtml = await fetchCached(postUrl, `${slug}_${post.id}.html`);
    } catch (e) { console.error(`    ✗ 게시글: ${e.message}`); continue; }
    const images = extractImages(postHtml);
    console.log(`    이미지 ${images.length}장`);
    for (let i = 0; i < images.length; i++) {
      const imgUrl = images[i];
      const imgKey = `${slug}_${post.id}_${i}.jpg`;
      let imgPath = path.join(CACHE_DIR, imgKey);
      try {
        if (!fs.existsSync(imgPath)) {
          const buf = await fetchUrl(imgUrl, true);
          ensureDir(CACHE_DIR);
          fs.writeFileSync(imgPath, buf);
        }
      } catch (e) { console.error(`    ✗ 이미지[${i}]: ${e.message}`); continue; }
      try {
        const result = await ocrImage(imgPath);
        if (result && result.trims && result.trims.length > 0) {
          allOcr.push(result);
          console.log(`    ✓ [${i}] 트림 ${result.trims.length}, 변형: ${result.variant || '-'}`);
        } else {
          console.log(`    - [${i}] 가격표 아님 (트림 0)`);
        }
      } catch (e) { console.error(`    ✗ OCR[${i}]: ${e.message}`); }
    }
  }

  if (allOcr.length === 0) { console.error(`  ✗ OCR 결과 없음`); return null; }

  // 4. 카탈로그 생성
  const catalog = ocrToCatalog(catalogId, title, maker, allOcr, sourceUrls);
  ensureDir(OUT_DIR);
  const out = path.join(OUT_DIR, `${catalogId}.json`);
  fs.writeFileSync(out, JSON.stringify(catalog, null, 2));

  // 5. 인덱스 갱신
  const idx = loadIndex();
  if (!idx[catalogId]) {
    idx[catalogId] = {
      id: catalogId, title, maker,
      source: { manufacturer: null, wikicar: sourceUrls[0], encar: [] },
      verified: { manufacturer: false, wikicar: true, encar: false }
    };
  } else {
    idx[catalogId].source = idx[catalogId].source || {};
    idx[catalogId].source.wikicar = sourceUrls[0];
    idx[catalogId].verified = idx[catalogId].verified || {};
    idx[catalogId].verified.wikicar = true;
  }
  idx[catalogId].trims = Object.keys(catalog.trims);
  idx[catalogId].fetched_at = catalog.fetched_at;
  saveIndex(idx);

  console.log(`\n  → ${out}`);
  console.log(`     trims=${Object.keys(catalog.trims).length} options=${Object.keys(catalog.options).length}`);
  return catalog;
}

async function crawlAll(opts = {}) {
  const models = require('./wikicar-models.cjs');
  const summary = { ok: [], fail: [] };
  const latestOnly = opts.latestOnly !== false; // 기본 latest only
  console.log(`[crawlAll] mode: ${latestOnly ? 'LATEST 1개만' : 'ALL POSTS (모든 가격표)'}`);
  for (const [catalogId, slug, title, maker, encarKeys] of models) {
    try {
      const r = await crawlOne(catalogId, slug, title, { maker, latestOnly });
      if (r) {
        summary.ok.push(catalogId);
        // encar_keys 갱신
        const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        if (idx[catalogId]) {
          idx[catalogId].source = idx[catalogId].source || {};
          idx[catalogId].source.encar = encarKeys || [];
          idx[catalogId].verified = idx[catalogId].verified || {};
          idx[catalogId].verified.encar = (encarKeys||[]).length > 0;
          fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
        }
      } else {
        summary.fail.push(catalogId);
      }
    } catch (e) {
      console.error(`✗ ${catalogId}: ${e.message}`);
      summary.fail.push(catalogId);
    }
  }
  console.log('\n========== WIKICAR SUMMARY ==========');
  console.log(`✓ ${summary.ok.length}/${models.length}:`, summary.ok.join(', '));
  if (summary.fail.length) console.log(`✗ ${summary.fail.length}:`, summary.fail.join(', '));
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === 'all') {
    crawlAll().catch(e => { console.error(e); process.exit(1); });
  } else {
    const args = process.argv.slice(2);
    const flags = {};
    const pos = [];
    args.forEach(a => {
      const m = a.match(/^--([a-z]+)=(.+)$/);
      if (m) flags[m[1]] = m[2];
      else pos.push(a);
    });
    const [catalogId, slug, title, latestArg] = pos;
    if (!catalogId || !slug || !title) {
      console.error('usage:\n  node wikicar-crawl.cjs all\n  node wikicar-crawl.cjs <catalog_id> <slug> <title> [all|latest] [--post=<id>] [--encar=<key1,key2>]');
      process.exit(1);
    }
    const latestOnly = (latestArg || 'latest') !== 'all';
    crawlOne(catalogId, slug, title, { latestOnly, postId: flags.post }).then(r => {
      if (!r) process.exit(1);
      // encar 매핑 갱신
      if (flags.encar) {
        const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        if (idx[catalogId]) {
          idx[catalogId].source.encar = flags.encar.split(',').map(s => s.trim()).filter(Boolean);
          idx[catalogId].verified.encar = idx[catalogId].source.encar.length > 0;
          fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
          console.log(`  encar 매핑: ${idx[catalogId].source.encar.join(',')}`);
        }
      }
    }, e => { console.error(e); process.exit(1); });
  }
}

module.exports = { crawlOne };
