/**
 * 브레드크럼 — 경로 기반 메뉴 + 동적 작업 컨텍스트(tail) 표시
 *  예: 찾기 > 기아 K5 노블레스 · 12가1234
 *     작업 > 박영협님과 대화
 *     계약 > C-2024-0123
 */

const ROUTE_MAP = {
  '/':         [{ icon: 'ph ph-desktop', label: '작업' }],
  '/search':   [{ icon: 'ph ph-magnifying-glass', label: '찾기' }],
  '/contract': [{ icon: 'ph ph-list-magnifying-glass', label: '조회' }, { icon: 'ph ph-file-text', label: '계약' }],
  '/settle':   [{ icon: 'ph ph-list-magnifying-glass', label: '조회' }, { icon: 'ph ph-coins', label: '정산' }],
  '/product':  [{ icon: 'ph ph-plus-circle', label: '등록' }, { icon: 'ph ph-car-simple', label: '상품' }],
  '/policy':   [{ icon: 'ph ph-plus-circle', label: '등록' }, { icon: 'ph ph-scroll', label: '정책' }],
  '/admin/sign':     [{ icon: 'ph ph-crown', label: '관리자' }, { icon: 'ph ph-paper-plane-tilt', label: '계약발송' }],
  '/admin/users':    [{ icon: 'ph ph-crown', label: '관리자' }, { icon: 'ph ph-users', label: '사용자' }],
  '/admin/partners': [{ icon: 'ph ph-crown', label: '관리자' }, { icon: 'ph ph-buildings', label: '파트너' }],
  '/admin/dev':      [{ icon: 'ph ph-crown', label: '관리자' }, { icon: 'ph ph-code', label: '개발' }],
  '/settings': [{ icon: 'ph ph-gear', label: '설정' }],
  '/account':  [{ icon: 'ph ph-user', label: '계정 정보' }],
};

let currentPath = '';
let currentTail = null;    // 항목 선택 시 { icon, label, sub? }
let currentBrief = '';     // 페이지 브리핑 (항목 미선택 시)

/** 경로 변경 시 호출 — tail & brief 자동 초기화 */
export function renderBreadcrumb(path) {
  if (path !== currentPath) {
    currentPath = path;
    currentTail = null;
    currentBrief = '';
  }
  paintBreadcrumb();
}

/** 페이지에서 현재 작업중인 엔티티를 알림 */
export function setBreadcrumbTail(tail) {
  currentTail = tail;
  paintBreadcrumb();
}

/** 페이지 브리핑 (요약 문장) — tail이 있으면 가려짐 */
export function setBreadcrumbBrief(text) {
  currentBrief = text || '';
  paintBreadcrumb();
}

function paintBreadcrumb() {
  const el = document.getElementById('breadcrumb');
  if (!el) return;
  const base = ROUTE_MAP[currentPath] || [{ icon: 'ph ph-circle', label: currentPath }];

  let html = base.map((c, i) => {
    const isLast = i === base.length - 1 && !currentTail;
    return `
      <span class="bc-item ${isLast ? 'is-current' : ''}">
        ${c.icon ? `<i class="${c.icon}"></i>` : ''}
        <span>${c.label}</span>
      </span>
      ${i < base.length - 1 ? '<i class="ph ph-caret-right bc-sep"></i>' : ''}
    `;
  }).join('');

  if (currentTail) {
    html += `<i class="ph ph-caret-right bc-sep"></i>
      <span class="bc-item is-current">
        ${currentTail.icon ? `<i class="${currentTail.icon}"></i>` : ''}
        <span>${currentTail.label}</span>
        ${currentTail.sub ? `<span class="bc-sub">${currentTail.sub}</span>` : ''}
      </span>`;
  } else if (currentBrief) {
    html += `<span class="bc-dot">·</span><span class="bc-brief">${currentBrief}</span>`;
  }

  el.innerHTML = html;
}
