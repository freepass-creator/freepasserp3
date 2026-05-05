/**
 * vehicle-matrix.js — 매물(product) ↔ 카탈로그 매칭 + FP 표준옵션 분석
 *
 * 사용처: src/pages/dev.js 의 "차종 매트릭스" 탭
 * 흐름: 매물 maker/model/sub_model/trim/year → 카탈로그 lookup → 트림 매칭 → basic + 옵션 텍스트 → FP 옵션 ID Set
 */

import { matchFpByName, normName } from './fp-keyword-rules.js';

let _index = null;        // _index.json 캐시
let _catalogs = {};       // catalog_id → 카탈로그 JSON 캐시
let _encarMap = null;     // "maker|normName(sub)" → catalog_id (catalog aliases 기반)
let _yearRanges = null;   // catalog_id → { start: 'YYYY-MM', end: 'YYYY-MM' | '현재' }

const CB = () => '?t=' + Date.now();

async function fetchJson(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url + CB(), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {}
  }
  return null;
}

export async function loadIndex() {
  if (_index) return _index;
  _index = await fetchJson([
    '/data/car-master/_index.json',
    './public/data/car-master/_index.json',
    'public/data/car-master/_index.json',
  ]) || {};
  return _index;
}

/* sub_model → catalog 직접 매핑 (각 catalog json 의 aliases 필드에서 파생).
 *  scripts/build-aliases-map.cjs 가 빌드 시 생성.
 *  매물 sub_model 이 catalog alias 와 일치하면 high confidence 로 즉시 반환.
 *  키 형식: "maker|normName(sub)" */
async function loadEncarMap() {
  if (_encarMap) return _encarMap;
  _encarMap = await fetchJson([
    '/data/car-master/_aliases-map.json',
    './public/data/car-master/_aliases-map.json',
    'public/data/car-master/_aliases-map.json',
  ]) || {};
  return _encarMap;
}

/* catalog_id → year_range — 연식 기반 catalog 후보 좁히기용. */
async function loadYearRanges() {
  if (_yearRanges) return _yearRanges;
  _yearRanges = await fetchJson([
    '/data/car-master/_year-ranges.json',
    './public/data/car-master/_year-ranges.json',
    'public/data/car-master/_year-ranges.json',
  ]) || {};
  return _yearRanges;
}

/* 매물 연식 (YYYY 또는 YYYY-MM) 이 catalog year_range 안에 있는지. 없으면 null. */
function isYearInRange(productYear, range) {
  if (!productYear || !range) return null;
  const py = Number(String(productYear).slice(0, 4));
  if (!py) return null;
  const startY = Number(String(range.start || '').slice(0, 4));
  const endY = range.end === '현재' ? 9999 : Number(String(range.end || '').slice(0, 4));
  if (!startY) return null;
  return py >= startY && py <= endY;
}

export async function loadCatalog(catalogId) {
  if (_catalogs[catalogId]) return _catalogs[catalogId];
  const json = await fetchJson([
    `/data/car-master/${catalogId}.json`,
    `./public/data/car-master/${catalogId}.json`,
    `public/data/car-master/${catalogId}.json`,
  ]);
  if (json) _catalogs[catalogId] = json;
  return json;
}

// 카탈로그 _index → maker별 후보 캐싱 — 코드 + 토큰 모두 추출
let _candidatesByMaker = null;
// 괄호 없이 끝부분 영문/숫자 코드 추출 (e.g., "현대 그랜저 GN7" → "GN7", "쏘나타 디 엣지 DN8" → "DN8")
function extractCode(title) {
  const tokens = (title || '').trim().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (/^[A-Z][A-Z0-9]+$/.test(t)) return t;
  }
  return '';
}
function buildCandidates(idx) {
  const map = {};  // maker → [{ catalogId, title, code, codeNorm, tokens, tokensNorm }]
  for (const entry of Object.values(idx)) {
    const m = entry.maker;
    if (!m) continue;
    if (!map[m]) map[m] = [];

    const title = entry.title || '';
    const titleNoMaker = title.replace(new RegExp('^' + m + '\\s+'), '').trim();
    const code = extractCode(title);
    // 토큰 분리 (공백 split)
    const tokens = titleNoMaker.split(/\s+/).filter(Boolean);

    map[m].push({
      catalogId: entry.id,
      title,
      code,
      codeNorm: normName(code),
      tokens,
      tokensNorm: tokens.map(t => normName(t)),
    });
  }
  return map;
}

/**
 * 매물 sub_model 을 카탈로그와 매칭 (점수 기반)
 *  - 코드(DN8/DL3/GN7 등) 매칭: +코드길이*5
 *  - 다른 토큰("디엣지","하이브리드") 매칭: +토큰길이
 *  - model 명 매칭: +모델길이/2
 *
 * 동일 코드를 공유하는 변형 카탈로그(쏘나타/디엣지/하이브리드 등) 자동 disambiguation.
 *
 * @returns {{ catalogId, confidence: 'high'|'medium'|'low', score, runnerUp } | null}
 */
/** product 4번째 인자: { fuel_type, year, ... } 받아 후보 필터에 활용. 없으면 무시. */
export async function findCatalog(maker, subModel, model, product = {}) {
  const idx = await loadIndex();
  if (!maker) return null;
  if (!_candidatesByMaker) _candidatesByMaker = buildCandidates(idx);

  const m = (maker || '').trim();
  const candidates = _candidatesByMaker[m] || [];
  if (candidates.length === 0) return null;

  const subN = normName(subModel || '');
  const mdN = normName(model || '');
  if (!subN && !mdN) return null;

  // year 기반 candidate 가산점 — 매물 연식이 catalog year_range 안에 있으면 강한 시그널
  const yearRanges = await loadYearRanges();
  const productYearVal = Number(product?.year || 0);

  // 1차 — encar 직접 매핑 (build-encar-catalog-map.cjs 가 생성한 _encar-catalog-map.json 활용)
  //   매물 sub_model 이 우리 표준 sub 와 정확 일치 → high confidence 즉시 반환.
  //   runtime 에서 encar-master-seed 직접 안 읽음 (build 시 1회 생성된 매핑만 사용).
  const encarMap = await loadEncarMap();
  if (subN && encarMap[`${m}|${subN}`]) {
    return {
      catalogId: encarMap[`${m}|${subN}`],
      confidence: 'high',
      score: 100,
      runnerUp: null,
      via: 'encar-direct',
    };
  }

  // 연료/연식 기반 후보 필터 — product.fuel_type / year 사용.
  //  - 전기차 매물은 EV 전용 catalog 만 매칭 (G80 가솔린이 일렉트리파이드 G80 으로 잘못 잡히는 문제 해결)
  //  - 비-전기 매물은 EV catalog 제외
  //  TODO: 등록증 OCR 통합 후 year 기반 generation 필터 (catalog year range 데이터 필요)
  const productFuel = product?.fuel_type || '';
  const productYear = Number(product?.year || 0);
  const subIsEV = /(일렉트리파이드|electrified|일렉트릭|electric|\bev\b)/i.test(subModel || '');
  const fuelIsEV = /전기|ev|electric/i.test(productFuel) || subIsEV;
  const isEVCatalogTitle = (title) => /(일렉트리파이드|electrified|일렉트릭|electric|\bev\b|아이오닉|ioniq|볼트\s*ev|모델\s*[3SXY]|타이칸)/i.test(title || '');
  const filteredCandidates = candidates.filter(c => {
    const titleEV = isEVCatalogTitle(c.title);
    if (fuelIsEV && !titleEV) return false;
    if (!fuelIsEV && titleEV) return false;
    return true;
  });
  // 필터 후 후보 0개면 원본 후보 유지 (안전 장치)
  const useCandidates = filteredCandidates.length ? filteredCandidates : candidates;

  // 후보별 점수 계산 — 매물의 모든 자료 활용 (sub_model / model / year / fuel_type / engine_cc / trim_name)
  const productCcDisp = ccToDisp(product?.engine_cc);
  const productFuelN = fuelNorm(productFuel);
  const productTrimN = aliasNorm(product?.trim_name || product?.trim || '');
  const scored = useCandidates.map(c => {
    let score = 0;
    const titleN = normName(c.title || '');
    // 코드 매칭 (가장 강한 신호)
    if (c.codeNorm && subN.includes(c.codeNorm)) score += c.codeNorm.length * 5;
    // 토큰 매칭 — sub_model 에 토큰이 substring 으로 들어있으면 가산
    for (const tn of c.tokensNorm) {
      if (!tn || tn === c.codeNorm) continue;
      if (subN.includes(tn)) score += tn.length;
      else if (mdN && mdN.includes(tn)) score += Math.floor(tn.length / 2);
    }
    // 모델명 매칭 — sub_model 비어있어도 model 만으로 catalog 후보군 좁힘 (강한 가산)
    if (mdN && c.tokensNorm.some(tn => tn && (mdN.includes(tn) || tn.includes(mdN)))) {
      score += 10;   // 같은 model 의 catalog 면 base 점수
    }
    // year 매칭 — 매물 연식이 catalog year_range 안에 있으면 강한 가산점
    if (productYearVal) {
      const inRange = isYearInRange(productYearVal, yearRanges[c.catalogId]);
      if (inRange === true) score += 20;       // 연식 일치 — sub_model 약해도 catalog 확정 도움
      else if (inRange === false) score -= 30; // 연식 범위 밖 — penalty
    }
    // fuel_type 매칭 — catalog title/trims 에 동력원 키워드 있으면 가산/감산
    if (productFuelN) {
      const titleHasFuel = (kw) => titleN.includes(kw);
      if (productFuelN === '하이브리드' && (titleHasFuel('하이브리드') || titleHasFuel('hev'))) score += 8;
      if (productFuelN === '디젤' && titleHasFuel('디젤')) score += 8;
      if (productFuelN === 'lpg' && (titleHasFuel('lpg') || titleHasFuel('lpi'))) score += 8;
      if (productFuelN === '전기' && (titleHasFuel('일렉트리파이드') || titleHasFuel('ev') || titleHasFuel('전기'))) score += 8;
    }
    // engine_cc → 배기량 표기 매칭
    if (productCcDisp && titleN.includes(productCcDisp.replace('.',''))) score += 5;
    // trim_name 토큰 매칭 (catalog title 안에 trim 토큰 있는 경우 — 페리 후 specific catalog 유리)
    if (productTrimN) {
      for (const tn of c.tokensNorm) {
        if (tn && tn.length >= 2 && productTrimN.includes(tn)) { score += 2; break; }
      }
    }
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  // 점수 0 또는 음수만 있는 경우 = 매칭 실패 (model 토큰조차 안 맞음)
  // 양수 점수 1+ 면 (model 매칭만 +10 도) catalog 확정 후보로 인정
  if (!top || top.score <= 0) return null;
  const second = scored[1];

  // 신뢰도: 점수 절대값 + 2등과 격차
  let confidence = 'low';
  if (top.score >= 25) confidence = 'high';      // model+year 정합 (10+20) 또는 코드 매칭 = 확실
  else if (top.score >= 12) confidence = 'medium'; // model + 보조신호 1개 이상
  if (second && (top.score - second.score) < 3) confidence = 'low';  // 박빙이면 확인 필요

  return {
    catalogId: top.catalogId,
    confidence,
    score: top.score,
    runnerUp: second ? { catalogId: second.catalogId, score: second.score } : null,
  };
}

// 하위 호환 (기존 시그니처)
export async function findCatalogByMakerSub(maker, subModel, model) {
  const r = await findCatalog(maker, subModel, model);
  return r ? r.catalogId : null;
}

// 트림명 영-한 / 변형 정규화 사전
const TRIM_ALIAS = {
  'premium':'프리미엄', 'exclusive':'익스클루시브', 'inspiration':'인스퍼레이션',
  'modern':'모던', 'smart':'스마트', 'luxury':'럭셔리', 'style':'스타일',
  'calligraphy':'캘리그래피', 'prestige':'프레스티지', 'noblesse':'노블레스',
  'signature':'시그니처', 'platinum':'플래티넘', 'masters':'마스터즈', 'gravity':'그래비티',
  'best':'베스트', 'selection':'셀렉션', 'business':'비즈니스', 'cross':'크로스',
  'urban':'어반', 'sports':'스포츠', 'classic':'클래식',
  'h-pick':'에이치픽', 'hpick':'에이치픽',
  'deluxe':'디럭스', 'trendy':'트렌디', 'noble':'노블레스',
  'standard':'스탠다드', 'air':'에어', 'earth':'어스', 'light':'라이트',
  'long range':'롱레인지', 'longrange':'롱레인지', 'long-range':'롱레인지',
  'performance':'퍼포먼스', 'long':'롱', 'plus':'플러스', 'special':'스페셜',
  'edition':'에디션', 'black':'블랙', 'white':'화이트', 'sport':'스포츠',
  'recharge':'리차지', 'gt-line':'gt라인', 'gtline':'gt라인',
  'value':'밸류', 'evalue':'이밸류', 'e-value':'이밸류', 'e-light':'이라이트',
  'tfsi':'tfsi', 'tdi':'tdi', 'matic':'매틱',
  'm sport':'m스포츠', 'msport':'m스포츠', 'm-sport':'m스포츠',
};
function aliasNorm(s) {
  let n = normName(s);
  for (const [eng, kor] of Object.entries(TRIM_ALIAS)) {
    n = n.replace(eng, kor);
  }
  return n;
}

// 배기량 cc → 호환 표기 (1999 → '2.0')
function ccToDisp(cc) {
  if (!cc) return null;
  const n = parseInt(cc);
  if (isNaN(n)) return null;
  if (n >= 900 && n < 1100)  return '1.0';
  if (n >= 1100 && n < 1400) return '1.2';
  if (n >= 1400 && n < 1600) return '1.5';
  if (n >= 1500 && n < 1700) return '1.6';
  if (n >= 1700 && n < 2000) return '2.0';
  if (n >= 2000 && n < 2300) return '2.2';
  if (n >= 2300 && n < 2700) return '2.5';
  if (n >= 2700 && n < 3200) return '3.0';
  if (n >= 3200 && n < 3800) return '3.5';
  if (n >= 3800)             return '5.0';
  return null;
}

// 연료 표기 정규화
function fuelNorm(f) {
  const x = (f || '').toLowerCase();
  if (!x) return '';
  if (x.includes('lpg') || x.includes('lpi') || x.includes('가스')) return 'lpg';
  if (x.includes('하이브리드') || x.includes('hybrid')) return '하이브리드';
  if (x.includes('전기') || x.includes('ev')) return '전기';
  if (x.includes('수소')) return '수소';
  if (x.includes('디젤') || x.includes('diesel')) return '디젤';
  if (x.includes('가솔린') || x.includes('휘발')) return '가솔린';
  return x;
}

/** trim 객체에서 base 가격(원) 추출 — number 직접 OR { base, before_tax, ... } 객체 둘 다 지원 */
export function trimBasePrice(trim) {
  if (!trim) return null;
  const p = trim.price;
  if (typeof p === 'number' && p > 0) return p;
  if (p && typeof p === 'object') {
    if (Number(p.base) > 0) return Number(p.base);
    // 일부 catalog 는 base 없이 before_tax 만 — 110% 추정
    if (Number(p.before_tax) > 0) return Math.round(Number(p.before_tax) * 0.91);
  }
  return null;
}

/**
 * 가격 기반 트림 역매칭 — 차량 가격(원) 으로 가장 가까운 트림 찾기.
 *  encar 매물처럼 트림명 없거나 흐릿할 때 가격으로 disambig.
 *
 * @param {object} catalog
 * @param {number} targetPrice — 차량 가격 (원)
 * @param {object} opts — { tolerance: 0.08 (8% 기본), maxResults: 3 }
 * @returns {{ candidates: [{name, trim, price, diff, diffPct}], best } | null}
 */
export function findTrimByPrice(catalog, targetPrice, opts = {}) {
  if (!catalog?.trims || !targetPrice || targetPrice <= 0) return null;
  const tolerance = opts.tolerance ?? 0.08;          // ±8% 기본 (트림 간 격차 ~10% 평균 고려)
  const maxResults = opts.maxResults ?? 3;
  const trimNames = Object.keys(catalog.trims);
  if (!trimNames.length) return null;

  // 가격 있는 트림만 후보
  const withPrice = [];
  for (const tn of trimNames) {
    const trim = catalog.trims[tn];
    const price = trimBasePrice(trim);
    if (!price) continue;
    const diff = Math.abs(price - targetPrice);
    const diffPct = diff / targetPrice;
    withPrice.push({ name: tn, trim, price, diff, diffPct });
  }
  if (!withPrice.length) return null;

  withPrice.sort((a, b) => a.diff - b.diff);
  // 허용 범위 안 후보들
  const candidates = withPrice.filter(c => c.diffPct <= tolerance).slice(0, maxResults);
  // 범위 밖이면 그래도 가장 가까운 1개 (low conf 표시용)
  const best = candidates[0] || withPrice[0];
  return { candidates, best };
}

/**
 * 트림 매칭 — score 기반 best + alternatives + confidence
 *  - 항상 best 후보 1개를 리턴 (단, 점수 0 이하는 null)
 *  - confidence: 'high' (정확/단일후보) / 'medium' (스코어 격차 큼) / 'low' (격차 작음 → 사용자 확인 권장)
 *  - alts: 상위 후보 3개 (사용자 disambig UI 용)
 *  - product.price 가 있으면 가격 매칭도 score 가중치로 활용 (정확도 향상)
 *
 * @returns {{ name, trim, confidence, score, alts: [{name, score}] } | null}
 */
export function findTrimInCatalog(catalog, trimName, product = {}) {
  if (!catalog || !catalog.trims) return null;
  const trimNames = Object.keys(catalog.trims);
  if (trimNames.length === 0) return null;

  // 트림명이 없는 경우 — 매물의 fuel_type / displacement 로 trim 추정
  if (!trimName) {
    const fuel = fuelNorm(product.fuel_type);
    const disp = ccToDisp(product.engine_cc || product.displacement);
    // 매물 fuel/disp 와 매칭되는 첫 trim 우선
    let bestTrim = trimNames[0];
    let bestScore = -1;
    for (const tn of trimNames) {
      const tnN = aliasNorm(tn);
      let s = 0;
      if (fuel === '하이브리드' && /하이브리드|hev|hybrid/.test(tnN)) s += 30;
      else if (fuel === '디젤' && /디젤|diesel/.test(tnN)) s += 30;
      else if (fuel === 'lpg' && /lpg|lpi/.test(tnN)) s += 30;
      else if (fuel === '전기' && /전기|ev|electric/.test(tnN)) s += 30;
      else if (fuel === '가솔린' && !/하이브리드|hev|hybrid|디젤|lpg|lpi|전기|ev/.test(tnN)) s += 30;
      else if (!fuel && !/하이브리드|hev|hybrid|디젤|lpg|lpi/.test(tnN)) s += 5; // 가솔린 추정
      if (disp && tnN.includes(disp.replace('.', ''))) s += 20;
      if (s > bestScore) { bestScore = s; bestTrim = tn; }
    }
    return {
      name: bestTrim,
      trim: catalog.trims[bestTrim],
      confidence: bestScore > 20 ? 'medium' : 'low',
      score: bestScore,
      alts: trimNames.slice(0, 3).map(n => ({ name: n, score: 0 })),
    };
  }

  // 정확 매칭 (raw)
  if (catalog.trims[trimName]) {
    return {
      name: trimName,
      trim: catalog.trims[trimName],
      confidence: 'high',
      score: 1000,
      alts: [{ name: trimName, score: 1000 }],
    };
  }

  const target = aliasNorm(trimName);
  // 정규화 후 정확 매칭
  for (const tn of trimNames) {
    if (aliasNorm(tn) === target) {
      return {
        name: tn,
        trim: catalog.trims[tn],
        confidence: 'high',
        score: 1000,
        alts: [{ name: tn, score: 1000 }],
      };
    }
  }

  // hint 들
  const fuel = fuelNorm(product.fuel_type);
  const disp = ccToDisp(product.engine_cc || product.displacement);
  const isCommercial = /영업|렌터|운전교습/.test(product.usage_type || '') ||
                        /영업|렌터|운전교습/.test(product.vehicle_status || '');
  const isHandicap = /장애/.test(product.usage_type || '') || /장애/.test(product.special_use || '');
  const isNline = /n\s*라인|n\s*line/i.test(trimName) || /n\s*라인|n\s*line/i.test(product.trim_name || '');
  // 가격 hint — 매물 가격(원) 이 있으면 가격 매칭 가중치
  const targetPrice = Number(product.vehicle_price || product.price || 0);
  // 매물 fp_options — trim 의 basic 옵션과 매칭도 측정
  const productFpSet = new Set(Array.isArray(product.fp_options) ? product.fp_options : []);
  // catalog options 라이브 lookup 캐시
  const trimFpCache = new Map();
  function getTrimFp(tn) {
    if (trimFpCache.has(tn)) return trimFpCache.get(tn);
    const trim = catalog.trims[tn];
    const fpSet = new Set();
    for (const code of (trim?.basic || [])) {
      const name = catalog.options?.[code]?.name || code;
      matchFpByName(name).forEach(id => fpSet.add(id));
    }
    trimFpCache.set(tn, fpSet);
    return fpSet;
  }
  // 모든 트림 가격 미리 계산 (반복 lookup 회피)
  const trimPrices = new Map();
  for (const tn of trimNames) {
    const p = trimBasePrice(catalog.trims[tn]);
    if (p) trimPrices.set(tn, p);
  }

  // 후보 score 계산
  const scored = [];
  for (const tn of trimNames) {
    const tnNorm = aliasNorm(tn);
    let score = 0;

    if (tnNorm === target) score = 1000;
    else if (tnNorm.startsWith(target)) score = 100;
    else if (tnNorm.includes(target)) score = 50;
    else if (target.includes(tnNorm) && tnNorm.length >= 2) score = 30;
    else continue;

    // 연료 가중
    if (fuel === 'lpg' && /lpg|lpi/.test(tnNorm)) score += 50;
    else if (fuel === 'lpg' && !/lpg|lpi/.test(tnNorm)) score -= 30;
    else if (fuel && fuel !== 'lpg' && /lpg|lpi/.test(tnNorm)) score -= 30;
    if (fuel === '하이브리드' && /하이브리드|hev|hybrid/.test(tnNorm)) score += 50;
    if (fuel === '디젤' && /디젤|diesel/.test(tnNorm)) score += 50;

    // 배기량 가중
    if (disp && tnNorm.includes(disp.replace('.', ''))) score += 40;

    // 특수 표기
    if (/영업용|렌터카|영업|렌터/.test(tnNorm)) score += isCommercial ? 80 : -50;
    if (/장애인|왼손|오른손|원발|양발|오른발/.test(tnNorm)) score += isHandicap ? 80 : -80;
    if (/n라인|nline/.test(tnNorm)) score += isNline ? 50 : -20;

    // 가격 가중 — 매물 가격이 있고 트림 가격이 있으면, 격차 비례 가산/감점
    if (targetPrice && trimPrices.has(tn)) {
      const tp = trimPrices.get(tn);
      const diffPct = Math.abs(tp - targetPrice) / targetPrice;
      if (diffPct < 0.03)      score += 60;   // ±3% — 거의 일치
      else if (diffPct < 0.08) score += 30;   // ±8% — 가까움
      else if (diffPct < 0.15) score += 10;   // ±15% — 후보권
      else if (diffPct > 0.30) score -= 30;   // ±30% 초과 — 페널티
    }

    // 옵션 매칭 — 매물 fp_options 와 trim 의 basic FP 셋의 일치도
    //   매물 옵션 多 + 그 옵션이 trim 의 basic 에 있으면 강한 시그널
    //   특정 trim 에만 있는 옵션이면 trim 식별 가능
    if (productFpSet.size > 0) {
      const trimFp = getTrimFp(tn);
      let hits = 0;
      for (const id of productFpSet) if (trimFp.has(id)) hits++;
      // 매물 옵션 1개당 +3, 일치율 70%+ 이면 추가 보너스
      score += hits * 3;
      if (productFpSet.size >= 5 && hits / productFpSet.size >= 0.7) score += 20;
    }

    scored.push({ name: tn, score });
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // 트림명이 어떤 카탈로그 트림과도 안 겹침 — 첫 트림으로 fallback (low confidence)
    const first = trimNames[0];
    return {
      name: first,
      trim: catalog.trims[first],
      confidence: 'low',
      score: 0,
      alts: trimNames.slice(0, 3).map(n => ({ name: n, score: 0 })),
    };
  }

  const top = scored[0];
  const second = scored[1];
  // 신뢰도: top score가 절대값 높고 + 2nd 와 격차가 충분
  let confidence = 'medium';
  if (top.score >= 100 && (!second || top.score - second.score >= 40)) confidence = 'high';
  else if (top.score < 30 || (second && top.score - second.score < 20)) confidence = 'low';

  return {
    name: top.name,
    trim: catalog.trims[top.name],
    confidence,
    score: top.score,
    alts: scored.slice(0, 3),
  };
}

/** 옵션 텍스트를 토큰으로 분리 */
export function tokenizeOptionsText(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text.map(s => String(s).trim()).filter(Boolean);
  return String(text).split(/[·,\/\|;\n]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * trim의 select_groups에서 토큰과 매칭되는 그룹의 옵션명들 반환
 * 토큰 norm 이 select_group 의 codes' option name 하나와 substring 양방향 match
 */
function pickSelectGroupNames(catalog, trim, tokens) {
  if (!trim?.select_groups || !tokens?.length) return [];
  const tokNorm = tokens.map(t => normName(t)).filter(Boolean);
  const out = [];
  for (const group of trim.select_groups) {
    const codes = Array.isArray(group) ? group : (group.codes || []);
    const groupName = !Array.isArray(group) ? (group.name || '') : '';
    // 그룹 이름이 토큰과 매칭되거나 그룹 내 옵션 이름이 토큰과 매칭되면 → 그룹 채택
    const groupNameN = normName(groupName);
    const optNames = codes.map(c => catalog.options?.[c]?.name || '').filter(Boolean);
    const optNamesN = optNames.map(o => normName(o));
    const hit = tokNorm.some(tn => {
      if (!tn) return false;
      if (groupNameN && (groupNameN.includes(tn) || tn.includes(groupNameN))) return true;
      return optNamesN.some(on => on && (on.includes(tn) || tn.includes(on)));
    });
    if (hit) out.push(...optNames);
  }
  return out;
}

/**
 * product 분석 — 카탈로그 매칭 + 트림 매칭 + FP 표준옵션 매핑
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   catalogId?: string,
 *   catalogTitle?: string,
 *   trimName?: string,
 *   basicCount?: number,
 *   fpFromBasic?: string[],
 *   fpFromOptionsText?: string[],
 *   fpAll?: string[],
 * }}
 */
export async function analyzeProduct(product) {
  if (!product?.maker) {
    return { ok: false, reason: '제조사 없음', confidence: 'none' };
  }

  const cat = await findCatalog(product.maker, product.sub_model, product.model, product);
  if (!cat) {
    return {
      ok: false,
      reason: '카탈로그 없음 (우리 63개에 포함 안 됨)',
      confidence: 'none',
      requiresUserInput: true,
    };
  }

  const catalog = await loadCatalog(cat.catalogId);
  if (!catalog) return { ok: false, reason: 'catalog load failed', catalogId: cat.catalogId };

  const trimName = product.trim_name || product.trim || '';
  const trimMatch = findTrimInCatalog(catalog, trimName, product);

  const fpFromBasic = new Set();
  const fpFromOptionsText = new Set();
  let basicCount = 0;
  let matchedSelectGroupNames = [];

  if (trimMatch) {
    const basic = trimMatch.trim?.basic || [];
    basicCount = basic.length;
    for (const code of basic) {
      const name = catalog.options?.[code]?.name || '';
      matchFpByName(name).forEach(id => fpFromBasic.add(id));
    }
    // product.options → select_groups 매칭 → 그룹 옵션명들 → FP
    const tokens = tokenizeOptionsText(product.options);
    if (tokens.length) {
      matchedSelectGroupNames = pickSelectGroupNames(catalog, trimMatch.trim, tokens);
      for (const name of matchedSelectGroupNames) {
        matchFpByName(name).forEach(id => fpFromOptionsText.add(id));
      }
      // 옵션 텍스트 자체로도 FP 키워드 매칭 (catalog 외 일반 토큰)
      for (const tok of tokens) {
        matchFpByName(tok).forEach(id => fpFromOptionsText.add(id));
      }
    }
  }

  // 종합 신뢰도 = catalog conf와 trim conf의 최저 단계
  const order = { high: 3, medium: 2, low: 1, none: 0 };
  const catConf = cat.confidence;
  const trimConf = trimMatch?.confidence || 'low';
  const overall = order[catConf] <= order[trimConf] ? catConf : trimConf;

  const fpAll = new Set([...fpFromBasic, ...fpFromOptionsText]);

  // 가격 매칭 정보 — 매물 가격이 있으면 카탈로그 트림 가격과 비교
  let priceMatch = null;
  const targetPrice = Number(product.vehicle_price || product.price || 0);
  if (targetPrice > 0) {
    const matchedTrimPrice = trimBasePrice(trimMatch?.trim);
    if (matchedTrimPrice) {
      const diff = matchedTrimPrice - targetPrice;
      const diffPct = Math.abs(diff) / targetPrice;
      priceMatch = {
        targetPrice,
        catalogPrice: matchedTrimPrice,
        diff,
        diffPct,
        // 매칭 등급 — 가격 격차로 트림 정확도 검증
        level: diffPct < 0.03 ? 'exact' : diffPct < 0.08 ? 'close' : diffPct < 0.15 ? 'fair' : 'far',
      };
    }
    // 가격 기반 역매칭 — 트림명 매칭이 약하거나 가격 매칭이 안 맞으면 후보 제시
    if (!priceMatch || priceMatch.level === 'far' || trimConf === 'low') {
      const reverse = findTrimByPrice(catalog, targetPrice);
      if (reverse?.candidates?.length) {
        priceMatch = priceMatch || {};
        priceMatch.candidates = reverse.candidates.map(c => ({
          name: c.name,
          price: c.price,
          diffPct: c.diffPct,
        }));
        priceMatch.bestByPrice = reverse.best?.name;
      }
    }
  }

  return {
    ok: true,
    catalogId: cat.catalogId,
    catalogTitle: catalog.title || cat.catalogId,
    catalogConfidence: catConf,
    trimName: trimMatch?.name || null,
    trimConfidence: trimConf,
    trimAlts: trimMatch?.alts || [],
    priceMatch,
    confidence: overall,
    requiresUserInput: overall === 'low',
    basicCount,
    matchedSelectGroupNames,
    fpFromBasic: [...fpFromBasic],
    fpFromOptionsText: [...fpFromOptionsText],
    fpAll: [...fpAll],
  };
}

/** 캐시 비우기 (탭 다시 열 때 강제 reload) */
export function clearCache() {
  _index = null;
  _catalogs = {};
  _codeMapByMaker = null;
}
