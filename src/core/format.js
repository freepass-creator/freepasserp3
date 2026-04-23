/**
 * 공통 포맷/HTML 유틸
 */

/** 세부모델에 이미 포함된 토큰을 트림에서 제거해서 반환.
 *  예: sub="아반떼 (CN7)", trim="아반떼 CN7 인스퍼레이션" → "인스퍼레이션"
 *  한글/영문/숫자 단위로 토큰화 후 대소문자 무시 비교. */
const _WORD_RE = /[A-Za-z]+|[0-9]+(?:\.[0-9]+)?|[가-힯]+/g;
export function trimMinusSub(sub, trim) {
  const raw = String(trim || '').trim();
  if (!raw) return '';
  if (!sub) return raw;
  const subSet = new Set((String(sub).match(_WORD_RE) || []).map(t => t.toLowerCase()));
  const tokens = raw.match(_WORD_RE) || [];
  const out = tokens.filter(t => !subSet.has(t.toLowerCase())).join(' ');
  return out;
}

/** 금액 → 만원 단위 (예: 450000 → "45만") */
export function fmtMoney(v) {
  if (!v) return '-';
  const n = Number(v);
  if (isNaN(n)) return v;
  return n >= 10000 ? Math.round(n / 10000) + '만' : n.toLocaleString();
}

/** 금액 → 원 단위 (예: 450000 → "450,000원") */
export function fmtWon(v) {
  if (!v) return '-';
  const n = Number(v);
  if (isNaN(n)) return v;
  return n.toLocaleString() + '원';
}

/** 금액 → 풀 텍스트 (450000 → "45만원", 5000 → "5,000원") — 모바일용 */
export function fmtMoneyFull(v) {
  if (!v) return '-';
  const n = Number(v);
  if (isNaN(n)) return v;
  return n >= 10000 ? Math.round(n / 10000) + '만원' : n.toLocaleString() + '원';
}

/** 타임스탬프 → 상대 시간 (방금 / N분 / 시:분 / 어제 / M/D) */
export function fmtTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return '방금';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분`;
  const d = new Date(ts);
  if (diff < 86400000) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff < 172800000) return '어제';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 빈 상태 HTML (아이콘 + 텍스트, 공용 .empty-state 클래스 사용) */
export function empty(t, icon = 'ph-tray') {
  return `<div class="empty-state"><i class="ph ${icon}"></i><p>${t}</p></div>`;
}

/** 읽기전용 계약 필드 HTML */
export function cField(l, v) {
  return `<div class="contract-field"><span class="contract-field-label">${l}</span><span class="contract-field-value">${v || '-'}</span></div>`;
}
