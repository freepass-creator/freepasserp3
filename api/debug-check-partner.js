/**
 * 임시 디버그용 — 신규 공급사(이안카) 온보딩 전 partners 컬렉션에 이미 등록돼있는지,
 * 있다면 무슨 코드인지 확인. 렌트존/연카 사고 재발 방지(코드 임의 배정 금지).
 * 확인 끝나면 삭제.
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

    if (req.method === 'POST') {
      const RP031_KEY = 'RP031';
      const existing = await db.ref(`partners/${RP031_KEY}`).once('value');
      if (existing.exists()) return res.json({ ok: false, error: 'RP031 이미 존재함', data: existing.val() });
      await db.ref(`partners/${RP031_KEY}`).set({
        partner_code: 'RP031',
        partner_name: '(주)이안카',
        partner_type: '공급사',
        account_number: '우리은행 1005-703-740308 (주)이안카',
        created_at: Date.now(),
        created_by: 'sync_onboarding',
      });
      return res.json({ ok: true, created: 'RP031' });
    }

    const snap = await db.ref('partners').once('value');
    const val = snap.val() || {};
    const hits = [];
    const allCodes = new Set();
    for (const [key, p] of Object.entries(val)) {
      const code = p.partner_code || p.company_code || key;
      allCodes.add(code);
      const name = p.partner_name || p.company_name || '';
      if (String(name).includes('이안') || key.includes('이안')) {
        hits.push({ key, code, partner_name: p.partner_name, company_name: p.company_name, _deleted: !!p._deleted });
      }
    }
    const rpNums = [...allCodes].map(c => { const m = /^RP0*(\d+)$/.exec(c); return m ? Number(m[1]) : null; }).filter(n => n != null);
    const maxRp = Math.max(0, ...rpNums);

    // policies 컬렉션도 확인 — 렌트존 사고가 정책 쪽에 이미 잘못된 코드가 박혀있어서 난 문제였음
    const polSnap = await db.ref('policies').once('value');
    const polVal = polSnap.val() || {};
    const polHits = [];
    for (const [key, pol] of Object.entries(polVal)) {
      const name = pol.partner_name || pol.provider_name || pol.policy_name || '';
      if (String(name).includes('이안')) {
        polHits.push({ key, policy_name: pol.policy_name, provider_company_code: pol.provider_company_code, partner_code: pol.partner_code, _deleted: !!pol._deleted });
      }
    }

    // products 컬렉션도 확인 — 혹시 이미 수기로 등록된 이안카 매물이 있는지(그 경우 이미 코드 있을 수 있음)
    const prodSnap = await db.ref('products').once('value');
    const prodVal = prodSnap.val() || {};
    const prodHits = [];
    for (const [key, p] of Object.entries(prodVal)) {
      if (p._deleted) continue;
      const memo = `${p.partner_memo || ''} ${p.location || ''} ${p.account_number || ''}`;
      if (memo.includes('이안')) {
        prodHits.push({ key, car_number: p.car_number, provider_company_code: p.provider_company_code, partner_code: p.partner_code, source: p.source });
      }
    }

    res.json({ ok: true, partnerHits: hits, policyHits: polHits, productHits: prodHits, maxRpCode: `RP${String(maxRp).padStart(3,'0')}`, nextRpCode: `RP${String(maxRp+1).padStart(3,'0')}`, totalPartners: Object.keys(val).length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
