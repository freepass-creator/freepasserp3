/**
 * confirm.js — 커스텀 확인 다이얼로그 (Windows native confirm() 대체)
 *
 *  사용:
 *    if (!await customConfirm('삭제하시겠습니까?')) return;
 *    if (!await customConfirm({ title: '삭제', message: '...', danger: true, okLabel: '삭제' })) return;
 *
 *  특징:
 *  - 화면 가운데 고정, backdrop blur
 *  - ESC / 백드롭 클릭 → 취소 (resolve false)
 *  - Enter → 확인 (resolve true)
 *  - danger:true → 확인 버튼 빨간색
 */

let _activeOverlay = null;

export function customConfirm(messageOrOpts) {
  const opts = typeof messageOrOpts === 'string'
    ? { message: messageOrOpts }
    : (messageOrOpts || {});
  const {
    title = '',
    message = '',
    okLabel = '확인',
    cancelLabel = '취소',
    danger = false,
  } = opts;

  return new Promise(resolve => {
    // 이미 열려있는 overlay 있으면 닫기 (중복 방지)
    if (_activeOverlay) {
      try { _activeOverlay.remove(); } catch (_) {}
      _activeOverlay = null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-card" role="alertdialog" aria-modal="true">
        ${title ? `<div class="confirm-title">${esc(title)}</div>` : ''}
        <div class="confirm-message">${esc(message).replace(/\n/g, '<br>')}</div>
        <div class="confirm-actions">
          <button type="button" class="confirm-btn confirm-cancel">${esc(cancelLabel)}</button>
          <button type="button" class="confirm-btn confirm-ok ${danger ? 'is-danger' : 'is-primary'}">${esc(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    _activeOverlay = overlay;

    const cleanup = (result) => {
      overlay.classList.add('is-leaving');
      setTimeout(() => {
        try { overlay.remove(); } catch (_) {}
        if (_activeOverlay === overlay) _activeOverlay = null;
      }, 160);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    };
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);  // backdrop click
    });
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => cleanup(true));

    // 첫 paint 후 fade-in 트리거
    requestAnimationFrame(() => overlay.classList.add('is-shown'));
    // 확인 버튼에 자동 포커스 (Enter 즉시 통과 가능)
    setTimeout(() => overlay.querySelector('.confirm-ok')?.focus(), 60);
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
