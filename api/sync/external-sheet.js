/**
 * 외부 구글시트 → products 동기화 (오토플러스 = RP023)
 * POST /api/sync/external-sheet
 *
 * v1 freepasserp app.py 의 /api/sync/external-sheet 를 Node.js Vercel Serverless 로 포팅.
 * 시트: https://docs.google.com/spreadsheets/d/1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U/
 *   탭: 판매차량리스트(수수료100)
 *   파트너코드: RP023 (오토플러스)
 *
 * 응답: { ok, synced, skipped, products: { [product_uid]: product } }
 *  Firebase write 는 클라이언트(dev.js)가 처리.
 */

import crypto from 'crypto';

const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY || 'AIzaSyBSPo1kZOefX-6NuHoQdUF1htqQDSxXsCs';
const SHEET_ID = '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U';
const TAB_NAME = '판매차량리스트(수수료100)';
const PROVIDER_CODE = 'RP023';

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

const STATUS_MAP = {
  '판매중': 'available', '할인판매': 'available',
  '계약중': 'unavailable', '계약요청': 'unavailable',
  '보류': 'unavailable', '매각진행중': 'unavailable', '판매완료': 'unavailable',
  '판매보류': 'unavailable', '수리중': 'unavailable',
};
const VEHICLE_STATUS_MAP = {
  '판매중': '출고가능', '할인판매': '출고가능',
  '계약중': '계약완료', '계약요청': '계약대기',
  '보류': '출고불가', '매각진행중': '출고불가', '판매완료': '출고불가',
  '판매보류': '출고불가', '수리중': '출고불가',
};

const isImport = (name) => {
  const nl = String(name || '').toLowerCase();
  return IMPORT_BRAND_KEYWORDS.some(b => nl.includes(b));
};

const safeGet = (row, idx) => (idx < 0 || idx >= row.length ? '' : String(row[idx] ?? '').trim());
const parsePrice = (v) => parseInt(String(v || '').replace(/[^\d]/g, '') || '0', 10);

async function fetchJson(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, message: 'POST only' }));
  }

  try {
    const encodedTab = encodeURIComponent(TAB_NAME);

    // 1) chipRuns — 차량번호 셀의 스마트칩 → drive folder URL
    const photoLinkMap = {};
    try {
      const chipUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?ranges=${encodedTab}&fields=sheets.data.rowData.values.chipRuns&key=${SHEETS_API_KEY}`;
      const chipData = await fetchJson(chipUrl);
      const chipSheets = chipData.sheets || [];
      if (chipSheets.length) {
        const chipRows = chipSheets[0]?.data?.[0]?.rowData || [];
        chipRows.forEach((rd, ri) => {
          for (const cell of (rd.values || [])) {
            for (const chip of (cell.chipRuns || [])) {
              const uri = chip?.chip?.richLinkProperties?.uri || '';
              if (uri && uri.includes('drive.google.com')) {
                photoLinkMap[ri] = uri.split('?')[0];
                break;
              }
            }
            if (photoLinkMap[ri]) break;
          }
        });
      }
    } catch (e) {
      // chipRuns 가 부족해도 동기화는 계속
      console.warn('[external-sheet] chipRuns 실패:', e.message);
    }

    // 2) 셀 값
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodedTab}?key=${SHEETS_API_KEY}`;
    const sheetData = await fetchJson(sheetsUrl);
    const rows = sheetData.values || [];
    if (!rows.length) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, message: '시트 데이터 없음' }));
    }

    // 헤더 찾기 (차량번호 컬럼이 있는 행)
    let headerIdx = -1, headers = [];
    for (let i = 0; i < rows.length; i++) {
      const rowStr = rows[i].map(c => String(c ?? '').trim());
      if (rowStr.includes('차량번호')) { headerIdx = i; headers = rowStr; break; }
    }
    if (headerIdx < 0) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, message: '헤더 행을 찾을 수 없음' }));
    }

    const colIdx = (name) => headers.indexOf(name);
    const colPartial = (kw) => headers.findIndex(h => h.includes(kw));

    const idxCar = colIdx('차량번호');
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
    const idxOptions = colPartial('옵션');
    const idxNotes = colPartial('비고');

    let idxRent12 = -1, idxRent24 = -1, idxRent36 = -1;
    headers.forEach((h, i) => {
      const hl = h.replace(/\s/g, '');
      if (hl.includes('12개월') && hl.includes('3만')) idxRent12 = i;
      else if (hl.includes('24개월') && hl.includes('3만')) idxRent24 = i;
      else if (hl.includes('36개월') && hl.includes('3만')) idxRent36 = i;
    });
    if (idxRent12 < 0) {
      idxRent12 = headers.findIndex(h => h.replace(/\s/g, '').includes('12개월'));
    }

    const products = {};
    const nowMs = Date.now();
    let synced = 0, skipped = 0;

    for (let off = 0; off + headerIdx + 1 < rows.length; off++) {
      const absRow = headerIdx + 1 + off;
      const row = rows[absRow] || [];
      const carNumber = safeGet(row, idxCar);
      if (!carNumber || !/[가-힣]/.test(carNumber)) { skipped++; continue; }

      const statusRaw = safeGet(row, idxStatus);
      const status = STATUS_MAP[statusRaw];
      if (!status) { skipped++; continue; }
      const vehicleStatus = VEHICLE_STATUS_MAP[statusRaw] || '출고가능';

      const modelShort = safeGet(row, idxModelShort);
      const modelFull = idxModelFull >= 0 ? safeGet(row, idxModelFull) : '';
      const rent12 = idxRent12 >= 0 ? parsePrice(safeGet(row, idxRent12)) : 0;
      const rent24 = idxRent24 >= 0 ? parsePrice(safeGet(row, idxRent24)) : 0;
      const rent36 = idxRent36 >= 0 ? parsePrice(safeGet(row, idxRent36)) : 0;

      const imp = isImport(modelFull) || isImport(modelShort);
      const depMult = imp ? 3 : 2;

      const uidSeed = `${PROVIDER_CODE}_${carNumber}`;
      const productUid = `EXT_${crypto.createHash('md5').update(uidSeed).digest('hex').slice(0, 12)}`;

      const mileage = parseInt(String(safeGet(row, idxMileage)).replace(/[^\d]/g, '') || '0', 10);

      const regDate = safeGet(row, idxRegDate);
      let yearModel = '';
      if (regDate) {
        const m = /^(\d{4})/.exec(regDate);
        if (m) yearModel = `${String(m[1]).slice(2)}년식`;
      }

      const product = {
        // 표준 product 스키마 — createNewProduct() 와 동일 키 + 외부소스 메타
        _key: productUid,
        product_uid: productUid,
        product_code: `${PROVIDER_CODE}_${carNumber}`,
        provider_company_code: PROVIDER_CODE,
        partner_code: PROVIDER_CODE,
        car_number: carNumber,
        raw_model_short: modelShort,
        raw_model_full: modelFull,
        maker: '',
        model_name: '',
        sub_model: '',
        trim_name: '',
        ext_color: safeGet(row, idxColor),
        fuel_type: safeGet(row, idxFuel),
        mileage,
        year: yearModel,
        first_registration_date: regDate,
        location: safeGet(row, idxLocation),
        status,
        vehicle_status: vehicleStatus,
        product_type: '중고구독',
        status_label: statusRaw,
        is_active: true,
        options: idxOptions >= 0 ? safeGet(row, idxOptions) : '',
        partner_memo: idxNotes >= 0 ? safeGet(row, idxNotes) : '',
        photo_link: photoLinkMap[absRow] || '',
        source: 'external_sheet',
        source_sheet_id: SHEET_ID,
        price: {},
        created_at: nowMs,
        updated_at: nowMs,
        created_by: 'sync_external_sheet',
      };
      if (rent12) product.price['12'] = { rent: rent12, deposit: rent12 * depMult };
      if (rent24) product.price['24'] = { rent: rent24, deposit: rent24 * depMult };
      if (rent36) product.price['36'] = { rent: rent36, deposit: rent36 * depMult };

      products[productUid] = product;
      synced++;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      ok: true, synced, skipped, products,
      sheet_id: SHEET_ID, tab_name: TAB_NAME, provider_code: PROVIDER_CODE,
    }));
  } catch (e) {
    console.error('[external-sheet] 실패:', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, message: e.message || String(e) }));
  }
}
