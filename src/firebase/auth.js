import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail
} from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { auth, db } from './config.js';
import { store } from '../core/store.js';

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
        const snap = await get(ref(db, `users/${user.uid}`));
        const profile = snap.val() || {};
        store.currentUser = { uid: user.uid, email: user.email, ...profile };
      } else {
        store.currentUser = null;
      }
      store.authReady = true;
      if (!resolved) { resolved = true; resolve(store.currentUser); }
    });
  });
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signup(email, password) {
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
