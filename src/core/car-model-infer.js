/**
 * car-model-infer.js — OCR 차명·등록일 → vehicle_master generation 추론
 *
 * 분리 이유: store 의존을 매개변수(carModels)로 받아 순수 함수화 → 테스트 가능.
 *
 * 알고리즘:
 *   1. 차명 정확 매칭 (normalize 후 동일) — 마스터 model 과 거의 1:1
 *   2. 실패 시 양방향 substring fallback ("그랜저 3.0" ↔ "그랜저")
 *   3. production_start ≤ 최초등록일 (필수: 생산 시작 전 등록 불가)
 *   4. 종료된 generation 도 후보 — 재고 판매 후 등록 가능
 *   5. 거리 (등록일이 [start, end] 안 → 0, 종료 후 → regYM - peYM) 가장 작은 generation 우선
 */

/* 한글/영문/숫자만 보존 — \W 는 ASCII 한정이라 한글이 제거됨. \p{L}/\p{N} 으로 Unicode 인식 */
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/* "2018.05.10" / "2018-05-10" / "201805" → 2018*12+5 = 24221 */
function parseYM(s) {
  const d = String(s || '').replace(/[^\d]/g, '');
  if (d.length >= 6) return Number(d.slice(0, 4)) * 12 + Number(d.slice(4, 6));
  if (d.length === 4) return Number(d) * 12 + 12;   // 연도만 있으면 연말로
  return null;
}

function psYM(m) {
  if (m.production_start) return parseYM(m.production_start + '-01');
  if (m.year_start) return Number(m.year_start) * 12 + 1;
  return 0;
}
function peYM(m) {
  const v = m.production_end || m.year_end;
  if (!v || v === '현재' || v === 'current') return Infinity;
  if (/^\d{4}$/.test(String(v))) return Number(v) * 12 + 12;
  return parseYM(v + '-12') ?? Infinity;
}

/**
 * @param {string} ocrModel - OCR 추출 차명 (예: "그랜저", "K5")
 * @param {string} ocrYear - 연식 (4자리 연도, 등록일에서 fallback 가능)
 * @param {string} ocrRegDate - 최초등록일 (YYYY.MM.DD 또는 YYYY-MM-DD)
 * @param {Array} carModels - vehicle_master 컬렉션
 * @returns {Object|null} { maker, model, sub_model, vehicle_class } 또는 null
 */
export function inferCarModel(ocrModel, ocrYear, ocrRegDate, carModels = []) {
  if (!ocrModel) return null;
  const ocrNorm = normalize(ocrModel);
  if (!ocrNorm) return null;

  const regYM = parseYM(ocrRegDate) ?? (ocrYear ? Number(ocrYear) * 12 + 12 : null);
  if (!regYM) return null;

  const all = (carModels || []).filter(m => !m.archived && m.model);

  // 1. 정확 매칭 우선
  let candidates = all.filter(m => normalize(m.model) === ocrNorm);
  // 2. fallback: 양방향 substring
  if (!candidates.length) {
    candidates = all.filter(m => {
      const mNorm = normalize(m.model);
      return mNorm.includes(ocrNorm) || ocrNorm.includes(mNorm);
    });
  }
  if (!candidates.length) return null;

  // 3. production_start ≤ 등록일
  const valid = candidates.filter(m => psYM(m) <= regYM);
  if (!valid.length) return null;

  // 4. 거리 — 등록일 ∈ [start, end] → 0, 종료 후 → regYM - peYM
  const distance = (m) => {
    const pe = peYM(m);
    return regYM <= pe ? 0 : regYM - pe;
  };
  // 5. 거리 오름차순, 동률은 production_start 내림차순 (최신 generation 우선)
  valid.sort((a, b) => {
    const da = distance(a), db = distance(b);
    if (da !== db) return da - db;
    return psYM(b) - psYM(a);
  });

  const best = valid[0];
  return {
    maker: best.maker,
    model: best.model,
    sub_model: best.sub_model,
    vehicle_class: best.vehicle_class || best.category || '',
  };
}
