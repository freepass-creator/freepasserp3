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
  [/디젤|경유|diesel/i, '디젤'],          // 경유 → 디젤 통일
  [/LPG|LPi|LPI/i, 'LPG'],
  [/수소|FCEV/i, '수소'],
  [/전기|일렉트릭|electric|\bEV\b/i, '전기'],
  [/가솔린|휘발유|gasoline|petrol|GDI/i, '가솔린'],   // 휘발유 → 가솔린 통일
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

  // 트림 = 세부모델·파워트레인에 안 들어간 "나머지". 모델·섀시·파워트레인·노이즈 토큰을 빼고 남은 것.
  //  (공급사 입력패턴 1,753건 학습 기반 — 등록구분/연식MY/엔진테크/마케팅/괄호코드 등 노이즈 제거)
  let trim = String(p.trim_name || '');
  // ① 제조사·모델·세부모델 단어 단위 제거 (세부모델 "쏘렌토 MQ4" → "쏘렌토","MQ4" 각각 — 섀시코드 중복 방지)
  const modelTokens = [p.maker, p.model, p.sub_model].filter(Boolean)
    .flatMap(s => String(s).split(/[\s/]+/)).filter(w => w.length >= 2);
  for (const w of modelTokens) trim = trim.replace(new RegExp(esc(w), 'gi'), ' ');
  trim = trim
    .replace(/\([^)]*\)/g, ' ')                                 // ② 괄호 내용 전부 (코드 (MQ4)·(7세대)·(A/T 26MY)·(P1))
    .replace(/\d\s*세대/g, ' ')                                 // 세대 표기
    .replace(/\b\d{2,4}\s*MY\b/gi, ' ')                         // 연식코드 25MY / 2026 MY
    .replace(/자가용|영업용|렌터카|렌트카|리스|법인|개인용?|런칭/g, ' ')   // 등록구분·마케팅
    .replace(/플러그인\s*하이브리드|하이브리드|PHEV|HEV|디젤|경유|가솔린|휘발유|LPG|LPi|LPI|전기|일렉트릭|E-?Tech|electric|수소|FCEV/gi, ' ')  // 연료
    .replace(/스마트\s*스트림|T-?GDI|GDI|MPI|IVT|DCT|CVT|DSG|e-?VGT|TDI/gi, ' ')   // 엔진테크·변속기
    .replace(/\d\.\d\s*T?|\d{3,4}\s*cc|\d+\s*인승?|터보/gi, ' ')   // 배기량·인승·터보
    .replace(/\b(AWD|4WD|RWD|FWD|2WD|4MATIC|xDrive|e-4WD|2륜|4륜|A\/T|M\/T|AT|MT)\b/gi, ' ')   // 구동·변속
    .replace(/\b[A-Z]{2,3}\d{1,2}\b/g, ' ')                     // 섀시코드(숫자) CN7/DL3/MQ4/GN7
    .replace(/\b(IG|HG|OS|JF|AD|YP|QX|TF|TM|UM)\b/g, ' ')        // 섀시코드(2글자, 큐레이트)
    .replace(/\bF\/?L\b|페이스리프트|풀체인지/gi, ' ')             // 페이스리프트 표기
    .replace(/Model\s*[3SXY]|모델\s*[3SXY와이쓰리]|\b테슬라\b/gi, ' ')   // 테슬라 모델명(트림 아님)
    .replace(/신형|디\s*올\s*뉴|올\s*뉴|더\s*뉴|the\s*new|all\s*new|\bthe\b|\b뉴\b|\b디\b/gi, ' ')   // 세대접두·마케팅
    .replace(/\s{2,}/g, ' ').replace(/^[\s.,+·\-]+|[\s.,+·\-]+$/g, '').trim();   // 양끝 문장부호·공백

  return { variant, trim };
}
