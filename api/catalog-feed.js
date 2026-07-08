/**
 * /api/catalog-feed — 손님용 카탈로그 공개 데이터 피드 (원칙 23 PII / 대외비 차단)
 *
 * 배경: 기존 catalog.html 은 RTDB products(.read:true)·policies·partners·users 를
 *  익명 인증으로 직접 구독 → 원가·수수료·공급사코드·메모·전직원 연락처까지
 *  브라우저에서 통째로 덤프 가능했음. 이 피드가 서버에서 정제 후 필요한 것만 내려줌.
 *  (RTDB 원본 노드들은 rules 에서 익명 접근 차단 — database.rules.json)
 *
 * GET /api/catalog-feed?p={공급사코드}&a={영업자코드}
 *  - p: 해당 공급사 매물만 + brand(회사명) 반환. 코드 자체는 응답에 안 나감.
 *  - a: 영업자 카드 정보(이름·전화·회사·직급) 반환 — 손님에게 의도적으로 노출되는 값만.
 *
 * 응답: { generated_at, count, products:[...], brand?, agent? }
 *  products 필드 = 화이트리스트 (아래 sanitize). 수수료(fee/commission)·정책코드·
 *  공급사코드·내부메모·source 계열은 절대 포함 금지.
 *
 * 캐시: Vercel 엣지 s-maxage=300 (쿼리별 캐시) — RTDB 부하/비용 보호.
 */
import admin from 'firebase-admin';

const DATABASE_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

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

/* 월별 가격에서 공개 가능한 rent/deposit 만 — fee/commission(마진) 제거 */
function publicPrice(price) {
  const out = {};
  for (const [m, v] of Object.entries(price || {})) {
    const month = Number(m);
    if (!Number.isFinite(month) || month < 1 || month > 60) continue;
    const rent = Number(v?.rent || 0);
    if (rent <= 0) continue;
    out[m] = { rent, deposit: Number(v?.deposit || 0) };
  }
  return out;
}

/* 정책(보험조건 등) 공개분 — 수수료·환수·코드·메모 계열 제거 후 첨부.
 *  손님 상세화면이 대인/대물/자차/운전자범위 등을 _policy 에서 표시함. */
const POLICY_DENY = /commission|clawback|fee|수수료|환수|memo|비고|_code$|^code|created_by|updated_by/i;
function publicPolicy(policy) {
  if (!policy) return null;
  const out = {};
  for (const [k, v] of Object.entries(policy)) {
    if (POLICY_DENY.test(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
/* 상품 ↔ 정책 매칭 — 클라이언트 policy-utils.findPolicy 와 동일 규칙 (policy_code === policy_code | _key) */
function findPolicyFor(p, policies) {
  if (!p.policy_code) return null;
  return policies.find(x => x && (x.policy_code === p.policy_code || x._key === p.policy_code)) || null;
}

/* 카탈로그 표시 필드 화이트리스트 — 여기 없는 필드는 절대 안 나감 */
function sanitizeForCatalog(key, p) {
  return {
    _key: key,
    car_number: p.car_number || '',        // 카탈로그는 차량번호를 의도적으로 표시 (?car 단일 모드)
    maker: p.maker || '',
    model: p.model || '',
    sub_model: p.sub_model || '',
    trim_name: p.trim_name || p.trim || '',
    variant: p.variant || '',
    vehicle_class: p.vehicle_class || '',
    year: p.year || '',
    first_registration_date: p.first_registration_date || '',
    fuel_type: p.fuel_type || '',
    ext_color: p.ext_color || '',
    int_color: p.int_color || '',
    mileage: Number(p.mileage || 0) || 0,
    engine_cc: Number(p.engine_cc || 0) || 0,
    options: p.options || '',
    product_type: p.product_type || '',
    vehicle_status: p.vehicle_status || '',
    status: p.status || '',
    photo_link: p.photo_link || '',
    image_url: p.image_url || '',
    image_urls: Array.isArray(p.image_urls) ? p.image_urls : undefined,
    price: publicPrice(p.price),
    created_at: p.created_at || 0,
    updated_at: p.updated_at || 0,
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, message: 'GET only' })); }

  const providerCode = String(req.query?.p || '').trim();
  const agentCode = String(req.query?.a || '').trim();

  try {
    const app = await getAdmin();
    const db = admin.database(app);

    const [allSnap, polSnap] = await Promise.all([
      db.ref('products').once('value'),
      db.ref('policies').once('value'),
    ]);
    const all = allSnap.val() || {};
    const policies = Object.entries(polSnap.val() || {}).map(([k, v]) => ({ _key: k, ...v }));
    const products = Object.entries(all)
      .filter(([, p]) => p && !p._deleted && p.is_active !== false)
      .filter(([, p]) => !providerCode || p.provider_company_code === providerCode || p.partner_code === providerCode)
      .map(([k, p]) => {
        const out = sanitizeForCatalog(k, p);
        const pol = publicPolicy(findPolicyFor(p, policies));
        if (pol) out._policy = pol;   // 보험조건 등 공개분 — 손님 상세 표시용
        return out;
      });

    // 공급사 브랜드명 (?p) — 코드 대신 이름만
    let brand = null;
    if (providerCode) {
      const partners = (await db.ref('partners').once('value')).val() || {};
      const partner = Object.values(partners).find(x => x && (x.partner_code === providerCode || x.company_code === providerCode));
      if (partner) brand = partner.partner_name || partner.company_name || '';
    }

    // 영업자 카드 (?a) — 손님에게 의도 노출되는 필드만 (uid/email/role 원본 등 제외)
    let agent = null;
    if (agentCode) {
      // orderByChild 는 rules indexOn 필요(admin SDK 도 인덱스 요구) — 전체 로드 후 서버에서 find (외부 미노출)
      const users = (await db.ref('users').once('value')).val() || {};
      const u = Object.values(users).find(x => x && x.user_code === agentCode);
      if (u) {
        agent = {
          name: u.name || '',
          phone: u.phone || '',
          company_name: u.company_name || '',
          title: u.title || u.position || '',
          role: u.role === 'agent_admin' ? 'agent_admin' : 'agent',
        };
      }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.statusCode = 200;
    return res.end(JSON.stringify({ generated_at: new Date().toISOString(), count: products.length, products, brand, agent }));
  } catch (e) {
    console.error('[catalog-feed]', e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, message: e.message || String(e) }));
  }
}
