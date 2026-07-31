/**
 * 임시 디버그용 — partners 컬렉션에서 RP011(렌트존) 관련 레코드 실제 값 확인.
 * 확인 끝나면 반드시 삭제.
 */
import admin from 'firebase-admin';

const DATABASE_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

let _appPromise = null;
function getAdmin() {
  if (_appPromise) return _appPromise;
  const p = (async () => {
    if (admin.apps.length) return admin.app();
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || '';
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 환경변수가 Vercel에 설정되지 않았습니다');
    const trimmed = raw.trim();
    const decoded = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
    const creds = JSON.parse(decoded);
    return admin.initializeApp({ credential: admin.credential.cert(creds), databaseURL: DATABASE_URL });
  })();
  _appPromise = p;
  p.catch(() => { _appPromise = null; });
  return p;
}

export default async function handler(req, res) {
  try {
    await getAdmin();
    const db = admin.database();
    const snap = await db.ref('partners').once('value');
    const val = snap.val() || {};
    const hits = [];
    for (const [key, p] of Object.entries(val)) {
      const code = p.partner_code || p.company_code || key;
      const name = p.partner_name || p.company_name || '';
      if (code === 'RP011' || String(name).includes('연카') || String(name).includes('렌트존')) {
        hits.push({ key, code, partner_code: p.partner_code, company_code: p.company_code, partner_name: p.partner_name, company_name: p.company_name, _deleted: p._deleted || false, created_at: p.created_at });
      }
    }

    const polSnap = await db.ref('policies').once('value');
    const polVal = polSnap.val() || {};
    const polHits = [];
    for (const [key, pol] of Object.entries(polVal)) {
      const name = pol.partner_name || pol.provider_name || '';
      const code = pol.provider_company_code || pol.partner_code || '';
      if (code === 'RP011' || String(name).includes('연카') || String(name).includes('렌트존')) {
        polHits.push({ key, policy_name: pol.policy_name, provider_company_code: pol.provider_company_code, partner_code: pol.partner_code, partner_name: pol.partner_name, _deleted: pol._deleted || false });
      }
    }

    const prodSnap = await db.ref('products').orderByChild('car_number').equalTo('188호3065').once('value');
    const prodVal = prodSnap.val() || {};
    const prodHits = Object.entries(prodVal).map(([key, p]) => ({
      key, car_number: p.car_number, provider_company_code: p.provider_company_code, partner_code: p.partner_code, product_type: p.product_type,
      _deleted: p._deleted || false, status: p.status, vehicle_status: p.vehicle_status, updated_at: p.updated_at, sheet_meta_source: p.sheet_meta?.source || null,
    }));

    res.json({ ok: true, partners: hits, policies: polHits, product_188호3065: prodHits });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
