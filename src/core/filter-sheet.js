/**
 * filter-sheet.js — 모바일/데스크톱 공용 필터 바텀시트.
 *
 * 사용:
 *   openFilterSheet({
 *     products,           // 전체 매물 — dynamic chip 집계용
 *     activeFilters,      // Map<groupKey, Set<chipId>> — caller 가 소유 (mutable)
 *     onApply,            // 시트 [적용] 클릭 시 호출 (caller 가 render + dot 갱신)
 *     onChange,           // chip 토글마다 호출 (라이브 미리보기 — optional)
 *     getFilterCount,     // 외부 카운트 — title 뱃지 (optional, 기본 activeFilters 합)
 *   });
 *
 * 핵심 정책:
 *   - dynamic 칩 (제조사 등) 은 products 기준 매번 빌드.
 *   - "더보기" / 섹션 접힘 상태는 시트 인스턴스 단위로 유지 (전역 X) — 다음 시트 호출 시 초기화.
 *   - activeFilters 는 caller 가 소유. 시트는 set 을 mutate 만 하고 onApply 콜백으로 caller 의 render 트리거.
 */
import { FILTERS, buildDynamicChips } from './product-filters.js';
import { openBottomSheet } from './mobile-shell.js';

/** range 그룹 값이 활성 상태인지 (min 또는 max 가 데이터 범위 안쪽으로 좁혀졌을 때) */
const isRangeActive = (val, dataMax) => {
  if (!val) return false;
  const minSet = val.min != null && val.min > 0;
  const maxSet = val.max != null && val.max < dataMax;
  return minSet || maxSet;
};

export function openFilterSheet({
  products = [],
  activeFilters = {},
  onApply,
  onChange,
  getFilterCount,
  anchor = null,
} = {}) {
  // dynamic 칩 집계 (제조사 등)
  buildDynamicChips(products);

  // range 타입 필터의 데이터 max 값 사전 계산 (시트 인스턴스 단위)
  const dataMax = {};
  for (const [k, f] of Object.entries(FILTERS)) {
    if (f.type !== 'range') continue;
    let max = 0;
    for (const p of products) {
      const v = f.field(p);
      if (v > max) max = v;
    }
    dataMax[k] = max || 1;
  }

  const ensureSet = (k) => (activeFilters[k] = activeFilters[k] || new Set());
  const ensureRange = (k) => {
    if (!activeFilters[k] || activeFilters[k] instanceof Set) {
      activeFilters[k] = { min: 0, max: dataMax[k] };
    }
    return activeFilters[k];
  };
  const countAll = () => {
    if (typeof getFilterCount === 'function') return getFilterCount();
    let n = 0;
    for (const [k, val] of Object.entries(activeFilters)) {
      const f = FILTERS[k];
      if (f?.type === 'range') { if (isRangeActive(val, dataMax[k])) n += 1; }
      else if (val?.size) n += val.size;
    }
    return n;
  };

  // 시트 인스턴스 단위 state (다음 호출 시 초기화)
  const dynExpanded = {};
  const secCollapsed = {};

  const chipHtml = (key, c, set) =>
    `<button class="chip ${set?.has(c.id) ? 'is-active' : ''}" data-c="${c.id}">${c.label}</button>`;

  // range 표시 — 1,000,000 → "100" (만원). max=0 면 "—".
  const fmtRange = (n, divisor) => {
    if (!n) return '0';
    return Math.round(n / (divisor || 10000)).toLocaleString();
  };

  const renderSection = (key, f) => {
    let chipsHtml = '';
    let bodyHtml = '';
    let activeCount = 0;

    if (f.type === 'range') {
      const max = dataMax[key] || 1;
      const range = ensureRange(key);
      if (range.max == null || range.max > max) range.max = max;
      if (range.min == null || range.min < 0) range.min = 0;
      activeCount = isRangeActive(range, max) ? 1 : 0;
      const step = f.step || 100000;
      bodyHtml = `
        <div class="m-filter-range" data-range-g="${key}" data-max="${max}" data-step="${step}" data-divisor="${f.divisor || 10000}" data-unit="${f.unit || ''}">
          <div class="m-filter-range-display">
            <b data-rd-min>${fmtRange(range.min, f.divisor)}</b>
            <span> ~ </span>
            <b data-rd-max>${fmtRange(range.max, f.divisor)}</b>
            <span class="m-filter-range-unit">${f.unit || ''}</span>
          </div>
          <div class="m-filter-range-row">
            <label>최소</label>
            <input type="range" data-r-min min="0" max="${max}" step="${step}" value="${range.min}">
          </div>
          <div class="m-filter-range-row">
            <label>최대</label>
            <input type="range" data-r-max min="0" max="${max}" step="${step}" value="${range.max}">
          </div>
        </div>
      `;
    } else if (f.dynamic) {
      const set = activeFilters[key];
      const popular = f.popular || [];
      const others  = f.others  || [];
      const open = !!dynExpanded[key];
      chipsHtml = popular.map(c => chipHtml(key, c, set)).join('');
      if (open) chipsHtml += others.map(c => chipHtml(key, c, set)).join('');
      if (others.length) {
        chipsHtml += `<button class="m-filter-more" data-more="${key}">${open ? '접기' : `더보기 (${others.length})`}</button>`;
      }
      activeCount = set?.size || 0;
      bodyHtml = `<div class="m-filter-chips" data-g="${key}">${chipsHtml}</div>`;
    } else {
      const set = activeFilters[key];
      chipsHtml = f.chips.map(c => chipHtml(key, c, set)).join('');
      if (!chipsHtml) return '';
      activeCount = set?.size || 0;
      bodyHtml = `<div class="m-filter-chips" data-g="${key}">${chipsHtml}</div>`;
    }

    if (!bodyHtml) return '';
    const collapsed = secCollapsed[key] ? 'is-collapsed' : '';
    const toggleIcon = secCollapsed[key] ? 'ph-caret-right' : 'ph-caret-down';
    return `
      <div class="m-filter-section ${activeCount ? 'has-active' : ''} ${collapsed}" data-sec="${key}">
        <div class="m-filter-section-title" data-sec-toggle="${key}">
          <i class="${f.icon}"></i>
          <span>${f.label}</span>
          ${activeCount > 0 ? `<span class="m-filter-section-count">${activeCount}</span>` : ''}
          <i class="ph ${toggleIcon}"></i>
        </div>
        ${bodyHtml}
      </div>
    `;
  };

  const sectionsHtml = Object.entries(FILTERS).map(([k, f]) => renderSection(k, f)).join('');

  const html = `<div class="m-filter-sheet">${sectionsHtml}</div>`;
  const footerHtml = `
    <div class="m-filter-actions">
      <button class="btn btn-outline" id="filterSheetReset">초기화</button>
      <button class="btn btn-outline" id="filterSheetCancel">취소</button>
      <button class="btn btn-primary" id="filterSheetApply">적용</button>
    </div>
  `;

  // 시트 열 때 현재 활성 필터 스냅샷 — [취소] 시 원복
  const snapshot = {};
  for (const [k, val] of Object.entries(activeFilters)) {
    if (val instanceof Set) snapshot[k] = new Set(val);
    else if (val && typeof val === 'object') snapshot[k] = { ...val };
  }
  const restoreFromSnapshot = () => {
    for (const k of Object.keys(activeFilters)) delete activeFilters[k];
    for (const [k, val] of Object.entries(snapshot)) {
      if (val instanceof Set) activeFilters[k] = new Set(val);
      else if (val && typeof val === 'object') activeFilters[k] = { ...val };
    }
  };

  const totalCount = countAll();

  /** 시트 제목 뱃지 동기화 */
  const syncTitleBadge = (sheetRoot) => {
    if (!sheetRoot) return;
    const title = sheetRoot.querySelector('.m-sheet-title');
    if (!title) return;
    const total = countAll();
    const existing = title.querySelector('.sb-badge');
    if (total) {
      if (existing) existing.textContent = total;
      else title.insertAdjacentHTML('beforeend', ` <span class="sb-badge is-visible">${total}</span>`);
    } else {
      existing?.remove();
    }
  };

  const sheet = openBottomSheet(html, {
    title: `필터${totalCount ? ` <span class="sb-badge is-visible">${totalCount}</span>` : ''}`,
    footer: footerHtml,
    anchor,
    onMount: (root) => {
      // 섹션 접기 토글 (타이틀 클릭, 단 칩/더보기 클릭은 제외)
      root.addEventListener('click', (e) => {
        const toggleTitle = e.target.closest('[data-sec-toggle]');
        if (!toggleTitle) return;
        if (e.target.closest('[data-c], [data-more]')) return;
        const key = toggleTitle.dataset.secToggle;
        secCollapsed[key] = !secCollapsed[key];
        const section = toggleTitle.closest('.m-filter-section');
        section?.classList.toggle('is-collapsed');
        const caret = toggleTitle.querySelector('.ph-caret-down, .ph-caret-right');
        if (caret) {
          caret.classList.toggle('ph-caret-down');
          caret.classList.toggle('ph-caret-right');
        }
      });

      const bindGroups = () => {
        root.querySelectorAll('[data-g]').forEach(group => {
          const g = group.dataset.g;
          ensureSet(g);
          group.onclick = (e) => {
            // "더보기/접기" 토글
            const moreBtn = e.target.closest('[data-more]');
            if (moreBtn) {
              const k = moreBtn.dataset.more;
              dynExpanded[k] = !dynExpanded[k];
              const section = moreBtn.closest('.m-filter-section');
              const next = document.createElement('div');
              next.innerHTML = renderSection(k, FILTERS[k]).trim();
              const newEl = next.firstElementChild;
              if (newEl && section) {
                section.replaceWith(newEl);
                bindGroups();
              }
              return;
            }
            // 칩 토글
            const btn = e.target.closest('[data-c]');
            if (!btn) return;
            const c = btn.dataset.c;
            const set = activeFilters[g];
            if (set.has(c)) set.delete(c);
            else set.add(c);
            btn.classList.toggle('is-active');
            // 섹션 카운트 뱃지 갱신
            const section = btn.closest('.m-filter-section');
            const cnt = set.size;
            const titleEl = section?.querySelector('.m-filter-section-title');
            const countEl = section?.querySelector('.m-filter-section-count');
            if (cnt > 0) {
              if (countEl) countEl.textContent = cnt;
              else {
                const labelSpan = titleEl?.querySelector('span');
                labelSpan?.insertAdjacentHTML('afterend', `<span class="m-filter-section-count">${cnt}</span>`);
              }
              section?.classList.add('has-active');
            } else {
              countEl?.remove();
              section?.classList.remove('has-active');
            }
            // 라이브 미리보기 + 시트 제목 뱃지
            onChange?.();
            syncTitleBadge(sheet.root);
          };
        });
      };
      bindGroups();

      // range 슬라이더 바인딩 — input 이벤트로 라이브 갱신, max < min 충돌 보정
      const bindRanges = () => {
        root.querySelectorAll('[data-range-g]').forEach(box => {
          const g = box.dataset.rangeG;
          const max = Number(box.dataset.max);
          const divisor = Number(box.dataset.divisor) || 10000;
          const inMin = box.querySelector('[data-r-min]');
          const inMax = box.querySelector('[data-r-max]');
          const dMin = box.querySelector('[data-rd-min]');
          const dMax = box.querySelector('[data-rd-max]');
          const range = ensureRange(g);
          const update = () => {
            let lo = Number(inMin.value);
            let hi = Number(inMax.value);
            if (lo > hi) {
              // 충돌 시 마지막 움직인 슬라이더에 맞춰 다른 쪽을 끌고 옴
              if (document.activeElement === inMin) inMax.value = lo;
              else inMin.value = hi;
              lo = Number(inMin.value);
              hi = Number(inMax.value);
            }
            range.min = lo;
            range.max = hi;
            dMin.textContent = Math.round(lo / divisor).toLocaleString();
            dMax.textContent = Math.round(hi / divisor).toLocaleString();
            // 섹션 활성 상태 갱신
            const section = box.closest('.m-filter-section');
            const active = isRangeActive(range, max);
            const titleEl = section?.querySelector('.m-filter-section-title');
            const countEl = section?.querySelector('.m-filter-section-count');
            if (active) {
              if (!countEl) {
                const labelSpan = titleEl?.querySelector('span');
                labelSpan?.insertAdjacentHTML('afterend', `<span class="m-filter-section-count">1</span>`);
              }
              section?.classList.add('has-active');
            } else {
              countEl?.remove();
              section?.classList.remove('has-active');
            }
            onChange?.();
            syncTitleBadge(sheet.root);
          };
          inMin.addEventListener('input', update);
          inMax.addEventListener('input', update);
        });
      };
      bindRanges();

      root.querySelector('#filterSheetReset')?.addEventListener('click', () => {
        for (const [k, f] of Object.entries(FILTERS)) {
          if (f.type === 'range') activeFilters[k] = { min: 0, max: dataMax[k] || 1 };
          else activeFilters[k] = new Set();
        }
        root.querySelectorAll('.chip.is-active').forEach(c => c.classList.remove('is-active'));
        root.querySelectorAll('.m-filter-section.has-active').forEach(s => s.classList.remove('has-active'));
        root.querySelectorAll('.m-filter-section-count').forEach(b => b.remove());
        // range slider 도 reset
        root.querySelectorAll('[data-range-g]').forEach(box => {
          const max = Number(box.dataset.max);
          const divisor = Number(box.dataset.divisor) || 10000;
          box.querySelector('[data-r-min]').value = 0;
          box.querySelector('[data-r-max]').value = max;
          box.querySelector('[data-rd-min]').textContent = '0';
          box.querySelector('[data-rd-max]').textContent = Math.round(max / divisor).toLocaleString();
        });
        onChange?.();
        syncTitleBadge(sheet.root);
      });

      root.querySelector('#filterSheetCancel')?.addEventListener('click', () => {
        // 시트 열 때 상태로 원복 후 닫기 (즉시반영 모드라 onChange 로 결과도 원복)
        restoreFromSnapshot();
        onChange?.();
        sheet.close();
      });
      root.querySelector('#filterSheetApply')?.addEventListener('click', () => {
        onApply?.();
        sheet.close();
      });
    },
  });
  return sheet;
}
