/**
 * 간단한 로거 — 프로덕션에선 조용히, 개발에선 콘솔 출력
 */
const isDev = import.meta.env?.DEV ?? (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

export const log = {
  debug: (...args) => { if (isDev) console.log(...args); },
  info: (...args) => { if (isDev) console.info(...args); },
  warn: (...args) => { if (isDev) console.warn(...args); },
  error: (...args) => { console.error(...args); }, // error는 프로덕션에서도 필요
};
