/**
 * vehicle-registration.js — 자동차등록증 OCR 텍스트 → 상품 필드 매핑
 *
 * jpkerp2 의 원형 숫자(①②③…) 셀 분해 기반 파서를 포팅 + freepasserp3 schema 에 맞게 매핑.
 * 한국 자동차등록증은 자동차등록규칙 별지 제1호서식이라 모든 등록증에 원형 숫자가 공통.
 * 텍스트 OCR 결과의 순서가 흐트러져도 안정적으로 추출 가능.
 *
 * 추가 필드 (freepasserp3 신규):
 *  - cert_car_name: 등록증상 차명 원본 (제조사+모델 — 사용자 입력 model 과 별도 보존, 오인식 감지용)
 *  - vin, type_number, engine_type, seats, owner_name, owner_biz_no, address (옵셔널)
 */
import { extractCarNumber, extractVin, extractDate } from '../ocr.js';

// 자동차등록규칙 별지 제1호서식의 각 필드 앞 원형 숫자
const CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔';

const FUEL_ALIAS = {
  '경유': '디젤', '휘발유': '가솔린', '가솔린': '가솔린', '디젤': '디젤',
  'lpg': 'LPG', 'LPG': 'LPG', '전기': '전기', '수소': '수소',
  '하이브리드': '하이브리드', '가솔린하이브리드': '하이브리드',
};

/**
 * 원형 숫자(①②③…) 앵커로 텍스트를 셀 단위로 분해.
 * @returns {Map<number, string>}  키 1~24, 값은 해당 셀의 라벨+값 텍스트
 */
function splitByCircledNumbers(text) {
  const cells = new Map();
  const re = new RegExp(`([${CIRCLED_NUMS}])`, 'g');
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = CIRCLED_NUMS.indexOf(m[1]);
    if (idx >= 0) matches.push({ num: idx + 1, index: m.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + 1;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    cells.set(matches[i].num, text.slice(start, end).trim());
  }
  return cells;
}

function stripLabel(cellText, labelPattern) {
  const m = cellText.match(labelPattern);
  return m ? cellText.slice(m[0].length).trim() : cellText.trim();
}

const toNum = (s) => Number(String(s).replace(/[,\s]/g, ''));

/**
 * 등록증 OCR 텍스트 파싱 — 원형 숫자 셀 우선, 정규식 fallback
 */
export function parseVehicleRegistration(text) {
  const out = {};
  const cells = splitByCircledNumbers(text);

  // ① 자동차등록번호 → car_number
  const c1 = cells.get(1);
  if (c1) {
    const v = stripLabel(c1, /^자\s*동\s*차\s*등\s*록\s*번\s*호\s*[:：]?\s*/);
    const m = v.match(/(\d{2,3})\s*([가-힣])\s*(\d{4})/);
    if (m) out.car_number = `${m[1]}${m[2]}${m[3]}`;
  }
  if (!out.car_number) {
    const carNo = extractCarNumber(text);
    if (carNo) out.car_number = carNo;
  }

  // ② 차종 → vehicle_class (대형/중형/소형/경형 + 승용/승합/화물/특수)
  const c2 = cells.get(2);
  if (c2) {
    const v = stripLabel(c2, /^차\s*종\s*[:：]?\s*/);
    const cat = v.match(/((?:대형|중형|소형|경형)\s*(?:승용|승합|화물|특수))/);
    if (cat) out.vehicle_class = cat[1].replace(/\s+/g, '');
  }

  // ④ 차명 → cert_car_name (등록증상 원본 보존, 사용자가 입력한 model 과 별도)
  const c4 = cells.get(4);
  if (c4) {
    const v = stripLabel(c4, /^차\s*명\s*[:：]?\s*/);
    if (v && v.length < 30 && /[가-힣A-Za-z]/.test(v)) {
      out.cert_car_name = v;
    }
  }
  // fallback — 정규식 라벨 매칭
  if (!out.cert_car_name) {
    const NEXT_LABELS = /형식|차종|차\s*체|제작연월|원동기|차대번호|용도|연료|배기량|승차정원|최초등록|차량자중|총중량/;
    const m = text.match(/차\s*명[\s:：]+([^\n]+)/);
    if (m) {
      let raw = m[1].trim();
      const cut = raw.search(NEXT_LABELS);
      if (cut > 0) raw = raw.slice(0, cut).trim();
      raw = raw.replace(/\s*\([^)]*\)/g, '').replace(/^[⑤⑥①②③④⑦⑧⑨⓪]+\s*/, '').trim();
      if (/[가-힣A-Za-z]{2,}/.test(raw) && raw !== '차대번호') out.cert_car_name = raw;
    }
  }

  // ⑤ 형식 및 제작연월 → type_number + year
  const c5 = cells.get(5);
  if (c5) {
    const v = stripLabel(c5, /^형식\s*(?:및\s*)?제작연월\s*[:：]?\s*/);
    const typeM = v.match(/^([A-Z][A-Z0-9\-]{2,18})/);
    if (typeM) out.type_number = typeM[1].replace(/-+$/, '');
    const yearM = v.match(/(\d{4})\s*[-년./]/);
    if (yearM) out.year = String(yearM[1]);
  }

  // ⑥ 차대번호 → vin
  const c6 = cells.get(6);
  if (c6) {
    const v = stripLabel(c6, /^차\s*대\s*번\s*호\s*[:：]?\s*/);
    const m = v.match(/([A-HJ-NPR-Z0-9]{17})/);
    if (m) out.vin = m[1];
  }
  if (!out.vin) {
    const vin = extractVin(text);
    if (vin) out.vin = vin;
  }

  // ⑦ 원동기형식 → engine_type
  const c7 = cells.get(7);
  if (c7) {
    const v = stripLabel(c7, /^원동기\s*형식\s*[:：]?\s*/);
    const m = v.match(/^([A-Z][A-Z0-9\-]{2,9})/);
    if (m) out.engine_type = m[1];
  }

  // ⑧ 사용본거지 → owner_address
  const c8 = cells.get(8);
  if (c8) {
    const v = stripLabel(c8, /^사\s*용\s*본\s*거\s*지\s*[:：]?\s*/);
    if (v) out.owner_address = v;
  }

  // ⑨ 성명(명칭) → owner_name
  const c9 = cells.get(9);
  if (c9) {
    const v = stripLabel(c9, /^성\s*명\s*\(?\s*명칭\s*\)?\s*[:：]?\s*/);
    if (v && v.length < 50) out.owner_name = v;
  }

  // ⑩ 생년월일/법인등록번호 → owner_biz_no
  const c10 = cells.get(10);
  if (c10) {
    const m = c10.match(/(\d{6}\s*-\s*\d{7})|(\d{6}\s*-\s*\d{1}\*{6})/);
    if (m) out.owner_biz_no = m[0].replace(/\s/g, '');
  }

  // ⑯ 승차정원 → seats
  const c16 = cells.get(16);
  if (c16) {
    const m = c16.match(/(\d{1,2})\s*명/);
    if (m) out.seats = Number(m[1]);
  }

  // ⑱ 배기량 → engine_cc
  const c18 = cells.get(18);
  if (c18) {
    const m = c18.match(/([\d,]{3,})\s*(?:cc|CC|시시)/);
    if (m) {
      const n = toNum(m[1]);
      if (n >= 50 && n <= 20000) out.engine_cc = String(n);
    }
  }
  if (!out.engine_cc) {
    const m = text.match(/배기량[^\d]*(\d{1,2}[,.]?\d{3})/) || text.match(/(\d{3,4})\s*cc/i);
    if (m) out.engine_cc = m[1].replace(/[,\.]/g, '');
  }

  // ㉑ 연료 → fuel_type
  const c21 = cells.get(21);
  if (c21) {
    const m = c21.match(/(경유|휘발유|가솔린|디젤|LPG|전기|수소|하이브리드)/i);
    if (m) out.fuel_type = FUEL_ALIAS[m[1]] || m[1];
  }
  if (!out.fuel_type) {
    const m = text.match(/(경유|휘발유|가솔린|디젤|LPG|전기|수소|하이브리드)/i);
    if (m) out.fuel_type = FUEL_ALIAS[m[1]] || m[1];
  }

  // 최초 등록일 → first_registration_date + year fallback
  const firstReg = extractDate(text);
  if (firstReg) {
    out.first_registration_date = firstReg.replace(/-/g, '.');
    if (!out.year) out.year = firstReg.slice(0, 4);
  }

  return out;
}

/** 파싱 결과가 너무 부실한지 — 재시도 / 사용자 알림 판단용 */
export function isParseIncomplete(d) {
  if (!d.car_number || !/^\d{2,3}[가-힣]\d{4}$/.test(d.car_number)) return true;
  const critical = [d.cert_car_name, d.vin, d.engine_cc];
  const missing = critical.filter(v => !v).length;
  return missing >= 2;
}
