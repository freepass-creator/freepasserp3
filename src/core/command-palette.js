/**
 * 명령 팔레트 — Cmd+K / Ctrl+K
 * 전역 통합 검색: 페이지 + 차량 + 계약 + 정산 + 대화
 */
import { store } from './store.js';
import { navigate } from './router.js';

const DEFAULT_COMMANDS = [
  { id: 'search',   label: '차량 찾기',  kind: 'page', href: '/search', icon: 'ph ph-magnifying-glass' },
  { id: 'home',     label: '작업',      kind: 'page', href: '/',        icon: 'ph ph-desktop' },
  { id: 'contract', label: '계약 조회',  kind: 'page', href: '/contract', icon: 'ph ph-file-text' },
  { id: 'settle',   label: '정산 조회',  kind: 'page', href: '/settle',  icon: 'ph ph-coins' },
  { id: 'product',  label: '상품 등록',  kind: 'page', href: '/product', icon: 'ph ph-car-simple' },
  { id: 'policy',   label: '정책 등록',  kind: 'page', href: '/policy',  icon: 'ph ph-scroll' },
  { id: 'settings', label: '설정',      kind: 'page', href: '/settings', icon: 'ph ph-gear' },
];

let open = false;

export function initCommandPalette() {
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && open) close();
  });
}

function toggle() { open ? close() : openPalette(); }

function openPalette() {
  open = true;
  const overlay = document.createElement('div');
  overlay.id = 'cmdPalette';
  overlay.className = 'cmd-overlay';
  overlay.innerHTML = `
    <div class="cmd-box">
      <div class="cmd-search">
        <i class="ph ph-magnifying-glass"></i>
        <input class="cmd-input" id="cmdInput" placeholder="명령, 차량, 계약, 고객 검색... (Esc 닫기)" autocomplete="off">
        <span class="cmd-hint">Cmd+K</span>
      </div>
      <div class="cmd-list" id="cmdList"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#cmdInput');
  input.focus();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let activeIdx = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const items = getCommands(q);
    const list = overlay.querySelector('#cmdList');
    if (!items.length) {
      list.innerHTML = '<div class="cmd-empty">결과 없음</div>';
      return;
    }
    list.innerHTML = items.map((item, i) => `
      <button class="cmd-item ${i === activeIdx ? 'is-active' : ''}" data-idx="${i}" data-href="${item.href || ''}" data-type="${item.type || ''}" data-id="${item.id || ''}">
        <i class="${item.icon || 'ph ph-arrow-right'}"></i>
        <div class="cmd-item-body">
          <div class="cmd-item-label">${highlight(item.label, q)}</div>
          ${item.hint ? `<div class="cmd-item-hint">${item.hint}</div>` : ''}
        </div>
        <span class="cmd-item-kind">${item.kind}</span>
      </button>
    `).join('');

    list.querySelectorAll('.cmd-item').forEach(btn => {
      btn.addEventListener('click', () => selectItem(items[parseInt(btn.dataset.idx)]));
    });
  };

  const updateActive = () => {
    overlay.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIdx);
    });
    const active = overlay.querySelector('.cmd-item.is-active');
    active?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => { activeIdx = 0; render(); });
  input.addEventListener('keydown', (e) => {
    const items = overlay.querySelectorAll('.cmd-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); updateActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); updateActive(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim().toLowerCase();
      const list = getCommands(q);
      if (list[activeIdx]) selectItem(list[activeIdx]);
    }
  });

  render();
}

function close() {
  open = false;
  document.getElementById('cmdPalette')?.remove();
}

function selectItem(item) {
  close();
  if (item.href) navigate(item.href);
  else if (item.action) item.action();
}

function getCommands(q) {
  if (!q) return DEFAULT_COMMANDS;

  const results = [];

  // 페이지 매칭
  DEFAULT_COMMANDS.forEach(c => {
    if (c.label.toLowerCase().includes(q)) results.push(c);
  });

  // 차량 매칭
  (store.products || []).slice(0, 100).forEach(p => {
    if (
      (p.car_number || '').toLowerCase().includes(q) ||
      (p.model || '').toLowerCase().includes(q) ||
      (p.maker || '').toLowerCase().includes(q)
    ) {
      results.push({
        label: `${p.year||''} ${p.model||''} ${p.sub_model||''}`,
        hint: `${p.car_number||''} · ${p.maker||''}`,
        kind: '차량',
        icon: 'ph ph-car-simple',
        href: '/search',
      });
    }
  });

  // 계약 매칭
  (store.contracts || []).slice(0, 50).forEach(c => {
    if (
      (c.contract_code || '').toLowerCase().includes(q) ||
      (c.customer_name || '').toLowerCase().includes(q) ||
      (c.car_number_snapshot || '').toLowerCase().includes(q)
    ) {
      results.push({
        label: `${c.vehicle_name_snapshot || c.contract_code}`,
        hint: `${c.customer_name || ''} · ${c.contract_status || ''}`,
        kind: '계약',
        icon: 'ph ph-file-text',
        href: '/contract',
      });
    }
  });

  // 정산 매칭
  (store.settlements || []).slice(0, 50).forEach(s => {
    if (
      (s.settlement_code || '').toLowerCase().includes(q) ||
      (s.customer_name || '').toLowerCase().includes(q)
    ) {
      results.push({
        label: `${s.settlement_code || s._key}`,
        hint: `${s.customer_name || ''} · ${s.settlement_status || s.status || ''}`.trim(),
        kind: '정산',
        icon: 'ph ph-coins',
        href: '/settle',
      });
    }
  });

  return results.slice(0, 15);
}

function highlight(text, q) {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return text;
  return text.slice(0, idx) + `<mark>${text.slice(idx, idx + q.length)}</mark>` + text.slice(idx + q.length);
}
