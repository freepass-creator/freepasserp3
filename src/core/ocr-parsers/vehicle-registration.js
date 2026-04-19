/**
 * vehicle-registration.js — 자동차등록증 OCR 텍스트 → 상품 필드 매핑
 *
 * ocrFile() 결과 text를 받아 필드 추출.
 * 반환된 객체를 updateRecord() 에 그대로 넣을 수 있도록 키 이름은 products 스키마와 일치.
 */

import { extractCarNumber, extractVin, extractDate } from '../ocr.js';

// 국산 + 주요 수입 제조사
const MAKERS = [
  '현대','기아','제네시스','쌍용','KG모빌리티','KGM','르노코리아','르노삼성','르노','한국GM','쉐보레','GM대우',
  'BMW','벤츠','아우디','폭스바겐','볼보','테슬라','미니','MINI','재규어','랜드로버','포르쉐','마세라티','페라리','람보르기니','롤스로이스','벤틀리',
  '토요타','혼다','렉서스','인피니티','닛산','마쓰다','스바루',
  '포드','링컨','캐딜락','크라이슬러','지프','닷지',
  '푸조','시트로엥','DS','알파로메오','피아트','마세라티',
];

// 연료
const FUEL_MAP = [
  [/가솔린|휘발유/, '가솔린'],
  [/디젤|경유/, '디젤'],
  [/LPG|엘피지/i, 'LPG'],
  [/하이브리드|hybrid|HEV/i, '하이브리드'],
  [/전기|EV\b/, '전기'],
  [/수소|FCEV/, '수소'],
];

function extractMaker(text) {
  // 긴 이름부터 매칭 (예: "기아" vs "기아자동차")
  const sorted = [...MAKERS].sort((a, b) => b.length - a.length);
  return sorted.find(m => text.includes(m)) || '';
}

function extractFuel(text) {
  for (const [re, name] of FUEL_MAP) if (re.test(text)) return name;
  return '';
}

function extractCC(text) {
  // "배기량 1,998cc" / "1998cc" 형태
  const m = text.match(/배기량[^\d]*(\d{1,2}[,.]?\d{3})/) || text.match(/(\d{3,4})\s*cc/i);
  if (!m) return '';
  return m[1].replace(/[,\.]/g, '');
}

function extractModelName(text, maker) {
  // 제조사 뒤 단어를 모델로 추정 (단순 휴리스틱 — 정확도 낮음)
  if (!maker) return '';
  const re = new RegExp(`${maker}\\s+([A-Za-z0-9가-힣\\-]+)`, 'g');
  const m = re.exec(text);
  return m?.[1] || '';
}

/**
 * 등록증 OCR 텍스트 파싱
 * @param {string} text
 * @returns {Partial<Product>} products 컬렉션에 merge 가능한 필드 객체 (빈 값은 제외)
 */
export function parseVehicleRegistration(text) {
  const out = {};

  const carNo = extractCarNumber(text);
  if (carNo) out.car_number = carNo;

  const vin = extractVin(text);
  if (vin) out.vin = vin;

  const firstReg = extractDate(text);  // YYYY-MM-DD
  if (firstReg) {
    // 등록증 포맷은 보통 YYYY.MM.DD — freepass 관행에 맞춰 점 구분
    out.first_registration_date = firstReg.replace(/-/g, '.');
    out.year = firstReg.slice(0, 4);
  }

  const maker = extractMaker(text);
  if (maker) out.maker = maker;

  const model = extractModelName(text, maker);
  if (model) out.model = model;

  const fuel = extractFuel(text);
  if (fuel) out.fuel_type = fuel;

  const cc = extractCC(text);
  if (cc) out.engine_cc = cc;

  return out;
}
