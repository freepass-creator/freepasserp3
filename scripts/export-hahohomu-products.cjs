#!/usr/bin/env node
/**
 * export-hahohomu-products.cjs
 *   freepasserp3 RTDB 매물 → 하허호무심사 데모 사이트용 공개 JSON 내보내기.
 *
 *   - products 노드는 공개 읽기(.read:true)라 서비스계정 키 불필요. 공개 REST 로 fetch.
 *   - 출고가능 매물만, **노출용 안전 필드만** 정제. 대외비(차량번호·공급사/영업/상품코드·
 *     수수료·정책·메모)는 전부 제거.
 *   - 결과: C:/dev/hahohomu-gift/data/products.json  ({ generated_at, count, products:[...] })
 *
 *   사용: node scripts/export-hahohomu-products.cjs
 *   주의: read-only. RTDB 에 write 없음.
 */
const fs = require('fs');
const path = require('path');

const RTDB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const OUT_DIR = 'C:/dev/hahohomu-gift/data';
const OUT_FILE = path.join(OUT_DIR, 'products.json');

/** 출고가능 판정 — external-sheet.js normalizeVehicleStatus 와 동일 규칙 */
function isAvailable(p) {
  if (p._deleted || p.status === 'deleted') return false;
  const s = String(p.vehicle_status || '').replace(/\s+/g, '');
  return s === '출고가능' || s === '즉시출고';
}

// 마케팅 헤드라인(rent_from)용 현실적 월렌트료 하한. 이 미만(예: 1·6개월 행의 ₩100/₩37)은
// 단기/placeholder 값이라 "월 OO원부터" 계산에서 제외(테이블에는 그대로 보존).
const RENT_FLOOR = 100000;

/** price 맵 { [month]: {rent, deposit, fee...} } → 노출용 {month: {rent, deposit}} (수수료 제거) */
function publicPrice(price) {
  const out = {};
  let rentMinReal = Infinity;   // 하한 이상 최소
  let rentMinAny = Infinity;    // 전체 최소(폴백)
  for (const [m, v] of Object.entries(price || {})) {
    const month = Number(m);
    const rent = Number(v?.rent || 0);
    if (!Number.isFinite(month) || month < 1 || month > 60 || rent <= 0) continue;
    out[month] = { rent, deposit: Number(v?.deposit || 0) };   // fee/commission 의도적 제외
    if (rent < rentMinAny) rentMinAny = rent;
    if (rent >= RENT_FLOOR && rent < rentMinReal) rentMinReal = rent;
  }
  const rent_from = Number.isFinite(rentMinReal) ? rentMinReal
    : (Number.isFinite(rentMinAny) ? rentMinAny : 0);
  let deposit_from = 0;
  for (const v of Object.values(out)) { if (v.rent === rent_from) { deposit_from = v.deposit; break; } }
  return { table: out, rent_from, deposit_from };
}

// product_type → 사이트 3분류. 신차렌트=new / *구독=subscription / 중고렌트(그 외)=rerent(재렌트)
function categoryOf(product_type) {
  const t = String(product_type || '');
  if (/구독$/.test(t)) return 'subscription';
  if (/^신차/.test(t)) return 'new';
  return 'rerent';
}

function publicOptions(options) {
  if (Array.isArray(options)) return options.filter(Boolean);
  if (typeof options === 'string') {
    return options.split(/[\s·,\/]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/** 매물 → 공개 안전 shape (대외비 필드 완전 배제) */
function sanitize(key, p) {
  const trim = p.trim_name || p.trim || '';
  const { table, rent_from, deposit_from } = publicPrice(p.price);
  return {
    id: key,                                  // 불투명 해시(EXT_md5...). 차량번호 아님
    maker: p.maker || '',
    model: p.model || '',
    sub_model: p.sub_model || '',
    trim,
    title: [p.maker, p.sub_model, trim].filter(Boolean).join(' '),
    product_type: p.product_type || '',       // 신차렌트 / 중고렌트 / 중고구독
    category: categoryOf(p.product_type),      // new / rerent / subscription (사이트 페이지 매핑)
    year: p.year || (String(p.first_registration_date || '').match(/(\d{4})/)?.[1] || ''),
    fuel: p.fuel_type || '',
    color: p.color || p.exterior_color || '',
    mileage: Number(p.mileage || 0) || 0,
    photo: p.photo_link || '',                // drive 폴더/모던렌트카 링크일 수 있음(직접 이미지 X 가능)
    rent_from,                                // 월 최저 렌트료(마케팅 "월 OO원부터")
    deposit_from,                             // 대표 보증금(rent_from 약정)
    price: table,                             // {36:{rent,deposit}, 48:{...}} 수수료 없음
    options: publicOptions(p.options),
  };
}

(async () => {
  console.log('freepasserp3 RTDB(공개 REST) 에서 매물 로드 중...');
  const res = await fetch(`${RTDB}/products.json`);
  if (!res.ok) throw new Error(`RTDB fetch 실패: ${res.status} ${res.statusText}`);
  const all = await res.json() || {};
  const entries = Object.entries(all);
  console.log(`✓ 전체 ${entries.length}건 로드`);

  const available = entries.filter(([, p]) => isAvailable(p));
  const products = available.map(([k, p]) => sanitize(k, p))
    .sort((a, b) => (a.rent_from || 9e9) - (b.rent_from || 9e9));   // 저렴한 순

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    source: 'freepasserp3',
    count: products.length,
    products,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');

  const withPhoto = products.filter(p => p.photo).length;
  console.log(`✓ 출고가능 ${products.length}대 정제 완료 (사진링크 보유 ${withPhoto}대)`);
  console.log(`  → ${OUT_FILE}`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
