#!/usr/bin/env node
/**
 * 엔카 매물 검색 mobile API 에서 한국 OEM 차종 트리 추출.
 *  - inav 파라미터로 Manufacturer / ModelGroup / Model facet 받음
 *  - 응답 JSON 의 iNav.Nodes 배열 파싱
 *  - 저장: public/data/car-master/_encar-master.json
 *
 *  사용:
 *    node scripts/fetch-encar-master.cjs
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'data', 'car-master', '_encar-master.json');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
  'Referer': 'https://www.encar.com/',
  'Origin': 'https://www.encar.com',
};
function fetchUrl(url, retries = 4) {
  return new Promise((resolve, reject) => {
    const attempt = (left, delay) => {
      const req = https.get(url, { headers: HEADERS }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (!data || res.statusCode !== 200) {
            if (left > 0) setTimeout(() => attempt(left - 1, delay * 2), delay);
            else resolve('');
            return;
          }
          try { resolve(JSON.parse(data)); }
          catch (e) {
            if (left > 0) setTimeout(() => attempt(left - 1, delay * 2), delay);
            else resolve(data);
          }
        });
      });
      req.on('error', e => left > 0 ? setTimeout(() => attempt(left - 1, delay * 2), delay) : reject(e));
      req.setTimeout(10000, () => req.destroy());
    };
    attempt(retries, 1000);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 표기 변환: 하이브리드 → HEV, 괄호 제거
function normalize(s) {
  return String(s || '')
    .replace(/하이브리드/g, 'HEV')
    .replace(/[()\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// iNav 응답 재귀 탐색 — Name=aspect 인 노드의 Facets 추출
function findFacet(node, aspect) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findFacet(n, aspect);
      if (r) return r;
    }
    return null;
  }
  if (node.Name === aspect) return node.Facets || [];
  if (node.Refinements?.Nodes) {
    const r = findFacet(node.Refinements.Nodes, aspect);
    if (r) return r;
  }
  if (Array.isArray(node.Facets)) {
    for (const f of node.Facets) {
      if (f.Refinements?.Nodes) {
        const r = findFacet(f.Refinements.Nodes, aspect);
        if (r) return r;
      }
    }
  }
  return null;
}

async function main() {
  const POPULAR = ['현대', '기아', '제네시스', 'KG모빌리티(쌍용)'];
  const tree = {};

  for (const maker of POPULAR) {
    console.log('\n=== ' + maker + ' 차종 트리 ===');
    const qMaker = encodeURIComponent(`(And.Hidden.N._.(C.CarType.A._.Manufacturer.${maker}.))`);
    const urlMaker = `https://api.encar.com/search/car/list/mobile?count=true&q=${qMaker}&inav=%7CModelGroup`;
    const respMaker = await fetchUrl(urlMaker);
    if (typeof respMaker === 'string') { console.log('  ! 응답 비-JSON: ' + respMaker.slice(0,100)); continue; }
    const modelGroups = findFacet(respMaker.iNav?.Nodes, 'ModelGroup') || [];
    console.log('  ModelGroup ' + modelGroups.length + '개');
    tree[maker] = {};

    for (const mg of modelGroups) {
      const mgName = mg.Value;
      const mgCount = mg.Count;
      const qModel = encodeURIComponent(`(And.Hidden.N._.(C.CarType.A._.(C.Manufacturer.${maker}._.ModelGroup.${mgName}.)))`);
      const urlModel = `https://api.encar.com/search/car/list/mobile?count=true&q=${qModel}&inav=%7CModel`;
      const respModel = await fetchUrl(urlModel);
      await sleep(150);   // rate limit 회피
      if (typeof respModel === 'string') { console.log('  ! ' + mgName + ' 응답 비-JSON'); continue; }
      const models = findFacet(respModel.iNav?.Nodes, 'Model') || [];
      tree[maker][normalize(mgName)] = {
        count: mgCount,
        original: mgName,
        models: models.map(m => ({ value: normalize(m.Value), original: m.Value, count: m.Count }))
      };
      console.log('  ' + normalize(mgName) + ' (' + mgCount + ') → ' + models.length + ' 세부모델');
    }
    await sleep(500);   // 메이커 간 sleep
  }

  fs.writeFileSync(OUT, JSON.stringify(tree, null, 2));
  console.log('\n✓ ' + OUT + ' 저장 완료');
}

main().catch(e => { console.error(e); process.exit(1); });
