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
import { findCatalog, loadCatalog, findTrimInCatalog, loadIndex } from './vehicle-matrix.js';
import { titleToSubModel } from './catalog-source.js';

/* findCatalog 실패 시 fallback — maker + model_root + year 만으로 catalog 검색 */
async function fallbackFindByModelYear(maker, rawModel, year, fuelType) {
  if (!maker || !rawModel) return null;
  const idx = await loadIndex();
  if (!idx) return null;
  const modelN = String(rawModel).trim();
  const yr = Number(String(year || '').slice(0, 4));
  const fuel = String(fuelType || '').toLowerCase();
  const isHybrid = /하이브리드|hev|hybrid/.test(fuel);
  const isEV = /전기|ev|electric/.test(fuel);
  // maker + model_root 일치 catalog 후보
  let candidates = Object.values(idx).filter(c => c.maker === maker && c.model_root === modelN);
  if (!candidates.length) return null;
  // year 범위 필터
  if (yr) {
    const inRange = candidates.filter(c => {
      const ys = Number(String(c.year_start || '').slice(0, 4));
      const ye = c.year_end === '현재' ? 9999 : Number(String(c.year_end || '').slice(0, 4));
      if (!ys) return false;
      return yr >= ys && yr <= (ye || 9999);
    });
    if (inRange.length) candidates = inRange;
  }
  // 동력원 매칭: 하이브리드 / EV catalog 우선
  let fuelFiltered = candidates;
  if (isHybrid) {
    fuelFiltered = candidates.filter(c => /하이브리드|HEV/.test(c.title || ''));
  } else if (isEV) {
    fuelFiltered = candidates.filter(c => /EV|일렉트릭|일렉트리파이드/.test(c.title || ''));
  } else {
    // 가솔린/디젤 — 하이브리드/EV catalog 제외
    fuelFiltered = candidates.filter(c => !/하이브리드|HEV|일렉트릭|일렉트리파이드|\bEV\b/.test(c.title || ''));
  }
  if (fuelFiltered.length) candidates = fuelFiltered;
  // 최신 출시 우선
  candidates.sort((a, b) => (b.year_start || '').localeCompare(a.year_start || ''));
  return { catalogId: candidates[0].id, confidence: 'low' };
}

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

/** 전용계좌 텍스트에서 회사명 부분 추출.
 *  "국민 274101-04-182593 우리캐피탈오토파크(주)" → "우리캐피탈오토파크(주)"
 *  "신한 131-021-922538 주식회사 콘카" → "주식회사 콘카"
 *  "농협 351-1234-5678-90 하나리스" → "하나리스"
 *  계좌번호 (숫자+하이픈, 6자 이상) 패턴 다음의 텍스트를 회사명으로. */
export function extractAccountCompany(account) {
  if (!account) return '';
  const s = String(account).trim();
  const m = s.match(/[\d\-]{6,}\s+(.+)$/);
  return m ? m[1].trim() : '';
}

/** 회사명 정규화 비교용 — 법인 표기 모든 변형 제거 + 공백 제거.
 *  처리 케이스:
 *    (주) ㈜ （주）   ← 정상 괄호
 *    주)             ← 한쪽 괄호 만 (시트에 흔함)
 *    주식회사 / 유한회사 등 단어형
 *  결과: 핵심 회사명만 + 공백 제거. */
export function normalizeCompanyName(name) {
  if (!name) return '';
  return String(name)
    .replace(/㈜/g, '')
    .replace(/[\(（]\s*주\s*[\)）]/g, '')                    // (주), （주）
    .replace(/(^|\s|[\d\-])주\s*[\)）]/g, (_, pre) => pre)   // 우측 괄호만 — "주)아이언" → "아이언"
    .replace(/[\(（]\s*주(\s|[가-힣])/g, (_, post) => post)  // 좌측 괄호만 — "(주아이언" → "아이언"
    .replace(/주식회사|유한책임회사|유한회사|합자회사|합명회사|재단법인|사단법인|학교법인|의료법인/g, '')
    .replace(/\s+/g, '')
    .trim();
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
  // 모델명 우선 매칭 — 시트 maker 잘못 입력된 경우 (예: G90을 현대로) 보정
  // 긴 모델명 우선 (예: '그랑 콜레오스' 가 '콜레오스' 보다 앞)
  const candidates = [modelRaw, subModelRaw].filter(Boolean).map(s => String(s).toLowerCase());
  const sortedModels = Object.keys(MODEL_TO_MAKER).sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    for (const model of sortedModels) {
      if (c.includes(model.toLowerCase())) return MODEL_TO_MAKER[model];
    }
  }
  // 모델 매칭 없으면 makerRaw 신뢰
  if (m && VALID_MAKERS.has(m)) return m;
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
    // 사용자 정책: "종합" 탭만 import (다른 공급사별 탭은 무시).
    // 종합 탭에 운영 매물이 모두 합산되어 있다고 가정.
    multiTab: false,
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
    partnerCode: 'RP023',   // 오플 시트 모든 매물 → provider_company_code = RP023 자동 적용

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
  // 전용계좌 컬럼에서 회사명 추출 — "은행명 계좌번호 회사명" 패턴
  //   예: "국민 274101-04-182593 우리캐피탈오토파크(주)" → "우리캐피탈오토파크(주)"
  out.account_company = extractAccountCompany(c(38));
  out.fuel_type = normalizeFuel(c(6) + ' ' + c(19));
  out.maker = inferMaker(c(23), c(4), c(5));

  // 시트 운영 메타 (26~37) — 매물 row 에 무손실 보존, 추후 정책 매핑/분석
  // (Z 차고지·AM 전용계좌·AN 비고 는 별도 필드, 그 외 12개 보존)
  out.sheet_meta = {
    driving_area:    c(26),   // AA 운행지역(범위)
    driving_route:   c(27),   // AB 운행
    installment:     c(28),   // AC 분납
    age_21:          c(29),   // AD 21세
    age_23:          c(30),   // AE 23세
    year_1plus:      c(31),   // AF 1년+
    insurance:       c(32),   // AG 보증
    property_damage: c(33),   // AH 대물
    injury:          c(34),   // AI 자손
    collision:       c(35),   // AJ 자차
    uninsured:       c(36),   // AK 무보험
    accident:        c(37),   // AL 사고
  };

  // 차종/세부모델/트림명에 maker prefix ("지프 체로키" / "기아 셀토스") 들어있으면 제거
  out.raw_model = stripMakerPrefix(c(4), out.maker);
  out.sub_model_raw = stripMakerPrefix(c(5), out.maker);
  out.trim_name = stripMakerPrefix(c(19), out.maker);
  // 트림 풀명 + 트림 짧은표기 + 배기량컬럼 에서 displacement 추출
  out.displacement = extractDisplacement(c(6) + ' ' + c(19)) || extractDisplacement(c(24));

  // 가격 매트릭스 — K(10)=단기보증 / O(14)=장기보증 (보증금)
  //   단기 1/6/12 보증금 = K, 장기 24/36/48/60 보증금 = O. 대여료는 별도 컬럼.
  const price = {};
  const shortDeposit = normalizePrice(c(10));
  const longDeposit = normalizePrice(c(14));
  // 6개월 (인덱스 12) 항목 제외 — 사용자 정책으로 단기는 1/12 만 운영
  const priceMap = { '1': 11, '12': 13, '24': 15, '36': 16, '48': 17, '60': 18 };
  const longPeriods = new Set(['24', '36', '48', '60']);
  for (const [period, idx] of Object.entries(priceMap)) {
    const rent = normalizePrice(c(idx));
    if (!rent) continue;
    const dep = longPeriods.has(period) ? longDeposit : shortDeposit;
    price[period] = dep ? { rent, deposit: dep } : { rent };
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

/** catalog 매칭 실패 시 raw 데이터로 채우는 fallback matched_product.
 *  catalog_id 비우고 sub_model/trim_name 등은 시트 그대로 — 추후 매물 편집에서 매핑 가능. */
function fallbackMatchedProduct(raw) {
  return {
    car_number: raw.car_number,
    maker: raw.maker,
    model: raw.raw_model || '',
    sub_model: raw.sub_model_raw || raw.raw_model || '',
    trim_name: raw.trim_name || raw.trim_keyword || '',
    catalog_id: '',
    fuel_type: raw.fuel_type || '',
    ext_color: raw.ext_color || '',
    int_color: raw.int_color || '',
    mileage: raw.mileage,
    year: raw.year,
    first_registration_date: raw.first_registration_date,
    vehicle_price: raw.vehicle_price,
    engine_cc: raw.engine_cc || '',
    location: raw.location || '',
    vehicle_status: raw.vehicle_status,
    product_type: (raw.kind && /신차/.test(raw.kind)) ? '신차렌트' : '중고렌트',
    options: raw.options || [],
    partner_memo: raw.partner_memo || '',
    price: raw.price,
    status_label_raw: raw.status_label,
    account_raw: raw.account || '',
    options_raw: raw.options_raw || '',
    sheet_meta: raw.sheet_meta || null,
  };
}

export async function enrichWithCatalog(raw) {
  // 차량번호 invalid (미정/빈) 도 catalog 매칭은 진행 — import 시점에 임시번호 자동 발급.
  // raw.is_pending_plate 메타로 dev.js 에 알림.
  if (!isValidCarNumber(raw.car_number)) {
    raw.is_pending_plate = true;
  }
  if (!raw.maker) {
    return { ok: false, reason: 'maker 추론 실패', matched_product: fallbackMatchedProduct(raw) };
  }

  // catalog 매칭에 들어가는 "sub_model 후보"는 시트별로 다름:
  //   zonghap → F 컬럼 (sub_model_raw)
  //   autoplus → C 컬럼 (raw_model = sub_model_raw 와 같음)
  const subCandidate = raw.sub_model_raw || raw.raw_model || '';

  // 시트 fuel_type 비어있을 때 — sub_model / trim 텍스트에서 동력원 추출 보정
  let inferredFuel = raw.fuel_type || '';
  if (!inferredFuel) {
    const all = `${subCandidate} ${raw.trim_name || ''} ${raw.raw_model || ''}`;
    if (/하이브리드|hybrid|hev/i.test(all)) inferredFuel = '하이브리드';
    else if (/(전기|EV|일렉트릭|electric)\b/i.test(all)) inferredFuel = '전기';
    else if (/디젤|diesel|d\d\.\d/i.test(all)) inferredFuel = '디젤';
    else if (/LPG|LPi|LPI/i.test(all)) inferredFuel = 'LPG';
    else inferredFuel = '가솔린';   // default
  }
  raw.fuel_type = inferredFuel;   // import 시 product 필드에 정확 반영

  // 시트 trim 텍스트에서 인승/배기량 추출 (catalog 매칭 정확도 보강)
  const trimText = `${raw.trim_name || ''} ${subCandidate}`;
  if (!raw.seats) {
    const seatM = trimText.match(/(\d+)\s*인승/);
    if (seatM) raw.seats = parseInt(seatM[1], 10);
  }

  let cat = await findCatalog(raw.maker, subCandidate, raw.raw_model || raw.sub_model_raw, {
    fuel_type: inferredFuel,
    year: raw.year,
    first_registration_date: raw.first_registration_date,
  });
  // findCatalog 점수 매칭 실패 → maker + model_root + year fallback
  if (!cat?.catalogId) {
    cat = await fallbackFindByModelYear(raw.maker, raw.raw_model || subCandidate, raw.year, inferredFuel);
  }
  if (!cat?.catalogId) {
    return {
      ok: false,
      reason: `catalog 미매칭 (${raw.maker} / ${subCandidate}) — raw 그대로 import`,
      matched_product: fallbackMatchedProduct(raw),
    };
  }
  const catalog = await loadCatalog(cat.catalogId);
  if (!catalog) return {
    ok: false, reason: `catalog load 실패: ${cat.catalogId}`,
    matched_product: fallbackMatchedProduct(raw),
  };

  const standardSub = titleToSubModel(raw.maker, catalog.title || '');
  const standardModel = catalog.model_root || catalog.model || '';

  // 정책: 세부트림 / 선택옵션은 시트 입력값 그대로 import (catalog 표준화 X).
  //   사용자가 시트에 정확히 적은 형태 우선 — catalog 와 다른 트림 표기/옵션 보존.
  //   추후 매물 편집에서 catalog 트림 드롭다운 / 옵션 chip 으로 수동 매핑 가능.
  const standardTrim = raw.trim_name || raw.trim_keyword || '';
  const standardOptions = raw.options || [];

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
      product_type: (raw.kind && /신차/.test(raw.kind)) ? '신차렌트' : '중고렌트',
      options: standardOptions.length ? standardOptions : raw.options,
      partner_memo: raw.partner_memo || '',
      price: raw.price,
      status_label_raw: raw.status_label,
      account_raw: raw.account || '',
      options_raw: raw.options_raw,
      sheet_meta: raw.sheet_meta || null,
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
