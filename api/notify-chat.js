/**
 * /api/notify-chat — 새 채팅 메시지 FCM 푸시 발송 (Vercel Serverless)
 *
 * 클라이언트(push.js)가 메시지 전송 직후 POST. 흐름:
 *   1. idToken 검증(admin.auth) → 발신자 uid (로그인 유저만 발송 가능)
 *   2. rooms/{roomId} 읽어 상대편(영업↔공급) + 관리자(role=admin) 수신자 uid 산출
 *   3. users/{uid}/fcm_tokens 토큰 모아 data-only 멀티캐스트 발송
 *   4. 무효 토큰(만료/해지)은 자동 정리
 *
 * 보안: 발신자는 idToken 으로 인증. 본인 메시지 푸시 못 받게 발신자 uid 는 수신 대상에서 제외.
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

const ROLE_LABEL = { agent: '영업자', agent_admin: '영업자', provider: '공급사', admin: '관리자' };

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, message: 'POST only' })); }

  try {
    let body = '';
    req.on('data', (c) => body += c);
    await new Promise((r) => req.on('end', r));
    const { roomId, text, idToken } = JSON.parse(body || '{}');
    if (!roomId || !idToken) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, message: 'roomId, idToken 필요' })); }

    const app = await getAdmin();
    const db = admin.database(app);

    // 1) 발신자 인증
    let senderUid = '';
    try {
      const decoded = await admin.auth(app).verifyIdToken(idToken);
      senderUid = decoded.uid;
    } catch {
      res.statusCode = 401; return res.end(JSON.stringify({ ok: false, message: 'invalid idToken' }));
    }

    // 2) 방 + 유저 로드
    const room = (await db.ref(`rooms/${roomId}`).once('value')).val();
    if (!room) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, message: 'room not found' })); }
    const users = (await db.ref('users').once('value')).val() || {};

    const agentUid = room.agent_uid || '';
    const providerUid = room.provider_uid || '';
    const providerCompany = room.provider_company_code || '';

    // 수신 대상 uid 집합 — 상대편 + 모든 관리자, 발신자 제외
    const targets = new Set();
    const senderIsAgent = senderUid && senderUid === agentUid;
    const senderIsProvider = senderUid && senderUid === providerUid;

    if (!senderIsProvider) {
      // 공급사 측에 전달 — provider_uid 우선, 없으면 같은 회사코드 유저 전체
      if (providerUid) targets.add(providerUid);
      else if (providerCompany) {
        for (const [uid, u] of Object.entries(users)) {
          if (u && u.role === 'provider' && u.company_code === providerCompany) targets.add(uid);
        }
      }
    }
    if (!senderIsAgent && agentUid) targets.add(agentUid);    // 영업자 측
    for (const [uid, u] of Object.entries(users)) {           // 관리자(전체 모니터링)
      if (u && u.role === 'admin') targets.add(uid);
    }
    targets.delete(senderUid);

    if (!targets.size) return res.end(JSON.stringify({ ok: true, sent: 0, note: '수신 대상 없음' }));

    // 3) 토큰 수집 (token → 소유 uid)
    const tokenOwners = [];
    for (const uid of targets) {
      const toks = users[uid]?.fcm_tokens || {};
      for (const t of Object.keys(toks)) tokenOwners.push({ token: t, uid });
    }
    if (!tokenOwners.length) return res.end(JSON.stringify({ ok: true, sent: 0, note: '등록된 토큰 없음' }));

    const senderName = room.last_sender_name || users[senderUid]?.name
      || ROLE_LABEL[users[senderUid]?.role] || '새 메시지';
    const carName = [room.sub_model || room.model, room.car_number].filter(Boolean).join(' ');
    const title = carName ? `${senderName} · ${carName}` : senderName;
    const bodyText = String(text || room.last_message || '새 메시지').slice(0, 200);

    // 4) data-only 멀티캐스트 — 표시는 SW(firebase-messaging-sw.js)가 통제
    const message = {
      tokens: tokenOwners.map((t) => t.token),
      data: { title, body: bodyText, roomId: String(roomId), url: `/?room=${roomId}` },
      webpush: { headers: { Urgency: 'high' }, fcmOptions: { link: `/?room=${roomId}` } },
    };
    const resp = await admin.messaging(app).sendEachForMulticast(message);

    // 무효 토큰 정리
    const prune = [];
    resp.responses.forEach((r, i) => {
      const code = r.error?.code || '';
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        const { uid, token } = tokenOwners[i];
        prune.push(db.ref(`users/${uid}/fcm_tokens/${token}`).remove().catch(() => {}));
      }
    });
    await Promise.allSettled(prune);

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, sent: resp.successCount, failed: resp.failureCount, pruned: prune.length }));
  } catch (e) {
    console.error('[notify-chat]', e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, message: e.message || String(e) }));
  }
}
