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

/* 공급사 코드 → 한글 회사명 변환 (store.partners 에서 lookup, 법인 접두/접미어 제거) */
export function providerNameByCode(code, store) {
  if (!code) return '';
  const p = (store?.partners || []).find(x =>
    (x.partner_code === code || x.company_code === code) && !x._deleted
  );
  return stripLegalEntity(p?.partner_name || p?.company_name || code);
}

/* 메인줄 통일 포맷 — 차량번호 · 세부모델 · 공급사명(한글) */
export function formatMainLine(carNumber, subModel, providerName) {
  return [carNumber, subModel, providerName].filter(Boolean).join(' · ') || '-';
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

/* ──────── 저장 패턴 ──────── */
/* 패널 헤더에 [저장] 버튼 주입 — bindFormSave 가 클릭 처리 */
export function setHeadSave(card, title, canEdit, formId) {
  const head = card?.querySelector('.ws4-head');
  if (!head) return;
  head.innerHTML = `
    <span>${esc(title)}</span>
    <div class="spacer" style="flex:1;"></div>
    ${canEdit ? `<button class="btn btn-sm btn-primary" data-save-form="${esc(formId)}">저장</button>` : ''}
  `;
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

/* 페이지 단위 폼 저장 핸들러 (panel-scoped) — bindDirtyTracking 의 dirty 해제도 함께 처리
 *  data-save-form 속성을 가진 버튼 클릭 시: 같은 .ws4-card 내 [data-f] 모두 수집 → updateRecord */
export function bindFormSave(page, collection, key, _current, options = {}) {
  const { onSaved } = options;

  // chip 토글 — 단일/멀티
  page.querySelectorAll('[data-f][data-multi]').forEach(group => {
    group.querySelectorAll('.chip[data-v]').forEach(chip => {
      chip.addEventListener('click', () => chip.classList.toggle('active'));
    });
  });
  page.querySelectorAll('[data-f]:not([data-multi])').forEach(el => {
    if (el.tagName === 'DIV') {
      el.querySelectorAll('.chip[data-v]').forEach(chip => {
        chip.addEventListener('click', () => {
          el.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
        });
      });
    }
  });

  page.querySelectorAll('[data-save-form]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.ws4-card') || page;
      const data = {};
      card.querySelectorAll('[data-f]').forEach(el => {
        const f = el.dataset.f;
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
          data[f] = el.value;
        } else if (el.tagName === 'DIV') {
          if (el.dataset.multi) {
            data[f] = [...el.querySelectorAll('.chip.active')].map(c => c.dataset.v);
          } else {
            data[f] = el.querySelector('.chip.active')?.dataset.v || '';
          }
        }
      });
      if (data.status === '비활성') data.is_active = false;
      else if (data.status === '활성') data.is_active = true;
      data.updated_at = Date.now();

      try {
        await updateRecord(`${collection}/${key}`, data);
        // dirty 해제 (전역 헬퍼와 호환 — 클래스 직접 제거)
        card.classList.remove('is-dirty');
        card.querySelectorAll('[data-save-form]').forEach(b => b.classList.remove('is-pulse'));
        // 저장 성공 → 해당 패널의 모든 input/select/textarea 초록 flash
        flashSaved([...card.querySelectorAll('[data-f] input, [data-f] select, [data-f] textarea, input[data-f], select[data-f], textarea[data-f]')]);
        onSaved?.(data);
      } catch (e) {
        console.error(`[${collection}] save fail`, e);
        alert('저장 실패 — ' + (e.message || e));
      }
    });
  });
}
