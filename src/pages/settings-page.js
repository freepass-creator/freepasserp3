/**
 * 설정 — 앱 환경설정만 (알림 · 카탈로그 · 테마 · 시작페이지 · 기간 필터)
 *  계정/프로필 관련은 /account 로 이동
 */
import { store } from '../core/store.js';
import { requestNotificationPermission } from '../firebase/messaging.js';
import { showToast } from '../core/toast.js';
import { toggleSound } from '../core/chat-notif.js';

export function mount() {
  const main = document.getElementById('mainContent');
  const user = store.currentUser || {};
  const soundOn = localStorage.getItem('fp.sound') !== 'off';
  const landingPage = localStorage.getItem('fp.landing') || '/search';
  const badgeSettings = JSON.parse(localStorage.getItem('fp.badges') || '{"chat":true,"contract":true,"settle":true}');
  const periodFilter = JSON.parse(localStorage.getItem('fp.period.filter') || '[12,24,36]');

  main.innerHTML = `
    <div class="st-page">

      <div class="contract-section"><div class="contract-section-title">앱 환경</div>
        <div style="padding:var(--sp-2) var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-1);">
          <div class="contract-field" style="cursor:pointer;" id="stTheme">
            <span class="contract-field-label">다크모드</span>
            <span style="font-size:var(--fs-xs);"><i class="ph ${store.theme === 'dark' ? 'ph-sun' : 'ph-moon'}"></i> ${store.theme === 'dark' ? 'ON' : 'OFF'}</span>
          </div>
          <div class="contract-field">
            <span class="contract-field-label">시작 페이지</span>
            <select class="select input-xs" id="stLanding" style="width:120px;">
              ${[{v:'/search',l:'찾기'},{v:'/',l:'작업'},{v:'/contract',l:'계약'},{v:'/settle',l:'정산'}].map(o =>
                `<option value="${o.v}" ${landingPage === o.v ? 'selected' : ''}>${o.l}</option>`
              ).join('')}
            </select>
          </div>
          <div class="contract-field">
            <span class="contract-field-label">대여 기간 필터</span>
            <div style="display:flex;gap:3px;">
              ${[12,24,36,48,60].map(m => `<button class="chip chip-xs ${periodFilter.includes(m) ? 'is-active' : ''}" data-period="${m}">${m}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="contract-section"><div class="contract-section-title">알림</div>
        <div style="padding:var(--sp-2) var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-1);">
          <div class="contract-field" style="cursor:pointer;" id="stPush">
            <span class="contract-field-label">웹 푸시 알림</span>
            <span style="font-size:var(--fs-xs);color:${Notification.permission === 'granted' ? 'var(--c-ok)' : 'var(--c-text-muted)'};">${Notification.permission === 'granted' ? '허용됨' : '허용 필요'}</span>
          </div>
          <div class="contract-field" style="cursor:pointer;" id="stSound">
            <span class="contract-field-label">알림 소리</span>
            <span style="font-size:var(--fs-xs);color:${soundOn ? 'var(--c-ok)' : 'var(--c-text-muted)'};">${soundOn ? 'ON' : 'OFF'}</span>
          </div>
          ${['chat','contract','settle'].map(key => {
            const labels = { chat: '대화 알림 뱃지', contract: '계약 알림 뱃지', settle: '정산 알림 뱃지' };
            const on = badgeSettings[key] !== false;
            return `<div class="contract-field" style="cursor:pointer;" data-badge="${key}">
              <span class="contract-field-label">${labels[key]}</span>
              <span style="font-size:var(--fs-xs);color:${on ? 'var(--c-ok)' : 'var(--c-text-muted)'};">${on ? 'ON' : 'OFF'}</span>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="contract-section"><div class="contract-section-title">카탈로그 공유</div>
        <div style="padding:var(--sp-2) var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-2);">
          <div style="display:flex;gap:var(--sp-2);align-items:center;">
            <input class="input input-sm" id="stCatalogUrl" readonly value="${location.origin}/catalog.html?a=${user.user_code || ''}" style="flex:1;">
            <button class="btn btn-sm btn-outline" id="stCatalogCopy"><i class="ph ph-copy"></i> 복사</button>
          </div>
          <div style="font-size:var(--fs-2xs);color:var(--c-text-muted);">이 링크를 고객에게 공유하면 내 카탈로그가 표시됩니다</div>
        </div>
      </div>

    </div>
  `;

  // Theme
  document.getElementById('stTheme')?.addEventListener('click', () => {
    const next = store.theme === 'dark' ? 'light' : 'dark';
    store.theme = next;
    document.documentElement.dataset.theme = next;
    localStorage.setItem('fp.theme', next);
    mount();
  });

  // Landing
  document.getElementById('stLanding')?.addEventListener('change', (e) => {
    localStorage.setItem('fp.landing', e.target.value);
    showToast('시작 페이지 변경됨');
  });

  // Period filter
  main.querySelectorAll('[data-period]').forEach(chip => {
    chip.addEventListener('click', () => {
      const m = parseInt(chip.dataset.period);
      const idx = periodFilter.indexOf(m);
      if (idx >= 0) periodFilter.splice(idx, 1);
      else periodFilter.push(m);
      localStorage.setItem('fp.period.filter', JSON.stringify(periodFilter));
      mount();
    });
  });

  // Push
  document.getElementById('stPush')?.addEventListener('click', async () => {
    const token = await requestNotificationPermission();
    showToast(token ? '알림 허용됨' : '알림 거부됨');
    mount();
  });

  // Sound
  document.getElementById('stSound')?.addEventListener('click', () => {
    const on = toggleSound();
    showToast(`알림 소리 ${on ? 'ON' : 'OFF'}`);
    mount();
  });

  // Badges
  main.querySelectorAll('[data-badge]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.badge;
      badgeSettings[key] = !badgeSettings[key];
      localStorage.setItem('fp.badges', JSON.stringify(badgeSettings));
      mount();
    });
  });

  // Catalog copy
  document.getElementById('stCatalogCopy')?.addEventListener('click', () => {
    const url = document.getElementById('stCatalogUrl')?.value;
    navigator.clipboard.writeText(url).then(() => showToast('링크 복사됨'));
  });
}

export function unmount() {}
