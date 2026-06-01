#!/usr/bin/env node
/**
 * 규격화 1단계: 단일 (동력원, 배기량) catalog 의 title 에 동력원+배기량 토큰 추가.
 *  - trim 키에서 동력원/배기량 토큰 추출
 *  - 단일이면 title 끝에 토큰 append (이미 있으면 skip)
 *  - 다중이면 보고만 (split 은 다음 단계)
 *
 *  catalog 파일명은 변경 안 함 (다음 단계에서 split 시 함께 갱신)
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const FUEL_DISP_PATTERNS = [
  { re: /하이브리드\s+(\d\.\d)(\s*T)?/, fmt: (m) => '하이브리드 ' + m[1] + (m[2] ? ' T' : '') },
  { re: /(HEV)\s+(\d\.\d)(\s*T)?/, fmt: (m) => '하이브리드 ' + m[2] + (m[3] ? ' T' : '') },
  { re: /\b(EV|일렉트릭)\b/, fmt: () => 'EV' },
  { re: /수소/, fmt: () => '수소' },
  { re: /(가솔린)\s+(\d\.\d)(\s*T)?/, fmt: (m) => '가솔린 ' + m[2] + (m[3] ? ' T' : '') },
  { re: /(디젤)\s+R?(\d\.\d)/, fmt: (m) => '디젤 ' + m[2] },
  { re: /(LPi|LPG)\s+(\d\.\d)/, fmt: (m) => 'LPG ' + m[2] },
];

function extractToken(trimKey) {
  for (const p of FUEL_DISP_PATTERNS) {
    const m = trimKey.match(p.re);
    if (m) return p.fmt(m);
  }
  return null;
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const single = [];   // 단일 (동력원,배기량) — title 갱신 대상
const multi = [];    // 다중 — split 대상

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const trims = Object.keys(d.trims || {});
  if (trims.length === 0) continue;

  const tokens = new Set();
  const noToken = [];
  for (const k of trims) {
    const t = extractToken(k);
    if (t) tokens.add(t);
    else noToken.push(k);
  }

  if (tokens.size === 1 && noToken.length === 0) {
    const token = [...tokens][0];
    // title 끝 동력원만 (배기량 없이) 있으면 제거 후 token 추가 (중복 회피)
    const FUEL_ONLY_RE = /\s+(가솔린|디젤|LPG|LPi|하이브리드|EV|수소|플러그인하이브리드)$/;
    let cleanTitle = d.title.replace(FUEL_ONLY_RE, '');
    if (!cleanTitle.endsWith(token)) {
      single.push({ f, oldTitle: d.title, cleanTitle, token, d });
    }
  } else if (tokens.size > 1 || noToken.length > 0) {
    multi.push({ f, title: d.title, tokens: [...tokens], noToken, tn: trims.length });
  }
}

console.log('=== 단일 (동력원,배기량) catalog title 갱신 (' + single.length + '개) ===');
for (const x of single) {
  const newTitle = x.cleanTitle + ' ' + x.token;
  console.log('  ' + (APPLY ? '✓' : '+') + ' ' + x.oldTitle + ' → ' + newTitle);
  if (APPLY) {
    x.d.title = newTitle;
    fs.writeFileSync(path.join(DIR, x.f), JSON.stringify(x.d, null, 2));
  }
}

console.log('\n=== 다중 (동력원,배기량) 또는 토큰 누락 catalog (' + multi.length + '개) ===');
multi.forEach(x => {
  const noTokenSummary = x.noToken.length ? ' / 누락: ' + x.noToken.length + 'trim' : '';
  console.log('  • ' + x.title + ' [' + x.f + ']: ' + x.tokens.join(' / ') + noTokenSummary);
});

console.log('\n' + (APPLY ? '적용' : 'dry-run') + ': 단일 ' + single.length + ' 갱신 / 다중 ' + multi.length + ' 대기');
