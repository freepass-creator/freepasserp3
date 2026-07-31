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
        hits.push({ key, code, partner_code: p.partner_code, company_code: p.company_code, partner_name: p.partner_name, company_name: p.company_name });
      }
    }
    res.json({ ok: true, hits });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
