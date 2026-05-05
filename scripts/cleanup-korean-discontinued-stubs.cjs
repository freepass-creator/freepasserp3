#!/usr/bin/env node
/**
 * 한국 단종 auto_stub catalog 정리
 *   - 사용자 정책: 2017년 이후 생산 차량만. 단종 예외만 유지.
 *
 *   유지 단종 catalog (사용자 명시):
 *     - 그랜저 HG / 아반떼 AD / 그랜드 스타렉스 / 포터 / 봉고
 *
 *   제거 대상:
 *     - source: 'auto_stub'
 *     - 한국 메이커 (현대/기아/제네시스/KGM/르노/쉐보레)
 *     - 위 유지 화이트리스트 외
 *
 *   _index.json 도 갱신
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// 단종 인정 한국차 키워드 (catalog id 또는 title 매칭)
const KEEP_KEYWORDS = [
  'grandeur_hg', '그랜저hg', 'grandeur hg',
  'avante_ad', 'avante ad', '아반떼ad', '아반떼 ad',
  'grand_starex', '그랜드_스타렉스', '그랜드스타렉스', 'starex',
  'porter', '포터',
  'bongo', '봉고',
];

const KOREAN_MAKERS = ['현대', '기아', '제네시스', 'KGM', '르노', '쉐보레'];

function shouldKeep(catalog, id) {
  const t = (catalog.title || '').toLowerCase();
  const idLower = id.toLowerCase();
  return KEEP_KEYWORDS.some(kw => idLower.includes(kw) || t.includes(kw));
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const removed = [];
const kept = [];

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const id = d.catalog_id || f.replace(/\.json$/, '');
  if (d.source !== 'auto_stub') continue;
  if (!KOREAN_MAKERS.includes(d.maker)) continue;
  if (shouldKeep(d, id)) {
    kept.push(id);
    continue;
  }
  fs.unlinkSync(fp);
  removed.push(id);
}

console.log(`✓ 제거: ${removed.length} catalog`);
console.log(`✓ 단종 예외 유지: ${kept.length} catalog`);
if (removed.length) console.log('  제거 sample:', removed.slice(0, 15).join(', '));
if (kept.length) console.log('  유지:', kept.join(', '));
