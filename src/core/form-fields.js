/**
 * form-fields.js — 전역 폼 필드 헬퍼
 *
 * 모든 페이지에서 동일한 입력칸 규격:
 *  - 좌(라벨) 우(입력/드롭다운/값)
 *  - 자동저장 + 상태 피드백 (수정 중 / 저장됨 / 오류)
 *  - 보기모드: 읽기 전용 값 표시
 */

/**
 * 입력 필드 (text/number)
 * @param {string} label - 라벨
 * @param {string} field - data-field
 * @param {object} data - 데이터 객체
 * @param {object} opts - { num, autocomplete, readonly }
 */
export function fieldInput(label, field, data, opts = {}) {
  const raw = data[field] ?? '';
  const isNum = opts.num === true;
  const v = isNum && raw !== '' && raw !== null ? Number(raw).toLocaleString('ko-KR') : raw;
  const numAttr = isNum ? ' data-num="1" inputmode="numeric"' : '';
  // 기본 readonly — 2-click 수정 모드 진입 (영구 readonly 는 opts.readonly)
  const lockedAttr = opts.readonly ? ' readonly data-permanent-lock="1"' : ' readonly data-edit-lock="1"';
  const listId = opts.autocomplete ? `dl_${field}` : '';
  const listAttr = listId ? ` list="${listId}"` : '';
  const dlEl = listId && opts.datalist ? `<datalist id="${listId}">${opts.datalist.map(x => `<option value="${x}">`).join('')}</datalist>` : '';
  const fullClass = opts.full ? ' form-row-full' : '';
  // placeholder = "라벨 : 예시" (예시 있을 때) — 입력칸이 라벨+예시 모두 표현
  const ph = opts.example ? `${label} : ${opts.example}` : (opts.placeholder || label);
  return `<div class="form-row${fullClass}">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      <input class="contract-field-input" data-field="${field}" value="${v}" placeholder="${ph}"${numAttr}${lockedAttr}${listAttr}>${dlEl}
      <span class="form-state" data-state="${field}"></span>
    </div>
  </div>`;
}

/**
 * 드롭다운 필드
 */
export function fieldSelect(label, field, data, options) {
  const cur = String(data[field] ?? '');
  // select 도 2-click 수정모드 — 처음엔 disabled-look (data-edit-lock), 2번째 클릭 시 활성화
  return `<div class="form-row">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      <select class="contract-field-input contract-field-select" data-field="${field}" data-edit-lock="1">
        <option value="">-</option>
        ${options.map(o => {
          const val = typeof o === 'object' ? o.value : o;
          const lbl = typeof o === 'object' ? o.label : o;
          return `<option value="${val}" ${val === cur ? 'selected' : ''}>${lbl}</option>`;
        }).join('')}
      </select>
      <span class="form-state" data-state="${field}"></span>
    </div>
  </div>`;
}

/**
 * 읽기 전용 값 표시 — 입력칸 형태 유지, 수정 불가
 */
export function fieldView(label, value) {
  return `<div class="form-row">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      <input class="contract-field-input" value="${value || '-'}" readonly tabindex="-1">
    </div>
  </div>`;
}

/**
 * 신규 입력 필드 (빈값)
 */
export function fieldNew(label, field, options) {
  if (options) {
    return `<div class="form-row">
      <span class="form-row-label">${label}</span>
      <div class="form-row-control">
        <select class="contract-field-input contract-field-select" data-field="${field}">
          <option value="">-</option>
          ${options.map(o => `<option value="${o}">${o}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }
  return `<div class="form-row">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      <input class="contract-field-input" data-field="${field}" value="" placeholder="-">
    </div>
  </div>`;
}

/**
 * 여러 줄 입력 (메모, 옵션 등)
 */
export function fieldTextarea(label, field, data, opts = {}) {
  const v = data[field] ?? '';
  const rows = opts.rows || 3;
  return `<div class="form-row form-row-full">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      <textarea class="contract-field-input" data-field="${field}" rows="${rows}" placeholder="-" style="resize:vertical;">${v}</textarea>
      <span class="form-state" data-state="${field}"></span>
    </div>
  </div>`;
}

/**
 * 파일 업로드 (서류 등)
 * @param {string} label
 * @param {string} field - data-field (저장될 URL 필드)
 * @param {object} data
 * @param {object} opts - { accept: 'image/*,.pdf' }
 */
export function fieldFile(label, field, data, opts = {}) {
  const url = data[field] || '';
  const accept = opts.accept || 'image/*,.pdf';
  return `<div class="form-row form-row-full">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      ${url ? `<a href="${url}" target="_blank" class="form-file-link"><i class="ph ph-file"></i> 업로드됨</a>` : '<span style="color:var(--c-text-muted);font-size:var(--fs-2xs);">미등록</span>'}
      <button class="btn btn-xs btn-outline form-file-btn" data-field="${field}" data-accept="${accept}"><i class="ph ph-upload-simple"></i></button>
      <span class="form-state" data-state="${field}"></span>
    </div>
  </div>`;
}

/**
 * 사진 업로드 (이미지 프리뷰 + 업로드)
 * @param {string} label
 * @param {string} field
 * @param {object} data
 */
export function fieldPhoto(label, field, data) {
  const url = data[field] || '';
  return `<div class="form-row form-row-full">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control form-photo-control">
      ${url ? `<img src="${url}" class="form-photo-preview" alt="">` : '<div class="form-photo-empty"><i class="ph ph-image"></i></div>'}
      <button class="btn btn-xs btn-outline form-photo-btn" data-field="${field}"><i class="ph ph-camera"></i></button>
      <span class="form-state" data-state="${field}"></span>
    </div>
  </div>`;
}

/**
 * 일괄저장 바인딩 — 기본은 [저장] 버튼이 호출하는 el.__flushSave() 가 변경분 일괄 저장.
 *  opts.eager=true 면 blur/change 시 즉시 저장 (admin 도구 등 [저장] 버튼이 없는 컨텍스트용).
 * @param {HTMLElement} el - 컨테이너
 * @param {function} saveFn - (field, value) => Promise
 * @param {object} [opts] - { eager: boolean }
 */
export function bindAutoSave(el, saveFn, opts = {}) {
  const eager = !!opts.eager;
  // eager 모드 — input blur / select change / textarea blur 시 자동 flush
  if (eager) {
    const triggerFlush = () => { el.__flushSave?.(); };
    el.addEventListener('blur', triggerFlush, true);   // capture phase — input/textarea
    el.addEventListener('change', triggerFlush, true); // select
  }
  const tracked = [];

  // text/number inputs
  el.querySelectorAll('.contract-field-input:not(select):not(textarea)').forEach(inp => {
    const f = inp.dataset.field;
    const stateEl = el.querySelector(`.form-state[data-state="${f}"]`);
    const isNum = inp.dataset.num === '1';
    let original = inp.value;

    inp.addEventListener('focus', () => {
      if (isNum) inp.value = inp.value.replace(/[^\d]/g, '');
      setFieldState(stateEl, inp.value !== original ? 'editing' : 'editing');
    });
    if (isNum) {
      inp.addEventListener('input', () => {
        const cleaned = inp.value.replace(/[^\d]/g, '');
        if (cleaned !== inp.value) inp.value = cleaned;
        setFieldState(stateEl, inp.value !== original ? 'editing' : null);
      });
    } else {
      inp.addEventListener('input', () => {
        setFieldState(stateEl, inp.value !== original ? 'editing' : null);
      });
    }
    inp.addEventListener('blur', () => {
      // 숫자는 천단위 표시 복구 (저장과 무관)
      if (isNum && inp.value !== '') inp.value = Number(inp.value.replace(/[^\d]/g, '')).toLocaleString('ko-KR');
      if (inp.value === original) setFieldState(stateEl, null);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') inp.blur();
      else if (e.key === 'Escape') { inp.value = original; setFieldState(stateEl, null); inp.blur(); }
    });

    tracked.push({
      type: 'input', el: inp, f, isNum, stateEl,
      getOriginal: () => original,
      setOriginal: v => { original = v; },
    });
  });

  // textarea
  el.querySelectorAll('textarea.contract-field-input').forEach(ta => {
    const f = ta.dataset.field;
    const stateEl = el.querySelector(`.form-state[data-state="${f}"]`);
    let original = ta.value;
    ta.addEventListener('input', () => {
      setFieldState(stateEl, ta.value !== original ? 'editing' : null);
    });
    ta.addEventListener('blur', () => {
      if (ta.value === original) setFieldState(stateEl, null);
    });
    tracked.push({
      type: 'textarea', el: ta, f, stateEl,
      getOriginal: () => original,
      setOriginal: v => { original = v; },
    });
  });

  // select dropdowns
  el.querySelectorAll('.contract-field-select').forEach(sel => {
    const f = sel.dataset.field;
    const stateEl = el.querySelector(`.form-state[data-state="${f}"]`);
    let original = sel.value;
    sel.addEventListener('change', () => {
      setFieldState(stateEl, sel.value !== original ? 'editing' : null);
    });
    tracked.push({
      type: 'select', el: sel, f, stateEl,
      getOriginal: () => original,
      setOriginal: v => { original = v; },
    });
  });

  // [저장] 버튼이 호출 — 변경된 필드만 saveFn 으로 일괄 호출
  el.dataset.flushHost = '1';
  el.__flushSave = async () => {
    let saved = 0;
    for (const t of tracked) {
      const cur = t.el.value;
      const orig = t.getOriginal();
      if (t.type === 'input') {
        const v = cur.trim();
        if (v === orig) continue;
        const val = t.isNum ? (v ? Number(v.replace(/[^\d]/g, '')) : null) : v;
        try {
          await saveFn(t.f, val);
          t.setOriginal(t.el.value);
          setFieldState(t.stateEl, 'saved');
          if (t.stateEl) { clearTimeout(t.stateEl._t); t.stateEl._t = setTimeout(() => setFieldState(t.stateEl, null), 3000); }
          saved++;
        } catch (err) { setFieldState(t.stateEl, 'error'); console.error('[bindAutoSave] save fail', t.f, err); }
      } else if (t.type === 'textarea') {
        if (cur === orig) continue;
        try {
          await saveFn(t.f, cur);
          t.setOriginal(cur);
          setFieldState(t.stateEl, 'saved');
          if (t.stateEl) { clearTimeout(t.stateEl._t); t.stateEl._t = setTimeout(() => setFieldState(t.stateEl, null), 3000); }
          saved++;
        } catch (err) { setFieldState(t.stateEl, 'error'); console.error('[bindAutoSave] save fail', t.f, err); }
      } else if (t.type === 'select') {
        if (cur === orig) continue;
        try {
          await saveFn(t.f, cur);
          t.setOriginal(cur);
          setFieldState(t.stateEl, 'saved');
          if (t.stateEl) { clearTimeout(t.stateEl._t); t.stateEl._t = setTimeout(() => setFieldState(t.stateEl, null), 3000); }
          saved++;
        } catch (err) { setFieldState(t.stateEl, 'error'); console.error('[bindAutoSave] save fail', t.f, err); }
      }
    }
    return saved;
  };
}

/**
 * 섹션 래퍼 — 아이콘 + 타이틀 + 2열 grid 바디
 * @param {string} icon - phosphor 아이콘 클래스
 * @param {string} title - 섹션 타이틀
 * @param {string} bodyHtml - form-row 들의 HTML
 */
export function formSection(icon, title, bodyHtml) {
  return `<div class="form-section">
    <div class="form-section-title">${icon ? `<i class="${icon}"></i>` : ''} ${title}</div>
    <div class="form-section-body">${bodyHtml}</div>
  </div>`;
}

function setFieldState(el, state, undoFn) {
  if (!el) return;
  el.classList.remove('is-editing', 'is-saved', 'is-error');
  el.style.pointerEvents = 'none';
  if (state === 'editing') {
    el.textContent = '수정중';
    el.classList.add('is-editing');
  } else if (state === 'saved') {
    if (undoFn) {
      el.innerHTML = '저장됨 <span class="form-undo">되돌리기</span>';
      el.style.pointerEvents = 'auto';
      el.querySelector('.form-undo')?.addEventListener('click', undoFn);
    } else {
      el.textContent = '저장됨';
    }
    el.classList.add('is-saved');
  } else if (state === 'error') {
    el.textContent = '오류';
    el.classList.add('is-error');
  } else {
    el.textContent = '';
  }
}

/* ──────── 2-click 수정 모드 ────────
   data-edit-lock 가 있는 input/select 는 처음엔 잠긴 상태.
   1) 클릭 → is-selected (시각 강조, 아직 수정 불가)
   2) 같은 칸 다시 클릭 → 잠금 해제 + 포커스 + 수정 가능
   다른 곳 클릭 / blur → 다시 잠김 (저장은 기존 bindAutoSave 가 처리) */
let _editSelected = null;
/* 페이지별 수정 모드 토글 — body.is-edit-mode 클래스로 관리.
 *  보기모드(off): 입력칸 완전 비활성화 — 클릭해도 커서 안 꽂히고 드롭다운 안 열림 (CSS pointer-events:none)
 *  편집모드(on):  입력칸 활성화 — 단일 클릭으로 바로 편집, 자동저장 동작 */
function applyEditMode(on) {
  const page = document.querySelector('.pt-page.active');
  document.body.classList.toggle('is-edit-mode', !!on);
  if (!page) return;
  page.querySelectorAll('[data-edit-lock="1"]:not([data-permanent-lock])').forEach(el => {
    if (on) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.removeAttribute('readonly');
    } else {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.setAttribute('readonly', '');
    }
  });
}
window.toggleEditMode = function(on) {
  const cur = document.body.classList.contains('is-edit-mode');
  const next = (typeof on === 'boolean') ? on : !cur;
  applyEditMode(next);
  window.refreshPageActions?.();
};
window.isEditMode = () => document.body.classList.contains('is-edit-mode');

/* 활성 페이지의 변경 사항 일괄 저장 — [저장] 버튼이 호출.
 *  bindAutoSave / bindFormSave 가 컨테이너에 등록한 __flushSave 들을 모두 실행. */
window.flushActivePageSaves = async function() {
  const page = document.querySelector('.pt-page.active');
  if (!page) return 0;
  const hosts = [page, ...page.querySelectorAll('[data-flush-host]')];
  let total = 0;
  for (const h of hosts) {
    if (typeof h.__flushSave === 'function') {
      try { total += (await h.__flushSave()) || 0; } catch (e) { console.error('[flushActivePageSaves]', e); }
    }
  }
  return total;
};

// select 가 잠긴 상태에서 드롭다운이 열리지 않도록 mousedown 차단 (수정모드 OFF 일 때만)
document.addEventListener('mousedown', (e) => {
  if (document.body.classList.contains('is-edit-mode')) return;
  const sel = e.target.closest('select[data-edit-lock="1"]:not([data-permanent-lock])');
  if (sel) e.preventDefault();
});

// 페이지 이동 시 수정모드 자동 종료 (다른 페이지로 가면서 편집 상태 가져가지 않음)
window.addEventListener('hashchange', () => {
  if (document.body.classList.contains('is-edit-mode')) applyEditMode(false);
});

/* 플로팅 "수정중/저장됨" 태그는 제거 — bindAutoSave 가 input 옆 .form-state 에 인라인 표시.
   (이전: position:fixed 로 body 에 띄우다가 input 위치 계산 오류 시 엉뚱한 좌표에 튀어나오는 버그) */
