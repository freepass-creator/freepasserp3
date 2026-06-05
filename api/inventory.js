/**
 * /api/inventory — 외부 홈페이지용 공개 매물 API (퍼블리시 키 모델)
 *
 * 다른 사이트(하허호무심사 등)가 발급받은 키로 출고가능 매물을 가져가는 재사용 엔드포인트.
 *
 * 인증/보안:
 *   - 키: 헤더 `x-api-key` 또는 쿼리 `?key=` 로 전달. RTDB `api_keys/{key}` 에서 검증.
 *   - 정적 사이트의 키는 "비밀"이 아니라 **퍼블리시 키** — 보안은 (a) 허용 Origin 제한 +
 *     (b) #admin 에서 즉시 폐기(active:false) 로 확보. (Stripe pk_ / 구글맵 키와 동일 모델)
 *   - origins 가 비어있으면 임시로 모든 출처 허용(데모용). 운영 키엔 origins 설정 권장.
 *
 * 응답: 대외비(차량번호·공급사/영업/상품코드·수수료·정책·메모) 제외한 출고가능 매물만.
 *   { generated_at, count, products:[{id, maker, model, sub_model, trim, title,
 *     year, fuel, color, photo, rent_from, price:{month:{rent,deposit}}, options:[]}] }
 *
 * CORS: 검증 통과 시 요청 Origin 을 echo (브라우저 cross-origin fetch 허용).
 * 캐시: s-maxage 로 Vercel 엣지 캐싱 → Firebase 부하/비용 보호.
 */
import admin from 'firebase-admin';

const DATABASE_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const RENT_FLOOR = 100000;   // 마케팅 rent_from 산정 하한 (1·6개월 placeholder 제외)

let _appPromise = null;
function getAdmin() {
  if (_appPromise) return _appPromise;
  _appPromise = (async () => {
    if (admin.apps.length) return admin.app();
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || '';
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var not set');
    const trimmed = raw.trim();
    const decoded = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
    const creds = JSON.parse(decoded);
    return admin.initializeApp({ credential: admin.credential.cert(creds), databaseURL: DATABASE_URL });
  })();
  return _appPromise;
}

/* ── 정제 로직 (export-hahohomu-products.cjs 와 동일 규칙) ── */
function isAvailable(p) {
  if (!p || p._deleted || p.status === 'deleted') return false;
  const s = String(p.vehicle_status || '').replace(/\s+/g, '');
  return s === '출고가능' || s === '즉시출고';
}
function publicPrice(price) {
  const out = {};
  let minReal = Infinity, minAny = Infinity;
  for (const [m, v] of Object.entries(price || {})) {
    const month = Number(m), rent = Number(v?.rent || 0);
    if (!Number.isFinite(month) || month < 1 || month > 60 || rent <= 0) continue;
    out[month] = { rent, deposit: Number(v?.deposit || 0) };   // fee/commission 제외
    if (rent < minAny) minAny = rent;
    if (rent >= RENT_FLOOR && rent < minReal) minReal = rent;
  }
  const rent_from = Number.isFinite(minReal) ? minReal : (Number.isFinite(minAny) ? minAny : 0);
  // 대표 보증금 = rent_from(헤드라인 월렌트료) 약정의 보증금
  let deposit_from = 0;
  for (const v of Object.values(out)) { if (v.rent === rent_from) { deposit_from = v.deposit; break; } }
  return { table: out, rent_from, deposit_from };
}
function publicOptions(options) {
  if (Array.isArray(options)) return options.filter(Boolean);
  if (typeof options === 'string') return options.split(/[\s·,\/]+/).map(s => s.trim()).filter(Boolean);
  return [];
}
// product_type → 사이트 3분류. 신차렌트=new / *구독=subscription / 중고렌트(그 외)=rerent(재렌트)
function categoryOf(product_type) {
  const t = String(product_type || '');
  if (/구독$/.test(t)) return 'subscription';
  if (/^신차/.test(t)) return 'new';
  return 'rerent';
}
function sanitize(key, p) {
  const trim = p.trim_name || p.trim || '';
  const { table, rent_from, deposit_from } = publicPrice(p.price);
  return {
    id: key,
    maker: p.maker || '', model: p.model || '', sub_model: p.sub_model || '', trim,
    title: [p.maker, p.sub_model, trim].filter(Boolean).join(' '),
    product_type: p.product_type || '', category: categoryOf(p.product_type),
    year: p.year || (String(p.first_registration_date || '').match(/(\d{4})/)?.[1] || ''),
    fuel: p.fuel_type || '', color: p.color || p.exterior_color || '',
    mileage: Number(p.mileage || 0) || 0,
    photo: p.photo_link || '',
    rent_from, deposit_from, price: table, options: publicOptions(p.options),
  };
}

/* ── Origin 검증 ── */
function originOf(req) {
  const o = req.headers.origin;
  if (o) return o.replace(/\/$/, '').toLowerCase();
  const ref = req.headers.referer || '';
  try { return new URL(ref).origin.toLowerCase(); } catch { return ''; }
}
function originAllowed(reqOrigin, allowed) {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;   // origins 미설정 = 전체 허용(데모)
  const norm = s => String(s || '').replace(/\/$/, '').toLowerCase();
  return allowed.map(norm).includes(norm(reqOrigin));
}
function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key, Content-Type');
}
function json(res, status, body, origin) {
  setCors(res, origin);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const reqOrigin = originOf(req);

  if (req.method === 'OPTIONS') { setCors(res, req.headers.origin || '*'); res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return json(res, 405, { ok: false, message: 'method not allowed' }, req.headers.origin);

  const key = String(req.headers['x-api-key'] || req.query?.key || '').trim();
  if (!key) return json(res, 401, { ok: false, message: 'API key required (x-api-key header or ?key=)' }, req.headers.origin);

  try {
    const app = await getAdmin();
    const db = admin.database(app);

    const keyData = (await db.ref(`api_keys/${key}`).once('value')).val();
    if (!keyData || keyData.active === false) {
      return json(res, 401, { ok: false, message: 'invalid or revoked key' }, req.headers.origin);
    }
    if (!originAllowed(reqOrigin, keyData.origins)) {
      return json(res, 403, { ok: false, message: `origin not allowed: ${reqOrigin || '(none)'}` }, req.headers.origin);
    }

    const all = (await db.ref('products').once('value')).val() || {};
    const products = Object.entries(all)
      .filter(([, p]) => isAvailable(p))
      .map(([k, p]) => sanitize(k, p))
      .sort((a, b) => (a.rent_from || 9e9) - (b.rent_from || 9e9));

    // 사용 흔적 — 비차단(응답 지연 방지). 실패해도 무시.
    db.ref(`api_keys/${key}`).update({ last_used_at: Date.now(), last_origin: reqOrigin || '' }).catch(() => {});

    // 검증 통과 → 요청 Origin echo (cross-origin 허용)
    setCors(res, req.headers.origin || '*');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ generated_at: new Date().toISOString(), source: 'freepasserp3', count: products.length, products }));
  } catch (e) {
    console.error('[inventory]', e);
    return json(res, 500, { ok: false, message: e.message || String(e) }, req.headers.origin);
  }
}
