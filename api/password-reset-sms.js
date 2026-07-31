/**
 * /api/password-reset-sms — 비밀번호 재설정 링크를 이메일 대신 SMS로 발송
 *
 * 배경: Firebase Auth 기본 재설정 메일은 구글 공유 발신 인프라를 써서 네이버/다음 등
 *  국내 메일에서 스팸으로 강하게 필터링돼 도착 안 하는 경우가 많음 (영업자 실제 피해 사례).
 *  Firebase 콘솔 접근 권한이 없어 발신 도메인 자체를 못 고치므로, 이미 구축된 Aligo SMS
 *  인프라로 재설정 링크를 문자로 대신 보냄 (카카오 알림톡과 달리 일반 SMS는 사전 템플릿
 *  승인 불필요).
 *
 * POST { email }
 * 보안: 등록 안 된 이메일이어도 항상 { ok:true } 로 응답 (계정 존재 여부 노출 방지 — 표준 관례)
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

  let body;
  try { body = await readBody(req); } catch { return res.status(400).json({ ok: false, error: 'invalid body' }); }
  const email = String(body?.email || '').trim();
  if (!email) return res.status(400).json({ ok: false, error: 'email required' });

  try {
    await getAdmin();

    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch {
      // 미등록 이메일 — 존재 여부 노출 방지 위해 성공처럼 응답
      return res.json({ ok: true });
    }

    const db = admin.database();
    const profileSnap = await db.ref(`users/${userRecord.uid}`).once('value');
    const phone = profileSnap.val()?.phone;
    if (!phone) return res.status(400).json({ ok: false, error: '등록된 휴대폰 번호가 없습니다 — 관리자에게 문의하세요' });

    const link = await admin.auth().generatePasswordResetLink(email);

    const apiKey = process.env.ALIGO_API_KEY;
    const userId = process.env.ALIGO_USER_ID;
    const senderTel = process.env.ALIGO_SENDER_TEL;
    if (!apiKey || !userId || !senderTel) {
      console.warn('[password-reset-sms] ALIGO_* env not configured');
      return res.status(500).json({ ok: false, error: 'SMS 발송 설정이 안 돼있습니다' });
    }

    const tel = String(phone).replace(/[^\d]/g, '');
    const msg = `[Freepass] 비밀번호 재설정 링크입니다.\n${link}\n(본인 요청이 아니면 무시하세요)`;
    const form = new URLSearchParams();
    form.append('key', apiKey);
    form.append('user_id', userId);
    form.append('sender', senderTel);
    form.append('receiver', tel);
    form.append('msg', msg);
    form.append('msg_type', 'LMS');   // 링크 포함해 80바이트 넘을 수 있어 장문(LMS) 고정

    const r = await fetch('https://apis.aligo.in/send/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await r.json().catch(() => ({}));
    const ok = String(data.result_code) === '1';
    if (!ok) {
      console.error('[password-reset-sms] aligo send failed', data);
      return res.status(500).json({ ok: false, error: data.message || 'SMS 발송 실패' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[password-reset-sms]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
