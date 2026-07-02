/**
 * /api/signup-profile — 가입 후 사용자 프로필 저장 (Firebase Admin 사용 — Rules 우회)
 * POST { name, phone, company_name, business_no }
 * Authorization: Bearer <Firebase ID Token>
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

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf-8');
        resolve(s ? JSON.parse(s) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // ID 토큰 검증
  const auth = req.headers.authorization || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!idToken) return res.status(401).json({ ok: false, error: 'token required' });

  let body;
  try { body = await readBody(req); } catch { return res.status(400).json({ ok: false, error: 'invalid body' }); }

  try {
    await getAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || '';

    const db = admin.database();

    // user_code 원자적 발급
    const seqRef = db.ref('counters/user_code_seq');
    const seq = await seqRef.transaction(cur => (cur || 0) + 1);
    const user_code = `U${String(seq.snapshot.val()).padStart(4, '0')}`;

    // 사업자번호로 partner 매칭
    const bizNo = String(body.business_no || '').replace(/\D/g, '');
    let role = 'agent', company_code = 'SP999', agent_channel_code = '', matched_partner_code = null;

    if (bizNo) {
      const partnersSnap = await db.ref('partners').once('value');
      const partners = partnersSnap.val() || {};
      for (const [k, p] of Object.entries(partners)) {
        if (!p || p._deleted) continue;
        const pn = String(p.business_number || '').replace(/\D/g, '');
        if (pn && pn === bizNo) {
          matched_partner_code = p.partner_code || k;
          const pt = p.partner_type || '';
          if (/영업|sales/i.test(pt)) {
            role = 'agent'; company_code = matched_partner_code; agent_channel_code = matched_partner_code;
          } else if (/공급|provider/i.test(pt)) {
            role = 'provider'; company_code = matched_partner_code;
          }
          break;
        }
      }
    }

    await db.ref(`users/${uid}`).set({
      uid,
      email,
      name: body.name || '',
      phone: body.phone || '',
      company_name: body.company_name || '',
      business_no: bizNo,
      user_code,
      role,
      company_code,
      agent_channel_code,
      matched_partner_code,
      status: 'active',
      created_at: Date.now(),
    });

    res.json({ ok: true, user_code, role, company_code });
  } catch (err) {
    console.error('[signup-profile]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
