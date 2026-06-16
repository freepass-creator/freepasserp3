/**
 * push.js — FCM 웹 푸시 (앱 닫혀있어도 채팅 알림)
 *
 * 흐름:
 *   1. initPush()  — 로그인 후/알림권한 허용 후 호출. SW 등록 → FCM 토큰 발급 →
 *                    users/{uid}/fcm_tokens/{token} 저장. (기기마다 1 토큰)
 *   2. notifyNewMessage(roomId, text) — 메시지 전송 직후 호출. /api/notify-chat 로
 *                    POST → 서버가 상대방(+관리자) 토큰에 푸시 발송.
 *
 * 포그라운드(탭 보는 중) 알림은 chat-notif.js 가 처리 → 여기선 토큰/전송만 담당.
 *  iOS 는 16.4+ 그리고 "홈 화면에 추가"(PWA) 상태에서만 웹 푸시 지원 → isSupported() 가 걸러줌.
 */
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { ref, set } from 'firebase/database';
import app, { db, auth } from '../firebase/config.js';

/* ⚠️ Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → "웹 푸시 인증서"(Web Push certificates)
 *  의 키 쌍(Key pair) 값을 그대로 붙여넣어야 함. 없으면 토큰 발급 실패(푸시 동작 안 함). */
const VAPID_KEY = '__PASTE_WEB_PUSH_VAPID_KEY_HERE__';

let _registered = false;

export async function initPush() {
  try {
    if (_registered) return;
    if (!VAPID_KEY || VAPID_KEY.startsWith('__PASTE')) {
      console.warn('[push] VAPID 키 미설정 — 푸시 토큰 발급 생략');
      return;
    }
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (!(await isSupported())) return;            // 비지원 브라우저(구형 iOS 등)
    if (Notification.permission !== 'granted') return;   // 권한은 onboard/설정에서 받음

    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await set(ref(db, `users/${uid}/fcm_tokens/${token}`), {
      ua: (navigator.userAgent || '').slice(0, 120),
      updated_at: Date.now(),
    });
    _registered = true;

    // 포그라운드 메시지 — chat-notif 가 이미 알림 처리 → 여기선 무시(중복 방지)
    onMessage(messaging, () => {});
  } catch (e) {
    console.warn('[push] init 실패:', e?.message || e);
  }
}

/* 메시지 전송 직후 호출 — 서버에 푸시 발송 요청. 실패해도 채팅 자체엔 영향 없음(비차단). */
export function notifyNewMessage(roomId, text) {
  try {
    const user = auth.currentUser;
    if (!user || !roomId) return;
    user.getIdToken().then((idToken) => {
      fetch('/api/notify-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, text: String(text || '').slice(0, 200), idToken }),
      }).catch(() => {});
    }).catch(() => {});
  } catch (e) {
    console.warn('[push] notify 실패:', e?.message || e);
  }
}
