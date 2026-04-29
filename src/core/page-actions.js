/**
 * page-actions.js — 전역 하단 액션바
 *
 * 레이아웃 (3-zone): [좌] [중] [우]
 *
 * 액션 객체 형식:
 *   { label, icon, onClick, primary?, danger?, disabled?, title? } — 일반 버튼 (.btn-xs)
 *   { chip: true, label, active?, onClick, title? } — 토글 chip (.chip)
 *   { divider: true } — 시각적 구분선
 */

const FOOTER_ID = 'pageActions';
function getFooter() { return document.getElementById(FOOTER_ID); }

function renderActionItem(a) {
  if (a.divider) {
    const div = document.createElement('span');
    div.className = 'pt-actions-divider';
    return div;
  }
  if (a.chip) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (a.active ? ' is-active' : '');
    if (a.title) chip.title = a.title;
    if (a.disabled) chip.disabled = true;
    chip.innerHTML = `${a.icon ? `<i class="ph ${a.icon}"></i>` : ''}${a.label || ''}`;
    if (a.onClick) chip.addEventListener('click', a.onClick);
    return chip;
  }
  // 일반 버튼 — 액션바는 항상 btn-xs 사이즈
  const btn = document.createElement('button');
  const cls = ['btn', 'btn-xs'];
  if (a.primary) cls.push('btn-primary');
  if (a.danger) cls.push('is-danger');
  btn.className = cls.join(' ');
  if (a.disabled) btn.disabled = true;
  if (a.title) btn.title = a.title;
  btn.innerHTML = `${a.icon ? `<i class="ph ${a.icon}"></i>` : ''}${a.label || ''}`;
  if (a.onClick) btn.addEventListener('click', a.onClick);
  return btn;
}

/**
 * 액션바 설정 — 3-zone layout
 * @param {object} zones { left?, center?, right? }
 *   하위 호환: 첫 인자가 배열이면 right 로 처리, 두 번째 인자(context) 무시, 세 번째 인자(middle) → center
 */
export function setPageActions(zonesOrRight = {}, _legacyContext = '', _legacyMiddle = []) {
  const footer = getFooter();
  if (!footer) return;
  footer.innerHTML = '';
  let zones = zonesOrRight;
  if (Array.isArray(zonesOrRight)) {
    zones = { right: zonesOrRight, center: _legacyMiddle || [] };
  }
  const { left = [], center = [], right = [] } = zones;
  const renderZone = (cls, items) => {
    const zone = document.createElement('span');
    zone.className = cls;
    for (const a of items) zone.appendChild(renderActionItem(a));
    footer.appendChild(zone);
  };
  renderZone('pt-actions-zone pt-actions-left', left);
  renderZone('pt-actions-zone pt-actions-center', center);
  renderZone('pt-actions-zone pt-actions-right', right);
}

export function clearPageActions() {
  const footer = getFooter();
  if (footer) footer.innerHTML = '';
}
