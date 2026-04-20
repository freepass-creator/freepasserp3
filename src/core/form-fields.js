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
  const roAttr = opts.readonly ? ' readonly' : '';
  const listId = opts.autocomplete ? `dl_${field}` : '';
  const listAttr = listId ? ` list="${listId}"` : '';
  const dlEl = listId && opts.datalist ? `<datalist id="${listId}">${opts.datalist.map(x => `<option value="${x}">`).join('')}</datalist>` : '';
  const fullClass = opts.full ? ' form-row-full' : '';
  return `<div class="form-row${fullClass}">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      <input class="contract-field-input" data-field="${field}" value="${v}" placeholder="-"${numAttr}${roAttr}${listAttr}>${dlEl}
      <span class="form-state" data-state="${field}"></span>
    </div>
  </div>`;
}

/**
 * 드롭다운 필드
 */
export function fieldSelect(label, field, data, options) {
  const cur = String(data[field] ?? '');
  return `<div class="form-row">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      <select class="contract-field-input contract-field-select" data-field="${field}">
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
 * 읽기 전용 값 표시
 */
export function fieldView(label, value) {
  return `<div class="form-row">
    <span class="form-row-label">${label}</span>
    <span class="form-row-value">${value || '-'}</span>
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
