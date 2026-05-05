#!/usr/bin/env node
/**
 * 단계 1 진단 — 매물 maker/model 표기 분포 + catalog maker 셋과 비교
 *
 * 출력:
 *   - 매물 maker 분포 (catalog maker 셋과 매칭/불일치 표시)
 *   - 메이커별 model 토큰 분포 (catalog title 키워드와 매칭/불일치)
 *   - 메타 시그널 가용성 (year, first_registration_date 보유율)
 *
 *   운영 RTDB read-only — write 없음.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const KEY = 'C:/Users/admin/OneDrive/Music/freepasserp-firebase-adminsdk-fbsvc-c295b69d1f.json';
admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
});

// catalog maker 셋
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_index.json'), 'utf8'));
const catalogMakers = new Set();
const catalogModelsByMaker = {};
for (const e of Object.values(idx)) {
  if (!e.maker) continue;
  catalogMakers.add(e.maker);
  if (!catalogModelsByMaker[e.maker]) catalogModelsByMaker[e.maker] = new Set();
  // title 의 model 토큰 (maker prefix 제거 후 첫 토큰)
  const titleTokens = (e.title || '').replace(new RegExp('^' + e.maker + '\\s+'), '').split(/\s+/);
  for (const t of titleTokens) {
    if (t && t.length >= 2) catalogModelsByMaker[e.maker].add(t);
  }
}

(async () => {
  console.log('Firebase RTDB 연결 중...');
  const db = admin.database();
  const snap = await db.ref('products').once('value');
  const products = snap.val() || {};
  const all = Object.entries(products).map(([k, v]) => ({ _key: k, ...v }))
    .filter(p => !p._deleted && p.status !== 'deleted');
  console.log(`✓ 매물 ${all.length}대 로드\n`);

  // === maker 분포 ===
  const makers = {};
  let noMaker = 0, noModel = 0;
  let withYear = 0, withRegDate = 0, withFuel = 0, withCC = 0;
  for (const p of all) {
    const k = p.maker || '(빈값)';
    makers[k] = (makers[k] || 0) + 1;
    if (!p.maker) noMaker++;
    if (!p.model) noModel++;
    if (p.year) withYear++;
    if (p.first_registration_date) withRegDate++;
    if (p.fuel_type) withFuel++;
    if (p.engine_cc) withCC++;
  }

  console.log('=== 매물 maker 분포 ===');
  Object.entries(makers).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
    const inCat = catalogMakers.has(k);
    const mark = inCat ? '✓' : '✗ catalog 없음';
    console.log(`  ${v.toString().padStart(3)}  ${k.padEnd(15)} ${mark}`);
  });

  console.log('\n=== 메타 시그널 가용성 ===');
  console.log(`  year:                  ${withYear}/${all.length} (${(withYear/all.length*100).toFixed(0)}%)`);
  console.log(`  first_registration:    ${withRegDate}/${all.length} (${(withRegDate/all.length*100).toFixed(0)}%)`);
  console.log(`  fuel_type:             ${withFuel}/${all.length} (${(withFuel/all.length*100).toFixed(0)}%)`);
  console.log(`  engine_cc:             ${withCC}/${all.length} (${(withCC/all.length*100).toFixed(0)}%)`);
  console.log(`  maker 비어있음:        ${noMaker}`);
  console.log(`  model 비어있음:        ${noModel}`);

  // === 메이커별 model 토큰 분포 (catalog 매칭 안되는 model 식별) ===
  const modelByMaker = {};
  for (const p of all) {
    if (!p.maker || !p.model) continue;
    if (!modelByMaker[p.maker]) modelByMaker[p.maker] = {};
    modelByMaker[p.maker][p.model] = (modelByMaker[p.maker][p.model] || 0) + 1;
  }

  console.log('\n=== 메이커별 model 표기 ===');
  for (const [maker, models] of Object.entries(modelByMaker).sort((a,b) => Object.values(b[1]).reduce((s,n)=>s+n,0) - Object.values(a[1]).reduce((s,n)=>s+n,0))) {
    const total = Object.values(models).reduce((s,n)=>s+n,0);
    console.log(`\n[${maker} / ${total}대]`);
    const catTokens = catalogModelsByMaker[maker] || new Set();
    Object.entries(models).sort((a,b)=>b[1]-a[1]).forEach(([model, n]) => {
      // catalog title 토큰 안에 매물 model 키워드가 있는지 — 단순 substring
      const found = [...catTokens].some(t => model.includes(t) || t.includes(model));
      const mark = found ? '✓' : '⚠';
      console.log(`  ${n.toString().padStart(3)}  ${mark}  ${model}`);
    });
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
