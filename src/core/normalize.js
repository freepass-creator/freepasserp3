/**
 * normalize.js — 표시 전 값 통일 헬퍼
 *
 * 사용자가 입력한 값(또는 v1에서 넘어온 레거시 값)이 제각각일 때
 * 렌더링 직전에 정규화하여 UI 에서 동일하게 보이도록 함.
 *
 * 데이터 자체는 건드리지 않음(display-only). 저장 시 정규화하려면
 * 저장 경로에서도 이 함수를 호출하면 됨.
 */

/** 상품구분 — 재렌트/재구독 등 레거시를 중고렌트/중고구독으로 통일 */
export function normalizeProductType(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const MAP = {
    '재렌트': '중고렌트',
    '재구독': '중고구독',
    '리스': '중고렌트',
    // 이미 표준형이면 그대로
  };
  return MAP[s] || s;
}

/** 연식 — YY / YY년 / YY년식 / 'YY / YYYY 등 → 4자리 YYYY 문자열 */
export function normalizeYear(raw) {
  if (raw === 0 || raw === '0') return '';
  if (!raw) return '';
  const s = String(raw).replace(/[^\d]/g, '');
  if (!s) return '';
  if (s.length === 2) {
    const n = parseInt(s, 10);
    // 00~현재년+1 → 20YY, 나머지 → 19YY
    const thisYear2 = new Date().getFullYear() % 100;
    return n <= thisYear2 + 1 ? `20${s}` : `19${s}`;
  }
  if (s.length === 4) return s;
  // 6자리 이상(YYYYMM 등) → 앞 4자리만
  return s.slice(0, 4);
}
