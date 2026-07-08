/**
 * /api/catalog-feed - public customer catalog feed.
 *
 * The browser receives only whitelisted fields. Internal source fields, provider
 * codes, policy codes, fees, commissions, memos, users, and partner records stay
 * server-side.
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

function publicPrice(price) {
  const out = {};
  for (const [key, v] of Object.entries(price || {})) {
    const month = Number(String(key).split('_')[0]);
    if (!Number.isFinite(month) || month < 1 || month > 60) continue;
    const rent = Number(v?.rent || 0);
    if (rent <= 0) continue;
    out[key] = { rent, deposit: Number(v?.deposit || 0) };
  }
  return out;
}

const PUBLIC_POLICY_FIELDS = [
  'policy_name',
  'policy_type',
  'insurance_included',
  'injury_compensation_limit',
  'injury_deductible',
  'property_compensation_limit',
  'property_deductible',
  'self_body_accident',
  'self_body_deductible',
  'personal_injury_compensation_limit',
  'personal_injury_deductible',
  'uninsured_damage',
  'uninsured_compensation_limit',
  'uninsured_deductible',
  'own_damage_compensation',
  'own_damage_repair_ratio',
  'own_damage_compensation_rate',
  'own_damage_min_deductible',
  'own_damage_max_deductible',
  'annual_roadside_assistance',
  'roadside_assistance',
  'credit_grade',
  'screening_criteria',
  'annual_mileage',
  'mileage_upcharge_per_10000km',
  'deposit_installment',
  'deposit_card_payment',
  'payment_method',
  'penalty_condition',
  'rental_region',
  'delivery_fee',
  'basic_driver_age',
  'driver_age_upper_limit',
  'personal_driver_scope',
  'business_driver_scope',
  'additional_driver_allowance_count',
  'additional_driver_cost',
  'maintenance_service',
];

function publicPolicy(policy) {
  if (!policy) return null;
  const out = {};
  for (const k of PUBLIC_POLICY_FIELDS) {
    const v = policy[k];
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function findPolicyFor(p, policies) {
  if (!p.policy_code) return null;
  return policies.find(x => x && (x.policy_code === p.policy_code || x._key === p.policy_code)) || null;
}

function sanitizeForCatalog(key, p) {
  return {
    _key: key,
    car_number: p.car_number || '',
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
    // 손님 상세 표기 필드 (product-detail-rows customer 경로가 읽음 — 누락 시 영구 '-')
    drive_type: p.drive_type || '',
    seats: p.seats || '',
    usage: p.usage || '',
    credit_grade: p.credit_grade || '',
    insurance_included: p.insurance_included || '',
    annual_mileage: p.annual_mileage || '',
    base_age: p.base_age || '',
    min_age: p.min_age || '',
    sheet_meta: p.sheet_meta ? { age_21: p.sheet_meta.age_21 || '', age_23: p.sheet_meta.age_23 || '' } : undefined,   // 내부 운영 컬럼 제외, 대여조건 2개만
    photo_link: p.photo_link || '',
    image_url: p.image_url || '',
    image_urls: publicImages(p),
    price: publicPrice(p.price),
    created_at: p.created_at || 0,
    updated_at: p.updated_at || 0,
  };
}

/* 사진 정규화 — image_urls(배열|JSON문자열) + 레거시 images/photos 병합 (product-photos.collectImages 동일 규칙) */
function publicImages(p) {
  const urls = [];
  for (const src of [p.image_urls, p.images, p.photos]) {
    if (!src) continue;
    let arr = src;
    if (typeof src === 'string') { try { arr = JSON.parse(src); } catch { continue; } }
    if (Array.isArray(arr)) for (const u of arr) { if (u && typeof u === 'string') urls.push(u); }
  }
  return urls.length ? [...new Set(urls)] : undefined;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, message: 'GET only' }));
  }

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
        if (pol) out._policy = pol;
        return out;
      });

    let brand = null;
    if (providerCode) {
      const partners = (await db.ref('partners').once('value')).val() || {};
      const partner = Object.values(partners).find(x => x && (x.partner_code === providerCode || x.company_code === providerCode));
      if (partner) brand = partner.partner_name || partner.company_name || '';
    }

    let agent = null;
    if (agentCode) {
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
