/**
 * 상품 일괄 임포트 — Google Sheets / CSV / Excel
 *
 * Google Sheets: 공개 링크의 CSV export URL 활용
 *   원본 URL: https://docs.google.com/spreadsheets/d/{ID}/edit#gid={GID}
 *   CSV URL:  https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid={GID}
 */

/**
 * Google Sheets URL → CSV export URL 변환
 */
export function sheetsUrlToCsv(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error('올바른 Google Sheets URL이 아닙니다');
  const id = m[1];
  const gidMatch = url.match(/[#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/**
 * CSV 문자열 → 객체 배열 (첫 행 = 헤더)
 */
export function parseCsv(csv) {
  // 전체 문자열을 한 번에 상태머신 파싱 — 줄 단위 선분할(구버전)은 따옴표로 감싼 셀 안의 개행에서
  //  한 행이 여러 깨진 행으로 분해되던 버그. 따옴표 내부의 개행/콤마/이스케이프("")를 정확히 처리.
  const s = String(csv || '');
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }   // 이스케이프된 따옴표
        else inQuotes = false;
      } else cur += c;                                 // 따옴표 안이면 개행·콤마도 데이터
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cur); cur = '';
    } else if (c === '\n' || c === '\r') {
      row.push(cur); cur = '';
      rows.push(row); row = [];
      if (c === '\r' && s[i + 1] === '\n') i++;        // CRLF 한 번만
    } else {
      cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }   // 마지막 행 flush(끝 개행 없어도)

  const nonEmpty = rows.filter(r => r.some(cell => String(cell).trim() !== ''));  // 빈 행 제거
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  });
}

/**
 * Sheets URL → 파싱된 행 배열
 */
export async function fetchSheetRows(sheetsUrl) {
  const csvUrl = sheetsUrlToCsv(sheetsUrl);
  const res = await fetch(csvUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheets 불러오기 실패 (${res.status}) — 시트가 "링크 공유" 설정되어 있나요?`);
  const csv = await res.text();
  return parseCsv(csv);
}

/**
 * 헤더 자동 매핑 — 한글/영문 둘 다 지원
 */
const FIELD_MAP = {
  // 기본
  '차량번호': 'car_number', 'car_number': 'car_number',
  '제조사': 'maker', 'maker': 'maker',
  '모델명': 'model', 'model': 'model', '모델': 'model',
  '세부모델': 'sub_model', 'sub_model': 'sub_model',
  '세부트림': 'trim_name', 'trim_name': 'trim_name', '트림': 'trim_name',
  '선택옵션': 'options', 'options': 'options', '옵션': 'options',
  '연식': 'year', 'year': 'year',
  '주행': 'mileage', '주행거리': 'mileage', 'mileage': 'mileage',
  '연료': 'fuel_type', 'fuel_type': 'fuel_type', '연료타입': 'fuel_type',
  '외부색상': 'ext_color', 'ext_color': 'ext_color', '색상': 'ext_color',
  '내부색상': 'int_color', 'int_color': 'int_color',
  '구동방식': 'drive_type', 'drive_type': 'drive_type',
  '차대번호': 'vin', 'vin': 'vin',
  '상태': 'vehicle_status', 'vehicle_status': 'vehicle_status', '차량상태': 'vehicle_status',
  '상품구분': 'product_type', 'product_type': 'product_type',
  '공급코드': 'provider_company_code', 'provider_company_code': 'provider_company_code', '공급사': 'provider_company_code',
  '정책코드': 'policy_code', 'policy_code': 'policy_code',
  // 가격
  '12개월대여료': 'price.12.rent', '12개월보증금': 'price.12.deposit',
  '24개월대여료': 'price.24.rent', '24개월보증금': 'price.24.deposit',
  '36개월대여료': 'price.36.rent', '36개월보증금': 'price.36.deposit',
  '48개월대여료': 'price.48.rent', '48개월보증금': 'price.48.deposit',
  '60개월대여료': 'price.60.rent', '60개월보증금': 'price.60.deposit',
};

/**
 * 행 → 상품 객체 변환 (price.* 중첩 키 지원)
 */
export function rowToProduct(row) {
  const product = { price: {} };
  for (const [key, val] of Object.entries(row)) {
    if (!val) continue;
    const field = FIELD_MAP[key.trim()];
    if (!field) continue;
    if (field.startsWith('price.')) {
      const [, month, type] = field.split('.');
      product.price[month] = product.price[month] || {};
      product.price[month][type] = Number(String(val).replace(/[^\d]/g, '')) || 0;
    } else if (field === 'year' || field === 'mileage') {
      product[field] = Number(String(val).replace(/[^\d]/g, '')) || val;
    } else {
      product[field] = val;
    }
  }
  if (!Object.keys(product.price).length) delete product.price;
  return product;
}

/**
 * Sheets URL or CSV 텍스트 → 상품 배열
 */
export async function parseProductsFromSheets(sheetsUrl) {
  const rows = await fetchSheetRows(sheetsUrl);
  return rows
    .map(rowToProduct)
    .filter(p => p.car_number);  // 차량번호 있는 행만
}
