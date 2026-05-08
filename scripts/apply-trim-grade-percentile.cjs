#!/usr/bin/env node
/**
 * 차등 안 된 catalog (모든 trim basic 동일) 의 trim 등급별 옵션 percentile 차등화.
 *  카테고리별 등급 정책:
 *   - 파워트레인/안전/지능형 안전 기술: 모든 trim 100% (안전 사양은 등급 무관)
 *   - 외관: base 75%, top 100% (캘리그래피 디자인 등은 top 만)
 *   - 내장: base 70%, top 100%
 *   - 시트: base 70%, top 100% (1열 통풍/2열 열선 등 mid+)
 *   - 편의: base 60%, top 100% (지문 인증/무선 충전 등 mid+)
 *   - 인포테인먼트: base 60%, top 100% (BOSE/HUD 등 top 만)
 *
 *  trim 등급 (낮음→높음): catalog 내 각 trim 의 등급 사전화
 *  부정확한 추정이지만 매트릭스 가시성 향상.
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// trim 명 등급 (낮음→높음)
const TRIM_GRADE = {
  '디럭스': 0, '스탠다드': 0, '스마트': 0, '트렌디': 0, '베이직': 0, '마이너스': 0,
  '에어': 0, '라이트': 0, 'MX': 0, 'L5': 0, 'EX': 0, 'S7': 0, 'T5': 0, 'E3': 0,
  '럭셔리': 1, '모던': 1, '프리미엄': 1, '어스': 1, '에어롱레인지': 1, 'LX': 1, 'V5': 1, 'E5': 1, 'C5': 1,
  '프레스티지': 2, '노블레스': 2, '익스클루시브': 2, '베스트': 2, '언리미티드': 2, 'V7': 2, 'C7': 2, 'E7': 2,
  '시그니처': 3, '캘리그래피': 3, '마스터즈': 3, '플래티넘': 3, '그래비티': 3, 'X': 3, 'X5': 3, 'X7': 3, 'T7': 3,
  '인스퍼레이션': 3, 'GT-Line': 3, 'X-Line': 3, 'VIP': 3, '프레지던트': 3, '아너스': 3, 'HiLLT': 3,
  '셀러브리티': 3, '르블랑': 2,
};
function trimGrade(k) {
  const tokens = k.split(/\s+/);
  for (const t of tokens) {
    const norm = t.replace(/[\sⅠⅡⅢⅣI]+/g, '');
    if (TRIM_GRADE[norm] != null) return TRIM_GRADE[norm];
  }
  return 1;
}

// 카테고리별 base 비율 (등급 0 시 비율, 등급 3 = 100%)
const CAT_BASE_RATIO = {
  '파워트레인/성능': 1.0,
  '안전': 1.0,
  '지능형 안전 기술': 0.85,   // 일부 ADAS 는 top trim 만
  '외관': 0.75,
  '내장': 0.70,
  '시트': 0.70,
  '편의': 0.60,
  '인포테인먼트': 0.60,
};

const POPULAR = ['현대', '기아', '제네시스', 'KGM'];

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!POPULAR.includes(d.maker)) continue;
  const opt = Object.keys(d.options || {}).length;
  if (opt < 30) continue;
  const trimEntries = Object.entries(d.trims || {});
  if (trimEntries.length < 2) continue;
  // 모든 trim basic 동일하면만 차등 적용
  const sizes = trimEntries.map(([_, t]) => (t.basic || []).length);
  const max = Math.max(...sizes), min = Math.min(...sizes);
  if (min !== max || max < 30) continue;
  // trim 등급 사전 + 정렬
  const trimWithGrade = trimEntries.map(([k, t]) => ({ k, t, grade: trimGrade(k) }));
  // 등급 분포 확인 (모두 같은 등급이면 차등 안함)
  const grades = [...new Set(trimWithGrade.map(x => x.grade))];
  if (grades.length < 2) continue;
  const minGrade = Math.min(...grades), maxGrade = Math.max(...grades);
  // 카테고리별 코드 사전화
  const allBasicCodes = trimWithGrade[0].t.basic || [];
  const catByCode = {};
  for (const code of allBasicCodes) {
    catByCode[code] = d.options?.[code]?.category || '편의';
  }
  // 각 trim 별로 카테고리별 percentile 적용
  for (const { k, t, grade } of trimWithGrade) {
    // 등급 0~maxGrade 비율: ratio = baseRatio + (1-baseRatio) * (grade-min)/(max-min)
    const newBasic = [];
    // 카테고리별 분류 후 ratio 적용
    const byCategory = {};
    for (const code of allBasicCodes) {
      const c = catByCode[code];
      if (!byCategory[c]) byCategory[c] = [];
      byCategory[c].push(code);
    }
    for (const [c, codes] of Object.entries(byCategory)) {
      const baseRatio = CAT_BASE_RATIO[c] != null ? CAT_BASE_RATIO[c] : 0.70;
      const ratio = baseRatio + (1 - baseRatio) * ((grade - minGrade) / Math.max(maxGrade - minGrade, 1));
      const cnt = Math.round(codes.length * ratio);
      newBasic.push(...codes.slice(0, cnt));
    }
    t.basic = newBasic;
  }
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title}`);
  for (const { k, t, grade } of trimWithGrade) console.log(`  ${k} (등급 ${grade}) basic=${(t.basic || []).length}`);
  touched++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog`);
