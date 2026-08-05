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
    res.json({ ok: true, hits, maxRpCode: `RP${String(maxRp).padStart(3,'0')}`, nextRpCode: `RP${String(maxRp+1).padStart(3,'0')}`, totalPartners: Object.keys(val).length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
