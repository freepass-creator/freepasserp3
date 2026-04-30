/**
 * driver-license.js — 운전면허증 OCR 텍스트 → 계약서 필드 매핑
 *
 * 추출 필드:
 *  - customer_name        (이름)
 *  - customer_birth       (생년월일 — YYYY-MM-DD)
 *  - license_number       (면허번호 — XX-XX-XXXXXX-XX)
 *  - license_class        (면허종류 — '1종 보통' / '2종 보통' 등)
 *  - license_issue_date   (발급일 — YYYY-MM-DD)
 */

import { extractDate } from '../ocr.js';

/* 한글 이름 패턴 — 2~4자 (성+이름) */
const RE_NAME = /(?:성\s*명|이름)\s*[:：]?\s*([가-힣]{2,4})/;
const RE_NAME_LOOSE = /^[가-힣]{2,4}$/m;

/* 면허번호 — XX-XX-XXXXXX-XX (총 12자리, 지역2 / 발급연도2 / 일련번호6 / 검증2) */
const RE_LICENSE = /(\d{2})\s*[-–]?\s*(\d{2})\s*[-–]?\s*(\d{6})\s*[-–]?\s*(\d{2})/;

/* 면허종류 */
const RE_CLASS = /(1\s*종\s*(?:대형|보통|소형|특수)|2\s*종\s*(?:보통|소형|원동기)|연습\s*(?:1종|2종))/;

/* 생년월일 — 주민번호 앞 6자리 또는 별도 표기 */
const RE_BIRTH_FROM_RRN = /(\d{6})\s*[-]\s*[1-4]/;

function normalizeBirth(yymmdd, leading2) {
  if (!yymmdd) return '';
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  // 주민번호 뒷자리로 1900s vs 2000s 판별 (1·2 → 1900s, 3·4 → 2000s)
  let yyyy;
  if (leading2 === '1' || leading2 === '2') yyyy = 1900 + yy;
  else if (leading2 === '3' || leading2 === '4') yyyy = 2000 + yy;
  else yyyy = yy < 30 ? 2000 + yy : 1900 + yy;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDriverLicense(text) {
  if (!text) return {};
  const result = {};

  // 이름
  const nameMatch = text.match(RE_NAME);
  if (nameMatch) result.customer_name = nameMatch[1];

  // 면허번호
  const licMatch = text.match(RE_LICENSE);
  if (licMatch) result.license_number = `${licMatch[1]}-${licMatch[2]}-${licMatch[3]}-${licMatch[4]}`;

  // 면허종류
  const classMatch = text.match(RE_CLASS);
  if (classMatch) result.license_class = classMatch[1].replace(/\s/g, ' ').trim();

  // 생년월일 — 주민번호 패턴 (YYMMDD-N) 우선
  const rrnMatch = text.match(RE_BIRTH_FROM_RRN);
  if (rrnMatch) {
    const after = text.slice(rrnMatch.index + rrnMatch[0].length - 1, rrnMatch.index + rrnMatch[0].length);
    result.customer_birth = normalizeBirth(rrnMatch[1], after);
  } else {
    // 주민번호 없으면 일반 날짜 추출 시도 (가장 오래된 날짜를 생년월일로 추정)
    const dates = (text.match(/(\d{4}[.\-/]\d{2}[.\-/]\d{2})/g) || [])
      .map(s => extractDate(s))
      .filter(Boolean)
      .sort();
    if (dates.length) result.customer_birth = dates[0];
  }

  // 발급일 — '발급', '교부' 키워드 근처의 날짜
  const issueMatch = text.match(/(?:발급|교부)\s*(?:일자)?\s*[:：]?\s*(\d{4}[.\-/]\d{2}[.\-/]\d{2})/);
  if (issueMatch) result.license_issue_date = extractDate(issueMatch[1]);

  return result;
}
