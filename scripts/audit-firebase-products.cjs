#!/usr/bin/env node
/**
 * Firebase RTDB 매물 전수 검수
 *   매물 371대 (또는 전체) 의 catalog/trim 매칭 시뮬 + 변경 후보 보고
 *
 *   사용:
 *     node scripts/audit-firebase-products.cjs
 *
 *   출력:
 *     docs/firebase-products-audit.md
 *
 *   주의: 운영 데이터 read-only. write 없음.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const KEY = 'C:/Users/admin/OneDrive/Music/freepasserp-firebase-adminsdk-fbsvc-c295b69d1f.json';
admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
});

const aliases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_aliases-map.json'), 'utf8'));
const yearRanges = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_year-ranges.json'), 'utf8'));
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_index.json'), 'utf8'));

const norm = s => (s||'').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g,'').replace(/\s+/g,'');
function inRange(year, range) {
  if (!year || !range) return null;
  const y = parseInt(year, 10);
  const startY = parseInt((range.start||'').match(/(\d{4})/)?.[1]||0);
  const endY = range.end === '현재' ? 9999 : parseInt((range.end||'').match(/(\d{4})/)?.[1]||0);
  if (!startY) return null;
  return y >= startY && y <= endY;
}

// catalog 후보 좁히기 — maker 별
const candidatesByMaker = {};
for (const e of Object.values(idx)) {
  if (!candidatesByMaker[e.maker]) candidatesByMaker[e.maker] = [];
  const titleNoMaker = (e.title||'').replace(new RegExp('^'+e.maker+'\\s+'),'').trim();
  const tokens = titleNoMaker.split(/\s+/).filter(Boolean);
  candidatesByMaker[e.maker].push({
    catalogId: e.id,
    title: e.title,
    tokensNorm: tokens.map(t => norm(t)),
  });
}

// 매물 매칭 (간단 점수: model +10, year ±20/-30)
function matchProduct(p) {
  const maker = p.maker;
  const sub = p.sub_model || '';
  const model = p.model || '';
  const year = parseInt(p.year || (p.first_registration_date||'').match(/(\d{4})/)?.[1] || 0);

  // 1차 alias-map 직접 매칭
  if (sub) {
    const cid = aliases[`${maker}|${norm(sub)}`];
    if (cid) {
      const inR = year ? inRange(year, yearRanges[cid]) : null;
      return { catalogId: cid, via: 'alias', score: 100, year, inRange: inR };
    }
  }

  // 2차 model + year 추정
  const candidates = candidatesByMaker[maker] || [];
  if (!candidates.length) return null;
  const subN = norm(sub);
  const mdN = norm(model);
  if (!subN && !mdN) return null;

  const scored = candidates.map(c => {
    let score = 0;
    for (const tn of c.tokensNorm) {
      if (!tn) continue;
      if (subN.includes(tn)) score += tn.length;
      else if (mdN && mdN.includes(tn)) score += Math.floor(tn.length / 2);
    }
    if (mdN && c.tokensNorm.some(tn => tn && (mdN.includes(tn) || tn.includes(mdN)))) score += 10;
    if (year) {
      const r = inRange(year, yearRanges[c.catalogId]);
      if (r === true) score += 20;
      else if (r === false) score -= 30;
    }
    return { ...c, score };
  });
  scored.sort((a,b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score <= 0) return null;
  return { catalogId: top.catalogId, via: 'score', score: top.score, year };
}

(async () => {
  console.log('Firebase RTDB 연결 중...');
  const db = admin.database();
  const snap = await db.ref('products').once('value');
  const products = snap.val() || {};
  const all = Object.entries(products).map(([k, v]) => ({ _key: k, ...v }))
    .filter(p => !p._deleted && p.status !== 'deleted');
  console.log(`✓ 매물 ${all.length}대 로드`);

  const stats = { total: all.length, matched: 0, missed: 0, sameSub: 0, changedSub: 0 };
  const cases = [];
  for (const p of all) {
    const r = matchProduct(p);
    if (!r) {
      stats.missed++;
      cases.push({ p, r: null, action: 'no_catalog' });
      continue;
    }
    stats.matched++;
    const newTitle = idx[r.catalogId]?.title || '';
    const newSub = newTitle.replace(new RegExp('^'+(p.maker||'')+'\\s+'),'').trim();
    const sameSub = (p.sub_model || '').trim() === newSub;
    if (sameSub) stats.sameSub++;
    else stats.changedSub++;
    cases.push({ p, r, action: sameSub ? 'no_change' : 'sub_change', newSub, newTitle });
  }

  // 보고서 작성
  const lines = [];
  lines.push('# Firebase 매물 전수 검수');
  lines.push('');
  lines.push(`> 생성: ${new Date().toISOString().slice(0,16).replace('T',' ')}`);
  lines.push(`> 운영 RTDB read-only — write 없음`);
  lines.push('');
  lines.push('## 요약');
  lines.push('');
  lines.push(`- 매물 총: **${stats.total}**`);
  lines.push(`- catalog 매칭: **${stats.matched}** (${(stats.matched/stats.total*100).toFixed(1)}%)`);
  lines.push(`- catalog 없음: **${stats.missed}** (${(stats.missed/stats.total*100).toFixed(1)}%)`);
  lines.push(`- sub_model 변경 필요: **${stats.changedSub}**`);
  lines.push(`- 변경 없음: ${stats.sameSub}`);
  lines.push('');
  lines.push('## sub_model 변경 케이스 (top 50)');
  lines.push('');
  lines.push('| # | car_no | maker | year | 현재 sub_model | 현재 trim | → 신규 sub | catalog | via |');
  lines.push('|---:|---|---|---:|---|---|---|---|---|');
  cases.filter(c => c.action === 'sub_change').slice(0, 50).forEach((c, i) => {
    const p = c.p;
    lines.push(`| ${i+1} | ${p.car_number||'?'} | ${p.maker||'?'} | ${p.year||'?'} | ${p.sub_model||'·'} | ${p.trim_name||p.trim||'·'} | ${c.newSub} | ${c.r.catalogId} | ${c.r.via} |`);
  });
  lines.push('');
  lines.push('## catalog 매칭 안 된 매물 (top 30)');
  lines.push('');
  lines.push('| car_no | maker | model | sub | year | fuel |');
  lines.push('|---|---|---|---|---:|---|');
  cases.filter(c => c.action === 'no_catalog').slice(0, 30).forEach(c => {
    const p = c.p;
    lines.push(`| ${p.car_number||'?'} | ${p.maker||'?'} | ${p.model||'?'} | ${p.sub_model||'·'} | ${p.year||'?'} | ${p.fuel_type||'·'} |`);
  });

  const OUTPUT = path.join(__dirname, '..', 'docs', 'firebase-products-audit.md');
  fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');

  console.log(`✓ ${stats.total} 매물 분석`);
  console.log(`  catalog 매칭: ${stats.matched} (${(stats.matched/stats.total*100).toFixed(1)}%)`);
  console.log(`  catalog 없음: ${stats.missed}`);
  console.log(`  sub_model 변경: ${stats.changedSub}`);
  console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
