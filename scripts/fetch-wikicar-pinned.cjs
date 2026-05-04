#!/usr/bin/env node
/**
 * 위키카 특정 doc 고정 fetch — 구형 카탈로그용 (자동 탐지 = 최신 doc 만 가져옴)
 * (catalog_id, slug, doc_srl) 매핑으로 직접 지정.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const WIKICAR_DIR = path.join(ROOT, 'public', 'data', 'wikicar');

// 구형 한국차 stub → wikicar slug + doc_srl
//  doc_srl 은 listing 페이지에서 찾은 OCR 적합한 가격표 페이지
const PINNED = [
  ['hyundai_kona_os',          'kona_os',         44548],  // 코나 카탈로그 2020.10 (페리 전 최후반)
  ['hyundai_kona_os_facelift', 'kona_os',         48376],  // 코나 가격표 2021.07 (N라인/하이브리드 출시 = 페리)
  ['kia_k7_premier',           'k7',              44475],  // K7 가격표 2021년형 (2020.10) = 프리미어
  ['kia_k7_yg',                'k7',              28081],  // K7 (YG era)
  ['kia_carnival_yp',          'allnew_carnival', 20301],  // 올뉴카니발 가격표 2018년형 (YP 페리 전)
  ['kia_carnival_yp_facelift', 'allnew_carnival', 20387],  // 더뉴 카니발 가격표 2018.03 (YP 페리)
  ['kia_k3_bd',                'allnew_k3',       27983],  // K3 BD 2019년형 (페리 전)
  ['kia_k3_bd_facelift',       'allnew_k3',       49677],  // K3 BD 2021.04 페리 후
  ['kia_k3_yd_facelift',       'the_new_k3',      18804],  // K3 YD 페리 (1세대 페리, 2017.05 마지막)
  ['hyundai_palisade_lx2',     'Palisade',        43147],  // 팰리세이드 LX2 2020년형
  ['hyundai_palisade_lx2_facelift', 'Palisade',   48980],  // 더 뉴 팰리세이드 LX2 2022.05
  ['kia_niro_de',              'niro_hev',        28307],  // 니로 가격표 2019.03 (DE 1세대 마지막)
  ['kia_seltos_sp2',           'seltos',          29643],  // 셀토스 가격표 2019.07 (SP2 출시)
  ['kia_sportage_ql_facelift', 'suv_sportage',    43293],  // 스포티지 가격표 2020년형 (= 더 볼드 페리 후반)
  ['kia_sorento_um_facelift',  'sorento_mq4',     23812],  // 쏘렌토 더마스터 가격표 2019년형 (= UM 페리)
  ['kia_sportage_ql',          'suv_sportage',    19946],  // The SUV 스포티지 2018년형 (QL 페리 전 마지막)
  ['kia_k8_gl3_pre',           'K8',              45415],  // K8 출시 2021.04 (페리 전)
  ['kia_morning_ja_pre',       'morning_ja',      19824],  // 올뉴 모닝 JA 출시 2017.01 (페리 전)
  ['kia_morning_ja_facelift1', 'morning_ja',      43169],  // 더 뉴 모닝 JA 페리 1 (2020.05)
];

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

function extractTitle(html) {
  const m = /<title>([^<]+)<\/title>/.exec(html);
  return m ? m[1].trim() : '';
}

async function fetchOne(catalogId, slug, docSrl) {
  const dir = path.join(WIKICAR_DIR, catalogId);
  fs.mkdirSync(dir, { recursive: true });

  const articleUrl = `http://wikicar.co.kr/${slug}/${docSrl}`;
  const pageBuf = await fetch(articleUrl);
  const html = pageBuf.toString('utf-8');
  fs.writeFileSync(path.join(dir, 'page.html'), pageBuf);

  const title = extractTitle(html);
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
    listingUrl: `http://wikicar.co.kr/${slug}`,
    title,
    docSrl,
    fetched_at: new Date().toISOString().slice(0, 10),
    images: imageNames,
    image_urls: imgs,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

async function main() {
  const targets = PINNED.filter(([cid]) => {
    if (fs.existsSync(path.join(WIKICAR_DIR, cid, 'page.html'))) {
      console.log(`■ ${cid.padEnd(38)} 이미 있음 — 스킵`);
      return false;
    }
    return true;
  });
  console.log(`pinned fetch 대상: ${targets.length}개\n`);

  const results = [];
  for (const [cid, slug, docSrl] of targets) {
    process.stdout.write(`■ ${cid.padEnd(38)} (${slug}/${docSrl}) `);
    try {
      const meta = await fetchOne(cid, slug, docSrl);
      results.push(meta);
      console.log(`✓ ${meta.images.length} imgs (${meta.title.slice(0, 40)})`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
  console.log(`\n[fetch-wikicar-pinned] ${results.length}개 완료`);
}

main().catch(e => { console.error(e); process.exit(1); });
