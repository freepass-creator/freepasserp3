/**
 * bankbook.js — 통장사본 OCR 텍스트 → 파트너 계좌 필드 매핑
 *
 * 한국 은행 통장사본은 양식이 은행마다 약간 다르나 공통 정보:
 *  - 은행명 (상단 로고/문구)
 *  - 계좌번호 (XXX-XX-XXXXXX 형식, 은행마다 자릿수 다름)
 *  - 예금주 (성명/법인명)
 *  - (선택) 개설일, 통장종류
 *
 * 매핑 (partners 컬렉션):
 *  - bank_name    → bank_name
 *  - account_no   → bank_account
 *  - holder       → bank_holder
 */

const KOREAN_BANKS = [
  '국민은행', 'KB국민은행', 'KB',
  '신한은행', '신한',
  '우리은행', '우리',
  '하나은행', 'KEB하나은행', '하나',
  '농협은행', 'NH농협', '농협', 'NH',
  '기업은행', 'IBK기업은행', 'IBK',
  '카카오뱅크', '케이뱅크', '토스뱅크',
  '새마을금고', '신협', '우체국',
  'SC제일은행', 'SC', '제일',
  '씨티은행', 'Citi',
  '대구은행', '부산은행', '광주은행', '경남은행', '전북은행', '제주은행', '수협',
  'DGB', 'BNK',
];

/** OCR text → { bank_name, bank_account, bank_holder } */
export function parseBankbook(text) {
  const out = {};
  if (!text) return out;
  const t = String(text);

  // ── 1. 은행명 ──
  // 한국 주요 은행명 매칭. 첫 번째 매칭 = 메인 (상단 로고일 확률 높음)
  for (const bank of KOREAN_BANKS) {
    if (t.includes(bank)) {
      // alias → 표준명 정규화
      out.bank_name = canonicalBank(bank);
      break;
    }
  }

  // ── 2. 계좌번호 ──
  // 한국 계좌번호 패턴 — 9~14자리 숫자, 하이픈 0~3개
  // 예: 110-123-456789, 1002-123-456789, 123456789012, 110-12-345678
  // 사업자번호(XXX-XX-XXXXX)·법인번호(XXXXXX-XXXXXXX) 와 구분 필요
  let m = t.match(/(?:계좌\s*번호|계좌)[\s:：]*([0-9]{2,4}[-\s]?[0-9]{2,6}[-\s]?[0-9]{2,7})/);
  if (!m) {
    // 라벨 없는 fallback — 가장 긴 하이픈 포함 숫자열
    const all = t.match(/[0-9]{2,4}[-][0-9]{2,6}[-][0-9]{2,7}/g) || [];
    // 사업자번호(XXX-XX-XXXXX 13자리), 법인번호(XXXXXX-XXXXXXX 13자리) 제외
    const filtered = all.filter(s => {
      const cleaned = s.replace(/[-\s]/g, '');
      if (/^[0-9]{10}$/.test(cleaned)) {  // 사업자번호 10자리
        return !/^[0-9]{3}-[0-9]{2}-[0-9]{5}$/.test(s);
      }
      if (/^[0-9]{13}$/.test(cleaned)) {  // 법인번호 13자리
        return !/^[0-9]{6}-[0-9]{7}$/.test(s);
      }
      return true;
    });
    if (filtered.length) m = [null, filtered[0]];
  }
  if (m) out.bank_account = m[1].replace(/\s/g, '');

  // ── 3. 예금주 ──
  // "예금주 : 홍길동" 또는 "예금주 : 주식회사 OOO"
  const holderMatch = t.match(/예금주[\s:：]*([^\n,()（）]{1,40}?)(?=\s*(?:\n|계좌|개설|통장|$))/);
  if (holderMatch) out.bank_holder = cleanHolder(holderMatch[1]);

  return out;
}

function canonicalBank(s) {
  const map = {
    'KB': '국민은행',
    'KB국민은행': '국민은행',
    '신한': '신한은행',
    '우리': '우리은행',
    '하나': '하나은행',
    'KEB하나은행': '하나은행',
    'NH': '농협은행',
    'NH농협': '농협은행',
    '농협': '농협은행',
    'IBK': '기업은행',
    'IBK기업은행': '기업은행',
    'SC': 'SC제일은행',
    '제일': 'SC제일은행',
    'Citi': '씨티은행',
  };
  return map[s] || s;
}

function cleanHolder(s) {
  return String(s).trim().replace(/\s+/g, ' ').replace(/\s*[\(（][^\)）]*[\)）]\s*/g, '').trim();
}
