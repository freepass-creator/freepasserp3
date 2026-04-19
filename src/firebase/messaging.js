/**
 * FCM Push Notifications
 */
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import app from './config.js';
import { setRecord } from './db.js';
import { store } from '../core/store.js';
import { showToast } from '../core/toast.js';

const VAPID_KEY = 'BEzn7JeQVD6bj8W8x-jP0DP6G8OUP1ypJnJUK2BLaGDKOWOcE3JFMRdBNsOF8OBUQO7yF6VnFdBF0PXGFPd0aM';

let messaging = null;

function getMsg() {
  if (!messaging) {
    try { messaging = getMessaging(app); } catch (e) { return null; }
  }
  return messaging;
}

export async function requestNotificationPermission() {
  const msg = getMsg();
  if (!msg) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  try {
    const token = await getToken(msg, { vapidKey: VAPID_KEY });
    if (token && store.currentUser?.uid) {
      await setRecord(`fcm_tokens/${store.currentUser.uid}/${token}`, {
        created_at: Date.now(),
        platform: 'web',
        user_agent: navigator.userAgent.slice(0, 200),
      });
    }
    return token;
  } catch (e) {
    console.warn('[FCM] token error', e);
    return null;
  }
}

export function onForegroundMessage(callback) {
  const msg = getMsg();
  if (!msg) return;
  onMessage(msg, (payload) => {
    const { title, body } = payload.notification || {};
    if (title) showToast(`${title}: ${body || ''}`, 'info');
    callback?.(payload);
  });
}
