/**
 * WS4 4패널 리사이즈 — localStorage 저장/복원 + 더블클릭 복원
 *
 * 사용법: initWs4Resize('fp.ws4.widths')
 */

export function initWs4Resize(storageKey) {
  // 저장된 폭 복원
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved)) {
      const panels = document.querySelectorAll('.ws4-panel');
      saved.forEach((w, i) => {
        if (w && panels[i]) {
          panels[i].style.width = w;
          panels[i].style.flex = 'none';
        }
      });
    }
  } catch (e) { /* ignore */ }

  document.querySelectorAll('.ws4-resize').forEach(handle => {
    // 더블클릭 → 원래 비율 복원 + 저장 삭제
    handle.addEventListener('dblclick', () => {
      document.querySelectorAll('.ws4-panel').forEach(p => {
        p.style.width = '';
        p.style.flex = '';
      });
      localStorage.removeItem(storageKey);
    });

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const panels = document.querySelectorAll('.ws4-panel');
      const idx = parseInt(handle.dataset.idx);
      const panel = panels[idx];
      const startX = e.clientX;
      const startW = panel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev) => {
        panel.style.width = `${Math.max(160, startW + ev.clientX - startX)}px`;
        panel.style.flex = 'none';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const widths = Array.from(document.querySelectorAll('.ws4-panel')).map(p => p.style.width || '');
        localStorage.setItem(storageKey, JSON.stringify(widths));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}
