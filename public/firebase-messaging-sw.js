/**
 * firebase-messaging-sw.js — FCM 백그라운드 푸시 핸들러
 *
 * 앱(ERP 탭)이 닫혀있거나 백그라운드일 때 새 채팅 메시지 푸시를 받아 OS 알림으로 표시.
 *  - 포그라운드(탭 보는 중)일 때는 chat-notif.js 가 처리 → 여기선 background 만.
 *  - Vite 번들 대상이 아니므로(정적 파일) compat SDK 를 importScripts 로 직접 로드.
 *  - config 는 클라이언트 config.js 와 동일해야 함(messagingSenderId/appId 일치 필수).
 *
 * 별도 SW — PWA 캐시 sw.js 와 공존. getToken({serviceWorkerRegistration}) 으로 이 SW 를 지정.
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyA0q_6yo9YRkpNeNaawH1AFPZx1IMgj-dY',
  authDomain: 'freepasserp3.firebaseapp.com',
  projectId: 'freepasserp3',
  storageBucket: 'freepasserp3.firebasestorage.app',
  messagingSenderId: '172664197996',
  appId: '1:172664197996:web:91b7219f22eb68b5005949',
});

const messaging = firebase.messaging();

/* 백그라운드 메시지 → OS 알림. 서버(api/notify-chat)가 data 페이로드로 보냄
 *  (notification 페이로드 대신 data-only → 표시를 우리가 통제, 중복 알림 방지). */
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const title = d.title || '새 메시지';
  const options = {
    body: d.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: d.roomId || 'freepass-chat',   // 같은 방 알림은 합침
    renotify: true,
    data: { roomId: d.roomId || '', url: d.url || '/' },
  };
  self.registration.showNotification(title, options);
});

/* 알림 클릭 → 이미 열린 ERP 탭이 있으면 focus, 없으면 새 창으로 해당 방 열기. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId || '';
  const target = roomId ? `/?room=${encodeURIComponent(roomId)}` : '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        if ('navigate' in w && roomId) { try { await w.navigate(target); } catch {} }
        return w.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
