/**
 * powertrain-from-product.js — 매물(product)의 구조화 필드로 5단계 파워트레인(variant) + 클린 트림 구성.
 *
 * 시트 트림은 지저분함(예 "그랑 콜레오스 하이브리드 E-Tech 1.5 터보 아이코닉 2WD"). 단순 parseTrim(뒤에서 떼기)은
 * 오분류 → 대신 연료 컬럼("HEV 1.6"/"가솔린2.5")·배기량·구동/인승 토큰을 조합해 표준 파워트레인을 만든다.
 *
 *   파워트레인(variant) = 연료 → 배기량 → 터보 → 구동 → 인승  (마스터 parseTrim 과 같은 표준 순서)
 *   트림(trim)         = 원본 트림에서 모델명·파워트레인 토큰 제거한 나머지 (예 "아이코닉", "프리미엄")
 *
 * 휴리스틱 — "얼추" 맞춤 (틀린 건 재고관리에서 개별 수정). catalog 표준과 정확히 일치 안 할 수 있음.
 */

const FUEL_NORM = [
  [/PHEV|플러그인/i, '플러그인하이브리드'],
  [/HEV|하이브리드|hybrid/i, '하이브리드'],
  [/디젤|diesel/i, '디젤'],
  [/LPG|LPi|LPI/i, 'LPG'],
  [/수소|FCEV/i, '수소'],
  [/전기|일렉트릭|electric|\bEV\b/i, '전기'],
  [/가솔린|gasoline|petrol|GDI/i, '가솔린'],
];
function normFuel(s) { for (const [re, v] of FUEL_NORM) if (re.test(String(s || ''))) return v; return ''; }

const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** product → { variant, trim } */
export function powertrainFromProduct(p) {
  const fuelRaw = String(p.fuel_type || '');
  const blob = `${p.trim_name || ''} ${p.raw_model_full || ''} ${p.raw_model_short || ''}`.trim();
  const all = `${fuelRaw} ${blob}`;

  const fuel = normFuel(fuelRaw) || normFuel(blob);

  // 배기량 — 연료/트림 문자열의 "x.y", 없으면 engine_cc(1598→1.6)
  let disp = '';
  const dm = all.match(/(\d\.\d)/);
  if (dm) disp = dm[1];
  if (!disp && p.engine_cc) {
    const cc = Number(String(p.engine_cc).replace(/[^\d]/g, ''));
    if (cc > 800) disp = (cc / 1000).toFixed(1);
  }

  const turbo = /터보|T-?GDI|\b\d\.\dT\b|e-VGT|TDI/i.test(all) ? 'T' : '';
  const drive = (all.match(/\b(AWD|4WD|RWD|FWD|2WD|4MATIC|xDrive|e-4WD)\b/i) || [])[1] || '';
  const dm2 = blob.match(/(\d+)\s*인승/);
  const seats = dm2 ? dm2[1] + '인승' : '';

  const variant = [fuel, disp, turbo, drive, seats].filter(Boolean).join(' ');

  // 트림 = 원본에서 모델명·파워트레인·세대접두 토큰 제거한 나머지
  let trim = String(p.trim_name || '');
  for (const w of [p.maker, p.model, p.sub_model].filter(Boolean)) {
    trim = trim.replace(new RegExp(esc(w), 'g'), ' ');
  }
  trim = trim
    .replace(/플러그인\s*하이브리드|하이브리드|PHEV|HEV|디젤|가솔린|LPG|LPi|전기|일렉트릭|E-?Tech|electric|수소|FCEV/gi, ' ')
    .replace(/\d\.\d\s*T?|\d{3,4}\s*cc|\d+\s*인승|터보|T-?GDI|e-VGT|TDI/gi, ' ')
    .replace(/\b(AWD|4WD|RWD|FWD|2WD|4MATIC|xDrive|e-4WD|2륜|4륜)\b/gi, ' ')
    .replace(/\b(DCT|CVT|IVT|DSG|A\/T|M\/T|AT|MT)\b|자동변속|수동변속/gi, ' ')   // 변속기 토큰
    .replace(/신형|디\s*올\s*뉴|올\s*뉴|더\s*뉴|뉴|the\s*new|all\s*new/gi, ' ')
    .replace(/\s+/g, ' ').trim();

  return { variant, trim };
}
