#!/usr/bin/env node
/**
 * 하이브리드 catalog title 순서 정리.
 *  변경: "메이커 [페리] 모델 chassis 하이브리드" → "메이커 [페리] 모델 하이브리드 chassis"
 *  예:   "현대 그랜저 GN7 하이브리드" → "현대 그랜저 하이브리드 GN7"
 *        "기아 더 뉴 K5 DL3 하이브리드" → "기아 더 뉴 K5 하이브리드 DL3"
 *
 *  사용:
 *    node scripts/fix-hybrid-title-order.cjs            # dry-run
 *    node scripts/fix-hybrid-title-order.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

// chassis 코드 패턴: 영문 1+ + 숫자 0+ (TM, CN7, DL3, MQ4, NQ5, GN7 등). 한글 모델명/변형 토큰 제외.
const CHASSIS_RE = /^[A-Z][A-Z0-9]{0,5}$/;

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const title = d.title || '';
  if (!/\s하이브리드\s*$/.test(title)) continue;
  // 마지막 "하이브리드" 제거
  const woHy = title.replace(/\s*하이브리드\s*$/, '').trim();
  // 마지막 토큰이 chassis 코드면 swap
  const tokens = woHy.split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (!CHASSIS_RE.test(last)) {
    console.log(`  ! skip — chassis 코드 토큰 미인식: ${title}`);
    continue;
  }
  const rest = tokens.slice(0, -1).join(' ');
  const newTitle = `${rest} 하이브리드 ${last}`;
  if (newTitle === title) continue;
  d.title = newTitle;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${title}  →  ${newTitle}`);
  touched++;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog 타이틀 순서 정리`);
