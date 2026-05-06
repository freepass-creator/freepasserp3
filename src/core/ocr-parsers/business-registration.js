/**
 * business-registration.js — 사업자등록증 OCR 텍스트 → 파트너 필드 매핑
 *
 * 한국 사업자등록증은 별지 제3호서식 (법인) / 제4호서식 (개인) 으로 표준화돼 있어
 * 라벨(등록번호/법인명/대표자/사업장 소재지/개업연월일/업태/종목/세무서장 등) 기반 추출 가능.
 *
 * jpkerp-v4 의 BUSINESS_REG_SCHEMA 패턴 참고. 단 freepasserp3 는 raw text OCR (Vision API) 기반이라
 * Gemini schema extraction 대신 정규식 기반.
 *
 * 매핑 (partners 컬렉션):
 *  - biz_no       → business_number
 *  - corp_no      → corp_number (확장)
 *  - partner_name → partner_name
 *  - ceo          → ceo_name
 *  - address      → address
 *  - open_date    → open_date (확장, YYYY-MM-DD)
 *  - hq_address   → hq_address (확장)
 *  - industry     → industry (확장)
 *  - category     → category (확장)
 *  - tax_office   → tax_office (확장)
 *  - entity_type  → entity_type ('corporate' | 'individual')
 */

/** OCR text → { business_number, partner_name, ceo_name, address, ... } */
export function parseBusinessRegistration(text) {
  const out = {};
  if (!text) return out;
  const t = String(text);

  // ── 1. 사업자등록번호 — XXX-XX-XXXXX (가장 확실한 식별자) ──
  // 라벨 우선, 없으면 패턴만으로 fallback
  let m = t.match(/(?:사업자\s*)?등록\s*번호[\s:：]*([0-9]{3}-[0-9]{2}-[0-9]{5})/);
  if (!m) m = t.match(/([0-9]{3}-[0-9]{2}-[0-9]{5})/);
  if (m) out.business_number = m[1];

  // ── 2. 법인등록번호 — XXXXXX-XXXXXXX (법인만, 개인은 없음) ──
  m = t.match(/법인\s*등록\s*번호[\s:：]*([0-9]{6}-[0-9]{7})/);
  if (!m) {
    // 라벨 없는 fallback (사업자번호 패턴과 길이로 구분)
    const all = t.match(/[0-9]{6}-[0-9]{7}/g);
    if (all && all.length) out.corp_number = all[0];
  } else {
    out.corp_number = m[1];
  }

  // ── 3. 법인명 / 상호 / 단체명 ──
  // "법인명(단체명) : 주식회사 OOO" 또는 "상호 : OOO"
  m = t.match(/(?:법인명|단체명|상\s*호)[^\n:：]*[:：]\s*([^\n]+?)(?=\s*(?:대표자|성\s*명|개업|법인\s*등록|사업장|$))/);
  if (m) out.partner_name = cleanName(m[1]);

  // ── 4. 대표자 / 성명 ──
  // "대표자 : 홍길동 (대표유형)" → 이름만 추출
  m = t.match(/(?:대표자|성\s*명)[\s:：]*([가-힣A-Za-z·\s]{2,20}?)(?=\s*[\(（\n]|개업|법인\s*등록|사업장|$)/);
  if (m) out.ceo_name = m[1].trim().replace(/\s+/g, ' ');

  // ── 5. 사업장 소재지 ──
  m = t.match(/사업장\s*소재지[\s:：]*([^\n]+?)(?=\s*(?:본점|업\s*태|종\s*목|개업|발급|$))/);
  if (m) out.address = cleanAddress(m[1]);

  // ── 6. 본점 소재지 (사업장과 다를 때만) ──
  m = t.match(/본점\s*소재지[\s:：]*([^\n]+?)(?=\s*(?:업\s*태|종\s*목|개업|발급|$))/);
  if (m) {
    const hq = cleanAddress(m[1]);
    if (hq && hq !== out.address) out.hq_address = hq;
  }

  // ── 7. 개업연월일 ──
  // "2017 년 01 월 01 일" / "2017-01-01" / "2017.01.01"
  m = t.match(/개업\s*연월일[\s:：]*(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (m) out.open_date = ymd(m[1], m[2], m[3]);

  // ── 8. 업태 / 종목 ──
  m = t.match(/업\s*태[\s:：]*([^\n종]+?)(?=\s*(?:종\s*목|발급|$))/);
  if (m) out.industry = m[1].trim().replace(/\s+/g, ' ');
  m = t.match(/종\s*목[\s:：]*([^\n]+?)(?=\s*(?:업\s*태|발급|개업|위와|$))/);
  if (m) out.category = m[1].trim().replace(/\s+/g, ' ');

  // ── 9. 세무서장 ──
  m = t.match(/([가-힣]+세무서)\s*장/);
  if (m) out.tax_office = m[1];

  // ── 10. 사업자 유형 ──
  if (/법인사업자/.test(t)) out.entity_type = 'corporate';
  else if (out.corp_number) out.entity_type = 'corporate';
  else if (/일반과세자|간이과세자|면세사업자/.test(t)) out.entity_type = 'individual';

  return out;
}

function cleanName(s) {
  // 괄호 내용 제거 (단체명·영문명 등 보조 표기)
  return String(s).trim().replace(/\s*[\(（][^\)）]*[\)）]\s*/g, '').replace(/\s+/g, ' ').trim();
}

function cleanAddress(s) {
  // 줄바꿈/연속공백 정리, "위와 같이..." 같은 후속 문구 제거
  return String(s).trim().replace(/\s+/g, ' ').replace(/\s*위와.*$/, '').trim();
}

function ymd(y, mo, d) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
