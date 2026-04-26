/**
 * 카카오 알림톡 발송 — Vercel Serverless / Vite localServerless 호환
 * POST /api/alimtalk { template_code, receiver_tel, variables: { _message, _subject } }
 *
 * Aligo 알림톡 API: https://kakaoapi.aligo.in/akv10/alimtalk/send/
 *
 * Env (.env):
 *   ALIGO_API_KEY      Aligo 발급 API 키
 *   ALIGO_USER_ID      Aligo 계정 ID
 *   ALIGO_SENDER_KEY   카카오 비즈 발신프로필 키
 *   ALIGO_SENDER_TEL   발신자 전화번호 (-없이)
 *   ALIGO_FAILOVER     'sms' 면 알림톡 실패 시 SMS 자동 대체 (기본: 안 함)
 *   ALIGO_DRY_RUN      'true' 면 실제 발송 X — 콘솔 로그만 (개발/테스트용)
 *
 * 템플릿은 Aligo 콘솔에 사전 승인 필요. 미설정 환경에선 mock 응답 (ok:false, mock:true).
 */

/* dev (vite localServerless) 는 req.body 자동 파싱 안 함 → stream 직접 읽음 */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { res.status(400).json({ ok: false, error: 'invalid body' }); return; }

  const { template_code, receiver_tel, variables = {} } = body || {};
  if (!template_code || !receiver_tel) {
    res.status(400).json({ ok: false, error: 'template_code & receiver_tel required' });
    return;
  }

  const apiKey    = process.env.ALIGO_API_KEY;
  const userId    = process.env.ALIGO_USER_ID;
  const senderKey = process.env.ALIGO_SENDER_KEY;
  const senderTel = process.env.ALIGO_SENDER_TEL;
  const failover  = process.env.ALIGO_FAILOVER === 'sms' ? 'Y' : 'N';
  const dryRun    = process.env.ALIGO_DRY_RUN === 'true';

  // 환경 미설정 — mock 응답 (코드 흐름 안 막힘)
  if (!apiKey || !userId || !senderKey || !senderTel) {
    console.warn('[alimtalk] env not configured — skipping send');
    res.json({ ok: false, mock: true, reason: 'ALIGO_* env not configured' });
    return;
  }

  const tel = String(receiver_tel).replace(/[^\d]/g, '');
  const message = String(variables._message || '');
  const subject = String(variables._subject || '');

  if (dryRun) {
    console.log('[alimtalk DRY_RUN]', { template_code, tel, subject, message });
    res.json({ ok: true, dryRun: true, template_code, tel });
    return;
  }

  // Aligo 알림톡 발송
  const form = new URLSearchParams();
  form.append('apikey', apiKey);
  form.append('userid', userId);
  form.append('senderkey', senderKey);
  form.append('tpl_code', template_code);
  form.append('sender', senderTel);
  form.append('receiver_1', tel);
  form.append('subject_1', subject || ' ');   // Aligo 빈 subject 허용 안 함 → space
  form.append('message_1', message);
  if (failover === 'Y') {
    form.append('failover', 'Y');
    form.append('fsubject_1', subject || ' ');
    form.append('fmessage_1', message);
  }

  try {
    const r = await fetch('https://kakaoapi.aligo.in/akv10/alimtalk/send/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await r.json().catch(() => ({}));
    // Aligo 응답: code 0 = 성공 (계정 차감 1건), 음수 = 실패
    const ok = data.code === 0 || data.code === '0';
    res.json({ ok, ...data });
  } catch (e) {
    console.error('[alimtalk] aligo call failed', e);
    res.json({ ok: false, error: e.message || String(e) });
  }
}
