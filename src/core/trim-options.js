/**
 * trim-options.js — 매물의 catalog/trim 매칭 결과로 옵션 풀 반환.
 *
 *   getOptionPool(product) → { groups: [{ name, options: [...] }], allNames: Set, source }
 *
 *  - product.maker/sub_model/year → catalog 매칭 → trim 매칭 → trim.basic + select_groups
 *  - 매칭 실패 → maker 의 전체 catalog 옵션 합집합 (대안 풀)
 *  - 둘 다 실패 → 빈 풀 (직접 입력만 가능)
 *
 *  옵션 형식: { id, name, category, is_package }
 */
import { findCatalog, loadCatalog, findTrimInCatalog } from './vehicle-matrix.js';

export async function getOptionPool(product) {
  const empty = { groups: [], allNames: new Set(), source: 'none' };
  if (!product?.maker) return empty;
  // 트림 명시적으로 선택돼야 옵션 풀 표시
  const trimName = product.trim_name || product.trim || '';
  if (!trimName) return { ...empty, source: 'no-trim' };

  // 1순위: cascade picker 가 sub_model 선택 시 결정한 explicit catalog_id (가장 정확).
  //   매물 연식이 catalog year_range 밖이어도 (사용자가 의도적으로 다른 catalog 선택한 경우) 우선.
  let catalogId = product.catalog_id || null;
  // 2순위: maker + sub_model 기반 매칭
  if (!catalogId) {
    const cat = await findCatalog(product.maker, product.sub_model, product.model, product);
    if (!cat?.catalogId) return { ...empty, source: 'no-catalog' };
    catalogId = cat.catalogId;
  }
  const catalog = await loadCatalog(catalogId);
  if (!catalog) return { ...empty, source: 'no-catalog' };
  const cat = { catalogId };

  // catalog options 자체가 비어있으면 (stub) — 매트릭스 페이지와 일관되게 안내만
  const optionCount = catalog.options ? Object.keys(catalog.options).length : 0;
  if (optionCount === 0) {
    return { ...empty, source: 'stub-catalog', catalogId: cat.catalogId, trimName };
  }
  // trim 매칭 — findTrimInCatalog 는 { name, trim, confidence, ... } wrapper 반환.
  // 실제 trim 데이터는 .trim 안에. catalog.trims[name] 로 직접 접근도 fallback.
  const trimWrapper = findTrimInCatalog(catalog, trimName, product);
  const trim = trimWrapper?.trim || (trimName && catalog.trims?.[trimName]) || null;
  if (!trim) {
    const widePool = makeMakerWidePool(catalog);
    return { ...widePool, source: 'maker-wide', catalogId: cat.catalogId, trimName };
  }

  const lookupOption = (id) => {
    const o = catalog.options[id];
    if (!o) return null;
    return { id, name: o.name, category: o.category || '', is_package: !!o.is_package };
  };

  // 매트릭스 페이지 패턴: select_groups (선택 패키지) 만 카드로. basic 은 자동 포함이라 표시 X.
  // 각 group = 1 카드: { name, items: [...옵션이름], price?: 만원 단위 }
  const packages = [];
  if (Array.isArray(trim.select_groups)) {
    trim.select_groups.forEach((g, idx) => {
      const codes = Array.isArray(g) ? g : (g.codes || []);
      const items = codes.map(c => catalog.options[c]?.name).filter(Boolean);
      if (!items.length) return;
      const price = Array.isArray(g) ? null : g.price;
      const pkgName = !Array.isArray(g) && g.name ? g.name : items[0];
      packages.push({
        idx,
        name: pkgName,
        items,
        price: price ? Math.round(price / 10000) : null,   // 만원 단위
      });
    });
  }

  // chip 호환: groups 형식도 같이 반환 (구코드 호환)
  const groups = packages.length
    ? [{ name: `선택 패키지 (${packages.length}개)`, options: packages.flatMap(p => p.items.map(name => ({ name }))) }]
    : [];

  // allNames — 직접 입력 시 중복/유사도 체크용 (basic + select_groups 옵션 모두)
  const allNames = new Set();
  for (const code of (trim.basic || [])) {
    const o = catalog.options[code];
    if (o?.name) allNames.add(o.name);
  }
  for (const pkg of packages) for (const name of pkg.items) allNames.add(name);

  return {
    groups, packages, allNames,
    source: 'trim',
    catalogId: cat.catalogId,
    trimName: trim.name || trimName,
    basicCount: (trim.basic || []).length,
  };
}

/** maker 전체 catalog 옵션 합집합 — trim 매칭 실패 시 폴백 풀 (카테고리별 그룹) */
function makeMakerWidePool(catalog) {
  const groups = [];
  const allNames = new Set();
  if (catalog?.options) {
    const byCategory = new Map();
    for (const [id, o] of Object.entries(catalog.options)) {
      const cat = o.category || '기타';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push({ id, name: o.name, category: cat, is_package: !!o.is_package });
      allNames.add(o.name);
    }
    for (const [name, opts] of byCategory) groups.push({ name, options: opts });
  }
  return { groups, allNames };
}

/**
 * 직접 입력 토큰 ↔ 풀 옵션 유사도 매칭.
 * @returns {Array<{ token: string, match: string, similarity: number }>}
 *   similarity >= 0.7 인 페어 반환 (사용자에게 "이거 맞나요?" 확인용)
 */
export function findSimilarInPool(tokens, allNamesSet) {
  if (!tokens?.length || !allNamesSet?.size) return [];
  const pool = [...allNamesSet];
  const out = [];
  for (const tok of tokens) {
    const t = norm(tok);
    if (!t) continue;
    let best = null;
    let bestSim = 0;
    for (const name of pool) {
      const sim = similarity(t, norm(name));
      if (sim > bestSim) { bestSim = sim; best = name; }
    }
    if (best && bestSim >= 0.7 && norm(best) !== t) {
      out.push({ token: tok, match: best, similarity: Math.round(bestSim * 100) / 100 });
    }
  }
  return out;
}

/** 옵션 입력 split — 콤마/슬래시 구분자, 띄어쓰기는 단일 옵션 안 단어로 인정 */
export function splitOptionInput(text) {
  return String(text || '').split(/[,/]+/).map(s => s.trim()).filter(Boolean);
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s\(\)\(\)/·\-_,.]+/g, '');
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // substring 양방향 매칭 우선
  if (a.includes(b)) return b.length / a.length * 0.95;
  if (b.includes(a)) return a.length / b.length * 0.95;
  // Dice coefficient (bigram)
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}
