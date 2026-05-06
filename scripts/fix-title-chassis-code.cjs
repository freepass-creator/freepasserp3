#!/usr/bin/env node
/**
 * catalog_id 의 chassis 부분을 title 끝에 자동 추가.
 *  catalog_id 형식: {maker}_{model}_{chassis}[_{variant}]
 *  예: kia_carnival_yp → chassis "YP" → title 에 "YP" 추가 (없으면)
 *
 *  사용:
 *    node scripts/fix-title-chassis-code.cjs        # dry-run
 *    node scripts/fix-title-chassis-code.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

// 한글 메이커 매핑 (catalog_id 의 영문 prefix → 한글 메이커)
const MAKER_PREFIX = ['kia', 'hyundai', 'genesis', 'kgm', 'chevrolet', 'renault'];

// chassis code 패턴
const CHASSIS_RE = /^([A-Z]{2,4}\d{0,3}|[A-Z]\d{2,3})[A-Z]?$/i;

// suffix 키워드 — 이거 들어가있으면 chassis 가 아님 (variant 표기)
const VARIANT_SUFFIXES = new Set(['pre', 'facelift', 'facelift1', 'facelift2', 'hybrid', 'ev', 'electric', 'lpg', 'diesel', 'coupe', 'st', 'shooting', 'limousine', 'cab', 'hi', 'edge']);

// 모델명 영문 표기 — chassis code 아님 (한글 모델명의 transliteration)
const MODEL_ENGLISH_NAMES = new Set([
  'BOLT', 'CRUZE', 'SPARK', 'TAHOE', 'TRAX', 'TRAILBLAZER', 'COLORADO', 'EQUINOX', 'IMPALA', 'CAMARO', 'MALIBU',
  'VENUE', 'KONA', 'TUCSON', 'CASPER', 'AVANTE', 'STARIA',
  'RAY', 'MORNING', 'STINGER', 'TASMAN', 'BONGO', 'SELTOS', 'NIRO', 'SORENTO', 'SPORTAGE', 'CARNIVAL', 'MOHAVE',
  'MUSSO', 'TIVOLI', 'TORRES', 'ACTYON', 'KORANDO', 'REXTON',
  'CHEROKEE', 'WRANGLER', 'COMPASS', 'GLADIATOR',
  'NEW', 'AIR', 'KHAN', 'SPORTS',   // 형용사/접미사
]);

const files = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'));

const fixes = [];

for (const f of files) {
  const filePath = path.join(CATALOG_DIR, f);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const cid = data.catalog_id || f.replace('.json', '');
  const title = data.title || '';
  const maker = data.maker || '';

  // catalog_id 의 chassis 추출
  if (!MAKER_PREFIX.some(p => cid.startsWith(p + '_'))) continue;
  const tokens = cid.split('_').slice(1);
  // suffix 제거 (페리/하이브리드 등 variant)
  const cleanTokens = [];
  for (const t of tokens) {
    if (VARIANT_SUFFIXES.has(t.toLowerCase())) continue;
    cleanTokens.push(t);
  }
  const lastTok = cleanTokens[cleanTokens.length - 1] || '';
  if (!lastTok) continue;
  const chassisCode = lastTok.toUpperCase();
  // chassis code 인지 검증
  if (!CHASSIS_RE.test(chassisCode)) continue;
  // 모델명 영문 표기는 skip (CRUZE / TAHOE / RAY 등)
  if (MODEL_ENGLISH_NAMES.has(chassisCode)) continue;

  // title 에 이미 chassis code 가 있으면 skip (trailing punctuation 도 정리)
  const titleNoMaker = title.replace(new RegExp('^' + maker + '\\s+'), '').trim();
  const titleTokens = titleNoMaker.split(/\s+/).map(t => t.replace(/[,.]/g, '').toUpperCase());
  if (titleTokens.includes(chassisCode)) continue;

  // 추가 필요
  const newTitle = `${title} ${chassisCode}`.trim();
  fixes.push({ cid, oldTitle: title, newTitle, chassisCode });
}

console.log(`총 ${fixes.length}개 catalog title 에 chassis code 추가 필요`);
console.log('');
fixes.slice(0, 50).forEach(f => {
  console.log(`  ${f.cid}: "${f.oldTitle}" → "${f.newTitle}"`);
});
if (fixes.length > 50) console.log(`  ... +${fixes.length - 50}건`);
console.log('');

if (!APPLY) {
  console.log('[dry-run] --apply 추가하면 실제 수정');
  process.exit(0);
}

let applied = 0;
for (const f of fixes) {
  const filePath = path.join(CATALOG_DIR, `${f.cid}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  data.title = f.newTitle;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  applied++;
}
console.log(`✓ ${applied}건 적용`);
