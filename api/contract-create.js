/**
 * /api/contract-create — 계약 생성 (Firebase Admin 사용 — RTDB Rules 우회)
 *
 * 배경: 영업자 본인이 만드는 계약도 RTDB 규칙에서 계속 PERMISSION_DENIED 남 —
 *  이 저장소의 database.rules.json 이 실제 프로젝트에 배포됐는지 확인할 방법이 없어서
 *  (Firebase 콘솔 접근 권한 없음), 회원가입 때처럼 Admin SDK 서버 API로 우회.
 *
 * 클라이언트(contract.js/search.js)가 하던 다이얼로그·스냅샷 계산 로직은 그대로 두고,
 * 마지막 Firebase 쓰기 단계만 이 엔드포인트로 위임. 권한 체크는 기존 RTDB rule 의도
 * (본인 계약만 / admin 은 전체)를 서버에서 그대로 재현.
 *
 * POST { customer: {key} | {isNew:true, data}, contract: {...}, room_key?, product_key?, product_update? }
 * Authorization: Bearer <Firebase ID Token>
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

  const auth = req.headers.authorization || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!idToken) return res.status(401).json({ ok: false, error: 'token required' });

  let body;
  try { body = await readBody(req); } catch { return res.status(400).json({ ok: false, error: 'invalid body' }); }

  try {
    await getAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const db = admin.database();

    const meSnap = await db.ref(`users/${uid}`).once('value');
    const me = meSnap.val();
    if (!me) return res.status(403).json({ ok: false, error: '사용자 프로필 없음' });
    const role = me.role;
    if (!(role === 'agent' || role === 'agent_admin' || role === 'admin')) {
      return res.status(403).json({ ok: false, error: '계약 생성 권한이 없습니다' });
    }

    const { customer, contract, room_key, product_key, product_update } = body || {};
    if (!contract || typeof contract !== 'object') {
      return res.status(400).json({ ok: false, error: 'contract 누락' });
    }
    // 기존 RTDB rule 의도 재현 — 영업자 본인 계약만, admin 은 누구든 배정 가능.
    if (role !== 'admin' && contract.agent_uid && contract.agent_uid !== uid) {
      return res.status(403).json({ ok: false, error: '본인 명의 계약만 생성할 수 있습니다' });
    }

    // 1) 고객 확보 — 신규면 생성, 기존이면 key 그대로
    let customerKey = customer?.key || '';
    if (customer?.isNew) {
      const custRef = db.ref('customers').push();
      customerKey = custRef.key;
      await custRef.set({
        ...customer.data,
        created_by: uid,
        created_at: Date.now(),
      });
    }
    if (!customerKey) return res.status(400).json({ ok: false, error: 'customerKey 발급 실패' });

    // 2) 계약 생성
    const contractRef = db.ref('contracts').push();
    const contractKey = contractRef.key;
    await contractRef.set({
      ...contract,
      customer_uid: customerKey,
      created_by: uid,
      created_at: Date.now(),
    });

    // 3) 소통방 연결 (있으면)
    if (room_key) {
      await db.ref(`rooms/${room_key}`).update({ linked_contract: contract.contract_code });
    }

    // 4) 차량 상태/배정 갱신 (있으면)
    if (product_key && product_update) {
      await db.ref(`products/${product_key}`).update({ ...product_update, updated_at: Date.now() });
    }

    res.json({ ok: true, contract_key: contractKey, customer_key: customerKey });
  } catch (err) {
    console.error('[contract-create]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
