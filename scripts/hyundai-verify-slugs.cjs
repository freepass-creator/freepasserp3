/**
 * 모델 슬러그 일괄 검증 — 각 /price 페이지 status 확인
 */
const https = require('https');
const models = require('./hyundai-models.cjs');

function head(url) {
  return new Promise(resolve => {
    const req = https.request(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      // 리다이렉트 처리
      if (res.statusCode === 301 || res.statusCode === 302) {
        resolve({ status: res.statusCode, redirect: res.headers.location });
      } else {
        resolve({ status: res.statusCode });
      }
      res.resume();
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.end();
  });
}

(async () => {
  console.log('현대 모델 슬러그 검증 (', models.length, '개)\n');
  for (const [catId, slug, title] of models) {
    const url = `https://www.hyundai.com/kr/ko/e/vehicles/${slug}/price`;
    const r = await head(url);
    let icon = '✓';
    if (r.status !== 200) icon = '✗';
    if (r.redirect) icon = '↪';
    const note = r.redirect ? ` → ${r.redirect}` : (r.error ? ` (${r.error})` : '');
    console.log(`  ${icon} [${r.status}] ${slug.padEnd(28)} | ${title}${note}`);
  }
})();
