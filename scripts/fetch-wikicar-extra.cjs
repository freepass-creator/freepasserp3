#!/usr/bin/env node
/**
 * 위키카 추가 카탈로그 fetch — 게시판 listing 페이지에서 최신 가격표 doc_srl 자동 추출.
 *
 * 입력: catalog_id → wikicar slug 매핑
 * 출력: public/data/wikicar/{catalog_id}/ (page.html, meta.json, p1-pN.jpg)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const WIKICAR_DIR = path.join(ROOT, 'public', 'data', 'wikicar');

// 우리 카탈로그 → wikicar slug
const SLUG_MAP = {
  'kia_morning_ja':       'morning_ja',
  'kia_k5_dl3':           'K5_dl3',
  'kia_k8_gl3':           'K8',
  'kia_k9_rj':            'k9',
  'kia_seltos':           'seltos',
  'kia_ray':              'ray',
  'kia_ray_ev':           'ray',          // 같은 페이지에 EV 같이
  'kia_ev3':              'EV3',
  'kia_ev4':              'EV4',
  'kia_ev5':              'EV5',
  'kia_ev6':              'ev6',
  'kia_ev9':              'ev9',
  'kia_niro_sg2':         'niro_hev',     // 2세대 니로 = SG2 hybrid
  'kia_carnival_ka4':     'allnew_carnival',
  'kia_sportage_nq5':     'suv_sportage',
  'kia_bongo3':           'bongo3',
  'hyundai_palisade_lx3': 'Palisade',
  'hyundai_kona_sx2':     'kona_os',      // 1세대만 있을 수도, 일단 시도
  'hyundai_santa_fe_mx5': 'santafe_tm',   // wikicar는 TM 만 있을 수 있음
  'hyundai_ioniq5':       'ioniq5',
  'hyundai_ioniq5_n':     'ioniq5',       // 같은 페이지
  'hyundai_ioniq6':       'ioniq6',
  'hyundai_ioniq9':       'ioniq_9',
  'hyundai_staria':       'staria',
  'hyundai_staria_lounge':'staria',
  'hyundai_venue':        'venue',
  'hyundai_avante_n':     'avante_cn7',
  'hyundai_nexo_nh2':     'nexo',
  'hyundai_tucson_nx4':   'tucson_nx4',
  'hyundai_grandeur_gn7': 'grandeur_ig',  // wikicar는 IG/GN7 통합 페이지
  'hyundai_st1':          'st1',
  'kia_tasman':           null,           // 위키카 없음
  'kia_stinger':          'stinger',      // 이미 있음
  'kia_mohave':           'mohave',       // 이미 있음
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

// 게시판 listing 에서 최신 가격표 doc_srl 추출
//  실제 패턴: <a href="/SLUG/12345">제목 가격표 ...</a>
//  또한 ?mid=...&document_srl=... 패턴도 지원
function findLatestPriceDocSrl(html, slug) {
  let latest = null;
  const tryUpdate = (docSrl, title, href) => {
    if (!title.includes('가격표')) return;
    if (title.includes('카탈로그')) return;  // 카탈로그(브로셔)는 제외
    if (title.includes('택시') || title.includes('상용')) return; // 택시/상용 변형 제외
    if (!latest || docSrl > latest.docSrl) {
      latest = { docSrl, title: title.trim(), href };
    }
  };
  // 1) /SLUG/NNN 패턴
  const re1 = new RegExp(`<a\\s+href="(/${slug}/(\\d+))"[^>]*>([^<]+)</a>`, 'g');
  let m;
  while ((m = re1.exec(html)) !== null) tryUpdate(parseInt(m[2]), m[3], m[1]);
  // 2) ?mid=...&document_srl=NNN 패턴
  const re2 = /<a\s+href="([^"]*document_srl=(\d+)[^"]*)"[^>]*>([^<]+)<\/a>/g;
  while ((m = re2.exec(html)) !== null) tryUpdate(parseInt(m[2]), m[3], m[1].replace(/&amp;/g, '&'));
  return latest;
}

function extractImagesFromArticle(html) {
  const seen = new Set();
  const out = [];
  const ogRe = /<meta property="og:image" content="([^"]+)"/g;
  let m;
  while ((m = ogRe.exec(html)) !== null) {
    if (m[1].includes('site_image')) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(m[1]);
  }
  return out;
}

async function fetchOne(catalogId, slug) {
  const dir = path.join(WIKICAR_DIR, catalogId);
  fs.mkdirSync(dir, { recursive: true });

  // 1) listing 페이지
  const listUrl = `http://wikicar.co.kr/${slug}`;
  const listHtml = (await fetch(listUrl)).toString('utf-8');
  const latest = findLatestPriceDocSrl(listHtml, slug);
  if (!latest) throw new Error(`no price post found in /${slug}`);

  // 2) 최신 가격표 페이지 fetch
  let articleUrl = latest.href;
  if (articleUrl.startsWith('/')) articleUrl = 'http://wikicar.co.kr' + articleUrl;
  if (articleUrl.startsWith('?')) articleUrl = 'http://wikicar.co.kr/' + articleUrl;
  if (!articleUrl.startsWith('http')) articleUrl = 'http://wikicar.co.kr/' + articleUrl;

  const pageBuf = await fetch(articleUrl);
  const html = pageBuf.toString('utf-8');
  fs.writeFileSync(path.join(dir, 'page.html'), pageBuf);

  const imgs = extractImagesFromArticle(html);
  const imageNames = [];
  for (let i = 0; i < imgs.length; i++) {
    const fname = `p${i + 1}.jpg`;
    try {
      const buf = await fetch(imgs[i]);
      fs.writeFileSync(path.join(dir, fname), buf);
      imageNames.push(fname);
    } catch (e) {
      console.error(`  [${catalogId}] image ${i + 1} 실패:`, e.message);
    }
  }

  const meta = {
    catalogId,
    sourceUrl: articleUrl,
    listingUrl: listUrl,
    title: latest.title,
    docSrl: latest.docSrl,
    fetched_at: new Date().toISOString().slice(0, 10),
    images: imageNames,
    image_urls: imgs,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

async function main() {
  const targets = Object.entries(SLUG_MAP).filter(([cid, slug]) => {
    if (!slug) return false;
    if (fs.existsSync(path.join(WIKICAR_DIR, cid, 'page.html'))) return false;  // 이미 있음
    return true;
  });

  console.log(`추가 fetch 대상: ${targets.length}개\n`);
  const results = [];
  for (const [cid, slug] of targets) {
    process.stdout.write(`■ ${cid.padEnd(38)} (slug=${slug.padEnd(20)}) `);
    try {
      const meta = await fetchOne(cid, slug);
      results.push(meta);
      console.log(`✓ ${meta.images.length} imgs (${meta.title.slice(0, 40)})`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
  console.log(`\n[fetch-wikicar-extra] ${results.length}개 추가 완료`);
}

main().catch(e => { console.error(e); process.exit(1); });
