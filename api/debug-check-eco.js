/**
 * 임시 디버그용 — 신규 공급사(에코렌트카) 온보딩 전 기존 등록 흔적 확인.
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
      const KEY = 'RP032';
      const existing = await db.ref(`partners/${KEY}`).once('value');
      if (existing.exists()) return res.json({ ok: false, error: 'RP032 이미 존재함', data: existing.val() });
      await db.ref(`partners/${KEY}`).set({
        partner_code: KEY,
        partner_name: '에코렌트카',
        partner_type: '공급사',
        created_at: Date.now(),
        created_by: 'sync_onboarding',
      });
      return res.json({ ok: true, created: KEY });
    }

    const partnersSnap = await db.ref('partners').once('value');
    const partnersVal = partnersSnap.val() || {};
    const partnerHits = [];
    const allCodes = new Set();
    for (const [key, p] of Object.entries(partnersVal)) {
      const code = p.partner_code || p.company_code || key;
      allCodes.add(code);
      const name = p.partner_name || p.company_name || '';
      if (String(name).includes('에코') || key.includes('에코')) {
        partnerHits.push({ key, code, partner_name: p.partner_name, _deleted: !!p._deleted });
      }
    }
    const rpNums = [...allCodes].map(c => { const m = /^RP0*(\d+)$/.exec(c); return m ? Number(m[1]) : null; }).filter(n => n != null);
    const maxRp = Math.max(0, ...rpNums);

    const polSnap = await db.ref('policies').once('value');
    const polVal = polSnap.val() || {};
    const policyHits = [];
    for (const [key, pol] of Object.entries(polVal)) {
      const name = pol.partner_name || pol.provider_name || pol.policy_name || '';
      if (String(name).includes('에코')) {
        policyHits.push({ key, policy_name: pol.policy_name, provider_company_code: pol.provider_company_code, _deleted: !!pol._deleted });
      }
    }

    const prodSnap = await db.ref('products').once('value');
    const prodVal = prodSnap.val() || {};
    const productHits = [];
    for (const [key, p] of Object.entries(prodVal)) {
      if (p._deleted) continue;
      const memo = `${p.partner_memo || ''} ${p.location || ''} ${p.account_number || ''}`;
      if (memo.includes('에코')) {
        productHits.push({ key, car_number: p.car_number, provider_company_code: p.provider_company_code, source: p.source });
      }
    }

    // SA렌터카(PT-0023) 계좌와 겹치는지 명시 확인
    const sarentPartner = Object.entries(partnersVal).find(([k, p]) => (p.partner_code || k) === 'PT-0023');

    res.json({
      ok: true, partnerHits, policyHits, productHits,
      maxRpCode: `RP${String(maxRp).padStart(3,'0')}`, nextRpCode: `RP${String(maxRp+1).padStart(3,'0')}`,
      sarentPartnerRecord: sarentPartner ? { key: sarentPartner[0], ...sarentPartner[1] } : null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
