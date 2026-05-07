/**
 * sheet-importer.js — 외부 공급사 구글시트 → freepasserp3 product 변환.
 *
 * **현재 지원 시트는 정확히 2개** (사용자 요청: "범용성 없이 딱 내가 준거 2개만"):
 *   1) 종합시트   (sheetId 1BcH... · gid 1422892422 · "종합" 탭)
 *   2) 오토플러스 (sheetId 1TJB... · gid 284963459  · "판매차량리스트" 탭)
 *
 * 각 시트는 컬럼 인덱스 기반 전용 파서가 있음 (parseZonghapRow / parseAutoplusRow).
 * 다른 시트가 들어오면 detectProfile 이 null 을 반환하고 fetch 단계에서 throw.
 *
 * 흐름:
 *   1. parseSheetUrl(url) → { sheetId, gid }
 *   2. fetchSheetWithProfile(sheetId, gid) → { profile, tab, headerRow, dataRows }
 *   3. profile.parser(row) → raw product
 *   4. enrichWithCatalog(raw) → 표준화 (catalog_id / sub_model / trim_name / options)
 *   5. dev.js 에서 차량번호 unique 필터링 후 RTDB push
 */
import { findCatalog, loadCatalog, findTrimInCatalog } from './vehicle-matrix.js';
import { titleToSubModel } from './catalog-source.js';

export const SHEETS_API_KEY = 'AIzaSyBSPo1kZOefX-6NuHoQdUF1htqQDSxXsCs';

/* ──────── URL/ID 파싱 ──────── */

/** URL 에서 sheetId + gid 추출. ID 만 들어와도 통과. */
export function parseSheetUrl(url) {
  if (!url) return { sheetId: '', gid: null };
  if (!/^https?:/i.test(url) && /^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) {
    return { sheetId: url.trim(), gid: null };
  }
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = url.match(/[?#&]gid=(\d+)/);
  return {
    sheetId: idMatch?.[1] || '',
    gid: gidMatch ? Number(gidMatch[1]) : null,
  };
}

/** gid → 탭 title (Sheets API spreadsheets.get) */
export async function resolveTabTitle(sheetId, gid) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${SHEETS_API_KEY}&fields=sheets.properties`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`시트 정보 조회 실패: ${res.status}`);
  const data = await res.json();
  const sheets = data.sheets || [];
  if (gid != null) {
    const found = sheets.find(s => s.properties?.sheetId === gid);
    if (found?.properties?.title) return found.properties.title;
  }
  return sheets[0]?.properties?.title || '';
}

/** values.batchGet — 한 탭 전체 row 매트릭스 */
export async function fetchSheetValues(sheetId, tab, range = 'A1:AZ2000') {
  const tabEnc = encodeURIComponent(tab);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${tabEnc}!${range}?key=${SHEETS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`시트 fetch 실패: ${res.status}`);
  const data = await res.json();
  return data.values || [];
}

/** 차량번호 셀의 chipRuns + hyperlink 추출 → row index → photo URL map */
export async function fetchPhotoLinkMap(sheetId, tab, carNumberColLetter) {
  const tabEnc = encodeURIComponent(tab);
  const map = {};
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?ranges=${tabEnc}!${carNumberColLetter}1:${carNumberColLetter}2000&fields=sheets.data.rowData.values(chipRuns,hyperlink,formattedValue,userEnteredValue.formulaValue)&key=${SHEETS_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return map;
    const data = await res.json();
    const rows = data.sheets?.[0]?.data?.[0]?.rowData || [];
    rows.forEach((rd, ri) => {
      const cell = (rd.values || [])[0];
      if (!cell) return;
      for (const chip of (cell.chipRuns || [])) {
        const uri = chip?.chip?.richLinkProperties?.uri || '';
        if (uri) { map[ri] = uri.split('?')[0]; return; }
      }
      if (cell.hyperlink) { map[ri] = cell.hyperlink; return; }
      const formula = cell.userEnteredValue?.formulaValue || '';
      const m = formula.match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
      if (m) map[ri] = m[1];
    });
  } catch (e) { console.warn('[photo link map]', e); }
  return map;
}

/* ──────── 정규화 헬퍼 (정렬 패턴) ──────── */

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

export function normalizeDate(text) {
  if (!text) return { date: '', year: null };
  const s = String(text).trim();
  const m = s.match(/^(\d{2,4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return { date: '', year: null };
  let y = Number(m[1]);
  if (y < 100) y = y < 50 ? 2000 + y : 1900 + y;
  const mo = String(m[2]).padStart(2, '0');
  const d = String(m[3]).padStart(2, '0');
  return { date: `${y}.${mo}.${d}`, year: y };
}

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

export function isValidCarNumber(text) {
  return /^\d{2,3}[가-힣]\s?\d{4}$/.test(String(text || '').trim());
}

/** 트림 풀명에서 displacement 추출 — "1.6 가솔린 터보 프레스티지" → "1.6" */
export function extractDisplacement(text) {
  if (!text) return '';
  const m = String(text).match(/(\d\.\d)/);
  return m ? m[1] : '';
}

export function splitOptions(text) {
  if (!text) return [];
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

/* ──────── 모델→제조사 추론 (시트 들쭉날쭉할 때 보정) ──────── */

const MODEL_TO_MAKER = {
  // 현대
  '그랜저': '현대', '쏘나타': '현대', '아반떼': '현대', '투싼': '현대', '싼타페': '현대',
  '팰리세이드': '현대', '코나': '현대', '베뉴': '현대', '캐스퍼': '현대', '스타리아': '현대',
  '아이오닉': '현대', '넥쏘': '현대', '포터': '현대', '벨로스터': '현대',
  // 기아
  'k9': '기아', 'k8': '기아', 'k7': '기아', 'k5': '기아', 'k3': '기아',
  '쏘렌토': '기아', '카니발': '기아', '스포티지': '기아', '셀토스': '기아', '니로': '기아',
  'ev6': '기아', 'ev9': '기아', '모하비': '기아', '레이': '기아', '봉고': '기아',
  '스팅어': '기아', '모닝': '기아', '타스만': '기아', '포르테': '기아',
  // 제네시스
  'g90': '제네시스', 'g80': '제네시스', 'g70': '제네시스',
  'gv90': '제네시스', 'gv80': '제네시스', 'gv70': '제네시스', 'gv60': '제네시스',
  // KGM
  '토레스': 'KGM', '렉스턴': 'KGM', '티볼리': 'KGM', '코란도': 'KGM', '무쏘': 'KGM',
  // 르노
  'sm6': '르노', 'qm6': '르노', 'xm3': '르노', '아르카나': '르노', '마스터': '르노',
  '그랑 콜레오스': '르노', '콜레오스': '르노',
  // 쉐보레
  '말리부': '쉐보레', '트래버스': '쉐보레', '트랙스': '쉐보레', '이쿼녹스': '쉐보레',
  '콜로라도': '쉐보레', '볼트': '쉐보레', '타호': '쉐보레', '크루즈': '쉐보레',
  // 지프 (catalog 등록 모델 — public/data/car-master/jeep_*.json)
  '체로키': '지프', 'cherokee': '지프', '그랜드체로키': '지프', '그랜드 체로키': '지프',
  '랭글러': '지프', 'wrangler': '지프', '컴패스': '지프', 'compass': '지프',
  '레니게이드': '지프', '글래디에이터': '지프', 'gladiator': '지프', '어벤저': '지프', 'avenger': '지프',
  // 외산
  'bmw': 'BMW', '벤츠': '벤츠', 'mercedes': '벤츠', 'amg': '벤츠',
  '아우디': '아우디', 'audi': '아우디', '폭스바겐': '폭스바겐', 'volkswagen': '폭스바겐',
  '볼보': '볼보', 'volvo': '볼보', '테슬라': '테슬라', 'tesla': '테슬라',
  '포르쉐': '포르쉐', 'porsche': '포르쉐', '미니': '미니', 'mini': '미니',
  '재규어': '재규어', '랜드로버': '랜드로버',
};

const VALID_MAKERS = new Set([
  '현대', '기아', '제네시스', 'KGM', '쉐보레', '르노', '르노코리아', 'KG모빌리티', '쌍용', '지프',
  'BMW', '벤츠', '아우디', '폭스바겐', '볼보', '테슬라', '포르쉐', '미니', '재규어', '랜드로버',
  '렉서스', '도요타', '혼다', '닛산', '마세라티', '벤틀리', '롤스로이스', '페라리', '람보르기니',
]);

export function inferMaker(makerRaw, modelRaw, subModelRaw) {
  const m = String(makerRaw || '').trim();
  if (m && VALID_MAKERS.has(m)) return m;
  // 시트 제조사 칸이 비었거나 모델명 들어있을 때 — 모델명 키워드로 추론
  const candidates = [m, modelRaw, subModelRaw].filter(Boolean).map(s => String(s).toLowerCase());
  for (const c of candidates) {
    for (const [model, maker] of Object.entries(MODEL_TO_MAKER)) {
      if (c.includes(model.toLowerCase())) return maker;
    }
  }
  return m;
}

/** sub_model 텍스트에서 maker prefix 제거 — "지프 체로키" → "체로키", "기아 셀토스" → "셀토스".
 *  시트가 차종 컬럼에 "{브랜드} {모델}" 로 입력하는 케이스 → catalog 의 sub_model 과 매칭되도록 정규화.
 *  영문 maker 명도 처리 (예: "Jeep 체로키" → "체로키"). */
export function stripMakerPrefix(text, maker) {
  if (!text || !maker) return text || '';
  const t = String(text).trim();
  const m = String(maker).trim();
  if (!m) return t;
  // 정확히 "{maker} " 로 시작하는 경우만 제거 (단어 단위, 부분 매칭 X)
  const lower = t.toLowerCase();
  const mLower = m.toLowerCase();
  if (lower === mLower) return '';                          // 그냥 "지프" 만 — 모델명 없음
  if (lower.startsWith(mLower + ' '))   return t.slice(m.length).trim();
  if (lower.startsWith(mLower + '\t'))  return t.slice(m.length).trim();
  // maker 의 한글/영문 별칭도 시도 (예: 'Jeep' / '지프')
  const aliasMap = {
    '지프': ['Jeep', 'JEEP'],
    'BMW':  ['비엠더블유', '비엠'],
    '벤츠': ['Mercedes', 'Benz', 'MERCEDES'],
    '아우디': ['Audi', 'AUDI'],
    '폭스바겐': ['Volkswagen', 'VW'],
    '볼보': ['Volvo'],
    '테슬라': ['Tesla'],
    '포르쉐': ['Porsche'],
  };
  for (const alias of (aliasMap[m] || [])) {
    const aLower = alias.toLowerCase();
    if (lower.startsWith(aLower + ' ')) return t.slice(alias.length).trim();
  }
  return t;
}

/* ──────── 시트별 전용 프로파일 ──────── */

const SHEET_PROFILES = {
  zonghap: {
    key: 'zonghap',
    label: '종합시트',
    sheetId: '1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg',
    defaultGid: 1422892422,
    headerRowIdx: 0,
    dataStartRowIdx: 1,
    carNumberColLetter: 'D',
    parser: parseZonghapRow,
    // 종합시트는 모든 공급사 탭 (아이카/아이언/리더스/KH/연카/...) 이 동일 컬럼 구조.
    // multiTab=true 면 fetchSheetWithProfile 가 모든 탭을 fetch 해서 통합.
    multiTab: true,
    columnLabels: [
      'A 상태', 'B 입고일', 'C 구분', 'D 차량번호', 'E 차종분류', 'F 세부모델',
      'G 트림짧은표기', 'H 외장', 'I 내장', 'J Km', 'K 단기보증라벨',
      'L 1개월', 'M 6개월', 'N 12개월', 'O 장기보증라벨',
      'P 24개월', 'Q 36개월', 'R 48개월', 'S 60개월',
      'T 트림풀명', 'U 옵션', 'V 최초등록', 'W 소비자가격', 'X 제조사', 'Y 배기량',
      'Z 차고지', 'AA 운행지역', 'AB 운행구간', 'AC 분납', 'AD 21세', 'AE 23세',
      'AF 1년+', 'AG 보증', 'AH 도장', 'AI 사진', 'AJ 자차', 'AK 무보험', 'AL 사고',
      'AM 전용계좌', 'AN 비고',
    ],
  },
  autoplus: {
    key: 'autoplus',
    label: '오토플러스',
    sheetId: '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U',
    defaultGid: 284963459,
    headerRowIdx: 8,
    dataStartRowIdx: 10,
    carNumberColLetter: 'B',
    parser: parseAutoplusRow,
    columnLabels: [
      'A No.', 'B 차량번호', 'C 차종', 'D 모델명(트림풀명)', 'E 색상', 'F 변속',
      'G 최초등록일', 'H 누적주행', 'I 판매시작일', 'J 판매일수', 'K 판매상태',
      'L 12/3만', 'M 18/2만', 'N 24/2만', 'O 36/2만',
      'P 18/3만', 'Q 24/3만', 'R 36/3만',
      'S 옵션', 'T 비고',
    ],
  },
};

export function detectProfile(sheetId) {
  for (const prof of Object.values(SHEET_PROFILES)) {
    if (prof.sheetId === sheetId) return prof;
  }
  return null;
}

export function listSupportedProfiles() {
  return Object.values(SHEET_PROFILES);
}

/** profile 자동 감지 + fetch 일괄 — dev.js 진입점.
 *  - 종합시트 (multiTab=true): 모든 탭 (공급사별) fetch 후 통합. raw 에 _source_tab 메타 추가.
 *  - 오토플러스: 단일 defaultGid 탭만 fetch.
 *  사용자가 URL 의 gid 로 다른 탭 줘도 무시 (정해진 데이터 탭 사용). */
export async function fetchSheetWithProfile(sheetId, _gid) {
  const profile = detectProfile(sheetId);
  if (!profile) {
    const supported = Object.values(SHEET_PROFILES).map(p => p.label).join(', ');
    throw new Error(`알 수 없는 시트입니다. 지원되는 시트: ${supported}`);
  }

  // multiTab — 모든 탭의 데이터 행을 합쳐서 dataRows 로 반환
  if (profile.multiTab) {
    const tabs = await listSheetTabs(sheetId);
    const dataRows = [];
    const tabSummary = [];
    for (const tabName of tabs) {
      try {
        const values = await fetchSheetValues(sheetId, tabName);
        const rows = values.slice(profile.dataStartRowIdx);
        const validRows = rows.filter(r => r && r.length && (r[3] || '').toString().trim());  // 차량번호 컬럼 (D)
        for (const row of validRows) {
          // _source_tab 메타를 raw row 마지막 슬롯에 끼워두면 parser 에서 noop (parser 는 0~39 인덱스만 사용).
          // dev.js 에서 parser 호출 후 _source_tab 별도 wire 위해 row 객체로 wrap.
          dataRows.push({ _row: row, _source_tab: tabName });
        }
        tabSummary.push({ tab: tabName, count: validRows.length });
      } catch (e) {
        console.warn(`[multi-tab fetch] ${tabName} 실패:`, e.message || e);
        tabSummary.push({ tab: tabName, count: 0, error: e.message });
      }
    }
    return { profile, tab: `${tabs.length}개 탭 통합`, headerRow: [], dataRows, tabSummary };
  }

  // 단일 탭
  const tab = await resolveTabTitle(sheetId, profile.defaultGid);
  if (!tab) throw new Error(`데이터 탭 조회 실패 (gid ${profile.defaultGid})`);
  const values = await fetchSheetValues(sheetId, tab);
  const headerRow = values[profile.headerRowIdx] || [];
  const dataRows = values.slice(profile.dataStartRowIdx);
  return { profile, tab, headerRow, dataRows };
}

/** 시트의 모든 탭명 list (sheets.properties.title) */
async function listSheetTabs(sheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${SHEETS_API_KEY}&fields=sheets.properties.title`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`시트 탭 목록 조회 실패: ${res.status}`);
  const data = await res.json();
  return (data.sheets || []).map(s => s.properties?.title).filter(Boolean);
}

/* ──────── 시트별 row → raw product ──────── */

/** 종합시트 — 컬럼 인덱스 기반 (헤더 1행 / 데이터 2행~) */
function parseZonghapRow(row) {
  const c = (i) => String(row[i] ?? '').trim();
  const out = { _raw_row: row, _profile: 'zonghap' };

  out.car_number = c(3);
  out.status_label = c(0);
  out.received_date = c(1);
  out.kind = c(2);                                  // 신차/중고
  out.trim_keyword = c(6);                           // 'HEV 1.6' 같은 짧은 표기
  out.ext_color = c(7);
  out.int_color = c(8);
  out.mileage = normalizeMileage(c(9));
  out.options_raw = c(20);
  out.options = splitOptions(c(20));
  const dateInfo = normalizeDate(c(21));
  out.first_registration_date = dateInfo.date;
  out.year = dateInfo.year;
  out.vehicle_price = normalizePrice(c(22));
  out.maker_raw = c(23);
  out.engine_cc = c(24);
  out.location = c(25);
  out.account = c(38);
  out.partner_memo = c(39);
  out.fuel_type = normalizeFuel(c(6) + ' ' + c(19));
  out.maker = inferMaker(c(23), c(4), c(5));

  // 차종/세부모델/트림명에 maker prefix ("지프 체로키" / "기아 셀토스") 들어있으면 제거
  out.raw_model = stripMakerPrefix(c(4), out.maker);
  out.sub_model_raw = stripMakerPrefix(c(5), out.maker);
  out.trim_name = stripMakerPrefix(c(19), out.maker);
  // 트림 풀명 + 트림 짧은표기 + 배기량컬럼 에서 displacement 추출
  out.displacement = extractDisplacement(c(6) + ' ' + c(19)) || extractDisplacement(c(24));

  // 가격 매트릭스 (단기 1/6/12 + 장기 24/36/48/60)
  const price = {};
  const priceMap = { '1': 11, '6': 12, '12': 13, '24': 15, '36': 16, '48': 17, '60': 18 };
  for (const [period, idx] of Object.entries(priceMap)) {
    const rent = normalizePrice(c(idx));
    if (rent) price[period] = { rent };
  }
  if (Object.keys(price).length) out.price = price;

  out.vehicle_status = mapStatusLabel(out.status_label);
  return out;
}

/** 오토플러스 — 컬럼 인덱스 기반 (헤더 9행 / 데이터 11행~) */
function parseAutoplusRow(row) {
  const c = (i) => String(row[i] ?? '').trim();
  const out = { _raw_row: row, _profile: 'autoplus' };

  out.no = c(0);
  out.car_number = c(1);
  out.ext_color = c(4);
  out.int_color = '';                                 // 시트에 컬럼 없음
  out.transmission_raw = c(5);
  const dateInfo = normalizeDate(c(6));
  out.first_registration_date = dateInfo.date;
  out.year = dateInfo.year;
  out.mileage = normalizeMileage(c(7));
  out.received_date = c(8);
  out.sale_days = c(9);
  out.status_label = c(10);
  out.options_raw = c(18);
  out.options = splitOptions(c(18));
  out.partner_memo = c(19);
  // 연료 컬럼이 없음 — 차종(C) + 모델명(D) 둘 다 검사 + 명시 없으면 default 가솔린
  // (오토플러스는 EV/HEV/디젤만 명시하고 가솔린은 표기 생략하는 패턴)
  const fuelText = c(2) + ' ' + c(3);
  out.fuel_type = normalizeFuel(fuelText) || (fuelText.trim() ? '가솔린' : '');
  out.maker = inferMaker('', c(2), c(3));            // 제조사 컬럼 없음 — C/D 컬럼에서 추론

  // C 컬럼 (차종) / D 컬럼 (모델명·트림풀명) 에 maker prefix 가 들어있는 경우 제거.
  //   예: "지프 체로키" → "체로키" (catalog 의 sub_model 과 매칭)
  //       "체로키(KL) 2.4 FWD Limited" → 그대로 (모델 prefix 일 뿐)
  out.raw_model = stripMakerPrefix(c(2), out.maker);
  out.sub_model_raw = stripMakerPrefix(c(2), out.maker);
  out.trim_name = stripMakerPrefix(c(3), out.maker);
  // 트림 풀명에서 displacement 추출 — "1.6 가솔린 터보" → "1.6" (findTrimInCatalog 가중치 +40)
  out.displacement = extractDisplacement(c(3) + ' ' + c(2));

  // 가격 매트릭스 — 2만km 기준 (12_3만/18_3만/24_3만/36_3만 은 별도)
  const price = {};
  const priceMap2man = { '12': 11, '18': 12, '24': 13, '36': 14 };  // L,M,N,O = 2만km 기본
  for (const [period, idx] of Object.entries(priceMap2man)) {
    const rent = normalizePrice(c(idx));
    if (rent) price[period] = { rent };
  }
  if (Object.keys(price).length) out.price = price;

  // 3만km 그룹은 partner_memo 에 보존 (스키마 미정 — 추후 사용자가 결정)
  const ext3man = [['18', 15], ['24', 16], ['36', 17]]
    .map(([p, i]) => { const r = normalizePrice(c(i)); return r ? `${p}/3만:${r.toLocaleString()}` : ''; })
    .filter(Boolean).join(' ');
  if (ext3man) out.partner_memo = (out.partner_memo ? out.partner_memo + ' | ' : '') + ext3man;

  out.vehicle_status = mapStatusLabel(out.status_label);
  return out;
}

function mapStatusLabel(sl) {
  // vehicle_status 표준 5가지 (사용자 정책): 즉시출고 / 출고가능 / 출고협의 / 상품화중 / 출고불가
  //   - 즉시출고: '즉시'
  //   - 출고가능: 출고가능 / 판매중 / 할인 / 예약 / 예약판매
  //   - 출고협의: 협의·계약요청·대기·보류 — 협의 가능
  //   - 상품화중: 수리·상품화 — 정비/입고 후 출고 준비
  //   - 출고불가: 계약중·계약완료·매각·단종·중지·불가·출고완료 — import skip
  //   - default: '상품화중' (모르겠으면 입고 단계로 분류)
  if (/즉시/.test(sl))                                       return '즉시출고';
  if (/출고가능|판매중|할인|예약/.test(sl))                  return '출고가능';
  if (/출고협의|협의|계약요청|대기|보류|대차/.test(sl))      return '출고협의';
  if (/수리|상품화/.test(sl))                                return '상품화중';
  if (/계약중|계약완료|매각|단종|중지|불가|출고완료/.test(sl)) return '출고불가';
  return '출고협의';
}

/* ──────── catalog 매칭으로 표준화 ──────── */

export async function enrichWithCatalog(raw) {
  // 차량번호 invalid (미정/빈) 도 catalog 매칭은 진행 — import 시점에 임시번호 자동 발급.
  // raw.is_pending_plate 메타로 dev.js 에 알림.
  if (!isValidCarNumber(raw.car_number)) {
    raw.is_pending_plate = true;
  }
  if (!raw.maker) {
    return { ok: false, reason: 'maker 추론 실패' };
  }

  // catalog 매칭에 들어가는 "sub_model 후보"는 시트별로 다름:
  //   zonghap → F 컬럼 (sub_model_raw)
  //   autoplus → C 컬럼 (raw_model = sub_model_raw 와 같음)
  const subCandidate = raw.sub_model_raw || raw.raw_model || '';

  const cat = await findCatalog(raw.maker, subCandidate, raw.raw_model || raw.sub_model_raw, {
    fuel_type: raw.fuel_type,
    year: raw.year,
    first_registration_date: raw.first_registration_date,
  });
  if (!cat?.catalogId) {
    return { ok: false, reason: `catalog 매칭 실패 (${raw.maker} / ${subCandidate})` };
  }
  const catalog = await loadCatalog(cat.catalogId);
  if (!catalog) return { ok: false, reason: `catalog load 실패: ${cat.catalogId}` };

  const standardSub = titleToSubModel(raw.maker, catalog.title || '');
  const standardModel = catalog.model_root || catalog.model || '';

  const trimWrap = raw.trim_name ? findTrimInCatalog(catalog, raw.trim_name, raw) : null;
  const standardTrim = trimWrap?.name || raw.trim_name || '';

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
      status_label_raw: raw.status_label,
      account_raw: raw.account || '',
      options_raw: raw.options_raw,
    },
    catalogTitle: catalog.title,
    confidence: cat.confidence,
  };
}

function matchOptionsAgainstCatalog(rawOptions, catalog) {
  if (!Array.isArray(rawOptions) || !rawOptions.length) return [];
  const cataOpts = catalog.options ? Object.values(catalog.options).map(o => o.name).filter(Boolean) : [];
  if (!cataOpts.length) return rawOptions.slice();
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\(\)\(\)/·\-_,.\[\]]+/g, '');
  const matched = new Set();
  for (const r of rawOptions) {
    const rn = norm(r);
    if (!rn) continue;
    let found = null;
    for (const co of cataOpts) {
      const cn = norm(co);
      if (!cn) continue;
      if (cn === rn || cn.includes(rn) || rn.includes(cn)) { found = co; break; }
    }
    matched.add(found || r);
  }
  return [...matched];
}
