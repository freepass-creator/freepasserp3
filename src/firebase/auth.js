import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { auth, db } from './config.js';
import { store } from '../core/store.js';

// 명시적 LOCAL persistence — 브라우저 새로고침 / 재시작 후에도 로그인 유지
// 1s timeout 으로 race — Firebase 가 어떤 이유로든 settle 안 시켜도 로그인 진행
const _persistenceReady = Promise.race([
  setPersistence(auth, browserLocalPersistence).catch(e => console.warn('[auth] setPersistence 실패:', e?.message || e)),
  new Promise(resolve => setTimeout(resolve, 1000)),
]);

/* Firebase auth 관련 localStorage·sessionStorage 강제 정리 (stale 토큰 복구용).
 *  로그인 form 의 [초기화] 버튼 또는 initAuth 타임아웃 시 호출. */
function nukeFirebaseStorage() {
  try {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('firebase:') || k.startsWith('@firebase/')) localStorage.removeItem(k);
    });
    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith('firebase:') || k.startsWith('@firebase/')) sessionStorage.removeItem(k);
    });
  } catch (_) {}
}
window.nukeFirebaseStorage = nukeFirebaseStorage;

/** Watch auth state and load user profile
 *  - Firebase는 토큰 갱신 시에도 onAuthStateChanged emit → UID 변경 시에만 profile 재로드
 *  - Promise는 최초 1회만 resolve (재호출 무시)
 */
export function initAuth() {
  return new Promise((resolve) => {
    let resolved = false;
    let lastUid = null;

    onAuthStateChanged(auth, async (user) => {
      const uid = user?.uid || null;
      if (uid === lastUid && uid !== null) {
        // 같은 유저 재emit (토큰 갱신 등) — store 안 건드림
        if (!resolved) { resolved = true; resolve(store.currentUser); }
        return;
      }
      lastUid = uid;
      if (user) {
        // 첫 로그인 직후 reload 케이스: auth 토큰이 db SDK 에 완전히 attach 되기 전 get() 이 fire 되어
        // 빈 객체를 받아 role 누락으로 판정되는 race 방어 — null/role 없으면 한 번 재시도
        let profile = (await get(ref(db, `users/${user.uid}`))).val() || {};
        if (!profile.role) {
          await new Promise(r => setTimeout(r, 300));
          profile = (await get(ref(db, `users/${user.uid}`))).val() || profile;
        }
        // ⚠ Firebase rule 의 auth.uid 매칭용 — profile 에 uid 필드가 다른 값으로 들어있으면
        //   여기서 덮어쓰여 PERMISSION_DENIED 발생. spread 뒤에 uid/email 명시.
        store.currentUser = { ...profile, uid: user.uid, email: user.email };
      } else {
        store.currentUser = null;
      }
      store.authReady = true;
      if (!resolved) { resolved = true; resolve(store.currentUser); }
    });
  });
}

export async function login(email, password) {
  await _persistenceReady;
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signup(email, password) {
  await _persistenceReady;
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logout() {
  await signOut(auth);
  store.currentUser = null;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}
