/**
 * ui-helpers.js — v3 ERP 공통 UI 헬퍼 (페이지 모듈 분리 기반)
 *
 * 분류:
 *   - 문자열/포맷: esc, shortStatus, mapStatusDot, fmt*
 *   - 리스트: listBody, emptyState, renderRoomItem
 *   - 폼 필드: ffi, ffs
 *   - 저장 패턴: setHeadSave, flashSaved, bindFormSave
 *   - 정책 휴리스틱: needsReview
 */
import { updateRecord } from '../firebase/db.js';

/* ──────── 문자열·포맷 ──────── */
export function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 차량 상태 — 4개로 정규화: 즉시 / 가능 / 협의 / 불가
   - "즉시출고" → 즉시
   - "출고가능" → 가능
   - "출고완료", "출고불가" → 불가
   - 그 외 모든 값 → 협의 */
export function shortStatus(s) {
  if (!s) return '-';
  const t = String(s);
  if (/즉시/.test(t)) return '즉시';
  if (/완료|불가/.test(t)) return '불가';
  if (/가능/.test(t)) return '가능';
  return '협의';
}

/* 차량 status → CSS dot class 매핑 — .status-dot.{운행/대기/정비/예약/사고} 와 매칭 */
export function mapStatusDot(status) {
  const norm = shortStatus(status);
  return {
    '즉시': '운행',
    '가능': '대기',
    '협의': '정비',
    '불가': '사고',
  }[norm] || '대기';
}

export function fmtMileage(m) { return m ? Number(m).toLocaleString() : '-'; }

/* 전역 날짜 포맷 — YY.MM.DD 통일.
 *  - 숫자(타임스탬프 ms) 또는 Date.parse 가능 문자열 → YY.MM.DD
 *  - YYYYMMDD/YYMMDD 문자열 → YY.MM.DD
 *  - 그 외 → 빈 문자열
 */
export function fmtDate(v) {
  if (v == null || v === '') return '';
  // 숫자 (타임스탬프) 또는 ISO/Date.parse 가능
  if (typeof v === 'number' || /^\d{10,}$/.test(String(v).trim())) {
    const t = Number(v);
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yy}.${mm}.${dd}`;
    }
  }
  // ISO 형식 (2026-04-29 등) 또는 Date.parse 가능 문자열
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) {
      const d = new Date(parsed);
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yy}.${mm}.${dd}`;
    }
  }
  // 숫자 문자열 (YYYYMMDD / YYMMDD)
  const d = String(v ?? '').replace(/[^\d]/g, '');
  if (d.length === 8) return `${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  if (d.length === 6) return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}`;
  return String(v ?? '').trim() || '';
}

export function fmtMoney(v) {
  const n = Number(v); if (!n) return '';
  return n >= 10000 ? Math.round(n / 10000) + '만' : n.toLocaleString();
}

/* 항상 만원 단위 — 임대료/보증금 등 대형 금액 (천단위 절대 안 보고 만원으로 통일).
 *  v 가 0/null 이면 빈 문자열. suffix 기본 '만' (e.g., '만원' 도 가능). */
export function fmtMoneyMan(v, suffix = '만') {
  const n = Number(v);
  if (!n) return '';
  return Math.round(n / 10000) + suffix;
}

/* 채팅 등 시간 표시 — 오늘이면 HH:MM, 이전이면 YY.MM.DD */
export function fmtTime(ts) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : (ts.toMillis?.() || Date.parse(ts) || 0);
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return fmtDate(t);
}

/* 목록 우측 날짜 — 오늘이면 HH:MM, 그 외 YY.MM.DD (전역 통일) */
export function fmtListDate(v) {
  if (!v && v !== 0) return '';
  const t = typeof v === 'number' ? v : (v.toMillis?.() || (Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0));
  if (t) {
    const d = new Date(t);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return fmtDate(t);
  }
  return fmtDate(v);
}

/* 활동 이력 / 상세 — YY.MM.DD HH:MM (전역 통일) */
export function fmtFullTime(ts) {
  if (!ts) return '-';
  const t = typeof ts === 'number' ? ts : (ts.toMillis?.() || Date.parse(ts) || 0);
  if (!t) return '-';
  const d = new Date(t);
  const yy = String(d.getFullYear()).slice(-2);
  return `${yy}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* 모바일 환경 감지 — viewport 너비 + UA 보강 (PWA 도 모바일로 인식) */
export function isMobileViewport() {
  return window.matchMedia('(max-width: 767px)').matches || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function needsReview(p) {
  const pol = p._policy || p.policy || {};
  const v = String(pol.credit_grade || pol.screening_criteria || p.credit_grade || '').trim();
  return !!v && !/무심사|전체|무관|none/i.test(v);
}

/* ──────── 리스트 (좌측 .ws4-list 카드) ──────── */
export function listBody(page) {
  return document.querySelector(`[data-page="${page}"] .ws4-list .ws4-body`);
}

export function emptyState(label) {
  return `<div style="padding:24px; text-align:center; color:var(--text-muted);">${esc(label)}</div>`;
}

/* 모든 페이지 공통 — 2줄(메인/보조) 카드. 메인은 name + time/badge, 보조는 msg + meta */
export function renderRoomItem({ id, icon, badge, tone, accent, name, time, msg, meta, metaClass, active }) {
  const toneCls = tone ? ` tone-${esc(tone)}` : (accent ? ' is-accent' : '');
  return `<div class="room-item${active ? ' active' : ''}" data-id="${esc(id || '')}">
    <div class="room-item-avatar${toneCls}"><i class="ph ph-${esc(icon || 'circle')}"></i>${esc(badge || '')}</div>
    <div>
      <div class="room-item-top">
        <span class="room-item-name">${esc(name || '-')}</span>
        ${time ? `<span class="room-item-time">${esc(time)}</span>` : ''}
      </div>
      <div class="room-item-sub">
        <span class="room-item-msg">${esc(msg || '-')}</span>
        ${meta ? `<span class="room-item-meta${metaClass ? ' ' + esc(metaClass) : ''}">${esc(meta)}</span>` : ''}
      </div>
    </div>
  </div>`;
}

/* 회사명에서 법인 접두/접미어 제거 — "주식회사현대캐피탈"·"현대캐피탈(주)" 등 모두 처리.
 *  공백 0개도 허용 (\s*). 반복 적용으로 양쪽 동시 케이스도 커버. */
const LEGAL_ENTITY_RE = /(?:^|\s)(?:주식회사|유한회사|유한책임회사|합자회사|합명회사|재단법인|사단법인|학교법인|의료법인|사회복지법인|특수법인)(?:\s|$)/g;
export function stripLegalEntity(name) {
  if (!name) return '';
  let s = String(name).trim();
  // 1) 괄호형 — (주), （주）, ㈜
  s = s.replace(/[\(（]\s*주\s*[\)）]/g, '');
  s = s.replace(/㈜/g, '');
  s = s.replace(/㈐/g, '');
  // 2) 단어형 — 주식회사·유한회사 등 (공백 옵션)
  // 양쪽 어디든 — 정규식으로는 까다로워서 split 으로 단순 처리
  const TOKENS = ['주식회사', '유한책임회사', '유한회사', '합자회사', '합명회사', '재단법인', '사단법인', '학교법인', '의료법인', '사회복지법인', '특수법인'];
  for (const tok of TOKENS) {
    // 시작·끝·중간 모두 공백/없음 무관 — 토큰 자체를 빈 문자열로
    s = s.split(tok).join('');
  }
  // 정리 — 연속 공백, 양 끝 공백
  return s.replace(/\s+/g, ' ').trim();
}

/* 공급사 코드 → 회사명 캐시 — partners 변경 시 자동 무효화 (Map 1회 빌드 후 N번 lookup O(1))
 *  매 row 마다 store.partners.find() 선형스캔 → O(N×M) 비용 회피. */
let _providerNameCache = null;
let _providerCacheRef = null;     // 마지막 빌드 시점의 store.partners 참조 — 같으면 캐시 재사용
function getProviderCache(store) {
  const partners = store?.partners;
  if (!partners) return null;
  if (_providerCacheRef === partners && _providerNameCache) return _providerNameCache;
  const map = new Map();
  for (const x of partners) {
    if (x._deleted) continue;
    const code = x.partner_code || x.company_code;
    if (!code) continue;
    const name = stripLegalEntity(x.partner_name || x.company_name || code);
    map.set(code, name);
  }
  _providerNameCache = map;
  _providerCacheRef = partners;
  return map;
}

/* 공급사 코드 → 한글 회사명 변환 (캐시 lookup O(1), 법인 접두/접미어 제거) */
export function providerNameByCode(code, store) {
  if (!code) return '';
  const cache = getProviderCache(store);
  return (cache && cache.get(code)) || stripLegalEntity(code);
}

/* 공급사 코드 → "회사명 (코드)" 라벨. 폼 드롭다운/리스트 등 사용자가 보는 곳에서 사용.
 *  코드만 있고 회사명 없으면 코드만 반환. */
export function providerLabelByCode(code, store) {
  if (!code) return '';
  const name = providerNameByCode(code, store);
  return (name && name !== code) ? `${name} (${code})` : code;
}

/* 메인줄 통일 포맷 — 구분자 없이 공백으로만, 보조줄에서만 | 사용 */
export function formatMainLine(carNumber, subModel, providerName) {
  return [carNumber, subModel, providerName].filter(Boolean).join(' ') || '-';
}

/* 채팅 코드 통일 포맷 — `CH-{차량번호}-{영업자코드}` (둘 다 있을 때).
 *  ensureRoom 으로 생성된 신규 룸은 chat_code 가 동일 형식 (CH_..._...).
 *  과거 pushRecord 자동 ID 룸은 _key 가 ugly 하므로, 룸 데이터로부터 derive. */
export function chatCodeOf(room) {
  if (!room) return '';
  const car = room.vehicle_number || room.car_number || '';
  const agent = room.agent_code || '';
  if (car && agent) return `CH-${car}-${agent}`;
  // 명시 코드 (ensureRoom 생성) 가 CH_ 형식이면 보기 좋게 dash 로 변환
  const explicit = room.chat_code || room.room_code || room.room_id || '';
  if (explicit && /^CH_/.test(explicit)) return explicit.replace(/_/g, '-');
  if (explicit) return explicit;
  // 최후 fallback — Firebase 자동 ID 인 경우 (구버전 데이터)
  return room._key ? `CH-${room._key.slice(0, 8)}` : '';
}

/* ──────── 폼 필드 ──────── */
/* 2-click 수정 모드 적용 — dis 가 없으면(편집 가능) data-edit-lock + readonly 부여.
   첫 클릭 = 선택, 두 번째 클릭 = 수정 모드 (form-fields.js 의 전역 핸들러가 처리) */
export function ffi(label, field, val, dis = '') {
  const lockAttr = dis ? '' : ' readonly data-edit-lock="1"';
  return `<div class="ff"><label>${esc(label)}</label><input type="text" class="input" data-f="${esc(field)}" value="${esc(val || '')}"${dis}${lockAttr}></div>`;
}

export function ffs(label, field, val, opts, dis = '') {
  const cur = val || '';
  const inOpts = opts.includes(cur);
  const lockAttr = dis ? '' : ' data-edit-lock="1"';
  return `<div class="ff"><label>${esc(label)}</label>
    <select class="input" data-f="${esc(field)}"${dis}${lockAttr}>
      <option value="">선택</option>
      ${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      ${cur && !inOpts ? `<option selected>${esc(cur)}</option>` : ''}
    </select>
  </div>`;
}

/* ──────── 보기 전용 상세 패널 헬퍼 (info-grid) ──────── */
/** 라벨/값 행 배열 → info-grid HTML
 *  rows: [[label, value, full=true, isHtml=false], ...] (full 기본 true — 한 줄에 한 행)
 *  isHtml=true 면 value 를 HTML 그대로 삽입 (esc 안 함) — 링크 등 */
export function renderInfoGrid(rows) {
  return `<div class="info-grid">${(rows || []).filter(r => r && r[1] != null && r[1] !== '').map(([l, v, full = true, isHtml = false]) =>
    `<div class="lab">${esc(l)}</div><div${full ? ' class="full"' : ''}>${isHtml ? v : esc(v)}</div>`
  ).join('')}</div>`;
}
/** 섹션 제목 + info-grid 묶음 — contract 의 sectionTitle + renderRows 패턴
 *  sections: [{ icon, label, rows }, ...] */
export function renderInfoSections(sections) {
  return (sections || []).filter(s => s && s.rows && s.rows.length).map(s =>
    `<div class="form-section-title"><i class="ph ph-${esc(s.icon || 'info')}"></i> ${esc(s.label)}</div>` +
    renderInfoGrid(s.rows)
  ).join('');
}

/* ──────── 저장 패턴 ──────── */
/* 패널 헤더 — 제목만. 저장은 자동 (input blur). canEdit/formId 인자는
 *  하위 호환 위해 받지만 더 이상 버튼 안 그림. */
export function setHeadSave(card, title, _canEdit, _formId) {
  const head = card?.querySelector('.ws4-head');
  if (!head) return;
  head.innerHTML = `<span>${esc(title)}</span>`;
}

/* 저장 성공 시 input/select/textarea 에 .is-saved 클래스 1.5초 부착 → 초록 라인 flash */
export function flashSaved(elements) {
  const els = Array.isArray(elements) ? elements : [elements];
  els.forEach(el => {
    if (!el) return;
    el.classList.add('is-saved');
    setTimeout(() => el.classList.remove('is-saved'), 1500);
  });
}

/* 페이지 단위 폼 일괄저장 — 변경된 [data-f] 필드만 모아 한 번에 updateRecord 호출.
 *  blur/change 시 자동저장 X. [저장] 버튼이 page.__flushSave() 를 호출해야 실제 저장. */
export function bindFormSave(page, collection, key, _current, options = {}) {
  const { onSaved } = options;
  if (!page || !key) return;

  const tracked = [];

  // input/select/textarea — original 캡처 + Esc 되돌리기만
  page.querySelectorAll('input[data-f], select[data-f], textarea[data-f], [data-f] input, [data-f] select, [data-f] textarea').forEach(el => {
    const f = el.dataset.f || el.closest('[data-f]')?.dataset.f;
    if (!f) return;
    let original = el.value;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && el.tagName !== 'TEXTAREA') el.blur();
      else if (e.key === 'Escape') { el.value = original; el.blur(); }
    });
    tracked.push({
      type: 'value', el, f,
      getOriginal: () => original,
      setOriginal: v => { original = v; },
    });
  });

  // chip — 클릭은 시각만 토글 (저장 X), flush 시 변경 여부 판정
  page.querySelectorAll('[data-f]').forEach(wrapper => {
    if (wrapper.tagName !== 'DIV') return;
    const f = wrapper.dataset.f;
    if (!f) return;
    const isMulti = !!wrapper.dataset.multi;
    const chips = wrapper.querySelectorAll('.chip[data-v]');
    if (!chips.length) return;

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        if (isMulti) chip.classList.toggle('active');
        else {
          wrapper.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
        }
      });
    });

    const collectVals = () => {
      if (isMulti) return [...wrapper.querySelectorAll('.chip.active')].map(c => c.dataset.v);
      const a = wrapper.querySelector('.chip.active');
      return a ? a.dataset.v : '';
    };

    let original = JSON.stringify(collectVals());
    tracked.push({
      type: 'chip', el: wrapper, f, collectVals,
      getOriginal: () => original,
      setOriginal: v => { original = v; },
    });
  });

  page.dataset.flushHost = '1';
  page.__flushSave = async () => {
    const patch = { updated_at: Date.now() };
    const flashEls = [];
    let dirty = false;

    for (const t of tracked) {
      if (t.type === 'value') {
        if (t.el.value === t.getOriginal()) continue;
        patch[t.f] = t.el.value;
        if (t.f === 'status') {
          // canonical: 'active' / 'pending' — is_active 동기화. legacy 한글 라벨도 호환.
          if (t.el.value === 'pending' || t.el.value === '비활성' || t.el.value === '대기') patch.is_active = false;
          else if (t.el.value === 'active' || t.el.value === '활성' || t.el.value === '승인') patch.is_active = true;
        }
        flashEls.push(t.el);
        dirty = true;
      } else if (t.type === 'chip') {
        const cur = t.collectVals();
        const ser = JSON.stringify(cur);
        if (ser === t.getOriginal()) continue;
        patch[t.f] = cur;
        flashEls.push(...t.el.querySelectorAll('input, select, textarea'));
        dirty = true;
      }
    }

    if (!dirty) return 0;
    try {
      await updateRecord(`${collection}/${key}`, patch);
      if (flashEls.length) flashSaved(flashEls);
      onSaved?.(patch);
      for (const t of tracked) {
        if (t.type === 'value') t.setOriginal(t.el.value);
        else if (t.type === 'chip') t.setOriginal(JSON.stringify(t.collectVals()));
      }
      return 1;
    } catch (e) {
      console.error(`[${collection}] save fail`, e);
      return 0;
    }
  };
}
