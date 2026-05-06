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

  const cat = await findCatalog(product.maker, product.sub_model, product.model, product);
  if (!cat?.catalogId) return { ...empty, source: 'no-catalog' };
  const catalog = await loadCatalog(cat.catalogId);
  if (!catalog) return { ...empty, source: 'no-catalog' };

  // trim 정확 매칭 — 실패 시 catalog 전체 옵션 (제조사 풀) 폴백
  const trim = findTrimInCatalog(catalog, trimName, product);
  if (!trim || !catalog.options) {
    const widePool = makeMakerWidePool(catalog);
    return { ...widePool, source: 'maker-wide', catalogId: cat.catalogId, trimName };
  }

  const lookupOption = (id) => {
    const o = catalog.options[id];
    if (!o) return null;
    return { id, name: o.name, category: o.category || '', is_package: !!o.is_package };
  };

  const groups = [];
  // 1. trim 의 기본 옵션 (basic)
  if (Array.isArray(trim.basic) && trim.basic.length) {
    const basicOpts = trim.basic.map(lookupOption).filter(Boolean);
    if (basicOpts.length) groups.push({ name: '기본 옵션', options: basicOpts });
  }
  // 2. select_groups (선택 패키지) — 그룹별로 분리해서 표시
  if (Array.isArray(trim.select_groups)) {
    for (const g of trim.select_groups) {
      const codes = Array.isArray(g) ? g : (g.codes || []);
      const groupName = (!Array.isArray(g) && g.name) ? g.name : '선택 패키지';
      const opts = codes.map(lookupOption).filter(Boolean);
      if (opts.length) groups.push({ name: groupName, options: opts });
    }
  }

  // allNames Set — 직접 입력 시 중복/유사도 체크용
  const allNames = new Set();
  for (const g of groups) for (const o of g.options) allNames.add(o.name);

  return { groups, allNames, source: 'trim', catalogId: cat.catalogId, trimName: trim.name || trimName };
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
