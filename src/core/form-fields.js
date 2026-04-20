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
  return `<div class="form-row">
    <span class="form-row-label">${label}</span>
    <div class="form-row-control">
      <input class="contract-field-input" data-field="${field}" value="${v}" placeholder="-"${numAttr}${roAttr}>
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
        ${options.map(o => `<option value="${o}" ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}
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
      try {
        await saveFn(f, val);
        original = v;
        if (isNum && v !== '') inp.value = Number(v).toLocaleString('ko-KR');
        setFieldState(stateEl, 'saved');
        clearTimeout(stateEl?._t);
        if (stateEl) stateEl._t = setTimeout(() => setFieldState(stateEl, null), 1500);
      } catch (err) { setFieldState(stateEl, 'error'); }
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') inp.blur();
      else if (e.key === 'Escape') { inp.value = original; inp.blur(); }
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
      try {
        await saveFn(f, sel.value);
        originalSel = sel.value;
        setFieldState(stateEl, 'saved');
        clearTimeout(stateEl?._t);
        if (stateEl) stateEl._t = setTimeout(() => setFieldState(stateEl, null), 1500);
      } catch (err) { setFieldState(stateEl, 'error'); }
    });
  });
}

function setFieldState(el, state) {
  if (!el) return;
  el.classList.remove('is-editing', 'is-saved', 'is-error');
  if (state === 'editing') {
    el.innerHTML = '<i class="ph ph-pencil-simple"></i>';
    el.classList.add('is-editing');
  } else if (state === 'saved') {
    el.innerHTML = '<i class="ph ph-check"></i> 저장됨';
    el.classList.add('is-saved');
  } else if (state === 'error') {
    el.innerHTML = '<i class="ph ph-warning"></i> 오류';
    el.classList.add('is-error');
  } else {
    el.innerHTML = '';
  }
}
