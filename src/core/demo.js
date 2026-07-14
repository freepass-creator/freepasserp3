/**
 * 영업자 체험(둘러보기) 모드 — 엔진
 *
 * 목적: 로그인 없이 "실제 영업자 화면"을 샘플 데이터로 만져보게 함 (영업파트너 모집용).
 *
 * ★ 안전 핵심: 데모 모드에서는 Firebase 를 절대 건드리지 않는다.
 *   - firebase/db.js 의 읽기/쓰기 함수가 isDemo() 일 때 이 파일의 인메모리 DB 로 우회.
 *   - 실제 고객·계약·개인정보 0% 노출. 쓰기는 메모리에서만 반영(새로고침 시 리셋).
 *   - 보안규칙·실로그인 흐름은 그대로 (데모는 별도 경로).
 */
import { buildDemoDB } from './demo-data.js';

const FLAG = 'fp_demo';

export function isDemo() {
  try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; }
}
export function enterDemo() {
  try { sessionStorage.setItem(FLAG, '1'); } catch {}
  location.reload();                       // 데모 경로로 재부팅
}
export function exitDemo() {
  try { sessionStorage.removeItem(FLAG); } catch {}
  location.replace(location.pathname);     // 플래그 제거 후 로그인 화면으로
}

/** 데모용 가짜 영업자 (role=agent). 실제 계정 아님. */
export const DEMO_USER = Object.freeze({
  uid: 'demo-agent',
  email: 'demo@freepass.example',
  role: 'agent',
  name: '체험 영업자',
  user_code: 'DEMO',
  company_code: 'DEMO',
  company_name: '프리패스 · 체험 모드',
  agent_channel_code: 'DEMO',
  position: '영업자',
  status: 'active',
  is_active: true,
  _demo: true,
});

/* ── 인메모리 DB (Firebase snapshot.val() 형태: { key: record }) ── */
let _mem = null;
const _subs = new Map();     // path → Set<{cb, options}>
let _seq = 1;

function mem() { if (!_mem) _mem = buildDemoDB(); return _mem; }

/** snapshot → 배열 (db.js snapshotToArray 와 동일 규격: _key 부여, _deleted 제외, created_at desc) */
function toArr(raw) {
  if (!raw) return [];
  return Object.entries(raw)
    .map(([key, v]) => (v && typeof v === 'object' ? { _key: key, ...v } : { _key: key, value: v }))
    .filter(it => !it._deleted)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

/* 경로 유틸 — 'messages/K1', 'rooms/K1/messages/M1' 같은 중첩 경로 지원 */
function getByPath(path) {
  const parts = String(path).split('/');
  let node = mem();
  for (const p of parts) { if (node == null) return null; node = node[p]; }
  return node ?? null;
}
function setByPath(path, value) {
  const parts = String(path).split('/');
  let node = mem();
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (node[p] == null || typeof node[p] !== 'object') node[p] = {};
    node = node[p];
  }
  node[parts[parts.length - 1]] = value;
}

/* 쓰기 후 알림 — 변경된 경로 자신 또는 그 조상(=구독 경로)인 워처를 모두 발화.
 *  (평면 topOf 브로드캐스트는 'messages/{roomId}' 같은 중첩 구독을 놓쳐 채팅이 죽던 버그 수정) */
function notifyWrite(writtenPath) {
  const wp = String(writtenPath);
  for (const [subPath, set] of _subs) {
    if (wp === subPath || wp.startsWith(subPath + '/')) {
      const raw = getByPath(subPath);
      set.forEach(({ cb, options }) => cb(options?.transform ? options.transform(raw) : toArr(raw)));
    }
  }
}

/* ── 읽기 ── */
export function demoWatchCollection(path, cb, options = {}) {
  if (!_subs.has(path)) _subs.set(path, new Set());
  const entry = { cb, options };
  _subs.get(path).add(entry);
  const raw = getByPath(path);
  cb(options.transform ? options.transform(raw) : toArr(raw));
  return () => { _subs.get(path)?.delete(entry); };
}
export function demoWatchRecord(path, cb) { cb(getByPath(path)); return () => {}; }
export async function demoFetchCollection(path) { return toArr(getByPath(path)); }
export async function demoFetchRecord(path) { return getByPath(path); }

/* ── 쓰기 (메모리에서만, 새로고침 시 리셋) ── */
export async function demoPush(path, data) {
  const key = `demo_${_seq++}`;
  const cur = getByPath(path);
  const bucket = (cur && typeof cur === 'object') ? cur : {};
  bucket[key] = { ...data, created_at: Date.now() };
  setByPath(path, bucket);
  notifyWrite(path);
  demoWriteNotice();
  return key;
}
export async function demoSet(path, data) {
  setByPath(path, { ...data, updated_at: Date.now() });
  notifyWrite(path);
  demoWriteNotice();
}
export async function demoUpdate(path, data) {
  const cur = getByPath(path) || {};
  setByPath(path, { ...cur, ...data, updated_at: Date.now() });
  notifyWrite(path);
  if (data?._deleted === undefined) demoWriteNotice();
}
export async function demoSoftDelete(path) {
  const cur = getByPath(path) || {};
  setByPath(path, { ...cur, _deleted: true, deleted_at: Date.now() });
  notifyWrite(path);
}

export async function demoIncrement(path, delta = 1) {
  const cur = Number(getByPath(path)) || 0;
  const next = cur + delta;
  setByPath(path, next);
  return next;
}
const _asArr = (cur) => Array.isArray(cur) ? cur.slice() : (cur && typeof cur === 'object' ? Object.values(cur) : []);
export async function demoAppendToArray(path, item, max = 0) {
  const arr = _asArr(getByPath(path));
  arr.push(item);
  const out = (max > 0 && arr.length > max) ? arr.slice(arr.length - max) : arr;
  setByPath(path, out);
  notifyWrite(path);
  return out;
}
export async function demoRemoveFromArray(path, value) {
  const arr = _asArr(getByPath(path));
  const matches = (it) => it === value || (it && typeof it === 'object' && (it.url === value || it.link === value));
  const i = arr.findIndex(matches);
  if (i >= 0) arr.splice(i, 1);
  setByPath(path, arr);
  notifyWrite(path);
  return arr;
}

/* 사용자 주도 쓰기 시 "실제 저장 안 됨" 안내 (연속 억제) */
let _noticeAt = 0;
function demoWriteNotice() {
  const now = Date.now();
  if (now - _noticeAt < 4000) return;
  _noticeAt = now;
  import('./toast.js').then(m => m.showToast?.('둘러보기 모드입니다 — 실제로 저장·발송되지 않아요', 'info')).catch(() => {});
}

/* ── 상단 데모 배너 ── */
export function mountDemoBanner() {
  if (document.getElementById('demoBanner')) return;
  const bar = document.createElement('div');
  bar.id = 'demoBanner';
  bar.innerHTML = `
    <span class="demo-banner-dot"></span>
    <b>둘러보기 모드</b>
    <span class="demo-banner-sub">실제 영업자 화면을 샘플 데이터로 체험 중입니다 · 저장·발송되지 않습니다</span>
    <span class="demo-banner-spacer"></span>
    <button type="button" id="demoJoinBtn" class="demo-banner-cta">영업파트너로 시작하기</button>
    <button type="button" id="demoExitBtn" class="demo-banner-exit">나가기</button>`;
  document.body.appendChild(bar);
  document.body.classList.add('has-demo-banner');
  if (!document.getElementById('demoBannerStyle')) {
    const st = document.createElement('style');
    st.id = 'demoBannerStyle';
    st.textContent = `
      #demoBanner{position:fixed;top:0;left:0;right:0;height:40px;z-index:99999;
        display:flex;align-items:center;gap:8px;padding:0 14px;
        background:linear-gradient(90deg,#1b2a4a,#2c4270);color:#fff;
        font-size:13px;font-family:inherit;box-shadow:0 1px 6px rgba(0,0,0,.25)}
      #demoBanner b{font-weight:700}
      .demo-banner-dot{width:8px;height:8px;border-radius:50%;background:#ffd34d;
        box-shadow:0 0 0 0 rgba(255,211,77,.7);animation:demoPulse 1.8s infinite}
      @keyframes demoPulse{0%{box-shadow:0 0 0 0 rgba(255,211,77,.6)}70%{box-shadow:0 0 0 7px rgba(255,211,77,0)}100%{box-shadow:0 0 0 0 rgba(255,211,77,0)}}
      .demo-banner-sub{opacity:.82;font-size:12px}
      @media(max-width:720px){.demo-banner-sub{display:none}}
      .demo-banner-spacer{flex:1}
      #demoBanner button{border:0;border-radius:6px;padding:6px 12px;font-size:12.5px;
        font-weight:600;cursor:pointer;font-family:inherit}
      .demo-banner-cta{background:#ffd34d;color:#1b2a4a}
      .demo-banner-cta:hover{background:#ffe08a}
      .demo-banner-exit{background:rgba(255,255,255,.14);color:#fff}
      .demo-banner-exit:hover{background:rgba(255,255,255,.26)}
      body.has-demo-banner{padding-top:40px !important}
      body.has-demo-banner .pt-shell,body.has-demo-banner .login-page{padding-top:0}
      /* 모바일 4탭 셸(.m-app: position fixed inset:0)은 body padding 무시 → 직접 40px 내림 */
      body.has-demo-banner .m-app{top:40px;height:calc(100dvh - 40px)}
    `;
    document.head.appendChild(st);
  }
  document.getElementById('demoExitBtn')?.addEventListener('click', exitDemo);
  document.getElementById('demoJoinBtn')?.addEventListener('click', exitDemo);  // 로그인/가입 화면으로
}
