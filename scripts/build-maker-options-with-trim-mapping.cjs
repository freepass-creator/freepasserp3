#!/usr/bin/env node
/**
 * 메이커별 옵션 사전 + 트림 매핑 (inverse index) 구축.
 *  구조:
 *    {
 *      "현대": {
 *        "HUD": {
 *          name: "헤드업 디스플레이 (HUD)",
 *          fp_id: "HUD",
 *          category: "안전",
 *          basic_trims: [{catalog: "hyundai_grandeur_gn7", trim: "캘리그래피 가솔린 2.5"}, ...],
 *          select_trims: [{catalog, trim, price}, ...],
 *          variants: ["헤드업 디스플레이", "헤드업 디스플레이(HUD)"]  // 정규화 후 동일한 다른 표기들
 *        },
 *        "HMC_KRELL_PREMIUM_SOUND": { name, fp_id: null, category, basic_trims, select_trims, variants }
 *      },
 *      ...
 *    }
 *  출력: public/data/car-master/_maker-options-v2.json
 *
 *  사용: node scripts/build-maker-options-with-trim-mapping.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const OUT_PATH = path.join(CATALOG_DIR, '_maker-options-v2.json');
const RULES_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-keyword-rules.js');
const MASTER_PATH = path.join(__dirname, '..', 'src', 'core', 'fp-options-master.js');

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

const MAKER_PREFIX = {
  '현대': 'HMC', '기아': 'KIA', '제네시스': 'GEN', 'KGM': 'KGM',
  '쉐보레': 'CHV', 'BMW': 'BMW', '벤츠': 'MBZ', '아우디': 'AUD',
  '미니': 'MIN', '볼보': 'VOL', '폭스바겐': 'VW', '포르쉐': 'POR',
  '랜드로버': 'LR', '재규어': 'JAG', '렉서스': 'LEX', '도요타': 'TOY',
  '토요타': 'TOY', '혼다': 'HND', '닛산': 'NIS', '인피니티': 'INF',
  '포드': 'FRD', '지프': 'JEP', '캐딜락': 'CAD', '링컨': 'LIN',
  '테슬라': 'TSL', '마세라티': 'MAS', '벤틀리': 'BEN', '롤스로이스': 'RR',
  '람보르기니': 'LAM', '페라리': 'FER', '르노': 'REN',
};
function slugify(name) {
  return (name || '').replace(/[^a-zA-Z0-9가-힣]+/g, '_').replace(/^_|_$/g, '').slice(0, 50).toUpperCase();
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const out = {};
const idByMakerNorm = {};   // maker → norm_name → unified id (옵션 단일화 용)

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
  const maker = d.maker;
  const prefix = MAKER_PREFIX[maker];
  if (!prefix) continue;
  if (!out[maker]) out[maker] = {};
  if (!idByMakerNorm[maker]) idByMakerNorm[maker] = {};

  const catalogId = f.replace('.json', '');
  const opts = d.options || {};

  // 1) 옵션 사전 entry 생성/갱신 — 코드별로 ID 결정
  const codeToId = {};
  for (const [code, info] of Object.entries(opts)) {
    if (code.startsWith('PKG_')) continue;
    const name = info.name || '';
    if (!name) continue;
    const norm = normName(name);
    let id = idByMakerNorm[maker][norm];
    if (!id) {
      const fpIds = matchFpIds(name);
      if (fpIds.length === 1) {
        id = fpIds[0];   // FP 단일 매핑 → FP ID 사용
      } else if (fpIds.length > 1) {
        // 다중 FP 매핑은 패키지성 옵션 (스마트센스 등) → 메이커 prefix + 슬러그
        id = `${prefix}_${slugify(name)}`;
      } else {
        id = `${prefix}_${slugify(name)}`;
      }
      // ID 충돌 회피
      let suffix = 1;
      const baseId = id;
      while (out[maker][id] && out[maker][id].name && normName(out[maker][id].name) !== norm) {
        id = `${baseId}_${++suffix}`;
      }
      idByMakerNorm[maker][norm] = id;
    }
    codeToId[code] = id;
    if (!out[maker][id]) {
      const fpIds = matchFpIds(name);
      out[maker][id] = {
        name,
        fp_id: fpIds.length === 1 ? fpIds[0] : null,
        fp_ids: fpIds,
        category: info.category || null,
        variants: new Set(),
        basic_trims: [],
        select_trims: [],
      };
    }
    out[maker][id].variants.add(name);
  }

  // 2) 트림 → 옵션 매핑 (inverse index 채우기)
  for (const [trimName, t] of Object.entries(d.trims || {})) {
    const ref = { catalog: catalogId, trim: trimName };
    for (const code of (t.basic || [])) {
      const id = codeToId[code];
      if (!id) continue;
      out[maker][id].basic_trims.push(ref);
    }
    for (const code of (t.select || [])) {
      const id = codeToId[code];
      if (!id) continue;
      out[maker][id].select_trims.push(ref);
    }
    for (const grp of (t.select_groups || [])) {
      if (Array.isArray(grp)) continue;
      const codes = grp.codes || [];
      for (const code of codes) {
        const id = codeToId[code];
        if (!id) continue;
        out[maker][id].select_trims.push({ ...ref, price: grp.price || null, package_name: grp.name || null });
      }
    }
  }
}

// Set → Array
for (const maker of Object.keys(out)) {
  for (const id of Object.keys(out[maker])) {
    out[maker][id].variants = [...out[maker][id].variants];
  }
}

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
console.log(`✓ ${path.relative(process.cwd(), OUT_PATH)}`);
const top = ['현대', '기아', '제네시스', 'KGM'];
for (const maker of top) {
  if (!out[maker]) continue;
  const ids = Object.keys(out[maker]);
  const fpMapped = ids.filter(id => out[maker][id].fp_id).length;
  const totalBasic = ids.reduce((a, id) => a + out[maker][id].basic_trims.length, 0);
  const totalSelect = ids.reduce((a, id) => a + out[maker][id].select_trims.length, 0);
  console.log(`  ${maker}: ${ids.length} 옵션 (FP 매핑 ${fpMapped}, basic 매핑 ${totalBasic}, select 매핑 ${totalSelect})`);
}
