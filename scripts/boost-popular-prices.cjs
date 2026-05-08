#!/usr/bin/env node
/**
 * 인기 모델 가격 누락 trim 보강.
 *  - 그랜저 GN7 / 하이브리드 GN7
 *  - 더 뉴 아반떼 CN7 / 하이브리드 CN7
 *  - 캐스퍼 AX (페리 전/후 모두)
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

const PRICES = {
  'hyundai_grandeur_gn7.json': {
    '캘리그래피 블랙 익스테리어 가솔린 2.5': 47160000,
    '캘리그래피 블랙 잉크 가솔린 2.5':       48910000,
  },
  'hyundai_grandeur_gn7_hybrid.json': {
    '프리미엄 하이브리드 2.4':    43760000,
    '익스클루시브 하이브리드 2.4': 47010000,
    '캘리그래피 하이브리드 2.4':   53170000,
  },
  'hyundai_avante_cn7.json': {
    'N 라인 가솔린 1.6': 26540000,
  },
  'hyundai_avante_cn7_hybrid.json': {
    '프리미엄 하이브리드 1.6':    27060000,
    '익스클루시브 하이브리드 1.6': 28910000,
    '프레스티지 하이브리드 1.6':   30730000,
    '캘리그래피 하이브리드 1.6':   32030000,
  },
  'hyundai_casper_pre.json': {
    '스마트 가솔린 1.0':       13850000,
    '스마트 가솔린 1.0 T':     16100000,
    '모던 가솔린 1.0':         15900000,
    '모던 가솔린 1.0 T':       18150000,
    '인스퍼레이션 가솔린 1.0':  18550000,
    '인스퍼레이션 가솔린 1.0 T':20800000,
    '액티브 2 가솔린 1.0':     17200000,
    '액티브 2 가솔린 1.0 T':   19450000,
    '크로스 가솔린 1.0':       19100000,
    '크로스 가솔린 1.0 T':     21000000,
  },
  'hyundai_casper.json': {
    '프리미엄 가솔린 1.0':       15650000,
    '프리미엄 가솔린 1.0 T':     17900000,
    '인스퍼레이션 가솔린 1.0':   18700000,
    '인스퍼레이션 가솔린 1.0 T': 20950000,
    '크로스 가솔린 1.0':         19250000,
    '크로스 가솔린 1.0 T':       21150000,
  },
};

let touched = 0, applied = 0;
for (const [f, prices] of Object.entries(PRICES)) {
  const fp = path.join(DIR, f);
  if (!fs.existsSync(fp)) { console.log('! 누락 ' + f); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let changed = 0;
  for (const [k, p] of Object.entries(prices)) {
    if (d.trims?.[k] && !d.trims[k].price?.base) {
      d.trims[k].price = { base: p };
      changed++;
    } else if (d.trims?.[k]?.price?.base) {
      // 이미 있음
    } else {
      console.log('  ! ' + f + ' / 누락 trim: ' + k);
    }
  }
  if (changed && APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log((APPLY ? '✓' : '+') + ' ' + d.title + ' — ' + changed + '개 trim 가격 보강');
  applied += changed;
  if (changed) touched++;
}
console.log('\n' + (APPLY ? '적용' : 'dry-run') + ': ' + touched + '개 catalog · ' + applied + '개 trim 가격 보강');
