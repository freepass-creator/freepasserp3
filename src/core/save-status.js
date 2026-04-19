/**
 * 자동저장 상태 표시 — 전역 세이브 인디케이터
 * 사용: trackSave(updateRecord(path, data))  또는  beginSave() / endSave(ok)
 */

let el = null;
let pending = 0;
let hideTimer = null;

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'saveStatus';
  el.className = 'save-status is-idle';
  el.innerHTML = `<i class="ph ph-check-circle"></i><span class="save-status-text">저장됨</span>`;
  document.body.appendChild(el);
  return el;
}

function setState(state, text, icon) {
  const node = ensureEl();
  node.classList.remove('is-idle', 'is-saving', 'is-saved', 'is-error');
  node.classList.add(`is-${state}`);
  node.querySelector('.save-status-text').textContent = text;
  node.querySelector('i').className = `ph ${icon}`;
}

export function beginSave() {
  pending++;
  clearTimeout(hideTimer);
  setState('saving', '저장 중...', 'ph-circle-notch ph-spin');
}

export function endSave(ok = true) {
  pending = Math.max(0, pending - 1);
  if (pending > 0) return;
  if (ok) {
    setState('saved', '저장됨', 'ph-check-circle');
    hideTimer = setTimeout(() => {
      ensureEl().classList.add('is-hidden');
    }, 1500);
  } else {
    setState('error', '저장 실패', 'ph-x-circle');
    hideTimer = setTimeout(() => {
      ensureEl().classList.add('is-hidden');
    }, 3000);
  }
}

export async function trackSave(promise) {
  beginSave();
  ensureEl().classList.remove('is-hidden');
  try {
    const result = await promise;
    endSave(true);
    return result;
  } catch (err) {
    endSave(false);
    throw err;
  }
}
