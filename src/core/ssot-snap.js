/**
 * ssot-snap.js — 매물을 우리 SSOT 규격의 '완전경로 종착지' 하나로 스냅.
 *
 *  어떤 차든 → 제조사·모델·세부모델·파워트레인·세부트림 = SSOT 에 실재하는 한 조합으로 가둔다.
 *  raw 통과 금지. 없는 트림이면 '제일 비슷한 트림'으로. (규격이 틀렸어도 일단 그 규격 안으로)
 *
 *  1) maker/model/세부모델 — matchVehicle(연식 기반 세대) 로 SSOT 엔트리 확정
 *  2) 파워트레인 — 그 세부모델의 SSOT variants 중 (연료>배기량>구동) 최근접
 *  3) 세부트림 — 그 파워트레인 후보 트림 중 raw 트림과 최유사 (항상 실재 트림 반환)
 */
import { buildVehicleIndex, matchVehicle } from './vehicle-matcher.js';

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
const keyNorm = (s) => String(s == null ? '' : s).replace(/[\s\-_.]+/g, '').toLowerCase();  // 공백·하이픈 무시 키

/* ── 연료 정규화 (제품 raw / SSOT 라벨 공통 키) ── */
function fuelKey(s) {
  const t = String(s || '');
  if (/수소|FCEV/i.test(t)) return '수소';
  if (/PHEV|플러그인/i.test(t)) return '하이브리드';
  if (/HEV|하이브리드|hybrid/i.test(t)) return '하이브리드';
  if (/전기|일렉|electric|\bEV\b/i.test(t)) return '전기';
  if (/LPG|LPi|LPI/i.test(t)) return 'LPG';
  if (/디젤|경유|diesel/i.test(t)) return '디젤';
  if (/가솔린|휘발유|gasoline|petrol|GDI|MPI|T-GDI/i.test(t)) return '가솔린';
  return '';
}

/* ── 구동 정규화: 2WD / 4WD(=4WD·AWD·사륜 묶음) ── */
function driveKey(s) {
  const t = String(s || '').toLowerCase();
  if (/4wd|awd|4matic|xdrive|콰트로|quattro|4모션|4motion|사륜|4륜|4구동/i.test(t)) return '4';
  if (/2wd|fwd|rwd|전륜|후륜|2륜/i.test(t)) return '2';
  return '';
}

/* ── 제품 배기량(L) 추출 ── */
function prodDispL(p) {
  const blob = `${p.fuel_type || ''} ${p.trim_name || ''} ${p.raw_model_full || ''} ${p.variant || ''}`;
  const dm = blob.match(/(\d\.\d)/);
  if (dm) return Number(dm[1]);
  const cc = Number(String(p.engine_cc || p.displacement || '').replace(/[^\d]/g, ''));
  if (cc > 800) return Math.round(cc / 100) / 10;
  return null;
}

/* ── 문자열 유사도 (bigram Dice) ── */
function dice(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const big = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = big(a), B = big(b); let inter = 0;
  for (const [g, n] of A) if (B.has(g)) inter += Math.min(n, B.get(g));
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
}
function simScore(raw, cand) {
  const a = norm(raw), b = norm(cand);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  return dice(a, b);
}

/* ── 파워트레인 라벨 (배기량 .1 고정: 2.0/3.0 정수도 .0 표기) ── */
function variantLabel(v) {
  if (!v) return '';
  let e = '';
  if (v.battery_kwh != null) e = `${v.battery_kwh}kWh`;
  else if (v.displacement_l != null) e = `${Number(v.displacement_l).toFixed(1)}${v.turbo ? 'T' : ''}`;
  return [v.fuel, e, v.drivetrain].filter(Boolean).join(' ');
}

/* ── 파워트레인 스냅: SSOT variants 중 최근접 ── */
function snapVariant(p, variants) {
  if (!variants || !variants.length) return null;
  const pf = fuelKey(p.fuel_type) || fuelKey(`${p.trim_name || ''} ${p.raw_model_full || ''}`);
  const pd = prodDispL(p);
  const pdr = driveKey(`${p.trim_name || ''} ${p.raw_model_full || ''} ${p.variant || ''} ${p.drive_type || ''}`);
  let best = variants[0], bestScore = -1e9;
  for (const v of variants) {
    let s = 0;
    if (pf) s += (fuelKey(v.fuel) === pf ? 100 : -120);          // 연료 최우선
    if (pd != null && v.displacement_l != null) s -= Math.abs(pd - v.displacement_l) * 25;  // 배기량 근접
    if (v.battery_kwh != null && pf === '전기') s += 5;
    if (pdr && v.drivetrain) s += (driveKey(v.drivetrain) === pdr ? 30 : -8);  // 구동
    if (s > bestScore) { bestScore = s; best = v; }
  }
  return best;
}

/* ── 트림 스냅: 후보 트림 중 최유사 (항상 실재 트림) ── */
function snapTrim(rawTrim, trims) {
  if (!trims || !trims.length) return '';
  // raw 에서 모델/파워트레인 토큰 거품 제거 (대충): 숫자.숫자, 2WD/4WD, 인승, 연료어
  let clean = String(rawTrim || '')
    .replace(/\d\.\d\s*(?:터보|T\b)?/gi, ' ')
    .replace(/\b(2wd|4wd|awd|fwd|rwd|4matic|xdrive)\b/gi, ' ')
    .replace(/\d+인승/g, ' ')
    .replace(/가솔린|디젤|LPG|LPI|하이브리드|HEV|전기|EV|수소/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!clean) clean = String(rawTrim || '');
  let best = trims[0], bestS = -1;
  for (const t of trims) {
    const s = simScore(clean, t);
    if (s > bestS) { bestS = s; best = t; }
  }
  return best;  // 매칭 약해도 가장 가까운 실재 트림으로
}

/* ── 수입 엔진코드 → SSOT 한글 모델 추론 (520d→5시리즈, S400d→S클래스, A6 45→A6) ── */
const MB_PAT = [
  [/glc/i, 'GLC-클래스'], [/gle/i, 'GLE-클래스'], [/gla/i, 'GLA-클래스'], [/glb/i, 'GLB-클래스'], [/gls/i, 'GLS-클래스'],
  [/cls/i, 'CLS-클래스'], [/cla/i, 'CLA-클래스'],
  [/eqs/i, 'EQS'], [/eqe/i, 'EQE'], [/eqa/i, 'EQA'], [/eqb/i, 'EQB'], [/eqc/i, 'EQC'],
  [/amg\s*gt/i, 'AMG GT'], [/\bslc/i, 'SLC-클래스'], [/\bsl\b/i, 'SL-클래스'], [/\bv\s?\d{3}/i, 'V-클래스'],
  [/\bs\s?\d{3}/i, 'S-클래스'], [/\be\s?\d{3}/i, 'E-클래스'], [/\bc\s?\d{3}/i, 'C-클래스'],
  [/\ba\s?\d{3}/i, 'A-클래스'], [/\bb\s?\d{3}/i, 'B-클래스'], [/\bg\s?\d{3}/i, 'G-클래스'],
];
function inferImportModel(maker, text, modelSet) {
  const has = (m) => modelSet && modelSet.has(m);
  const mk = keyNorm(maker);
  let mm;
  if (mk.includes('벤츠') || /benz|mercedes/i.test(maker || '')) {
    for (const [re, model] of MB_PAT) if (re.test(text) && has(model)) return model;
    return '';
  }
  if (mk === 'bmw') {
    if ((mm = text.match(/\bX\s?([1-7])\b/i)) && has('X' + mm[1])) return 'X' + mm[1];
    if ((mm = text.match(/\biX([123])\b/i)) && has('iX' + mm[1])) return 'iX' + mm[1];
    if (/\biX\b/i.test(text) && has('iX')) return 'iX';
    if ((mm = text.match(/\bi([34567])\b/i)) && has('i' + mm[1])) return 'i' + mm[1];
    if ((mm = text.match(/\bZ([34])\b/i)) && has('Z' + mm[1])) return 'Z' + mm[1];
    if ((mm = text.match(/\b([1-8])\d{2}\s?[a-z]{0,2}\b/i)) && has(mm[1] + '시리즈')) return mm[1] + '시리즈';
    return '';
  }
  if (mk.includes('아우디') || /audi/i.test(maker || '')) {
    if (/e-?트론|e-?tron/i.test(text)) {
      for (const c of ['Q4 e-트론', 'Q6 e-트론', 'Q8 e-트론', 'A6 e-트론', 'SQ6 e-트론', 'SQ8 e-트론', 'RS e-트론 GT', 'e-트론 GT', 'e-트론'])
        if (has(c) && (c === 'e-트론' || new RegExp(c.split(' ')[0], 'i').test(text))) return c;
    }
    if ((mm = text.match(/\bQ\s?([1-8])\b/i)) && has('Q' + mm[1])) return 'Q' + mm[1];
    if ((mm = text.match(/\bA\s?([1-8])\b/i)) && has('A' + mm[1])) return 'A' + mm[1];
    return '';
  }
  return '';
}

/**
 * SSOT 엔트리 인덱스 빌드.
 * @param {Array} ssotEntries  loadSsotEntries() 결과 (variants/trims 포함)
 */
export function buildSnapIndex(ssotEntries) {
  const index = buildVehicleIndex(ssotEntries);   // maker/model/세부모델 매칭용
  const byKey = new Map();
  const byModel = new Map();
  const byModelNorm = new Map();   // `${maker}|${model}` 공백·하이픈 무시 → 이미 분류된 제품 직접 매칭
  const modelsByMaker = new Map(); // keyNorm(maker) → Set(model)  (수입 엔진코드 추론 검증용)
  for (const e of ssotEntries) {
    byKey.set(`${e.maker}|${e.model}|${e.sub_model}`, e);
    const mk = `${e.maker}|${e.model}`;
    if (!byModel.has(mk)) byModel.set(mk, []);
    byModel.get(mk).push(e);
    const nk = `${keyNorm(e.maker)}|${keyNorm(e.model)}`;
    if (!byModelNorm.has(nk)) byModelNorm.set(nk, []);
    byModelNorm.get(nk).push(e);
    const mkk = keyNorm(e.maker);
    if (!modelsByMaker.has(mkk)) modelsByMaker.set(mkk, new Set());
    modelsByMaker.get(mkk).add(e.model);
  }
  return { index, byKey, byModel, byModelNorm, modelsByMaker };
}

/** 엔트리가 전기/수소 전용(가스 파워트레인 없음)인지 */
function isEvOnly(e) {
  return e.variants && e.variants.length && e.variants.every(v => ['전기', '수소'].includes(fuelKey(v.fuel)));
}
function entryYears(e) {
  const ys = Number(String(e.year_start || '').slice(0, 4)) || 0;
  const ye = e.year_end === '현재' ? 9999 : (Number(String(e.year_end || '').slice(0, 4)) || 9999);
  return [ys, ye];
}
/* 매물 등록일 → 연도. 'YYYY-MM-DD' / 'YY-MM-DD'(22→2022) / 'YYYYMM' 모두 처리 */
function regYearOf(p) {
  const s = String(p.first_registration_date || p.year || '').trim();
  let mm;
  if ((mm = s.match(/(19|20)\d{2}/))) return Number(mm[0]);          // 4자리 연도 포함
  if ((mm = s.match(/^(\d{2})[-.\/ ]/))) return 2000 + Number(mm[1]); // YY-MM-DD
  if ((mm = s.match(/^(\d{2})$/))) return 2000 + Number(mm[1]);
  return 0;
}

/**
 * 매물 → SSOT 종착지 스냅.
 * @returns {{maker,model,sub_model,gen_code,variant,trim_name}|null}  null = SSOT 매칭 실패(폴백 필요)
 */
export function snapToSsot(p, snapIndex) {
  const { index, byModel, byModelNorm, modelsByMaker } = snapIndex;

  // 1) 제품의 기존 maker/model 우선 (공백·하이픈 무시) — 이미 분류된 현재고에 강함 (테슬라 '모델Y'='모델 Y')
  let cand = (p.maker && p.model) ? byModelNorm.get(`${keyNorm(p.maker)}|${keyNorm(p.model)}`) : null;
  let m = null;
  // 2) 없으면 raw 텍스트로 matchVehicle
  if (!cand || !cand.length) {
    m = matchVehicle(
      p.raw_model_short || p.model || '',
      p.raw_model_full || `${p.model || ''} ${p.sub_model || ''} ${p.trim_name || ''}`,
      p.first_registration_date || p.year || '',
      index
    );
    if (m.maker && m.model) cand = byModel.get(`${m.maker}|${m.model}`) || [];
  }
  // 3) 수입 엔진코드 추론 (520d→5시리즈, S400d→S클래스, A6 45→A6) — 모델명이 코드로만 온 수입차
  if (!cand || !cand.length) {
    const mkr = p.maker || (m && m.maker) || '';
    const text = `${p.model || ''} ${p.sub_model || ''} ${p.trim_name || ''} ${p.raw_model_full || ''} ${p.raw_model_short || ''}`;
    const inferred = inferImportModel(mkr, text, modelsByMaker && modelsByMaker.get(keyNorm(mkr)));
    if (inferred) cand = byModelNorm.get(`${keyNorm(mkr)}|${keyNorm(inferred)}`) || [];
  }
  if (!cand || !cand.length) return null;

  const pf = fuelKey(p.fuel_type) || fuelKey(`${p.trim_name || ''} ${p.raw_model_full || ''}`);
  const regYear = regYearOf(p);

  // 1) 연식 범위 (생산기간) 필터
  if (regYear) {
    const inRange = cand.filter(e => { const [ys, ye] = entryYears(e); return ys && regYear >= ys && regYear <= ye; });
    if (inRange.length) cand = inRange;
  }
  // 2) 연료 필터 — 전기/수소면 그 세부모델, 아니면 전기·수소 전용 세부모델 제외 (가스차가 '일렉트리파이드'로 가는 것 방지)
  if (pf === '전기' || pf === '수소') {
    const ev = cand.filter(e => e.variants.some(v => fuelKey(v.fuel) === pf));
    if (ev.length) cand = ev;
  } else if (pf) {
    const nonEv = cand.filter(e => !isEvOnly(e));
    if (nonEv.length) cand = nonEv;
  }

  // 3) 최종 세부모델 — (matchVehicle 픽 또는 제품 세부모델) 이 후보에 있으면 그것, 없으면 연료맞는 것 → 최신
  const preferredSub = (m && m.sub_model) || p.sub_model || '';
  const entry =
    (preferredSub && cand.find(e => e.sub_model === preferredSub)) ||
    (preferredSub && cand.find(e => keyNorm(e.sub_model) === keyNorm(preferredSub))) ||
    cand.find(e => pf && e.variants.some(v => fuelKey(v.fuel) === pf)) ||
    [...cand].sort((a, b) => String(b.year_start || '').localeCompare(String(a.year_start || '')))[0];
  if (!entry) return null;

  const v = snapVariant(p, entry.variants);
  // 트림은 '스냅된 파워트레인의 트림'만 (LPG에 가솔린 N Line 안 붙게). 없으면 세부모델 union 폴백.
  const vTrims = (v && v.trims && v.trims.length) ? v.trims : entry.trims;
  return {
    maker: entry.maker,
    model: entry.model,
    sub_model: entry.sub_model,
    gen_code: entry.gen_code || '',
    variant: variantLabel(v),
    trim_name: snapTrim((m && m.trim_name) || p.trim_name, vTrims),
  };
}
