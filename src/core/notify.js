/**
 * core/notify.js — 알림 (Aligo SMS / 알림톡) 발송 헬퍼
 *
 * sendAlimtalk 실패해도 비즈니스 플로우는 안 막힘 (catch 무시).
 * 수신자 계산은 store 의존 — 공급사 연락처는 partners, 관리자 연락처는 users.
 */
import { store } from './store.js';
import { sendAlimtalk } from './alimtalk.js';

export function getProviderTel(providerCode) {
  if (!providerCode) return null;
  const partner = (store.partners || []).find(p =>
    p.partner_code === providerCode || p.company_code === providerCode || p._key === providerCode
  );
  return partner?.phone || partner?.contact_phone || partner?.manager_phone || null;
}

export function getAdminTels() {
  return (store.users || [])
    .filter(u => u.role === 'admin' && !u._deleted && u.is_active !== false && u.phone)
    .map(u => u.phone);
}

/* 공급사 + 모든 관리자에게 동시 발송 (중복 제거). */
export async function notifyProviderAndAdmin({ template, providerCode, message, subject }) {
  const tels = [getProviderTel(providerCode), ...getAdminTels()].filter(Boolean);
  if (!tels.length) return;
  const unique = [...new Set(tels)];
  await Promise.all(unique.map(tel =>
    sendAlimtalk({ template, tel, message, subject }).catch(() => null)
  ));
}
