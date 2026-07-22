/**
 * 외부 구글시트 → products 동기화 (다업체)
 * POST /api/sync/external-sheet  body: { source }
 *   source: 'autoplus' (오토플러스 RP023) | 'general' (종합시트, 행마다 partner_code) | 'songogong' (손오공렌터카 RP012)
 *
 * v1 freepasserp app.py 의 /api/sync/external-sheet 를 Node.js Vercel Serverless 로 포팅.
 *
 * 응답: { ok, synced, skipped, products: { [product_uid]: product }, source }
 *  Firebase write 는 클라이언트(dev.js)가 처리.
 */

import crypto from 'crypto';

const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY || 'AIzaSyBSPo1kZOefX-6NuHoQdUF1htqQDSxXsCs';

export const SHEET_CONFIGS = {
  autoplus: {
    sheet_id: '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U',
    tab_name: '판매차량리스트',           // 26-05-08 기준 새 탭 (구 '판매차량리스트(수수료 100)' 폐기)
    // 본 리스트 외 특가/프로모션 탭(전기차·스포티지·말리부 등)을 자동탐지 — 공급사가 탭 추가/개명해도
    //  안 깨짐. 공지/수정중/구버전/구독안내만 제외(AUTOPLUS_TAB_EXCLUDE). 같은 양식이라 autoplus 스키마로 파싱.
    //  본 리스트를 먼저, 특가 탭을 뒤에 두어 같은 차량번호면 특가 가격이 덮어씀.
    auto_tabs: true,
    provider_code: 'RP023',
    label: '오토플러스 (RP023)',
    schema: 'autoplus',
  },
  general: {
    sheet_id: '1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg',
    tab_name: null,                        // 렌트사 탭 자동탐지 (종합 탭 제외)
    label: '렌트사 탭 (배차상태 출고가능만)',
    schema: 'auto-supply',                 // 각 렌트사 탭 직접 읽기, 출고불가 자동 제외
  },
  supply: {
    /* 공급시트 자동탐지 — 위 종합시트의 모든 탭 중 헤더에
     * '공급코드' + '정책코드' 둘 다 있는 탭만 동기화 대상.
     * 사용자가 새 탭에 두 컬럼 추가 → 다음 sync 부터 자동 포함. */
    sheet_id: '1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg',
    tab_name: null,                       // 자동 탐지
    label: '공급시트 자동탐지 (공급/정책 컬럼 있는 탭)',
    schema: 'auto-supply',
  },
  songogong: {
    sheet_id: '1vBTcj1MpKt44Bzclvgjm23OXFEIY-1hp_g5Wu3bztsQ',
    tab_name: '판매차량리스트',
    provider_code: 'RP012',
    label: '손오공렌터카 (RP012)',
    schema: 'songogong',
  },
  aicar: {
    // 아이카 전용 시트 — "아이카종합" 탭이 기존 종합시트와 동일한 42컬럼 포맷 +
    // 행마다 공급사코드(RP004)·정책코드가 이미 채워져 있어 parseGeneralRow 그대로 재사용.
    sheet_id: '1AVW2uFy94qLPV4TU-MsgYMIDLrfC6KZhfxVjoFw7sH0',
    tab_name: '아이카종합',
    label: '아이카 (RP004)',
    schema: 'general',
  },

  /* 렌트사 개별 전용시트 — 전부 동일한 33컬럼 포맷(parseRentCoRow). 회사 추가될 때마다
   * sheet_id·provider_code·label 3줄만 추가하면 됨 (admin-ops.js 목록도 같이 추가). */
  pacific:  { sheet_id: '17ptJasUHfkTsTAPV7n09biOUxwON69ga_boY7Lj1YQI', tab_name: '시트1', provider_code: 'RP022', label: '퍼시픽 (RP022)', schema: 'rentco' },
  leaders:  { sheet_id: '1JzkGriOncxVC0CiQlL18uiHW-iyzvMNyJkJN4BPGoqI', tab_name: '시트1', provider_code: 'RP008', label: '리더스 (RP008)', schema: 'rentco' },
  star:     { sheet_id: '1IP7uES-NrxS58JK9UCtD3ppGZGeSL9STpT2jHJO5JIM', tab_name: '시트1', provider_code: 'RP018', label: '스타 (RP018)', schema: 'rentco' },
  rentzone: { sheet_id: '1IFV4_rNq4hW_KornQpz1ppBWbziCyklTo6oOH0BaUc8', tab_name: '시트1', provider_code: 'PT-0001', label: '렌트존 (PT-0001)', schema: 'rentco' },
  gyeongjinRent: { sheet_id: '1uxcBiaf9YUokWY6pA6cSQF5dWC_NhAbWzch6rFNPxks', tab_name: '시트1', provider_code: 'RP015', label: '경진렌트카 (RP015)', schema: 'rentco' },
  gyeongjinCar:  { sheet_id: '1zglJo10nM_oilYzLdk9XAe3SMVPkVf5fd8a3vF1yXHo', tab_name: '시트1', provider_code: 'RP016', label: '경진카 (RP016)', schema: 'rentco' },
  wooriCapital:  { sheet_id: '1V4dqn5e8dtTLjX_wnHx5wOup0arU3TAtsvEvuh0sisY', tab_name: '시트1', provider_code: 'RP020', label: '우리캐피탈렌터카 (RP020)', schema: 'rentco' },
  kh:       { sheet_id: '1BLoZxJ_5n0N9P4S4tkw6otj0trqGSDpe35jRT9DVs0k', tab_name: '시트1', provider_code: 'RP010', label: 'KH (RP010)', schema: 'rentco' },
  centro:   { sheet_id: '1iVCesNhymbW8SsvHU0MysRmsVHGb2PtXzA5c30xqm0I', tab_name: '시트1', provider_code: 'RP017', label: '센트로 (RP017)', schema: 'rentco' },
  billin:   { sheet_id: '1Iroh8oZFMqCgTQHwNXp0gOxa-SYOCOgqwcwPCgJzJaA', tab_name: '빌린카', provider_code: 'RP021', label: '빌린카 (RP021)', schema: 'rentco' },
  ian:      { sheet_id: '1fUC8sok_XKmpgDAvRRi6HEbeAkY-Rbvrt-th8j8G7Ms', tab_name: '시트1', provider_code: 'RP006', label: '아이언 (RP006)', schema: 'rentco' },
  wellix:   { sheet_id: '1hfXngq7GcXRF2u7OhmH39PqERQK34r6hq9dfSoI2Sy0', tab_name: '시트1', provider_code: 'RP013', label: '웰릭스 (RP013)', schema: 'rentco' },
  // SA렌터카(1C5rRLQOPyFM3UoVfIHN79fud099H6m-_QOtUnlFykvo) · J&J렌트카(1tVEVEZY-6e9y2Gz89eXnIRvsScFv7Y7sAiWw7hr_OFY)
  //  — 신규 파트너, 아직 공급사코드 미배정 (파트너 관리에서 등록 후 코드 확정되면 추가)
};

/* 오플 자동탐지 시 제외할 탭 — 공지/수정중/구버전(구 …)/구독안내. 나머지 보이는 탭은 모두 차량 리스트로 간주. */
const AUTOPLUS_TAB_EXCLUDE = /공지|수정중|구독|안내|^구\s/;

/* 공급사 탭마다 상태 컬럼 헤더가 다름(상태/배차상태/판매상태/즉시출고) — 우선순위대로 탐색. -1이면 없음. */
const STATUS_COL_NAMES = ['배차상태', '상태', '판매상태', '즉시출고'];
const findStatusIdx = (headers) => {
  for (const n of STATUS_COL_NAMES) { const i = headers.indexOf(n); if (i >= 0) return i; }
  return -1;
};

/* 종합시트 차고지 컬럼 회사명 → partner_code 매핑.
   '용인/우리캐피탈렌터카' 형태에서 마지막 토큰을 회사명으로 보고 매칭. */
const PARTNER_NAME_TO_CODE = {
  '아이카': 'RP004',
  '스타스카이': 'RP005', '스카이': 'RP005',
  '아이언렌트카': 'RP006', '아이언': 'RP006',
  '리더스렌터카': 'RP008', '리더스렌트카': 'RP008', '리더스': 'RP008',
  'KH': 'RP010',
  '연카': 'RP011',
  '손오공': 'RP012',
  '웰릭스모빌리티': 'RP013', '웰릭스': 'RP013',
  '스위치플랜': 'RP014', '스위치': 'RP014', '셀렉션': 'RP014', '제이피케이오토셀렉션': 'RP014',
  '경진렌트카': 'RP015',
  '경진카': 'RP016',
  '센트로': 'RP017',
  '에이스': 'RP019',
  '우리캐피탈렌터카': 'RP020',
  '빌린카': 'RP021', '엘씨': 'RP021',
  '퍼시픽': 'RP022',
  '오토플러스': 'RP023',
  '렌트존': 'PT-0001',
  '퍼스트': 'RP009',
  '스타': 'RP018',
};
const findPartnerCode = (carYard) => {
  if (!carYard) return '';
  const parts = String(carYard).split(/[\/／]/).map(s => s.trim()).filter(Boolean);
  for (const p of parts.reverse()) {
    if (PARTNER_NAME_TO_CODE[p]) return PARTNER_NAME_TO_CODE[p];
    // 부분 일치
    for (const [n, c] of Object.entries(PARTNER_NAME_TO_CODE)) {
      if (p.includes(n)) return c;
    }
  }
  return '';
};

const MAKER_MAP = {
  // 현대
  '그랜저': '현대', '쏘나타': '현대', '아반떼': '현대', '투싼': '현대', '싼타페': '현대',
  '팰리세이드': '현대', '코나': '현대', '베뉴': '현대', '캐스퍼': '현대', '스타리아': '현대',
  '아이오닉': '현대', '아이오닉5': '현대', '아이오닉6': '현대', '넥쏘': '현대', '포터': '현대',
  '엑센트': '현대', '벨로스터': '현대', 'i30': '현대', 'i40': '현대',
  // 기아
  'K9': '기아', 'K8': '기아', 'K7': '기아', 'K5': '기아', 'K3': '기아',
  '쏘렌토': '기아', '카니발': '기아', '스포티지': '기아', '셀토스': '기아', '니로': '기아',
  'EV6': '기아', 'EV9': '기아', '모하비': '기아', '레이': '기아', '봉고': '기아',
  '스팅어': '기아', '모닝': '기아',
  // 제네시스
  'G90': '제네시스', 'G80': '제네시스', 'G70': '제네시스',
  'GV90': '제네시스', 'GV80': '제네시스', 'GV70': '제네시스', 'GV60': '제네시스',
  // 쉐보레
  '말리부': '쉐보레', '트래버스': '쉐보레', '트랙스': '쉐보레', '이쿼녹스': '쉐보레',
  '콜로라도': '쉐보레', '볼트': '쉐보레', '타호': '쉐보레',
  // 르노
  'SM6': '르노', 'QM6': '르노', 'XM3': '르노', '아르카나': '르노', '마스터': '르노',
  // KG/쌍용
  '토레스': 'KG모빌리티', '렉스턴': 'KG모빌리티', '티볼리': 'KG모빌리티', '코란도': 'KG모빌리티',
  // 수입
  'BMW': 'BMW', '벤츠': 'Mercedes-Benz', '아우디': 'Audi', '볼보': 'Volvo',
  '렉서스': 'Lexus', '포르쉐': 'Porsche', '미니': 'MINI', '폭스바겐': 'Volkswagen',
  '테슬라': 'Tesla', '링컨': 'Lincoln', '재규어': 'Jaguar', '랜드로버': 'Land Rover',
  '마세라티': 'Maserati', '벤틀리': 'Bentley', '롤스로이스': 'Rolls-Royce',
  '페라리': 'Ferrari', '람보르기니': 'Lamborghini', '푸조': 'Peugeot',
};

const IMPORT_BRAND_KEYWORDS = ['bmw','benz','mercedes','벤츠','audi','아우디','volvo','볼보','lexus','렉서스',
  'porsche','포르쉐','jaguar','재규어','land rover','랜드로버','mini','미니','volkswagen','폭스바겐','peugeot',
  '푸조','maserati','마세라티','bentley','벤틀리','rolls','롤스','ferrari','페라리','lamborghini','람보르기니',
  'tesla','테슬라','lincoln','링컨'];

/* v3 양식 — vehicle_status 5종: 즉시출고/출고가능/상품화중/출고협의/출고불가
 * 룰 (사용자 정책):
 *  - '출고가능'으로 시작 (출고가능(정비중)·출고가능(대차중) 등 포함) → 출고가능 우선
 *  - 명확히 불가(계약/매각/완료/사고/미정/보류 등, 단 '출고가능'으로 시작 안 하는 것) → 출고불가
 *  - 정확히 5종이면 그대로 / '판매중'·'할인판매' → 출고가능
 *  - 비표준·빈값 → 출고협의 (불가 아님, 노출 유지) */
function normalizeVehicleStatus(raw) {
  const s = String(raw || '').trim();
  // 1) '출고가능'으로 시작 — 뒤에 조건 붙어도(정비중·대차중 등) 출고가능 우선
  if (/^출고가능/.test(s)) return '출고가능';
  // 2) 명확히 출고불가
  if (/출고불가|계약|매각|판매완료|완료|사고|대차|미정|보류|회수|반납|폐차/.test(s)) return '출고불가';
  // 3) 정확히 일치하는 나머지 종
  if (s === '즉시출고') return '즉시출고';
  if (s === '상품화중') return '상품화중';
  if (s === '출고협의') return '출고협의';
  if (/판매중|할인판매/.test(s)) return '출고가능';
  // 4) 그 외 비표준·빈값 → 협의
  return '출고협의';
}
function statusFlag(vehicleStatus) {
  return vehicleStatus === '출고가능' || vehicleStatus === '즉시출고' ? 'available' : 'unavailable';
}

/* ── 차종 표기 정규화 (시트 입력 흔들림 흡수) ──
 * 시트마다 같은 차를 다르게 적는 표기 차이를 sync 시점에 통일.
 *  목적: 같은 차가 모델명/세부모델 컬럼 흔들림 때문에 목록·필터에서 갈라지는 것 방지.
 * 룰 테이블 = [{ match(product), apply(product, ctx) }]. 차종 늘면 여기만 추가. */
const VEHICLE_NAMING_RULES = [
  {
    // 테슬라 모델 Y — '모델 Y'/'모델Y' 공백 흔들림 통일.
    //  신차는 전부 '모델 Y 주니퍼'(2025~ 페이스리프트)로. 구형 모델 Y(2021-2024)는
    //  중고로만 들어오므로 신차일 때만 주니퍼 강제. 중고는 주니퍼 표기 있을 때만 통일.
    match: ({ maker, model, sub_model }) =>
      /테슬라|tesla/i.test(maker || '') && /모델\s*y/i.test(`${model || ''} ${sub_model || ''}`),
    apply: (p, { isNew }) => {
      p.model = '모델 Y';
      if (isNew || /주니퍼/.test(p.sub_model || '')) p.sub_model = '모델 Y 주니퍼';
      else p.sub_model = String(p.sub_model || '').replace(/모델\s*y/i, '모델 Y');
    },
  },
];
function normalizeVehicleNaming(product, ctx = {}) {
  for (const r of VEHICLE_NAMING_RULES) {
    if (r.match(product)) r.apply(product, ctx);
  }
  return product;
}

const isImport = (name) => {
  const nl = String(name || '').toLowerCase();
  return IMPORT_BRAND_KEYWORDS.some(b => nl.includes(b));
};

/* 탭 이름 → A1 표기 range. 공백·괄호·쉼표·★ 등 특수문자 탭은 작은따옴표로 감싸야
 * Sheets API 가 'Unable to parse range' 없이 파싱함. 내부 작은따옴표는 '' 로 이스케이프.
 * (단일 호출 values/ranges 와 batchGet 모두 이 함수로 통일) */
const tabRange = (tabName) => `'${String(tabName).replace(/'/g, "''")}'`;

const safeGet = (row, idx) => (idx < 0 || idx >= row.length ? '' : String(row[idx] ?? '').trim());
const parsePrice = (v) => parseInt(String(v || '').replace(/[^\d]/g, '') || '0', 10);

async function fetchJson(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
  return resp.json();
}

/* chipRuns 추출 — 시트 셀의 스마트칩(drive 폴더 URL) */
async function loadChipRuns(sheetId, tabName) {
  const map = {};
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?ranges=${encodeURIComponent(tabRange(tabName))}&fields=sheets.data.rowData.values.chipRuns&key=${SHEETS_API_KEY}`;
    const data = await fetchJson(url);
    const chipRows = data.sheets?.[0]?.data?.[0]?.rowData || [];
    chipRows.forEach((rd, ri) => {
      for (const cell of (rd.values || [])) {
        for (const chip of (cell.chipRuns || [])) {
          const uri = chip?.chip?.richLinkProperties?.uri || '';
          if (uri && uri.includes('drive.google.com')) { map[ri] = uri.split('?')[0]; break; }
        }
        if (map[ri]) break;
      }
    });
  } catch (e) { console.warn('[external-sheet] chipRuns 실패:', e.message); }
  return map;
}

async function loadSheetValues(sheetId, tabName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabRange(tabName))}?key=${SHEETS_API_KEY}`;
  const data = await fetchJson(url);
  return data.values || [];
}

/* 숨긴 행 감지 — 시트에서 사용자가 숨긴(또는 필터로 가려진) 행 인덱스 Set.
 * 행 인덱스는 0-based (시트 1행 = 0) — values 배열의 absRow 와 정렬됨.
 * 숨긴 행의 차량은 '출고불가'로 처리 (운영자가 숨김 = 노출 안 함). */
async function loadHiddenRows(sheetId, tabName) {
  const hidden = new Set();
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?ranges=${encodeURIComponent(tabRange(tabName))}&fields=sheets.data.rowMetadata.hiddenByUser,sheets.data.rowMetadata.hiddenByFilter&key=${SHEETS_API_KEY}`;
    const data = await fetchJson(url);
    const rowMeta = data.sheets?.[0]?.data?.[0]?.rowMetadata || [];
    rowMeta.forEach((m, i) => { if (m && (m.hiddenByUser || m.hiddenByFilter)) hidden.add(i); });
  } catch (e) { console.warn('[external-sheet] hiddenRows 실패:', e.message); }
  return hidden;
}

/* 사진 호스트 — 서버 스크래핑/프록시가 처리 가능한 곳 (drive 폴더 / moderentcar / autoplus) */
const PHOTO_HOST_RE = /drive\.google\.com|moderentcar\.co\.kr|autoplus\.co\.kr/;
/* 셀에서 사진 링크 추출 — 차량번호 셀의 하이퍼링크(아이카=moderentcar) 또는 스마트칩(오플=drive 폴더).
 *  drive 는 ?query 제거, moderentcar 등은 query 유지(?v= 차량 식별자). 없으면 ''. */
function extractCellPhotoUrl(cell) {
  if (!cell) return '';
  const hl = cell.hyperlink || '';
  if (hl && PHOTO_HOST_RE.test(hl)) return hl.includes('drive.google.com') ? hl.split('?')[0] : hl;
  for (const chip of (cell.chipRuns || [])) {
    const uri = chip?.chip?.richLinkProperties?.uri || '';
    if (uri && PHOTO_HOST_RE.test(uri)) return uri.includes('drive.google.com') ? uri.split('?')[0] : uri;
  }
  return '';
}

/* 탭 그리드 로더 — 셀값(/values/) + 사진(칩/하이퍼링크)+숨김행(grid 1회) = 탭당 2호출.
 *  (구버전 3호출 → 2호출. grid 에서 formattedValue 를 빼야 rowData 가 전 행 반환됨 — API 특성)
 * 반환: { rows: string[][], photoLinkMap: {rowIdx:url}, hiddenRows: Set<rowIdx> } */
async function loadSheetGrid(sheetId, tabName) {
  // 1) 셀값 — /values/ 가 전 행을 신뢰성 있게 반환 (grid+formattedValue 는 1행으로 잘림)
  const rows = await loadSheetValues(sheetId, tabName);
  // 2) 사진(칩+하이퍼링크) + 숨김행 — spreadsheets.get 1회
  const photoLinkMap = {};
  const hiddenRows = new Set();
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`
      + `?ranges=${encodeURIComponent(tabRange(tabName))}`
      + `&fields=${encodeURIComponent('sheets.data.rowData.values(chipRuns,hyperlink),sheets.data.rowMetadata(hiddenByUser,hiddenByFilter)')}`
      + `&key=${SHEETS_API_KEY}`;
    const data = await fetchJson(url);
    const grid = data.sheets?.[0]?.data?.[0] || {};
    (grid.rowData || []).forEach((rd, ri) => {
      for (const cell of (rd.values || [])) {
        const u = extractCellPhotoUrl(cell);
        if (u) { photoLinkMap[ri] = u; break; }
      }
    });
    (grid.rowMetadata || []).forEach((m, i) => { if (m && (m.hiddenByUser || m.hiddenByFilter)) hiddenRows.add(i); });
  } catch (e) { console.warn('[external-sheet] grid meta 실패:', e.message); }
  return { rows, photoLinkMap, hiddenRows };
}

/* 한국 차량번호 검증 — 12가1234 / 서울12가3456 형식 */
const VALID_CAR_NO = /^(?:[가-힣]{2})?\d{2,3}\s?[가-힣]\s?\d{4}$/;

/* 오토플러스 시트 — 단일 공급사 (RP023) 행 → product.
 * 시트에 '정책코드' / '공급코드' 컬럼 있으면 우선 사용. 없으면 기본값(공급=RP023, 정책=빈값). */
/* modelFull 에서 modelShort 와 maker prefix 제거 → 트림 후보 추출.
 *  예: "기아 카니발 4세대 노블레스 9인승 디젤 2.2 DCT" - modelShort "카니발"
 *     → "4세대 노블레스 9인승 디젤 2.2 DCT" → 세대명 정리 → "노블레스 9인승 디젤 2.2 DCT" */
function extractTrimFromModel(modelFull, modelShort) {
  if (!modelFull) return '';
  let t = String(modelFull).trim();
  // maker prefix 제거 (한국 OEM)
  t = t.replace(/^(현대|기아|제네시스|KGM|쌍용)\s+/, '');
  // modelShort 토큰 제거 (예: "카니발")
  if (modelShort) {
    t = t.replace(new RegExp('\\b' + modelShort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), '');
  }
  // 세대명 / 페리 prefix 제거
  t = t.replace(/(\d세대|올 뉴|디 올 뉴|더 뉴|뉴)\b/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

function parseAutoplusRow({ row, headers, headerIdx, absRow, photoLinkMap, providerCode, sheetId, nowMs }) {
  const colIdx = (n) => headers.indexOf(n);
  const colPartial = (kw) => headers.findIndex(h => h.includes(kw));
  const idxCar = colIdx('차량번호');
  const carNumber = safeGet(row, idxCar);
  if (!carNumber || !VALID_CAR_NO.test(carNumber)) return null;

  // 시트 정책/공급 컬럼 (옵션)
  const idxPolicy   = colPartial('정책코드');
  const idxProvider = colPartial('공급코드');
  const sheetPolicy   = idxPolicy   >= 0 ? safeGet(row, idxPolicy)   : '';
  const sheetProvider = idxProvider >= 0 ? safeGet(row, idxProvider) : '';
  const finalProvider = sheetProvider || providerCode;

  let idxModelShort = headers.includes('차종') ? colIdx('차종') : colIdx('모델명');
  let idxModelFull = -1;
  for (let i = 0; i < headers.length; i++) {
    if (i !== idxModelShort && i > idxModelShort && (headers[i].includes('모델') || headers[i].includes('차명') || headers[i].includes('세부'))) {
      idxModelFull = i; break;
    }
  }
  if (idxModelFull < 0 && idxModelShort >= 0 && idxModelShort + 1 < headers.length) {
    const nextH = headers[idxModelShort + 1];
    if (nextH && !['색상', '연료', '주행거리(예상)'].includes(nextH)) idxModelFull = idxModelShort + 1;
  }
  const idxColor = colPartial('색상');
  const idxFuel = colPartial('연료');
  const idxMileage = colPartial('주행');
  const idxRegDate = colPartial('최초등록');
  const idxLocation = colPartial('현위치');
  const idxStatus = colPartial('판매상태');
  // 세부트림 / 선택옵션 — 시트 헤더 부분일치 (세부트림/트림 / 선택옵션/옵션)
  const idxTrim = headers.findIndex(h => h.includes('세부트림')) >= 0
    ? headers.findIndex(h => h.includes('세부트림'))
    : colPartial('트림');
  const idxOptions = headers.findIndex(h => h.includes('선택옵션')) >= 0
    ? headers.findIndex(h => h.includes('선택옵션'))
    : colPartial('옵션');
  const idxNotes = colPartial('비고');
  // 헤더에서 '{N}개월{Xkm}' 패턴 자동 탐지 — 12개월3만, 24개월2만, 18개월 등 모두 지원
  const PERIOD_KM_RE = /^(\d+)개월\s*([1-9]\d*만)?/;
  const priceColMap = [];
  headers.forEach((h, i) => {
    const hl = h.replace(/\s/g, '');
    const m = PERIOD_KM_RE.exec(hl);
    if (m) priceColMap.push({ period: m[1], km: m[2] || '', idx: i });
  });
  // 폴백: 헤더에 개월 패턴 없으면 12개월 고정 컬럼 탐색
  if (!priceColMap.length) {
    const fallback = headers.findIndex(h => h.replace(/\s/g, '').includes('12개월'));
    if (fallback >= 0) priceColMap.push({ period: '12', km: '', idx: fallback });
  }

  const statusRaw = safeGet(row, idxStatus);
  const vehicleStatus = normalizeVehicleStatus(statusRaw);
  const status = statusFlag(vehicleStatus);

  const modelShort = safeGet(row, idxModelShort);
  const modelFull = idxModelFull >= 0 ? safeGet(row, idxModelFull) : '';
  const imp = isImport(modelFull) || isImport(modelShort);
  const depMult = imp ? 3 : 2;
  const uidSeed = `${finalProvider}_${carNumber}`;
  const productUid = `EXT_${crypto.createHash('md5').update(uidSeed).digest('hex').slice(0, 12)}`;
  const mileage = parseInt(String(safeGet(row, idxMileage)).replace(/[^\d]/g, '') || '0', 10);
  const regDate = safeGet(row, idxRegDate);
  let yearModel = '';
  if (regDate) {
    const m = /^(\d{4})/.exec(regDate);
    if (m) yearModel = `${String(m[1]).slice(2)}년식`;
  }
  const product = {
    _key: productUid,
    product_uid: productUid,
    product_code: `${finalProvider}_${carNumber}`,
    provider_company_code: finalProvider,
    partner_code: finalProvider,
    policy_code: sheetPolicy || '',
    car_number: carNumber,
    raw_model_short: modelShort,
    raw_model_full: modelFull,
    maker: '', sub_model: '',
    // 트림 컬럼 있으면 그것 / 없으면 차종명에서 자동 추출 (modelShort 제거 후 나머지)
    trim_name: idxTrim >= 0 ? safeGet(row, idxTrim) : extractTrimFromModel(modelFull, modelShort),
    ext_color: safeGet(row, idxColor),
    fuel_type: safeGet(row, idxFuel),
    mileage, year: yearModel,
    first_registration_date: regDate,
    location: safeGet(row, idxLocation),
    status, vehicle_status: vehicleStatus,
    product_type: '중고구독',
    status_label: statusRaw,
    is_active: true,
    options: idxOptions >= 0 ? safeGet(row, idxOptions) : '',
    partner_memo: idxNotes >= 0 ? safeGet(row, idxNotes) : '',
    photo_link: photoLinkMap[absRow] || '',
    source: 'external_sheet',
    source_sheet_id: sheetId,
    source_schema: 'autoplus',
    price: {},
    created_at: nowMs, updated_at: nowMs,
    created_by: 'sync_external_sheet',
  };
  for (const { period, km, idx } of priceColMap) {
    const rent = parsePrice(safeGet(row, idx));
    if (!rent) continue;
    const key = km ? `${period}_${km}` : period;
    product.price[key] = { rent, deposit: rent * depMult };
  }
  return product;
}

/* 렌트사 개별 전용시트 (퍼시픽·리더스·스타·렌트존·경진렌트카·경진카·우리캐피탈렌터카·KH·센트로·빌린카·아이언 등) —
 *  전부 동일한 33컬럼 포맷(배차상태·차량번호·차종·모델명(트림)·...·전용계좌·비고) 하나를 공용으로 파싱.
 *  공급사코드 컬럼이 없어 config.provider_code 로 고정. maker/sub_model 은 비워두고
 *  admin-ops.js 클라이언트 쪽 catalog 매칭 파이프라인(raw_model_short/full 기반)에 위임(autoplus 와 동일). */
function parseRentCoRow({ row, headers, absRow, photoLinkMap, providerCode, sheetId, nowMs }) {
  const colIdx = (n) => headers.indexOf(n);
  const idxCar = colIdx('차량번호');
  const carNumber = safeGet(row, idxCar);
  if (!carNumber || !VALID_CAR_NO.test(carNumber)) return null;

  const statusRaw = safeGet(row, colIdx('배차상태'));
  const vehicleStatus = normalizeVehicleStatus(statusRaw);
  const status = statusFlag(vehicleStatus);
  const kindVal = safeGet(row, colIdx('구분'));

  const modelShort = safeGet(row, colIdx('차종'));
  const trimFull = safeGet(row, colIdx('모델명(트림)'));
  const regDate = safeGet(row, colIdx('최초등록일'));
  let year = '';
  if (regDate) {
    const m = /^(\d{2,4})/.exec(regDate);
    if (m) year = m[1].length === 4 ? `${m[1].slice(2)}년식` : `${m[1]}년식`;
  }

  const uidSeed = `${providerCode}_${carNumber}`;
  const productUid = `EXT_${crypto.createHash('md5').update(uidSeed).digest('hex').slice(0, 12)}`;

  const product = {
    _key: productUid,
    product_uid: productUid,
    product_code: `${providerCode}_${carNumber}`,
    provider_company_code: providerCode,
    partner_code: providerCode,
    policy_code: '',
    car_number: carNumber,
    raw_model_short: modelShort,
    raw_model_full: trimFull,
    maker: '', sub_model: '',
    trim_name: extractTrimFromModel(trimFull, modelShort),
    ext_color: safeGet(row, colIdx('외장색')),
    int_color: safeGet(row, colIdx('내장색')),
    fuel_type: safeGet(row, colIdx('유종')),
    mileage: parseInt(String(safeGet(row, colIdx('주행거리'))).replace(/[^\d]/g, '') || '0', 10),
    year, first_registration_date: regDate,
    location: '',
    vehicle_price: parsePrice(safeGet(row, colIdx('소비자가격'))) || 0,
    status, vehicle_status: vehicleStatus,
    product_type: resolveProductType({ pendingPlate: false, carNumber, kindVal, defaultProductType: '' }),
    status_label: statusRaw,
    is_active: true,
    options: safeGet(row, colIdx('옵션')),
    partner_memo: safeGet(row, colIdx('비고')),
    photo_link: photoLinkMap[absRow] || '',
    source: 'external_sheet',
    source_sheet_id: sheetId,
    source_schema: 'rentco',
    price: {},
    created_at: nowMs, updated_at: nowMs,
    created_by: 'sync_external_sheet',
  };

  // 보증금 — 단기보증(1/6/12개월 공통) / 장기보증(24/36/48/60개월 공통), 시트 원본값 그대로.
  const shortDep = parsePrice(safeGet(row, colIdx('단기보증')));
  const longDep = parsePrice(safeGet(row, colIdx('장기보증')));
  const rentCols = { '1': '1개월', '6': '6개월', '12': '12개월', '24': '24개월', '36': '36개월', '48': '48개월', '60': '60개월' };
  for (const [m, col] of Object.entries(rentCols)) {
    const r = parsePrice(safeGet(row, colIdx(col)));
    if (!r || r < 100000) continue;
    const dep = (Number(m) >= 24 ? longDep : shortDep) || 0;
    product.price[m] = dep ? { rent: r, deposit: dep } : { rent: r };
  }

  return product;
}

/* 손오공렌터카 — 단일 공급사 (RP012). 시트가 같은 차량에 인수형/반납형 두 가격 세트를 가짐
 *  → 매물 1개로 합쳐 등록 (rent/deposit=인수형, rent_return/deposit_return=반납형).
 * "구분" 컬럼이 "재구독"인 행은 보증금 컬럼이 비어있고, 시트 안내문 그대로
 *  "개월수 × 대여료" 로 산출. 그 외("재렌트" 등)는 보증금 컬럼에 이미 값이 있어 그대로(전 기간 공통) 사용.
 * 헤더에 "보증금"/"12개월".."60개월" 이 인수형·반납형 두 번씩 나오므로 위치 기반(첫/두번째 occurrence)으로 구분. */
function parseSongogongRow({ row, headers, absRow, photoLinkMap, providerCode, sheetId, nowMs }) {
  const colIdx = (n) => headers.indexOf(n);
  const idxCar = colIdx('차량번호');
  const carNumber = safeGet(row, idxCar);
  if (!carNumber || !VALID_CAR_NO.test(carNumber)) return null;

  const idxKind = colIdx('구분');
  const kindVal = safeGet(row, idxKind);
  const idxStatus = colIdx('배차상태');
  const statusRaw = safeGet(row, idxStatus);
  const vehicleStatus = normalizeVehicleStatus(statusRaw);
  const status = statusFlag(vehicleStatus);

  const modelShort = safeGet(row, colIdx('차종'));
  const trimFull = safeGet(row, colIdx('트림'));
  const regDate = safeGet(row, colIdx('최초등록일'));
  let year = '';
  if (regDate) {
    const m = /^(\d{2,4})/.exec(regDate);
    if (m) year = m[1].length === 4 ? `${m[1].slice(2)}년식` : `${m[1]}년식`;
  }
  const idxCond = colIdx('판매상태');   // 정상/정비중 — 상태(배차상태)와 별개
  const condVal = safeGet(row, idxCond);

  const uidSeed = `${providerCode}_${carNumber}`;
  const productUid = `EXT_${crypto.createHash('md5').update(uidSeed).digest('hex').slice(0, 12)}`;

  const product = {
    _key: productUid,
    product_uid: productUid,
    product_code: `${providerCode}_${carNumber}`,
    provider_company_code: providerCode,
    partner_code: providerCode,
    policy_code: '',
    car_number: carNumber,
    raw_model_short: modelShort,
    raw_model_full: trimFull,
    maker: '', sub_model: '',
    trim_name: extractTrimFromModel(trimFull, modelShort),
    ext_color: safeGet(row, colIdx('외부색상')),
    int_color: (() => { const v = safeGet(row, colIdx('내부색상')); return v === '-' ? '' : v; })(),
    fuel_type: safeGet(row, colIdx('연료')),
    mileage: parseInt(String(safeGet(row, colIdx('KM'))).replace(/[^\d]/g, '') || '0', 10),
    year, first_registration_date: regDate,
    location: '',   // 손오공 시트엔 현위치 컬럼 없음 — Firebase update 가 undefined 를 거부하므로 빈값 명시
    status, vehicle_status: vehicleStatus,
    product_type: '중고구독',
    status_label: statusRaw,
    is_active: true,
    options: safeGet(row, colIdx('옵션')),
    partner_memo: condVal && condVal !== '정상' ? `판매상태:${condVal}` : '',
    photo_link: photoLinkMap[absRow] || '',
    source: 'external_sheet',
    source_sheet_id: sheetId,
    source_schema: 'songogong',
    price: {},
    created_at: nowMs, updated_at: nowMs,
    created_by: 'sync_external_sheet',
  };

  // 가격 — "보증금"/"12개월".."60개월" 헤더가 인수형(1번째)·반납형(2번째) 두 블록으로 반복됨.
  const depIdxOwn = headers.indexOf('보증금');
  const depIdxReturn = headers.lastIndexOf('보증금');
  const isResubscribe = /재구독/.test(kindVal);
  const depositFlatOwn = depIdxOwn >= 0 ? parsePrice(safeGet(row, depIdxOwn)) : 0;
  const depositFlatReturn = (depIdxReturn >= 0 && depIdxReturn !== depIdxOwn) ? parsePrice(safeGet(row, depIdxReturn)) : 0;
  const periods = ['12', '24', '36', '48', '60'];
  periods.forEach((period, i) => {
    const m = Number(period);
    const rentOwn = depIdxOwn >= 0 ? parsePrice(safeGet(row, depIdxOwn + 1 + i)) : 0;
    const rentReturn = depIdxReturn >= 0 ? parsePrice(safeGet(row, depIdxReturn + 1 + i)) : 0;
    if (!rentOwn && !rentReturn) return;
    const entry = {};
    if (rentOwn) {
      entry.rent = rentOwn;
      const dep = isResubscribe ? Math.round(rentOwn * (m / 12)) : depositFlatOwn;
      if (dep) entry.deposit = dep;
    }
    if (rentReturn) {
      entry.rent_return = rentReturn;
      const depR = isResubscribe ? Math.round(rentReturn * (m / 12)) : depositFlatReturn;
      if (depR) entry.deposit_return = depR;
    }
    product.price[period] = entry;
  });

  return product;
}

/* 신차/재렌트/재구독 판별:
 * 1) pendingPlate 또는 100신XXXX → 항상 신차렌트
 * 2) 구분 컬럼에 '신차'|'신규' 포함 → 신차렌트
 * 3) 구분 컬럼에 '구독' 포함 → 중고구독 (재구독/구독상품/구독 J·R/제휴구독/LC구독(재구독) 등 —
 *    "구독"이 아닌 "재렌트"만 걸러야 하므로 아래 중고 체크보다 먼저 검사)
 * 4) 구분 컬럼에 '중고'|'재렌트' 포함 → 중고렌트
 * 5) 구분 비어있음 → null (admin-ops가 기존 DB값 보존)
 * 6) defaultProductType 폴백
 * (전체 공급사 탭 실사 결과 — 신규/구독/구독상품/구독 J/구독 R/제휴구독/LC구독(재구독) 이
 *  전부 기본값 '중고렌트'로 잘못 떨어지고 있었음 — 2026-07-22) */
function resolveProductType({ pendingPlate, carNumber, kindVal, defaultProductType }) {
  if (pendingPlate || /^100신\d{4}$/.test(carNumber)) return '신차렌트';
  if (kindVal && /신차|신규/.test(kindVal)) return '신차렌트';
  if (kindVal && /구독/.test(kindVal)) return '중고구독';
  if (kindVal && /중고|재렌트/.test(kindVal)) return '중고렌트';
  if (!kindVal) return null;
  return defaultProductType || '중고렌트';
}

/* 종합시트 — 다업체. 우선순위: 공급코드 컬럼 > 차고지 추출.
 * 정책코드 컬럼 있으면 product.policy_code 로 적용. */
function parseGeneralRow({ row, headers, absRow, photoLinkMap, sheetId, nowMs, tabPartnerCode = '', defaultProductType = '' }) {
  const colIdx = (n) => headers.indexOf(n);
  const colPartial = (kw) => headers.findIndex(h => h.includes(kw));
  const idxCar = colIdx('차량번호');
  let carNumber = safeGet(row, idxCar);
  // 번호 없는 신차(미정/번호미정/빈칸) — 차종분류·세부모델 있는 실제 차량이면 버리지 말고 100신XXXX 임시번호 부여.
  //  행 위치(absRow) 기반 → 시트 순서 유지되면 재동기화 시 같은 uid (멱등). 사용자: "번호없는 차는 신차".
  let pendingPlate = false;
  if (!carNumber || !VALID_CAR_NO.test(carNumber)) {
    const cls = safeGet(row, colIdx('차종분류'));
    const sub = safeGet(row, colIdx('세부모델'));
    if (!cls && !sub) return null;
    carNumber = `100신${String(absRow).padStart(4, '0')}`;
    pendingPlate = true;
  }

  const idxStatus = findStatusIdx(headers);   // 배차상태/상태/판매상태/즉시출고 별칭 — 탭마다 헤더 다름
  const statusRaw = safeGet(row, idxStatus);
  const vehicleStatus = normalizeVehicleStatus(statusRaw);
  const status = statusFlag(vehicleStatus);
  const idxPhysical = headers.indexOf('차량상태');
  const physicalStatus = idxPhysical >= 0 ? safeGet(row, idxPhysical) : '';

  // 공급코드 명시 컬럼 우선, 없으면 차고지에서 회사명 추출
  const idxProvider = colIdx('공급사코드');
  const idxPolicy   = colIdx('정책코드');
  const sheetProvider = idxProvider >= 0 ? safeGet(row, idxProvider) : '';
  const sheetPolicy   = idxPolicy   >= 0 ? safeGet(row, idxPolicy)   : '';

  const idxYard = colIdx('차고지');
  const yard = safeGet(row, idxYard);
  // 공급사 식별: 공급코드 컬럼 > 차고지 추출 > 탭 이름(자동탐지 시 탭=공급사)
  const partnerCode = sheetProvider || findPartnerCode(yard) || tabPartnerCode;
  if (!partnerCode) return null;

  const product = {
    car_number: carNumber,
    maker:        safeGet(row, colIdx('제조사')),
    model:        safeGet(row, colIdx('차종분류')),
    sub_model:    safeGet(row, colIdx('세부모델')),
    trim_name:    safeGet(row, colIdx('트림')),
    fuel_type:    safeGet(row, colIdx('연료')),
    ext_color:    safeGet(row, colIdx('외장')),
    int_color:    safeGet(row, colIdx('내장')),
    mileage:      parseInt(String(safeGet(row, colIdx('Km'))).replace(/[^\d]/g, '') || '0', 10),
    options:      safeGet(row, colIdx('옵션')),
    first_registration_date: safeGet(row, colIdx('최초등록')),
    vehicle_price: parsePrice(safeGet(row, colIdx('소비자가격'))),
    engine_cc:    parsePrice(safeGet(row, colIdx('배기량'))),
    location:     yard,
    address:      safeGet(row, colIdx('주소')),
    partner_memo: safeGet(row, colIdx('비고')),
    product_type: resolveProductType({ pendingPlate, carNumber, kindVal: safeGet(row, colIdx('구분') >= 0 ? colIdx('구분') : colPartial('구분')), defaultProductType }),
    arrival_note:  safeGet(row, colIdx('입고일자')),
    deposit_free:  /무보증/.test(safeGet(row, colIdx('입고일자'))),
    is_pending_plate: pendingPlate,     // 번호 미정 신차 — 실번호 받으면 수기로 덮어씀
    status,
    vehicle_status: vehicleStatus,
    status_label: statusRaw,
    physical_status: physicalStatus || '',
    is_active: true,
    photo_link: photoLinkMap[absRow] || '',
    source: 'external_sheet',
    source_sheet_id: sheetId,
    source_schema: 'general',
    provider_company_code: partnerCode,
    partner_code: partnerCode,
    policy_code: sheetPolicy || '',     // 시트 정책코드 명시 시 사용
    created_at: nowMs, updated_at: nowMs,
    created_by: 'sync_external_sheet',
  };

  // year — '26-04-14' 또는 '2026-04-14' 형태 → 'YY년식'
  const m = /^(\d{2,4})/.exec(product.first_registration_date);
  if (m) product.year = m[1].length === 4 ? `${m[1].slice(2)}년식` : `${m[1]}년식`;

  // 가격 — 단기보증/장기보증 + 1/6/12/24/36/48/60개월 임대료
  const shortDep = parsePrice(safeGet(row, colIdx('단기보증')));
  const longDep  = parsePrice(safeGet(row, colIdx('장기보증')));
  const rentCols = { '1': '1개월', '6': '6개월', '12': '12개월', '24': '24개월', '36': '36개월', '48': '48개월', '60': '60개월' };
  product.price = {};
  for (const [m, col] of Object.entries(rentCols)) {
    const r = parsePrice(safeGet(row, colIdx(col)));
    if (r < 100000) continue;   // 비현실적 저가(노트/조건문에서 추출된 숫자 등) 스킵 — 월 대여료는 10만원 이상
    const dep = (Number(m) >= 24 ? longDep : shortDep) || 0;
    product.price[m] = { rent: r, deposit: dep };
  }
  // ── 대여료 이상치 방어 (엑셀 오입력 당겨올 때) ──
  //  ① 상한: 월 대여료 2천만원 초과 = 비현실적(자릿수 오타 등) → 제거
  //  ② 역전: 짧은 기간이 더 긴 기간보다 쌈(단기<장기는 불가능) → 짧은 쪽이 잘못된 값 → 제거
  for (const k of Object.keys(product.price)) {
    if (product.price[k].rent > 20000000) { console.warn(`[sync] ${carNumber} ${k}개월 대여료 ${product.price[k].rent} 상한초과 제거`); delete product.price[k]; }
  }
  const _terms = Object.keys(product.price).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < _terms.length; i++) {
    const k = String(_terms[i]);
    const r = product.price[k]?.rent;
    if (r == null) continue;
    const inverted = _terms.slice(i + 1).some(m2 => (product.price[String(m2)]?.rent || 0) > r * 1.05);
    if (inverted) { console.warn(`[sync] ${carNumber} ${k}개월 대여료 ${r} 역전(장기보다 쌈) 제거`); delete product.price[k]; }
  }

  // 보증금 조건 탐색 — 어느 셀이든 "공동임차인/소득증빙...보증금 XXX만원" 패턴 있으면 캡처
  const DEP_COND_RE = /공동임차인|소득증빙조건/;
  const DEP_AMT_RE = /보증금\s*(\d+(?:\.\d+)?)\s*만원/;
  for (const cell of row) {
    const v = String(cell ?? '').trim();
    if (DEP_COND_RE.test(v)) {
      product.deposit_condition = v.replace(/^\(|\)$/g, '').trim();
      const m = DEP_AMT_RE.exec(v);
      if (m) product.deposit_condition_amount = Math.round(parseFloat(m[1]) * 10000);
      break;
    }
  }

  // 차종 표기 정규화 — 같은 차 모델명/세부모델 흔들림 통일 (예: 테슬라 모델 Y 신차 → 모델 Y 주니퍼)
  normalizeVehicleNaming(product, { isNew: product.product_type === '신차렌트' });

  // uid — partner_code + 차량번호 기반 (멱등)
  const uidSeed = `${partnerCode}_${carNumber}`;
  product._key = `EXT_${crypto.createHash('md5').update(uidSeed).digest('hex').slice(0, 12)}`;
  product.product_uid = product._key;
  product.product_code = `${partnerCode}_${carNumber}`;

  return product;
}

/* 시트 1종(source) 을 가져와서 products 객체 + 메타 반환.
 * Firebase write 없음. /api/sync/auto 에서도 재사용.
 * 반환: { ok, synced, skipped, products, source, sheet_id, tab_name, schema, tabs_scanned? } */
export async function syncFromSheet(source) {
  const config = SHEET_CONFIGS[source];
  if (!config) {
    return { ok: false, status: 400, message: `미지원 source: ${source}` };
  }
  if (!config.sheet_id) {
    return { ok: false, status: 501, message: `${config.label} URL 미설정` };
  }

  const products = {};
  const nowMs = Date.now();
  let synced = 0, skipped = 0;
  const tabsScanned = [];
  if (config.schema === 'auto-supply') {
    // 공급사 탭 전수 취합 — 탭 이름 = 공급사. 종합/시스템 탭만 제외.
    //  할당량 보호: 탭별 호출(×N) 대신 batchGet(값) + grid(사진칩·숨김) 각 1회로.

    // 1) 탭 목록 (1 call) — 숨긴 탭(거래 안 하는 공급사) 제외
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheet_id}?fields=sheets.properties(title,hidden)&key=${SHEETS_API_KEY}`;
    const meta = await fetchJson(metaUrl);
    const tabNames = (meta.sheets || [])
      .filter(s => s.properties && !s.properties.hidden)   // 숨긴 탭 = 비거래 공급사 → 제외
      .map(s => s.properties.title)
      .filter(t => t && t !== '종합' && !/^(공지|안내)$|^★/.test(t));   // 종합(취합 대상)·시스템 탭 제외
    if (!tabNames.length) {
      return { ok: true, synced: 0, skipped: 0, products: {}, source, sheet_id: config.sheet_id, tab_name: null, schema: config.schema, tabs_scanned: [], message: '공급사 탭이 없습니다' };
    }

    // 2) 모든 탭 값 한 번에 (batchGet, 1 call)
    const ranges = tabNames.map(t => `${tabRange(t)}!A1:BZ2000`);
    const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheet_id}/values:batchGet?${ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&')}&valueRenderOption=FORMATTED_VALUE&key=${SHEETS_API_KEY}`;
    const batch = await fetchJson(batchUrl);
    const valuesByTab = {};
    (batch.valueRanges || []).forEach((vr, i) => { valuesByTab[tabNames[i]] = vr.values || []; });

    // 3) 사진칩 + 숨김행 한 번에 (grid, 1 call) — 실패해도 무시
    const photoByTab = {}, hiddenByTab = {};
    try {
      const gRanges = tabNames.map(t => `ranges=${encodeURIComponent(tabRange(t))}`).join('&');
      const gUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheet_id}?${gRanges}&fields=${encodeURIComponent('sheets.properties.title,sheets.data.rowData.values(chipRuns,hyperlink),sheets.data.rowMetadata(hiddenByUser,hiddenByFilter)')}&key=${SHEETS_API_KEY}`;
      const g = await fetchJson(gUrl);
      for (const sh of (g.sheets || [])) {
        const title = sh.properties?.title;
        if (!title) continue;
        const grid = sh.data?.[0] || {};
        const pm = {};
        (grid.rowData || []).forEach((rd, ri) => {
          for (const cell of (rd.values || [])) {
            const u = extractCellPhotoUrl(cell);
            if (u) { pm[ri] = u; break; }
          }
        });
        const hs = new Set();
        (grid.rowMetadata || []).forEach((m, i) => { if (m && (m.hiddenByUser || m.hiddenByFilter)) hs.add(i); });
        photoByTab[title] = pm; hiddenByTab[title] = hs;
      }
    } catch (e) { console.warn('[external-sheet] supply grid meta 실패:', e.message); }

    // 4) 탭별 파싱 — 탭 이름으로 공급사 추정 (행에 공급코드/차고지 없으면 fallback)
    for (const tab of tabNames) {
      const rows = valuesByTab[tab] || [];
      let headerIdx = -1, headers = [];
      for (let i = 0; i < rows.length; i++) {
        const rowStr = rows[i].map(c => String(c ?? '').trim());
        if (rowStr.includes('차량번호')) { headerIdx = i; headers = rowStr; break; }
      }
      if (headerIdx < 0) { tabsScanned.push({ tab, synced: 0, skipped: 0, note: '차량번호 헤더 없음' }); continue; }
      // 공급사 코드 — 매핑 테이블에 있으면 RP코드, 없으면 탭 이름 그대로 (활성 탭은 안 빠지게)
      const tabPartnerCode = findPartnerCode(tab) || tab;
      const photoLinkMap = photoByTab[tab] || {};
      const hiddenRows = hiddenByTab[tab] || new Set();
      let tabSynced = 0, tabSkipped = 0;
      for (let off = 0; off + headerIdx + 1 < rows.length; off++) {
        const absRow = headerIdx + 1 + off;
        const row = rows[absRow] || [];
        const p = parseGeneralRow({ row, headers, absRow, photoLinkMap, sheetId: config.sheet_id, nowMs, tabPartnerCode, defaultProductType: config.default_product_type || '' });
        if (!p) { tabSkipped++; continue; }
        if (hiddenRows.has(absRow)) { p.vehicle_status = '출고불가'; p.status = 'unavailable'; p.status_label = '시트 숨김'; }
        if (p.vehicle_status !== '출고가능' && p.vehicle_status !== '즉시출고') { tabSkipped++; continue; }   // 출고가능/즉시출고만 import
        products[p._key] = p;
        tabSynced++;
      }
      synced += tabSynced;
      skipped += tabSkipped;
      tabsScanned.push({ tab, partner_code: tabPartnerCode || '(행별)', synced: tabSynced, skipped: tabSkipped });
    }

    return {
      ok: true, synced, skipped, products,
      source, sheet_id: config.sheet_id, tab_name: null, schema: config.schema,
      tabs_scanned: tabsScanned,
    };
  }

  // ── 단일/멀티 탭 동기화 (autoplus / general) ── 본 탭 + 특가 탭. 탭당 1회 호출.
  //  뒤 탭(특가)이 같은 차량번호(uid)면 앞 탭을 덮어씀 → 특가 가격 우선.
  let tabList;
  if (config.auto_tabs) {
    // 오플 — 보이는 탭 자동탐지. 본 리스트 먼저, 특가 탭 뒤. 공지/수정중/구버전/구독안내 제외.
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheet_id}?fields=sheets.properties(title,hidden)&key=${SHEETS_API_KEY}`;
    const meta = await fetchJson(metaUrl);
    const visible = (meta.sheets || [])
      .filter(s => s.properties && !s.properties.hidden)
      .map(s => s.properties.title)
      .filter(Boolean);
    const extra = visible.filter(t => t !== config.tab_name && !AUTOPLUS_TAB_EXCLUDE.test(t));
    tabList = [config.tab_name, ...extra];
  } else {
    tabList = [config.tab_name, ...(config.extra_tabs || [])];
  }
  let anyRows = false;
  for (const tabName of tabList) {
    const { rows, photoLinkMap, hiddenRows } = await loadSheetGrid(config.sheet_id, tabName);
    if (!rows.length) continue;
    let headerIdx = -1, headers = [];
    for (let i = 0; i < rows.length; i++) {
      const rowStr = rows[i].map(c => String(c ?? '').trim());
      if (rowStr.includes('차량번호')) { headerIdx = i; headers = rowStr; break; }
    }
    if (headerIdx < 0) continue;
    anyRows = true;
    for (let off = 0; off + headerIdx + 1 < rows.length; off++) {
      const absRow = headerIdx + 1 + off;
      const row = rows[absRow] || [];
      let p = null;
      if (config.schema === 'autoplus') {
        p = parseAutoplusRow({ row, headers, headerIdx, absRow, photoLinkMap, providerCode: config.provider_code, sheetId: config.sheet_id, nowMs });
      } else if (config.schema === 'general') {
        p = parseGeneralRow({ row, headers, absRow, photoLinkMap, sheetId: config.sheet_id, nowMs });
      } else if (config.schema === 'songogong') {
        p = parseSongogongRow({ row, headers, absRow, photoLinkMap, providerCode: config.provider_code, sheetId: config.sheet_id, nowMs });
      } else if (config.schema === 'rentco') {
        p = parseRentCoRow({ row, headers, absRow, photoLinkMap, providerCode: config.provider_code, sheetId: config.sheet_id, nowMs });
      }
      if (!p) { skipped++; continue; }
      if (hiddenRows.has(absRow)) { p.vehicle_status = '출고불가'; p.status = 'unavailable'; p.status_label = '시트 숨김'; }
      if (p.vehicle_status === '출고불가') { skipped++; continue; }   // 출고가능만 import
      products[p._key] = p;
      synced++;
    }
  }
  if (!anyRows) {
    return { ok: false, status: 400, message: '시트 데이터/헤더 없음' };
  }

  return {
    ok: true, synced, skipped, products,
    source, sheet_id: config.sheet_id, tab_name: config.tab_name,
    provider_code: config.provider_code || null,
    schema: config.schema,
  };
}

/* ──────── 종합표 직접 생성 ────────
 * 오플 + 공급사(보이는 탭) 시트의 42컬럼을 헤더이름 기준으로 종합 표준 순서에 정렬해 그대로 출력.
 * 공급사 탭이 이미 종합 양식(42컬럼)이라 passthrough — 입고일자·운전자범위·대인·대물 등 다 채워짐.
 * 출고불가/숨김 행 제외 (노출 차량만). 종합표 만들기 UI 가 호출 → 클립보드 TSV → 종합탭 붙여넣기. */
const JONGHAP_HEADERS = ['상태', '입고일자', '구분', '차량번호', '차종분류', '세부모델', '연료', '외장', '내장', 'Km', '단기보증', '1개월', '6개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월', '트림', '옵션', '최초등록', '소비자가격', '제조사', '배기량', '차고지', '주소', '운전자범위', '연주행', '분납', '21세', '23세', '1만+', '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌', '비고', '공급사코드', '정책코드'];
const JONGHAP_ALIAS = { '상태': STATUS_COL_NAMES };   // 탭별 상태 컬럼 표기 차이 흡수
const PC_COL = JONGHAP_HEADERS.indexOf('공급사코드');
const CAR_COL = JONGHAP_HEADERS.indexOf('차량번호');
const CLASS_COL = JONGHAP_HEADERS.indexOf('차종분류');
const SUB_COL = JONGHAP_HEADERS.indexOf('세부모델');

function buildHeaderMap(headerRow) {
  const m = {};
  (headerRow || []).forEach((h, i) => { const k = String(h ?? '').trim(); if (k && m[k] == null) m[k] = i; });
  return m;
}
function alignRowToJonghap(row, hmap) {
  return JONGHAP_HEADERS.map(canon => {
    const names = JONGHAP_ALIAS[canon] || [canon];
    for (const n of names) { const idx = hmap[n]; if (idx != null) return String(row[idx] ?? '').trim(); }
    return '';
  });
}
const statusColIdx = (hmap) => { for (const n of JONGHAP_ALIAS['상태']) if (hmap[n] != null) return hmap[n]; return -1; };

/* 한 탭의 행들을 종합 양식으로 정렬해 out 에 push (올릴 수 있는 차량만). 통계 반환.
 * 번호 없는 신차(번호미정 등) = 차종분류/세부모델 있는 실제 차량은 100신XXXX 임시번호 부여
 *  (tempState.n 공유 카운터). 100신0001 은 차량번호 정규식 통과 → 종합탭 붙여넣기 후 상품 동기화가
 *  일반 차량처럼 import (2026-06-08 사용자 선택). 빈 줄·푸터(차종/세부 다 빔)는 매물 아님 → 제외.
 * 반환: { pushed(올릴수있음), total(전체 매물), unavailable(출고불가/숨김) }. */
function pushTabRows(out, tabRows, hidden, fallbackProvider, tempState) {
  const empty = { pushed: 0, total: 0, unavailable: 0 };
  const hi = tabRows.findIndex(r => r.map(c => String(c ?? '').trim()).includes('차량번호'));
  if (hi < 0) return empty;
  const hmap = buildHeaderMap(tabRows[hi]);
  const sIdx = statusColIdx(hmap), cIdx = hmap['차량번호'];
  let pushed = 0, total = 0, unavailable = 0;
  for (let i = hi + 1; i < tabRows.length; i++) {
    const car = String(tabRows[i]?.[cIdx] ?? '').trim();
    const cells = alignRowToJonghap(tabRows[i], hmap);
    const isCar = VALID_CAR_NO.test(car) || !!(cells[CLASS_COL] || cells[SUB_COL]);
    if (!isCar) continue;                               // 빈 줄·푸터 → 매물 아님
    total++;
    const isUnavailable = (hidden && hidden.has(i))
      || (sIdx >= 0 && normalizeVehicleStatus(tabRows[i][sIdx]) === '출고불가');
    if (isUnavailable) { unavailable++; continue; }     // 출고불가/숨김 → 종합표 제외
    if (!VALID_CAR_NO.test(car)) cells[CAR_COL] = `100신${String(++tempState.n).padStart(4, '0')}`;  // 번호없는 신차
    if (!cells[PC_COL] && fallbackProvider) cells[PC_COL] = fallbackProvider;
    out.push(cells);
    pushed++;
  }
  return { pushed, total, unavailable };
}

export async function buildJonghapTable() {
  const rows = [];
  const tabs = [];
  const tempState = { n: 0 };   // 번호 없는 신차 100신XXXX 공유 카운터 (탭 간 충돌 방지)

  // 공급사 — 보이는 탭 batched (meta 1 + values 1 + 숨김 1).
  //  ※ 오플(autoplus)은 종합표에서 제외 (사용자 정책 2026-06-08) — 종합표는 공급사 통합만.
  try {
    const sid = SHEET_CONFIGS.supply.sheet_id;
    const meta = await fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${sid}?fields=sheets.properties(title,hidden)&key=${SHEETS_API_KEY}`);
    const tabNames = (meta.sheets || [])
      .filter(s => s.properties && !s.properties.hidden)
      .map(s => s.properties.title)
      .filter(t => t && t !== '종합' && !/^(공지|안내)$|^★/.test(t));
    if (tabNames.length) {
      const ranges = tabNames.map(t => `${tabRange(t)}!A1:BZ2000`);
      const batch = await fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchGet?${ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&')}&valueRenderOption=FORMATTED_VALUE&key=${SHEETS_API_KEY}`);
      const hiddenByTab = {};
      try {
        const g = await fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${sid}?${tabNames.map(t => `ranges=${encodeURIComponent(tabRange(t))}`).join('&')}&fields=${encodeURIComponent('sheets.properties.title,sheets.data.rowMetadata(hiddenByUser,hiddenByFilter)')}&key=${SHEETS_API_KEY}`);
        for (const sh of (g.sheets || [])) { const set = new Set(); (sh.data?.[0]?.rowMetadata || []).forEach((m, i) => { if (m && (m.hiddenByUser || m.hiddenByFilter)) set.add(i); }); hiddenByTab[sh.properties?.title] = set; }
      } catch {}
      (batch.valueRanges || []).forEach((vr, ti) => {
        const tab = tabNames[ti];
        const st = pushTabRows(rows, vr.values || [], hiddenByTab[tab] || new Set(), findPartnerCode(tab) || tab, tempState);
        tabs.push({ tab, count: st.pushed, total: st.total, unavailable: st.unavailable });
      });
    }
  } catch (e) { console.warn('[jonghap] 공급사 실패:', e.message); }

  // summary — 탭수·전체매물·출고불가·올릴수있음 (매물 파악용)
  const summary = tabs.reduce((s, t) => {
    s.total += t.total || 0; s.unavailable += t.unavailable || 0; s.uploadable += t.count || 0;
    return s;
  }, { tabs: tabs.length, total: 0, unavailable: 0, uploadable: 0 });

  return { ok: true, columns: JONGHAP_HEADERS, rows, tabs, count: rows.length, summary };
}

/* HTTP handler — 클라이언트(dev.js)가 POST 로 호출.
 * /api/sync/auto 도 동일 로직(syncFromSheet) 재사용. */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, message: 'POST only' }));
  }

  try {
    let body = '';
    req.on('data', chunk => body += chunk);
    await new Promise(resolve => req.on('end', resolve));
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch {}
    const source = parsed.source || 'autoplus';
    const out = await syncFromSheet(source);
    res.statusCode = out.ok ? 200 : (out.status || 400);
    res.setHeader('Content-Type', 'application/json');
    delete out.status;
    return res.end(JSON.stringify(out));
  } catch (e) {
    console.error('[external-sheet] 실패:', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, message: e.message || String(e) }));
  }
}
