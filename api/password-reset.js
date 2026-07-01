/**
 * /api/password-reset — 커스텀 비밀번호 재설정 메일 발송
 * POST { email }
 * Firebase Admin으로 리셋 링크 생성 → Gmail SMTP로 한글 브랜딩 메일 발송
 */
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';

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
      try { resolve(Buffer.concat(chunks).toString('utf-8') ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  let body;
  try { body = await readBody(req); } catch { return res.status(400).json({ ok: false, error: 'invalid body' }); }

  const { email } = body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'email required' });

  try {
    await getAdmin();

    const firebaseLink = await admin.auth().generatePasswordResetLink(email, {
      url: 'https://www.freepasserp.com',
    });

    // Firebase 도메인 → 프리패스 도메인으로 교체 (vercel.json에서 /auth/action → Firebase로 프록시)
    const resetLink = firebaseLink.replace(
      'https://freepasserp3.firebaseapp.com/__/auth/action',
      'https://www.freepasserp.com/auth/action'
    );

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"프리패스 ERP" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: '[프리패스] 비밀번호 재설정 안내',
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
          <h2 style="margin:0 0 8px;">비밀번호 재설정</h2>
          <p style="color:#555;margin:0 0 24px;line-height:1.6;">
            프리패스 ERP 비밀번호 재설정을 요청하셨습니다.<br>
            아래 버튼을 클릭해 새 비밀번호를 설정하세요.
          </p>
          <a href="${resetLink}"
             style="display:inline-block;background:#2563eb;color:#fff;padding:13px 28px;border-radius:7px;text-decoration:none;font-weight:600;font-size:15px;">
            비밀번호 재설정
          </a>
          <p style="color:#999;font-size:12px;margin-top:28px;line-height:1.6;">
            본인이 요청하지 않은 경우 이 메일을 무시하세요.<br>
            링크는 1시간 후 만료됩니다.
          </p>
          <p style="color:#ccc;font-size:11px;margin-top:4px;">
            버튼이 작동하지 않으면 아래 주소를 브라우저에 붙여넣으세요:<br>
            <span style="color:#2563eb;">${resetLink}</span>
          </p>
          <hr style="margin:28px 0;border:none;border-top:1px solid #eee;">
          <p style="color:#aaa;font-size:12px;margin:0;">프리패스 ERP · freepasserp.com</p>
        </div>
      `,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[password-reset]', err);
    if (err.code === 'auth/user-not-found') return res.json({ ok: true }); // 이메일 열거 방지
    res.status(500).json({ ok: false, error: err.message });
  }
}
