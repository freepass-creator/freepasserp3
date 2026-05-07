#!/usr/bin/env node
/**
 * 통합 옵션 사전 자동 구축 (Phase 1).
 *  - 모든 catalog 의 옵션을 메이커별로 수집
 *  - FP_KEYWORD_RULES 매칭: FP 표준 ID 그대로 사용 (HUD, AVMS, ...)
 *  - 매칭 실패: 메이커 prefix + 옵션명 슬러그 (예: HMC_KRELL_PREMIUM_SOUND)
 *  - 같은 옵션명 다른 표기 정규화 (공백/괄호/특수문자 제거)
 *  - 출력: public/data/car-master/_unified-options.json
 *
 *  사용:
 *    node scripts/build-unified-options-dict.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const OUT_PATH = path.join(CATALOG_DIR, '_unified-options.json');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const MASTER_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-options-master.js');

// FP_KEYWORD_RULES + FP_OPT_MASTER 로드
const rulesSrc = fs.readFileSync(RULES_PATH, 'utf8');
const RULES = [];
for (const m of rulesSrc.matchAll(/\{\s*kw:\s*['"]([^'"]+)['"]\s*,\s*ids:\s*\[([^\]]+)\]\s*\}/g)) {
  const ids = m[2].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  RULES.push({ kw: m[1], ids });
}
RULES.sort((a, b) => b.kw.length - a.kw.length);
const masterSrc = fs.readFileSync(MASTER_PATH, 'utf8');
const FP_NAMES = {};
for (const m of masterSrc.matchAll(/\['([A-Z_0-9]+)'\s*,\s*'([^']+)'/g)) FP_NAMES[m[1]] = m[2];

function normName(s) {
  return (s || '').toLowerCase().replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '').replace(/\s+/g, '');
}
function matchFpIds(text) {
  const n = normName(text);
  const matched = new Set();
  for (const r of RULES) if (n.includes(normName(r.kw))) for (const id of r.ids) matched.add(id);
  return [...matched].sort();
}

// 메이커 prefix
const MAKER_PREFIX = {
  '현대': 'HMC', '기아': 'KIA', '제네시스': 'GEN', 'KGM': 'KGM',
  '쉐보레': 'CHV', 'BMW': 'BMW', '벤츠': 'MBZ', '아우디': 'AUD',
  '미니': 'MIN', '볼보': 'VOL', '폭스바겐': 'VW', '포르쉐': 'POR',
  '랜드로버': 'LR', '재규어': 'JAG', '렉서스': 'LEX', '도요타': 'TOY',
  '토요타': 'TOY', '혼다': 'HND', '닛산': 'NIS', '인피니티': 'INF',
  '포드': 'FRD', '지프': 'JEP', '캐딜락': 'CAD', '링컨': 'LIN',
  '테슬라': 'TSL', '마세라티': 'MAS', '벤틀리': 'BEN', '롤스로이스': 'RR',
  '람보르기니': 'LAM', '페라리': 'FER', '르노': 'REN', '쌍용': 'KGM',
};
function slugify(name) {
  // 옵션명 → 슬러그 (영숫자 + 한글 + 언더스코어)
  return (name || '').replace(/[^a-zA-Z0-9가-힣]+/g, '_').replace(/^_|_$/g, '').slice(0, 60).toUpperCase();
}

// 통합 사전 구축
const unified = {};
// FP 표준 entry 먼저 등록
for (const [id, name] of Object.entries(FP_NAMES)) {
  unified[id] = { name, fp_id: id, source: 'fp' };
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const seenByMaker = {};   // 메이커 → normalized name set (중복 회피)
let makerOptCount = 0;

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const maker = d.maker;
  const prefix = MAKER_PREFIX[maker];
  if (!prefix) continue;
  if (!seenByMaker[maker]) seenByMaker[maker] = {};
  const opts = d.options || {};
  for (const [code, info] of Object.entries(opts)) {
    if (code.startsWith('PKG_')) continue;
    const name = info.name || '';
    if (!name) continue;
    const fpIds = matchFpIds(name);
    if (fpIds.length) continue;  // FP 매핑되는 옵션은 FP ID 그대로 사용 (별도 등록 X)
    const norm = normName(name);
    if (seenByMaker[maker][norm]) continue;  // 같은 옵션명 (정규화 후 동일) 중복 방지
    const slug = slugify(name);
    let id = `${prefix}_${slug}`;
    // ID 충돌 회피
    let suffix = 1;
    while (unified[id]) {
      id = `${prefix}_${slug}_${++suffix}`;
    }
    unified[id] = {
      name,
      fp_id: null,
      source: 'maker',
      maker,
      category: info.category || null,
    };
    seenByMaker[maker][norm] = id;
    makerOptCount++;
  }
}

fs.writeFileSync(OUT_PATH, JSON.stringify(unified, null, 2));
console.log(`✓ ${path.relative(process.cwd(), OUT_PATH)}`);
console.log(`  FP 표준: ${Object.values(unified).filter(v => v.source === 'fp').length}`);
console.log(`  메이커 고유: ${Object.values(unified).filter(v => v.source === 'maker').length}`);
console.log(`  총: ${Object.keys(unified).length}`);
