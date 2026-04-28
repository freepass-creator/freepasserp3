/**
 * 공용 엑셀 테이블 렌더러
 * - 헤더/바디 분리 테이블 (colgroup 공유로 정렬)
 * - sticky left/right pinned 컬럼
 * - 헤더 클릭 필터 (search/check)
 * - 컬럼 리사이즈 (드래그) + 더블클릭 auto-fit
 * - 행 클릭/우클릭 이벤트 위임
 *
 * 사용:
 *   renderExcelTable(containerEl, {
 *     cols: [
 *       { key: 'car_number', label: '차량번호', width: 90, filter: 'search', pin: 'left' },
 *       { key: 'status', label: '상태', width: 70, filter: 'check' },
 *       { key: 'price', label: '가격', width: 80, filter: false, render: (row) => `...` },
 *     ],
 *     data: [...],
 *     activeKey: '...',
 *     keyField: '_key',
 *     onRowClick: (row) => {},
 *     onContextMenu: (row, event) => {},
 *   });
 */
export function renderExcelTable(container, opts) {
  const {
    cols,
    data,
    activeKey,
    keyField = '_key',
    onRowClick,
    onContextMenu,
  } = opts;

  // 컬럼 폭 관리 (인덱스 기반)
  const widths = cols.map(c => c.width || 80);
  const totalW = () => widths.reduce((s, w) => s + w, 0);

  // pinned left 오프셋 계산 (좌측 pinned 컬럼 누적)
  const pinLeftOffsets = {};
  let leftAcc = 0;
  cols.forEach((c, i) => {
    if (c.pin === 'left') {
      pinLeftOffsets[i] = leftAcc;
      leftAcc += widths[i];
    }
  });

  // pinned right 오프셋 계산 (우측부터 누적)
  const pinRightOffsets = {};
  let rightAcc = 0;
  for (let i = cols.length - 1; i >= 0; i--) {
    if (cols[i].pin === 'right') {
      pinRightOffsets[i] = rightAcc;
      rightAcc += widths[i];
    }
  }

  const pinStyle = (i) => {
    if (cols[i].pin === 'left') return `left:${pinLeftOffsets[i]}px;`;
    if (cols[i].pin === 'right') return `right:${pinRightOffsets[i]}px;`;
    return '';
  };

  const colgroupHtml = () => `<colgroup>${widths.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;

  const headHtml = () => `
    <table class="excl-table" style="width:${totalW()}px">${colgroupHtml()}
      <thead><tr>${cols.map((c, i) => {
        const cls = [
          c.pin === 'left' ? 'excl-sticky-left' : '',
          c.pin === 'right' ? 'excl-pin-r' : '',
          c.align === 'right' ? 'excl-align-right' : '',
        ].filter(Boolean).join(' ');
        const s = pinStyle(i);
        return `<th class="${cls}" data-ci="${i}" ${c.filter ? `data-ft="${c.filter}"` : ''} ${s ? `style="${s}"` : ''}>${c.label}</th>`;
      }).join('')}</tr></thead>
    </table>`;

  const bodyHtml = () => `
    <table class="excl-table" style="width:${totalW()}px">${colgroupHtml()}
      <tbody>${data.map(row => {
        const key = row[keyField];
        return `<tr class="excl-row ${activeKey === key ? 'is-active' : ''}" data-key="${key}">${cols.map((c, i) => {
          const cls = [
            c.pin === 'left' ? 'excl-sticky-left' : '',
            c.pin === 'right' ? 'excl-pin-r' : '',
            c.align === 'right' ? 'excl-align-right' : '',
            c.cellClass || '',
          ].filter(Boolean).join(' ');
          const s = pinStyle(i);
          const val = c.render ? c.render(row) : (row[c.key] ?? '');
          return `<td class="${cls}" ${s ? `style="${s}"` : ''}>${val}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody>
    </table>`;

  container.innerHTML = `
    <div class="excl-head">${headHtml()}</div>
    <div class="excl-body">${bodyHtml()}</div>
  `;

  const headEl = container.querySelector('.excl-head');
  const bodyEl = container.querySelector('.excl-body');

  // 스크롤바 폭 보정 + 동기화
  requestAnimationFrame(() => {
    const sbWidth = bodyEl.offsetWidth - bodyEl.clientWidth;
    if (sbWidth > 0) headEl.style.paddingRight = `${sbWidth}px`;
  });
  bodyEl.addEventListener('scroll', () => { headEl.scrollLeft = bodyEl.scrollLeft; });

  // 행 클릭/우클릭 이벤트 위임
  if (onRowClick) {
    bodyEl.addEventListener('click', (e) => {
      const row = e.target.closest('.excl-row');
      if (!row) return;
      bodyEl.querySelector('.excl-row.is-active')?.classList.remove('is-active');
      row.classList.add('is-active');
      const item = data.find(d => String(d[keyField]) === row.dataset.key);
      if (item) onRowClick(item);
    });
  }
  if (onContextMenu) {
    bodyEl.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.excl-row');
      if (!row) return;
      e.preventDefault();
      const item = data.find(d => String(d[keyField]) === row.dataset.key);
      if (item) onContextMenu(item, e);
    });
  }

  // 헤더 필터 — 토글
  let _openFilterTh = null;
  const closeFilter = () => { document.querySelector('.excl-filter')?.remove(); _openFilterTh = null; };

  headEl.querySelectorAll('th[data-ft]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const ft = th.dataset.ft;
      const ci = Number(th.dataset.ci);
      if (ft === 'sort') return;
      if (_openFilterTh === th) { closeFilter(); return; }
      closeFilter();
      _openFilterTh = th;

      const rect = th.getBoundingClientRect();
      const popup = document.createElement('div');
      popup.className = 'excl-filter';
      popup.style.cssText = `position:fixed;top:${rect.bottom+2}px;left:${rect.left}px;z-index:9999;min-width:${Math.max(rect.width,140)}px;max-height:300px;display:flex;flex-direction:column;background:var(--c-bg);border:1px solid var(--c-border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.12);font-size:var(--fs-sm);`;

      if (ft === 'search') {
        popup.innerHTML = `<div style="padding:6px 8px;"><input class="input input-sm" placeholder="검색..." autofocus style="width:100%;"></div>
          <div style="display:flex;gap:4px;padding:6px 8px;border-top:1px solid var(--c-border-soft);">
            <button class="btn btn-xs btn-outline" data-a="reset" style="flex:1;">초기화</button>
            <button class="btn btn-xs btn-primary" data-a="apply" style="flex:1;">적용</button>
          </div>`;
        const input = popup.querySelector('input');
        setTimeout(() => input?.focus(), 50);
        input?.addEventListener('keydown', ev => { if (ev.key === 'Enter') popup.querySelector('[data-a="apply"]')?.click(); });
        popup.querySelector('[data-a="reset"]')?.addEventListener('click', () => {
          bodyEl.querySelectorAll('.excl-row').forEach(row => { row.style.display = ''; });
          closeFilter();
        });
        popup.querySelector('[data-a="apply"]')?.addEventListener('click', () => {
          const q = input?.value?.toLowerCase() || '';
          bodyEl.querySelectorAll('.excl-row').forEach(row => {
            const cell = row.children[ci]?.textContent?.toLowerCase() || '';
            row.style.display = !q || cell.includes(q) ? '' : 'none';
          });
          closeFilter();
        });
      } else if (ft === 'check') {
        const vals = {};
        bodyEl.querySelectorAll('.excl-row').forEach(row => {
          const v = row.children[ci]?.textContent?.trim() || '';
          if (v) vals[v] = (vals[v] || 0) + 1;
        });
        const sorted = Object.entries(vals).sort((a, b) => b[1] - a[1]);
        popup.innerHTML = `
          <div style="flex:1;overflow:auto;padding:4px 0;">${sorted.map(([v, cnt]) => `<label style="display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;white-space:nowrap;"><input type="checkbox" value="${v}" style="accent-color:var(--c-accent);"> ${v} <span style="color:var(--c-text-muted);font-size:12px;margin-left:auto;">${cnt}</span></label>`).join('')}</div>
          <div style="display:flex;gap:4px;padding:6px 8px;border-top:1px solid var(--c-border-soft);">
            <button class="btn btn-xs btn-outline" data-a="reset" style="flex:1;">초기화</button>
            <button class="btn btn-xs btn-primary" data-a="apply" style="flex:1;">적용</button>
          </div>`;
        popup.querySelector('[data-a="reset"]')?.addEventListener('click', () => {
          bodyEl.querySelectorAll('.excl-row').forEach(row => { row.style.display = ''; });
          closeFilter();
        });
        popup.querySelector('[data-a="apply"]')?.addEventListener('click', () => {
          const checked = new Set([...popup.querySelectorAll('input:checked')].map(c => c.value));
          bodyEl.querySelectorAll('.excl-row').forEach(row => {
            const cell = row.children[ci]?.textContent?.trim() || '';
            row.style.display = !checked.size || checked.has(cell) ? '' : 'none';
          });
          closeFilter();
        });
      }

      document.body.appendChild(popup);
      requestAnimationFrame(() => {
        const pr = popup.getBoundingClientRect();
        if (pr.right > window.innerWidth) popup.style.left = `${window.innerWidth - pr.width - 8}px`;
        if (pr.bottom > window.innerHeight) popup.style.top = `${rect.top - pr.height - 2}px`;
      });
      const onKey = ev => { if (ev.key === 'Escape') { closeFilter(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);
      setTimeout(() => {
        const onOut = ev => { if (!popup.contains(ev.target) && ev.target !== th) { closeFilter(); document.removeEventListener('pointerdown', onOut); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('pointerdown', onOut);
      });
    });
  });

  // 컬럼 리사이즈 — 드래그
  headEl.querySelectorAll('th').forEach((th, i) => {
    th.style.position = 'relative';
    const handle = document.createElement('div');
    handle.className = 'excl-resize';
    th.appendChild(handle);
    const defaultW = widths[i];
    let isExpanded = false;
    // 더블클릭 → auto-fit / 복원
    handle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (!isExpanded) {
        let maxW = th.scrollWidth;
        bodyEl.querySelectorAll(`.excl-row td:nth-child(${i+1})`).forEach(td => { maxW = Math.max(maxW, td.scrollWidth + 16); });
        widths[i] = Math.max(defaultW, maxW);
        isExpanded = true;
      } else {
        widths[i] = defaultW;
        isExpanded = false;
      }
      applyWidths();
    });
    // 드래그 리사이즈
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = widths[i];
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      let rafId = 0;
      const tables = container.querySelectorAll('.excl-table');
      const colEls = container.querySelectorAll(`.excl-table col:nth-child(${i+1})`);
      const onMove = (ev) => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const newW = Math.max(30, startW + ev.clientX - startX);
          widths[i] = newW;
          const tw = totalW();
          tables.forEach(t => { t.style.width = `${tw}px`; });
          colEls.forEach(col => { col.style.width = `${newW}px`; });
        });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  function applyWidths() {
    const tw = totalW();
    container.querySelectorAll('.excl-table').forEach(t => { t.style.width = `${tw}px`; });
    widths.forEach((w, i) => {
      container.querySelectorAll(`.excl-table col:nth-child(${i+1})`).forEach(col => { col.style.width = `${w}px`; });
    });
  }
}
