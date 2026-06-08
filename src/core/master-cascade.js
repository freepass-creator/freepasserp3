/**
 * master-cascade.js — 차종마스터 5단계 캐스케이딩 드롭다운 (공용 렌더 유틸)
 *
 *   ① 제조사 → ② 모델 → ③ 세부모델 → ④ 파워트레인 → ⑤ 트림
 *   (④ 파워트레인 = 연료+배기량+구동/인승. 웰릭스 신차견적기 variant 와 동일물.
 *    내부 데이터 키는 buildMasterTree 의 `variant` 유지, 화면 표기만 '파워트레인')
 *
 *  buildMasterTree(_index.json) 의 트리를 단일 구동원으로 5개 select 를 연쇄.
 *  상위 선택 시 하위 옵션 갱신 + 하위 선택 초기화. 하위가 1개뿐이면 자동 선택.
 *  독립 페이지(vehicle-master.js) · 개발도구(dev.js) 양쪽에서 동일 시그니처로 호출.
 */
import { buildMasterTree } from './vehicle-master-tree.js';

const LEVELS = ['maker', 'model', 'catalogId', 'variant', 'trim'];
const LABELS = ['① 제조사', '② 모델', '③ 세부모델', '④ 파워트레인', '⑤ 트림'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 5단계 캐스케이딩 드롭다운을 el 에 렌더.
 *
 * @param {HTMLElement} el     마운트 컨테이너
 * @param {Object}      index  _index.json catalog 맵
 * @param {Object}      [opts]
 *   @param {Function} [opts.onSelect]  선택 변경 콜백 (sel) => void
 *   @param {Map}      [opts.counts]    catalogId → 매물수 (결과 패널 표시용)
 *   @param {boolean}  [opts.showId]    결과 패널에 catalog_id 노출 (개발도구용, 기본 false)
 *   @param {Object}   [opts.initial]   초기 선택 {maker, model, catalogId, variant, trim}
 * @returns {{ getSelection():Object, setSelection(s:Object):void, refresh(idx?:Object):void }}
 */
export function renderMasterCascade(el, index, opts = {}) {
  let tree = buildMasterTree(index);
  const counts = opts.counts || null;
  const showId = !!opts.showId;
  const state = { maker: '', model: '', catalogId: '', variant: '', trim: '' };

  /* ── 트리 탐색 헬퍼 ── */
  const makerNode = () => tree.find(t => t.maker === state.maker) || null;
  const modelNode = () => { const mk = makerNode(); return mk ? mk.models.find(m => m.model === state.model) || null : null; };
  const subNode = () => { const md = modelNode(); return md ? md.subModels.find(s => s.id === state.catalogId) || null : null; };
  const variantNode = () => { const sm = subNode(); return sm ? sm.variants.find(v => v.variant === state.variant) || null : null; };

  /* ── 레벨별 옵션 [{value,label}] ── */
  function optionsFor(level) {
    switch (level) {
      case 'maker':
        return tree.map(t => ({ value: t.maker, label: `${t.maker} (${t.modelCount})` }));
      case 'model': {
        const mk = makerNode();
        return mk ? mk.models.map(m => ({ value: m.model, label: `${m.model} (${m.subModelCount})` })) : [];
      }
      case 'catalogId': {
        const md = modelNode();
        return md ? md.subModels.map(s => ({
          value: s.id,
          label: `${s.subModel}${s.year ? ' · ' + s.year : ''}${s.trimCount ? ' · 트림' + s.trimCount : ''}`,
        })) : [];
      }
      case 'variant': {
        const sm = subNode();
        return sm ? sm.variants.map(v => ({ value: v.variant, label: `${v.variant} (${v.trims.length})` })) : [];
      }
      case 'trim': {
        const v = variantNode();
        return v ? v.trims.map(t => ({ value: t, label: t })) : [];
      }
    }
    return [];
  }

  /* ── DOM 골격 ── */
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">
        ${LEVELS.map((lv, i) => `
          <label style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:150px;">
            <span style="font-size:var(--fs-2xs);color:var(--text-muted);font-weight:600;">${LABELS[i]}</span>
            <select class="input" data-lv="${lv}" disabled></select>
          </label>`).join('')}
      </div>
      <div data-mc-result></div>
    </div>`;

  const selects = {};
  for (const lv of LEVELS) selects[lv] = el.querySelector(`select[data-lv="${lv}"]`);
  const resultEl = el.querySelector('[data-mc-result]');

  /* ── select 채우기 ── */
  function fillSelect(level) {
    const sel = selects[level];
    const opts = optionsFor(level);
    const cur = state[level];
    sel.innerHTML =
      `<option value="">${opts.length ? '선택' : '─'}</option>` +
      opts.map(o => `<option value="${esc(o.value)}"${o.value === cur ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    sel.disabled = opts.length === 0;
  }

  /* 상위 변경 시: 해당 레벨 이후 상태 초기화 + 단일 옵션 자동선택 cascade */
  function clearBelow(level) {
    const start = LEVELS.indexOf(level) + 1;
    for (let i = start; i < LEVELS.length; i++) state[LEVELS[i]] = '';
  }
  function autoFillDown(fromLevel) {
    for (let i = LEVELS.indexOf(fromLevel) + 1; i < LEVELS.length; i++) {
      const opts = optionsFor(LEVELS[i]);
      if (opts.length === 1) state[LEVELS[i]] = opts[0].value;
      else break;
    }
  }

  function refreshAll() {
    for (const lv of LEVELS) fillSelect(lv);
    renderResult();
    if (typeof opts.onSelect === 'function') opts.onSelect(getSelection());
  }

  /* ── 결과 패널 ── */
  function getSelection() {
    const sm = subNode();
    const complete = !!(state.maker && state.model && state.catalogId && state.variant && state.trim);
    return {
      maker: state.maker,
      model: state.model,
      catalogId: state.catalogId,
      subModel: sm ? sm.subModel : '',
      year: sm ? sm.year : '',
      variant: state.variant,
      trim: state.trim,
      title: sm ? sm.title : '',
      complete,
    };
  }

  function renderResult() {
    const s = getSelection();
    if (!s.maker) {
      resultEl.innerHTML = `<div style="color:var(--text-muted);font-size:var(--fs-xs);padding:6px 2px;">① 제조사부터 선택하세요.</div>`;
      return;
    }
    const chain = [
      ['제조사', s.maker],
      ['모델', s.model],
      ['세부모델', s.subModel && (s.subModel + (s.year ? ` (${s.year})` : ''))],
      ['파워트레인', s.variant],
      ['트림', s.trim && s.trim !== '(기본)' ? s.trim : (s.variant ? '(기본)' : '')],
    ].filter(([, v]) => v);

    const cnt = counts && s.catalogId ? (counts.get(s.catalogId) || 0) : null;

    resultEl.innerHTML = `
      <div style="padding:8px 10px;background:var(--alert-blue-bg);border:1px solid var(--alert-blue-border);border-radius:4px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:var(--fs-sm);">
          ${chain.map(([k, v], i) => `
            ${i ? '<span style="color:var(--text-muted);">›</span>' : ''}
            <span><span style="color:var(--text-muted);font-size:var(--fs-2xs);">${k}</span> <b>${esc(v)}</b></span>
          `).join('')}
          ${s.complete ? '<span style="margin-left:auto;color:var(--text-link);font-size:var(--fs-2xs);"><i class="ph ph-check-circle"></i> 5단계 완성</span>' : ''}
        </div>
        ${cnt != null && cnt > 0 ? `<div style="margin-top:4px;font-size:var(--fs-xs);color:var(--text-sub);">📦 등록 매물 ${cnt}대</div>` : ''}
        ${showId && s.catalogId ? `<div style="margin-top:4px;font-size:var(--fs-2xs);color:var(--text-muted);font-family:monospace;">catalog_id: ${esc(s.catalogId)}</div>` : ''}
      </div>`;
  }

  /* ── 이벤트 ── */
  for (const lv of LEVELS) {
    selects[lv].addEventListener('change', (e) => {
      state[lv] = e.target.value;
      clearBelow(lv);
      if (state[lv]) autoFillDown(lv);
      refreshAll();
    });
  }

  /* ── 공개 API ── */
  function setSelection(s = {}) {
    state.maker = s.maker || '';
    state.model = s.model || '';
    state.catalogId = s.catalogId || '';
    state.variant = s.variant || '';
    state.trim = s.trim || '';
    refreshAll();
  }

  // 초기 렌더
  if (opts.initial) setSelection(opts.initial);
  else refreshAll();

  return {
    getSelection,
    setSelection,
    refresh(idx) { if (idx) tree = buildMasterTree(idx); refreshAll(); },
  };
}
