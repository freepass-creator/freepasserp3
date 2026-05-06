/**
 * sheet-importer.js — 외부 공급사 구글시트 row → freepasserp3 product 객체 변환.
 *
 * "구글시트에 개똥같이 입력해도 찰떡같이 우리형태에 맞춰서 재고등록" — best-effort 정규화.
 *
 * 흐름:
 *   1. fetchSheetValues(sheetId, tab, range) — Sheets API 로 row 들 가져옴
 *   2. parseRow(row, headerMap) — row → raw product (정규화 안 된 상태)
 *   3. enrichWithCatalog(raw) — catalog 매칭으로 sub_model/trim/options 표준화
 *   4. filterByCatalog + filterByCarNumberUnique — 시스템 중복 제외 + 매칭 가능만
 *   5. importToProducts — RTDB push
 */
import { findCatalog, loadCatalog, findTrimInCatalog } from './vehicle-matrix.js';
import { titleToSubModel } from './catalog-source.js';

const SHEETS_API_KEY = 'AIzaSyBSPo1kZOefX-6NuHoQdUF1htqQDSxXsCs';

/* ──────── 1. 시트 fetch ──────── */
export async function fetchSheetValues(sheetId, tab, range = 'A1:AZ2000') {
  const tabEnc = encodeURIComponent(tab);
  const rangeFull = `${tabEnc}!${range}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${rangeFull}?key=${SHEETS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`시트 fetch 실패: ${res.status}`);
  const data = await res.json();
  return data.values || [];
}

/** header row 1줄 → { 차량번호: 'D', 제조사: 'X', ... } 같은 컬럼 이름 → 인덱스 매핑 */
export function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((name, idx) => {
    if (name) map[String(name).trim()] = idx;
  });
  return map;
}

/* ──────── 2. 정규화 헬퍼 ──────── */

/** "HEV 1.6" / "G 2.5" / "가솔린" / "Petrol" → 표준 (가솔린/디젤/하이브리드/LPG/전기) */
export function normalizeFuel(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return '';
  if (/하이브리드|hybrid|hev|hv/i.test(s)) return '하이브리드';
  if (/^전기|\bev\b|electric|배터리|kwh/i.test(s)) return '전기';
  if (/디젤|diesel|\bd\b\s*\d/i.test(s)) return '디젤';
  if (/lpg|lpi|liquid|가스/i.test(s)) return 'LPG';
  if (/수소|hydrogen|fcev/i.test(s)) return '수소';
  if (/가솔린|gasoline|petrol|휘발유|^g\b|\bg\b\s*\d/i.test(s)) return '가솔린';
  return '';
}

/** "26-04-13" / "2026-04-13" / "2026.04.13" / "2026/4/13" → "2026.04.13" + year 2026 */
export function normalizeDate(text) {
  if (!text) return { date: '', year: null };
  const s = String(text).trim();
  // YY-MM-DD 또는 YYYY-MM-DD (구분자: . - /)
  const m = s.match(/^(\d{2,4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return { date: '', year: null };
  let y = Number(m[1]);
  if (y < 100) y = y < 50 ? 2000 + y : 1900 + y;
  const mo = String(m[2]).padStart(2, '0');
  const d = String(m[3]).padStart(2, '0');
  return { date: `${y}.${mo}.${d}`, year: y };
}

/** "47,650,000" / "4,765만" / "47650000" → 47650000 */
export function normalizePrice(text) {
  if (text == null || text === '') return null;
  const s = String(text).replace(/[,\s원]/g, '');
  if (/만$/.test(s)) {
    const n = parseFloat(s.replace(/만$/, ''));
    return Number.isFinite(n) ? Math.round(n * 10000) : null;
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "20" / "20km" / "2만" / "20,000" → 정수 km */
export function normalizeMileage(text) {
  if (text == null || text === '') return null;
  const s = String(text).replace(/[,\s]/g, '');
  if (/만$/.test(s)) {
    const n = parseFloat(s.replace(/[만kmKM]+$/g, ''));
    return Number.isFinite(n) ? Math.round(n * 10000) : null;
  }
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 차량번호 한국 plate 형식 검증 (\d{2,3}[가-힣]\d{4}) */
export function isValidCarNumber(text) {
  return /^\d{2,3}[가-힣]\s?\d{4}$/.test(String(text || '').trim());
}

/** 옵션 텍스트 split — 콤마/슬래시 + 대괄호 묶음 */
export function splitOptions(text) {
  if (!text) return [];
  // 대괄호 [a + b] 안의 + 는 한 옵션 (그룹) 으로 보존
  const out = [];
  const s = String(text);
  let buf = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '[') { depth++; buf += ch; continue; }
    if (ch === ']') { depth--; buf += ch; continue; }
    if (depth === 0 && (ch === ',' || ch === '/' || ch === '·')) {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/* ──────── 3. 시트 row → raw product 변환 ──────── */

/** header 컬럼 이름 → product 필드 매핑. 시트마다 헤더 다를 수 있어서 alias 여러 개. */
const COLUMN_MAP = {
  car_number:  ['차량번호'],
  maker:       ['제조사', '메이커'],
  raw_model:   ['차종분류', '차종', '모델'],
  sub_model:   ['세부모델', '세부 모델', '모델명'],
  fuel_raw:    ['연료'],
  ext_color:   ['외장', '외장색', '외부'],
  int_color:   ['내장', '내장색', '내부'],
  mileage_raw: ['Km', '주행거리', '주행', 'km'],
  trim_name:   ['트림'],
  options_raw: ['옵션'],
  reg_date:    ['최초등록', '최초등록일'],
  vehicle_price_raw: ['소비자가격', '차량가격'],
  engine_cc:   ['배기량'],
  location:    ['차고지', '위치'],
  status:      ['상태'],
  account:     ['전용계좌', '계좌번호'],
  memo:        ['비고', '메모'],
  // 가격 (월별)
  price_1m:    ['1개월'],
  price_6m:    ['6개월'],
  price_12m:   ['12개월'],
  price_24m:   ['24개월'],
  price_36m:   ['36개월'],
  price_48m:   ['48개월'],
  price_60m:   ['60개월'],
};

function getCell(row, headerMap, key) {
  const aliases = COLUMN_MAP[key] || [];
  for (const a of aliases) {
    if (a in headerMap) {
      const idx = headerMap[a];
      return row[idx] ?? '';
    }
  }
  return '';
}

/** raw row → 정규화된 product 객체. catalog 매칭은 별도 단계 (enrichWithCatalog) */
export function parseRow(row, headerMap) {
  const carNum = String(getCell(row, headerMap, 'car_number') || '').trim();
  const out = { _raw_row: row };
  out.car_number = carNum;
  out.maker = String(getCell(row, headerMap, 'maker') || '').trim();
  out.raw_model = String(getCell(row, headerMap, 'raw_model') || '').trim();
  out.sub_model = String(getCell(row, headerMap, 'sub_model') || '').trim();
  out.fuel_type = normalizeFuel(getCell(row, headerMap, 'fuel_raw'));
  out.ext_color = String(getCell(row, headerMap, 'ext_color') || '').trim();
  out.int_color = String(getCell(row, headerMap, 'int_color') || '').trim();
  out.mileage = normalizeMileage(getCell(row, headerMap, 'mileage_raw'));
  out.trim_name = String(getCell(row, headerMap, 'trim_name') || '').trim();

  const optsRaw = getCell(row, headerMap, 'options_raw');
  out.options_raw = String(optsRaw || '');
  out.options = splitOptions(optsRaw);

  const dateInfo = normalizeDate(getCell(row, headerMap, 'reg_date'));
  out.first_registration_date = dateInfo.date;
  out.year = dateInfo.year;

  out.vehicle_price = normalizePrice(getCell(row, headerMap, 'vehicle_price_raw'));
  out.engine_cc = String(getCell(row, headerMap, 'engine_cc') || '').trim();
  out.location = String(getCell(row, headerMap, 'location') || '').trim();
  out.status_label = String(getCell(row, headerMap, 'status') || '').trim();
  out.account = String(getCell(row, headerMap, 'account') || '').trim();
  out.partner_memo = String(getCell(row, headerMap, 'memo') || '').trim();

  // 가격 매트릭스
  const price = {};
  for (const [key, period] of [['price_1m', '1'], ['price_6m', '6'], ['price_12m', '12'], ['price_24m', '24'], ['price_36m', '36'], ['price_48m', '48'], ['price_60m', '60']]) {
    const rent = normalizePrice(getCell(row, headerMap, key));
    if (rent) price[period] = { rent };
  }
  if (Object.keys(price).length) out.price = price;

  // status_label → vehicle_status 매핑
  const sl = out.status_label;
  if (/출고가능|판매중|할인/i.test(sl))    out.vehicle_status = '출고가능';
  else if (/계약중|계약완료/i.test(sl))     out.vehicle_status = '출고불가';
  else if (/계약요청|대기/i.test(sl))       out.vehicle_status = '출고협의';
  else if (/보류|매각|완료|수리/i.test(sl)) out.vehicle_status = '출고불가';
  else                                      out.vehicle_status = '상품화중';

  return out;
}

/* ──────── 4. catalog 매칭으로 표준화 ──────── */

/** raw product → { ok, matched_product?, reason? } */
export async function enrichWithCatalog(raw) {
  if (!isValidCarNumber(raw.car_number)) {
    return { ok: false, reason: '차량번호 형식 오류' };
  }
  if (!raw.maker) {
    return { ok: false, reason: 'maker 없음' };
  }

  // sub_model 후보: F (세부모델) 우선, 없으면 E (차종분류)
  const subCandidate = raw.sub_model || raw.raw_model || '';

  const cat = await findCatalog(raw.maker, subCandidate, raw.raw_model || raw.sub_model, {
    fuel_type: raw.fuel_type,
    year: raw.year,
    first_registration_date: raw.first_registration_date,
  });
  if (!cat?.catalogId) {
    return { ok: false, reason: `catalog 매칭 실패 (${raw.maker} / ${subCandidate})` };
  }
  const catalog = await loadCatalog(cat.catalogId);
  if (!catalog) return { ok: false, reason: `catalog load 실패: ${cat.catalogId}` };

  // 표준 sub_model (catalog title 에서 maker prefix 제거)
  const standardSub = titleToSubModel(raw.maker, catalog.title || '');
  const standardModel = catalog.model_root || catalog.model || '';

  // 트림 매칭 (best-effort)
  const trimWrap = raw.trim_name ? findTrimInCatalog(catalog, raw.trim_name, raw) : null;
  const standardTrim = trimWrap?.name || raw.trim_name || '';

  // 옵션 매칭 — catalog options 중 raw.options 와 매칭되는 것 ID 추출 (fp_options 용 X, 그냥 표준 이름)
  const standardOptions = matchOptionsAgainstCatalog(raw.options, catalog);

  return {
    ok: true,
    matched_product: {
      car_number: raw.car_number,
      maker: raw.maker,
      model: standardModel,
      sub_model: standardSub,
      trim_name: standardTrim,
      catalog_id: cat.catalogId,
      fuel_type: raw.fuel_type,
      ext_color: raw.ext_color,
      int_color: raw.int_color,
      mileage: raw.mileage,
      year: raw.year,
      first_registration_date: raw.first_registration_date,
      vehicle_price: raw.vehicle_price,
      engine_cc: raw.engine_cc,
      location: raw.location,
      vehicle_status: raw.vehicle_status,
      product_type: '중고렌트',
      options: standardOptions.length ? standardOptions : raw.options,
      partner_memo: raw.partner_memo || '',
      price: raw.price,
      // 추가 메타 — 매칭 후 사용자가 수동 보정 시 참고용
      status_label_raw: raw.status_label,
      account_raw: raw.account,
      options_raw: raw.options_raw,
    },
    catalogTitle: catalog.title,
    confidence: cat.confidence,
  };
}

/** raw 옵션 토큰 들 ↔ catalog options 매칭 (substring 양방향) — 표준 이름 반환 */
function matchOptionsAgainstCatalog(rawOptions, catalog) {
  if (!Array.isArray(rawOptions) || !rawOptions.length) return [];
  const cataOpts = catalog.options ? Object.values(catalog.options).map(o => o.name).filter(Boolean) : [];
  if (!cataOpts.length) return rawOptions.slice();
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\(\)\(\)/·\-_,.\[\]]+/g, '');
  const matched = new Set();
  for (const raw of rawOptions) {
    const r = norm(raw);
    if (!r) continue;
    let found = null;
    for (const co of cataOpts) {
      const cn = norm(co);
      if (!cn) continue;
      if (cn === r || cn.includes(r) || r.includes(cn)) { found = co; break; }
    }
    matched.add(found || raw);
  }
  return [...matched];
}
