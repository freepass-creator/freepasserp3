/**
 * 미매핑 sub_models 자동 wikicar OCR 채우기 (10년 컷 + 풀체인지 1번 전 정책)
 *
 * 알고리즘:
 *   1. encar_master 에서 in-scope (≥2016-04, 한국 메이커) 미매핑 sub 목록
 *   2. SKIP 리스트 / model→slug 사전으로 wikicar 슬러그 결정
 *   3. wikicar 모델 페이지 → 가격표 게시글 리스트
 *   4. 게시글 점수화 (모델명 매치 + 변형 키워드 + 시기) → 최고점(≥3) 1개 선택
 *   5. 선택된 게시글 OCR → catalog 파일 생성 → _index.json encar 매핑
 *   6. 매칭 신뢰도 낮으면 skip (보고 큐)
 */
const fs = require('fs');
const path = require('path');
const { crawlOne } = require('./wikicar-crawl.cjs');

const OUT_DIR = 'public/data/car-master';
const INDEX_FILE = path.join(OUT_DIR, '_index.json');

// === 사용자 지시 SKIP ===
const SKIP_KEYS = new Set([
  'encar_001_018_142', // 쏘나타 뉴 라이즈 (사용자 지시 skip)
  'encar_001_018_144', // 쏘나타 뉴 라이즈 하이브리드 (사용자 지시 skip)
  'encar_001_065_191', // ST1 (사용자 지시: 안 쓰는 차)
]);

// === 메이커 영문 ===
const MAKER_EN = {
  '현대': 'hyundai', '기아': 'kia', '제네시스': 'genesis',
  '쉐보레': 'chevrolet', '르노': 'renault', 'KGM': 'kgm', '쌍용': 'kgm'
};

// === 모델 한글 → wikicar slug (1차 후보) ===
// slugs.txt 에서 확인된 슬러그 위주
const MODEL_TO_SLUG = {
  // 현대
  '그랜저': 'grandeur_ig',     // GN7 신형은 제조사로 처리됨
  '쏘나타': 'sonata_dn8',
  '아반떼': 'avante_cn7',       // CN7 만, AD 는 슬러그 없음
  '코나': 'kona_os',
  '투싼': 'tucson_nx4',
  '싼타페': 'santafe_tm',
  '캐스퍼': 'casper',
  '베뉴': 'venue',
  '벨로스터': 'veloster_js',
  '넥쏘': 'nexo',
  'ST1': 'st1',
  '스타리아': 'staria',
  // 아이오닉 (구형) — 변형별 슬러그
  '아이오닉': 'ioniq_a',  // 변형은 sub.sub에서 분기 (하이브리드/일렉트릭)
  // 기아
  'K3': 'k3',
  'K5': 'k5',
  'K7': 'k7',
  'K9': 'k9',
  '모하비': 'mohave',
  '스팅어': 'stinger',
  '셀토스': 'seltos',
  '쏘렌토': 'sorento_mq4',
  '카니발': 'allnew_carnival',
  '모닝': 'morning_ja',
  '레이': 'ray',
  '니로': 'niro_a',
  '스토닉': 'stonic',
  '스포티지': 'suv_sportage',
  '쏘울': 'soul',
  // 제네시스
  'G70': 'genesis_g70',
  'G80': 'genesis_g80',
  'G90': 'genesis_g90',
  'GV60': 'gv60',
  'GV70': 'gv70',
  'GV80': 'gv80',
  // 쉐보레
  '말리부': 'malibu',
  '스파크': 'spark',
  '카마로': 'camaro',
  '콜로라도': 'colorado',
  '크루즈': 'cruze',
  '트래버스': 'traverse',
  '트레일블레이저': 'trailblazer',
  '이쿼녹스': 'equinox',
  '볼트 EV': 'bolt_ev',
  '볼트(Volt)': 'volt_a',
  // 르노
  'SM6': 'sm6',
  'XM3': 'xm3',
  'QM6': 'qm6',
  'QM3': 'qm3',
  // KGM
  '렉스턴': 'new_rexton',
  '무쏘': 'musso',
  '액티언': 'actyon',
  '코란도': 'korando_c200',
  '토레스': 'torres',
  '티볼리': 'tivoli_armour'
};

// 아이오닉 변형 → 슬러그
const IONIQ_VARIANT_SLUG = {
  '하이브리드': 'ioniq_hb',
  '일렉트릭': 'ioniq_electric',
  'EV': 'ioniq_electric',
  '플러그인': 'ioniq_phev',
  'PHEV': 'ioniq_phev'
};

// 렉스턴 변형
const REXTON_VARIANT_SLUG = {
  '스포츠 칸': 'rexton_sports_khan',
  '스포츠': 'rexton_sports',
  '아레나': 'new_rexton',
  'G4': 'new_rexton',  // G4 렉스턴
  '올 뉴': 'new_rexton'
};

function pickSlug(sub) {
  const m = sub.model;
  // 특수 케이스
  if (m === '아이오닉') {
    for (const [kw, slug] of Object.entries(IONIQ_VARIANT_SLUG)) {
      if (sub.sub.includes(kw)) return slug;
    }
    return 'ioniq_a';
  }
  if (m === '렉스턴') {
    for (const [kw, slug] of Object.entries(REXTON_VARIANT_SLUG)) {
      if (sub.sub.includes(kw)) return slug;
    }
    return 'new_rexton';
  }
  // 일반
  return MODEL_TO_SLUG[m] || null;
}

// 변형 키워드 (sub.sub vs post.title 양쪽 매칭)
const VARIANT_KEYWORDS = ['하이브리드', '일렉트릭', '플러그인', 'PHEV', 'EV', '디젤', 'LPI', 'LPG',
                           'N라인', 'N 라인', '쿠페', '왜건', '카브리오', '컨버터블',
                           '영업용', '택시', '렌터카', '장애인'];

function scorePost(post, sub) {
  const title = post.title;
  let score = 0;

  // 1. 모델 키워드
  if (title.includes(sub.model)) score += 1;

  // 2. 변형 키워드 양방향 매칭
  for (const kw of VARIANT_KEYWORDS) {
    const inSub = sub.sub.includes(kw);
    const inTitle = title.includes(kw);
    if (inSub && inTitle) score += 2;
    if (inSub && !inTitle) score -= 3;
    if (!inSub && inTitle) score -= 3;
  }

  // 3. 시기 — 게시글 제목 안의 연도 vs production 기간
  const yearM = title.match(/(20\d{2})년/);
  if (yearM) {
    const y = +yearM[1];
    const ps = +sub.production_start.slice(0, 4);
    const pe = sub.production_end ? +sub.production_end.slice(0, 4) : 9999;
    if (y >= ps && y <= pe) score += 1;
    else score -= 3;
  }

  // 4. '더 뉴' / '올 뉴' 페이스리프트 키워드
  for (const kw of ['더 뉴', '올 뉴', '디 올 뉴', '뉴']) {
    const inSub = sub.sub.includes(kw);
    const inTitle = title.includes(kw);
    if (inSub && inTitle) score += 1;
    if (inSub && !inTitle) score -= 1;
  }

  // 5. 게시글 종류 — 가격표 우선, 카탈로그/사전계약 등은 감점
  if (title.includes('가격표')) score += 1;
  if (title.includes('카탈로그')) score -= 1;
  if (title.includes('출시') || title.includes('사전계약')) score -= 2;

  return score;
}

function makeCatalogId(sub) {
  const maker = MAKER_EN[sub.maker] || sub.maker.toLowerCase();
  const modelSlug = (MODEL_TO_SLUG[sub.model] || sub.model.toLowerCase()).replace(/_a$/, '').replace(/_armour$/, '');
  const id3 = sub._key.split('_').pop(); // last 3-digit
  return `${maker}_${modelSlug}_${id3}`;
}

async function fetchModelPage(slug) {
  const { fetchCached } = require('./wikicar-crawl.cjs');
  // wikicar-crawl 의 fetchCached 가 export 안 되어 있으니 직접 인라인 호출
  const http = require('http');
  return new Promise((resolve, reject) => {
    const cachePath = path.join('_cache/wikicar', `${slug}_model.html`);
    if (fs.existsSync(cachePath)) return resolve(fs.readFileSync(cachePath, 'utf8'));
    http.get(`http://wikicar.co.kr/${slug}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchModelPage(slug).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        if (!fs.existsSync('_cache/wikicar')) fs.mkdirSync('_cache/wikicar', { recursive: true });
        fs.writeFileSync(cachePath, html);
        resolve(html);
      });
    }).on('error', reject);
  });
}

function extractPosts(modelHtml, slug) {
  const re = new RegExp(`<a[^>]+href="/${slug}/(\\d+)"[^>]*>([^<]+)</a>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(modelHtml)) !== null) {
    out.push({ id: m[1], title: m[2].trim() });
  }
  // '가격표' 키워드만 (카탈로그/공지 등 제외)
  return out.filter(p => /가격표/.test(p.title));
}

const MIN_SCORE = 3;
const SCORE_GAP = 1;  // top 과 2등 차이가 이거 이상이면 안전

function selectBestPost(posts, sub) {
  const scored = posts.map(p => ({ ...p, score: scorePost(p, sub) }));
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { reason: 'no_posts' };
  if (scored[0].score < MIN_SCORE) return { reason: 'low_score', top: scored[0] };
  // 동점 / 미세 차이는 위험 (잘못 고를 가능성)
  if (scored[1] && scored[0].score - scored[1].score < SCORE_GAP) {
    return { reason: 'ambiguous', top: scored[0], second: scored[1] };
  }
  return { post: scored[0] };
}

async function main() {
  const m = require('../public/data/encar-master-seed.json');
  const arr = Array.isArray(m) ? m : (m.ENCAR_MASTER || Object.values(m));
  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const mapped = new Set();
  Object.values(idx).forEach(v => (v.source?.encar || []).forEach(k => mapped.add(k)));

  const CUTOFF = '2016-04';
  const KOREAN = ['현대', '기아', '제네시스', '쉐보레', '르노', 'KGM', '쌍용'];
  const todo = arr.filter(r => r && !r.archived && r.status !== 'deleted'
    && r.production_start && r.production_start >= CUTOFF
    && KOREAN.includes(r.maker)
    && !mapped.has(r._key)
    && !SKIP_KEYS.has(r._key));

  console.log(`[fill-gaps] 대상 sub_model: ${todo.length}개`);

  // 결과 큐
  const results = { ok: [], skip: [], fail: [] };

  for (const sub of todo) {
    const tag = `[${sub._key}] ${sub.maker} ${sub.model} - ${sub.sub}`;
    const slug = pickSlug(sub);
    if (!slug) {
      console.log(`SKIP: ${tag} → slug 매핑 없음`);
      results.skip.push({ key: sub._key, label: tag, reason: 'no_slug' });
      continue;
    }

    let modelHtml;
    try { modelHtml = await fetchModelPage(slug); }
    catch (e) {
      console.log(`FAIL: ${tag} → 모델페이지(${slug}): ${e.message}`);
      results.fail.push({ key: sub._key, label: tag, slug, reason: 'model_page_failed', err: e.message });
      continue;
    }

    const posts = extractPosts(modelHtml, slug);
    if (posts.length === 0) {
      console.log(`SKIP: ${tag} → 슬러그(${slug})에 가격표 게시글 0개`);
      results.skip.push({ key: sub._key, label: tag, slug, reason: 'no_posts' });
      continue;
    }

    const sel = selectBestPost(posts, sub);
    if (!sel.post) {
      console.log(`SKIP: ${tag} → ${sel.reason} (top=${sel.top?.title} score=${sel.top?.score}, 2nd=${sel.second?.title})`);
      results.skip.push({ key: sub._key, label: tag, slug, reason: sel.reason, top: sel.top, second: sel.second });
      continue;
    }

    const post = sel.post;
    const catalogId = makeCatalogId(sub);
    console.log(`OCR: ${tag} → slug=${slug} post=${post.id} "${post.title}" score=${post.score} → ${catalogId}`);

    try {
      const r = await crawlOne(catalogId, slug, `${sub.maker} ${sub.sub}`, {
        maker: sub.maker, postId: post.id, latestOnly: true
      });
      if (!r) {
        results.fail.push({ key: sub._key, label: tag, slug, post: post.id, reason: 'crawl_returned_null' });
        continue;
      }
      // encar 매핑
      const idxNow = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      if (idxNow[catalogId]) {
        idxNow[catalogId].source.encar = [sub._key];
        idxNow[catalogId].verified.encar = true;
        idxNow[catalogId].title = `${sub.maker} ${sub.sub}`;
        fs.writeFileSync(INDEX_FILE, JSON.stringify(idxNow, null, 2));
      }
      results.ok.push({ key: sub._key, label: tag, catalogId, trims: Object.keys(r.trims).length, post: post.title });
    } catch (e) {
      console.log(`FAIL: ${tag} → OCR 예외: ${e.message}`);
      results.fail.push({ key: sub._key, label: tag, slug, post: post.id, reason: 'ocr_exception', err: e.message });
    }
  }

  // 리포트 저장
  const report = {
    fetched_at: new Date().toISOString(),
    total: todo.length,
    ok: results.ok.length,
    skip: results.skip.length,
    fail: results.fail.length,
    results
  };
  fs.writeFileSync('_cache/fill_gaps_report.json', JSON.stringify(report, null, 2));

  console.log(`\n=== 종합 ===`);
  console.log(`✓ OK: ${results.ok.length}`);
  console.log(`- SKIP: ${results.skip.length}`);
  console.log(`✗ FAIL: ${results.fail.length}`);
  console.log(`리포트: _cache/fill_gaps_report.json`);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { pickSlug, scorePost, selectBestPost, makeCatalogId };
