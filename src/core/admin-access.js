/**
 * 시스템 관리자(개발도구 접근) 화이트리스트.
 *
 * role='admin' 은 [관리자 페이지](외부상품 동기화 / 공지 등 운영)만 접근.
 * 개발도구(#dev — RTDB viewer / 일괄삭제 / 마이그레이션 등 위험 작업)는
 * 아래 이메일 화이트리스트(시스템 관리자)만 접근.
 *
 * ⚠️ 로그인 이메일 기준. 본인이 ERP 에 로그인하는 이메일만 남기세요.
 *    (둘 다 본인 계정이면 그대로 둬도 무방 — 잠금 방지용으로 둘 다 등록)
 */
export const SYSTEM_ADMIN_EMAILS = [
  'pyh@teamjpk.com',      // 대표 마스터 (2026-07-07)
  'dudguq@gmail.com',
  'jpkpyh@gmail.com',
  'tbag4783@gmail.com',
];

const _set = new Set(SYSTEM_ADMIN_EMAILS.map(e => e.trim().toLowerCase()));

/* 주어진 사용자(store.currentUser)가 시스템 관리자인지 — 개발도구 접근 가드 */
export function isSystemAdmin(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return !!email && _set.has(email);
}
