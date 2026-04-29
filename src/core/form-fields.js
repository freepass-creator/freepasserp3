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
 * 자동저장 바인딩 — el 안의 모든 .contract-field-input에 blur/change 시 저장 + 피드백
 * @param {HTMLElement} el - 컨테이너
 * @param {function} saveFn - (field, value) => Promise
 */
export function bindAutoSave(el, saveFn) {
  // text/textarea inputs
  el.querySelectorAll('.contract-field-input:not(select)').forEach(inp => {
    const f = inp.dataset.field;
    const stateEl = el.querySelector(`.form-state[data-state="${f}"]`);
    const isNum = inp.dataset.num === '1';
    let original = inp.value;

    inp.addEventListener('focus', () => {
      if (isNum) inp.value = inp.value.replace(/[^\d]/g, '');
      original = inp.value;
      setFieldState(stateEl, 'editing');
    });
    if (isNum) {
      inp.addEventListener('input', () => {
        const cleaned = inp.value.replace(/[^\d]/g, '');
        if (cleaned !== inp.value) inp.value = cleaned;
      });
    }
    inp.addEventListener('blur', async () => {
      const v = inp.value.trim();
      if (v === original) {
        if (isNum && v !== '') inp.value = Number(v).toLocaleString('ko-KR');
        setFieldState(stateEl, null);
        return;
      }
      const val = isNum ? (v ? Number(v) : null) : v;
      const prevVal = original;
      try {
        await saveFn(f, val);
        original = v;
        if (isNum && v !== '') inp.value = Number(v).toLocaleString('ko-KR');
        const undo = () => {
          const restoreVal = isNum ? (prevVal ? Number(prevVal) : null) : prevVal;
          inp.value = prevVal;
          saveFn(f, restoreVal);
          original = prevVal;
          if (isNum && prevVal !== '') inp.value = Number(prevVal).toLocaleString('ko-KR');
          setFieldState(stateEl, null);
        };
        setFieldState(stateEl, 'saved', undo);
        clearTimeout(stateEl?._t);
        if (stateEl) stateEl._t = setTimeout(() => setFieldState(stateEl, null), 5000);
      } catch (err) { setFieldState(stateEl, 'error'); }
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') inp.blur();
      else if (e.key === 'Escape') { inp.value = original; inp.blur(); }
    });
  });

  // textarea (디바운스 저장)
  el.querySelectorAll('textarea.contract-field-input').forEach(ta => {
    const f = ta.dataset.field;
    const stateEl = el.querySelector(`.form-state[data-state="${f}"]`);
    let t, original = ta.value;
    ta.addEventListener('focus', () => { original = ta.value; setFieldState(stateEl, 'editing'); });
    ta.addEventListener('input', () => {
      clearTimeout(t);
      setFieldState(stateEl, 'editing');
      t = setTimeout(async () => {
        const prevVal = original;
        try {
          await saveFn(f, ta.value);
          original = ta.value;
          const undo = () => { ta.value = prevVal; saveFn(f, prevVal); original = prevVal; setFieldState(stateEl, null); };
          setFieldState(stateEl, 'saved', undo);
          clearTimeout(stateEl?._t);
          if (stateEl) stateEl._t = setTimeout(() => setFieldState(stateEl, null), 5000);
        } catch (err) { setFieldState(stateEl, 'error'); }
      }, 600);
    });
    ta.addEventListener('blur', () => {
      if (ta.value === original) setFieldState(stateEl, null);
    });
  });

  // select dropdowns
  el.querySelectorAll('.contract-field-select').forEach(sel => {
    const f = sel.dataset.field;
    const stateEl = el.querySelector(`.form-state[data-state="${f}"]`);
    let originalSel = sel.value;
    sel.addEventListener('focus', () => { originalSel = sel.value; setFieldState(stateEl, 'editing'); });
    sel.addEventListener('blur', () => {
      if (stateEl?.classList.contains('is-editing')) setFieldState(stateEl, null);
    });
    sel.addEventListener('change', async () => {
      const prevVal = originalSel;
      try {
        await saveFn(f, sel.value);
        originalSel = sel.value;
        const undo = () => { sel.value = prevVal; saveFn(f, prevVal); originalSel = prevVal; setFieldState(stateEl, null); };
        setFieldState(stateEl, 'saved', undo);
        clearTimeout(stateEl?._t);
        if (stateEl) stateEl._t = setTimeout(() => setFieldState(stateEl, null), 5000);
      } catch (err) { setFieldState(stateEl, 'error'); }
    });
  });
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
function lockField(el) {
  if (!el) return;
  el.classList.remove('is-selected');
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.setAttribute('readonly', '');
  } else if (el.tagName === 'SELECT') {
    // select 는 readonly 가 없어 pointer-events 차단으로 잠금
    el.style.pointerEvents = 'none';
    el.setAttribute('tabindex', '-1');
  }
  el.dataset.editLock = '1';
}
function unlockField(el) {
  if (!el) return;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.removeAttribute('readonly');
  } else if (el.tagName === 'SELECT') {
    el.style.pointerEvents = '';
    el.removeAttribute('tabindex');
  }
  delete el.dataset.editLock;
  el.classList.remove('is-selected');
  el.classList.add('is-editing');
  setTimeout(() => el.focus(), 0);
}
// select 가 잠긴 상태에서 1번째 클릭에 드롭다운이 열리지 않도록 mousedown 차단
document.addEventListener('mousedown', (e) => {
  const sel = e.target.closest('select[data-edit-lock="1"]:not([data-permanent-lock])');
  if (sel) e.preventDefault();
});
document.addEventListener('click', (e) => {
  // permanent-lock 은 항상 잠김 (편집 불가)
  const target = e.target.closest('[data-edit-lock="1"]:not([data-permanent-lock])');
  // 외부 클릭 — 선택 해제
  if (!target) {
    if (_editSelected) {
      _editSelected.classList.remove('is-selected');
      _editSelected = null;
    }
    return;
  }
  if (target === _editSelected) {
    // 2번째 클릭 — 수정 모드로
    unlockField(target);
    _editSelected = null;
  } else {
    // 1번째 클릭 — 선택 표시
    if (_editSelected) _editSelected.classList.remove('is-selected');
    target.classList.add('is-selected');
    _editSelected = target;
  }
});
// blur — 수정 모드 종료, 다시 잠금
document.addEventListener('blur', (e) => {
  const el = e.target;
  if (!el?.classList?.contains('is-editing')) return;
  el.classList.remove('is-editing');
  lockField(el);
}, true);

/* ──────── 3. 입력 상태 라벨 (수정중 / 저장됨) ────────
   data-f 속성을 가진 input/select/textarea 가 focus 되면 위에 '수정중' 라벨,
   blur + 저장 성공 시 '저장됨' 라벨 1.5초 표시. 부드럽게 fade. */
const FIELD_F_SELECTOR = 'input[data-f], select[data-f], textarea[data-f], [data-f] input, [data-f] select, [data-f] textarea';

function showFieldStateTag(el, kind, text) {
  if (!el) return;
  // 부모(.ff)를 컨테이너로 사용 (있을 때만), 없으면 input 자체 wrapper 처리
  const host = el.closest('.ff') || el.parentElement;
  if (!host) return;
  // 기존 태그 제거
  host.querySelector(':scope > .field-state-tag')?.remove();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const tag = document.createElement('span');
  tag.className = `field-state-tag is-${kind}`;
  tag.textContent = text;
  host.appendChild(tag);
  // 다음 프레임에 보이게 (transition 트리거)
  requestAnimationFrame(() => tag.classList.add('is-show'));
  return tag;
}
function hideFieldStateTag(el, kind) {
  if (!el) return;
  const host = el.closest('.ff') || el.parentElement;
  if (!host) return;
  const tag = host.querySelector(`:scope > .field-state-tag.is-${kind}`);
  if (!tag) return;
  tag.classList.remove('is-show');
  setTimeout(() => tag.remove(), 200);
}

document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el.matches?.(FIELD_F_SELECTOR)) return;
  // readonly (2-click 잠금) 상태에서는 표시 X
  if (el.hasAttribute('readonly')) return;
  showFieldStateTag(el, 'editing', '수정중');
});
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (!el.matches?.(FIELD_F_SELECTOR)) return;
  hideFieldStateTag(el, 'editing');
});

// flashSaved 가 .is-saved 클래스를 추가하는 시점에 '저장됨' 태그도 같이 표시.
//  MutationObserver 로 클래스 추가 감지 → 라벨 띄움
const _savedObserver = new MutationObserver(muts => {
  for (const m of muts) {
    if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
    const el = m.target;
    if (el.classList.contains('is-saved') && el.matches?.(FIELD_F_SELECTOR)) {
      showFieldStateTag(el, 'saved', '저장됨');
      setTimeout(() => hideFieldStateTag(el, 'saved'), 1300);
    }
  }
});
// 페이지 전체에 attr 변경 감지 (data-f 가진 input/select/textarea 만 응답)
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    _savedObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  }, { once: true });
  if (document.readyState !== 'loading') {
    _savedObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  }
}
