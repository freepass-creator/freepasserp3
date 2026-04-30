#!/usr/bin/env node
/**
 * 위키카 가격표 페이지 + 이미지 일괄 다운로드.
 *
 * 출력: public/data/wikicar/{catalog_id}/
 *   ├ page.html         원본 HTML
 *   ├ meta.json         { title, doc_srl, fetched_at, images: [filename] }
 *   └ p1.jpg, p2.jpg... 첨부 이미지 (커버 제외)
 *
 * 사용:
 *   node scripts/fetch-wikicar.cjs                    # _index.json 의 wikicar URL 자동 수집
 *   node scripts/fetch-wikicar.cjs <url> <catalog_id> # 단일 추가
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const CAR_INDEX = path.join(ROOT, 'public', 'data', 'car-master', '_index.json');
const WIKICAR_DIR = path.join(ROOT, 'public', 'data', 'wikicar');
fs.mkdirSync(WIKICAR_DIR, { recursive: true });

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

function extractImages(html) {
  const seen = new Set();
  const out = [];
  // og:image 우선 (대부분 본문 이미지)
  const ogRe = /<meta property="og:image" content="([^"]+)"/g;
  let m;
  while ((m = ogRe.exec(html)) !== null) {
    if (m[1].includes('site_image')) continue;  // 사이트 로고 제외
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(m[1].replace(/^http:\/\//, 'http://').replace(/\.\//, ''));
  }
  // 본문 src/href 보강
  const imgRe = /(?:src|href)="(http:\/\/wikicar\.co\.kr[^"]*\.jpg[^"]*)"/g;
  while ((m = imgRe.exec(html)) !== null) {
    if (m[1].includes('site_image')) continue;
    if (m[1].match(/files\/attach\/images\/\d+\/[a-z0-9]+\.jpg$/)) continue;  // 사용자 아바타 류
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(m[1]);
  }
  return out;
}

function extractTitle(html) {
  const m = html.match(/<meta property="og:title" content="([^"]+)"/);
  return m ? m[1].trim() : '';
}

async function fetchOne(catalogId, url) {
  const dir = path.join(WIKICAR_DIR, catalogId);
  fs.mkdirSync(dir, { recursive: true });
  const pageBuf = await fetch(url);
  const html = pageBuf.toString('utf-8');
  fs.writeFileSync(path.join(dir, 'page.html'), pageBuf);

  const title = extractTitle(html);
  const imgs = extractImages(html);

  // 이미지 다운로드
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
    sourceUrl: url,
    title,
    fetched_at: new Date().toISOString().slice(0, 10),
    images: imageNames,
    image_urls: imgs,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

async function main() {
  // CLI args
  if (process.argv.length >= 4) {
    const url = process.argv[2];
    const id = process.argv[3];
    console.log(`■ ${id} ← ${url}`);
    const meta = await fetchOne(id, url);
    console.log(`  title: ${meta.title}`);
    console.log(`  images: ${meta.images.length}개`);
    return;
  }
  // _index 의 wikicar URL 일괄
  const idx = JSON.parse(fs.readFileSync(CAR_INDEX, 'utf-8'));
  const targets = [];
  for (const [cid, info] of Object.entries(idx)) {
    const wc = (info.source?.wikicar || info.source?.manufacturer || '');
    if (typeof wc === 'string' && wc.includes('wikicar.co.kr')) {
      targets.push({ cid, url: wc });
    }
  }
  // source_urls 도 체크 (상세 카탈로그 파일에 있을 수 있음)
  const carDir = path.join(ROOT, 'public', 'data', 'car-master');
  for (const f of fs.readdirSync(carDir)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const d = JSON.parse(fs.readFileSync(path.join(carDir, f), 'utf-8'));
    const cid = f.replace('.json', '');
    if (targets.some(t => t.cid === cid)) continue;
    const urls = d.source_urls || [];
    const wc = urls.find(u => u && u.includes('wikicar.co.kr'));
    if (wc) targets.push({ cid, url: wc });
  }
  console.log(`총 ${targets.length}개 카탈로그 위키카 URL 보유\n`);

  const allMeta = [];
  for (const { cid, url } of targets) {
    process.stdout.write(`■ ${cid.padEnd(38)} `);
    try {
      const meta = await fetchOne(cid, url);
      allMeta.push(meta);
      console.log(`✓ ${meta.images.length} imgs (${meta.title.slice(0, 40)})`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }

  // 통합 인덱스
  fs.writeFileSync(
    path.join(WIKICAR_DIR, '_index.json'),
    JSON.stringify(allMeta, null, 2)
  );
  console.log(`\n[fetch-wikicar] ${allMeta.length}개 페이지 + 이미지 저장 완료`);
}

main().catch(e => { console.error(e); process.exit(1); });
