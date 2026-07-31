/**
 * 임시 디버그용 — Aligo SMS 발송 자체가 정상 동작하는지 확인하기 위한 1회성 테스트 엔드포인트.
 * 확인 끝나면 반드시 삭제.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const receiver = String(req.query?.tel || '').replace(/[^\d]/g, '');
  if (!receiver) return res.status(400).json({ ok: false, error: 'tel query param required' });

  const apiKey = process.env.ALIGO_API_KEY;
  const userId = process.env.ALIGO_USER_ID;
  const senderTel = process.env.ALIGO_SENDER_TEL;
  if (!apiKey || !userId || !senderTel) {
    return res.status(500).json({ ok: false, error: 'ALIGO_* env not configured', has: { apiKey: !!apiKey, userId: !!userId, senderTel: !!senderTel } });
  }

  const form = new URLSearchParams();
  form.append('key', apiKey);
  form.append('user_id', userId);
  form.append('sender', senderTel);
  form.append('receiver', receiver);
  form.append('msg', '[Freepass] SMS 발송 테스트입니다.');

  try {
    const r = await fetch('https://apis.aligo.in/send/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await r.json().catch(() => ({}));
    res.json({ ok: String(data.result_code) === '1', data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
