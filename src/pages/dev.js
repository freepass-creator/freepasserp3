/**
 * pages/dev.js — 개발도구 (admin 전용)
 *
 * v2 admin/dev.js 의 8개 탭 (vehicle / notice / color / data / upload / sync / stock / tools)
 * 현재 placeholder. 단계적으로 옮겨올 예정.
 */
import { store } from '../core/store.js';
import { esc } from '../core/ui-helpers.js';

const DEV_TABS = [
  { id: 'vehicle', icon: 'car-profile',     label: '차종 마스터',  sub: '제조사·모델·세부모델 CRUD' },
  { id: 'notice',  icon: 'megaphone',       label: '공지',         sub: '대시보드 공지 CRUD' },
  { id: 'color',   icon: 'palette',         label: '색상 옵션',    sub: '외장·내장 색상 마스터' },
  { id: 'data',    icon: 'database',        label: 'RTDB 현황',     sub: '컬렉션별 레코드 수·용량' },
  { id: 'upload',  icon: 'upload-simple',   label: '일괄 업로드',  sub: 'CSV·Excel·Sheets 임포트' },
  { id: 'sync',    icon: 'google-drive-logo', label: '시트 동기화', sub: 'Google Sheets ↔ Firebase' },
  { id: 'stock',   icon: 'trash',           label: '데이터 삭제',  sub: '재고·계약·정산 일괄 삭제' },
  { id: 'tools',   icon: 'wrench',          label: '시스템 도구',  sub: '버전·캐시·Store·마이그레이션' },
];

let _activeDev = 'vehicle';

export function renderDev() {
  const page = document.querySelector('.pt-page[data-page="dev"]');
  if (!page) return;
  const me = store.currentUser || {};
  if (me.role !== 'admin') {
    page.innerHTML = `<div style="padding: var(--sp-6); color: var(--text-muted); text-align: center;">관리자만 접근 가능합니다.</div>`;
    return;
  }
  const active = DEV_TABS.find(t => t.id === _activeDev);
  // 1 2 1 규격 — 좌(도구목록) / 가운데(본문) / 우(설명)
  page.innerHTML = `
    <div class="ws4">
      <!-- 좌 (1): 도구 목록 -->
      <div class="ws4-card ws4-list" style="flex: 1 1 0;">
        <div class="ws4-head"><i class="ph ph-code"></i> <span>개발도구</span></div>
        <div class="ws4-body" style="padding: var(--sp-2);">
          ${DEV_TABS.map(t => `
            <button class="settings-tab ${t.id === _activeDev ? 'is-active' : ''}" data-dev="${t.id}">
              <i class="ph ph-${t.icon}"></i>
              <span class="settings-tab-text">
                <span class="settings-tab-label">${t.label}</span>
                <span class="settings-tab-sub">${t.sub}</span>
              </span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- 가운데 (2): 본문 -->
      <div class="ws4-card" style="flex: 2 1 0;">
        <div class="ws4-head"><i class="ph ph-${active?.icon}"></i> <span>${esc(active?.label || '')}</span></div>
        <div class="ws4-body" id="devContent" style="padding: var(--sp-4); overflow-y: auto;">
          <div style="color: var(--text-muted); padding: var(--sp-6); text-align: center;">
            <i class="ph ph-wrench" style="font-size: 32px; display: block; margin-bottom: var(--sp-3);"></i>
            ${esc(active?.label)} — 준비 중
          </div>
        </div>
      </div>

      <!-- 우 (1): 설명 -->
      <div class="ws4-card" style="flex: 1 1 0;">
        <div class="ws4-head"><i class="ph ph-info"></i> <span>설명</span></div>
        <div class="ws4-body settings-help" style="padding: var(--sp-4); overflow-y: auto;">
          <h4 class="settings-help-title">${esc(active?.label || '')}</h4>
          <p>${esc(active?.sub || '')}</p>
          <p class="settings-help-tip">⚙ 관리자 전용 시스템 도구입니다. 작업은 즉시 반영되니 신중히.</p>
        </div>
      </div>
    </div>
  `;

  page.querySelectorAll('[data-dev]').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeDev = btn.dataset.dev;
      renderDev();
    });
  });
}
