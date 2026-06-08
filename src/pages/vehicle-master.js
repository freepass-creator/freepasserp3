/**
 * 차종 마스터 페이지 — 5단계 캐스케이딩 드롭다운 drill-down
 *
 *   ① 제조사 → ② 모델 → ③ 세부모델 → ④ 파워트레인 → ⑤ 트림
 *
 *  데이터원: public/data/car-master/_index.json (catalog 매트릭스 단일 진실원)
 *  - 웰릭스 신차견적기(4단계: 제조사→모델→세부모델(variant)→트림) 에서 출발.
 *    보유 중고는 같은 모델의 여러 세대를 동시 보유하므로 '세부모델(세대)' 1칸이 더 끼어 5단계.
 *  - 렌더는 공용 유틸 renderMasterCascade() 사용 (dev 개발도구와 동일 시그니처).
 *  - 신규 등록/수정은 catalog json 직접 편집 (dev 도구).
 *
 * vehicle_master Firebase 컬렉션은 deprecate — 차종 마스터 화면은 catalog 기반.
 */
import { setBreadcrumbTail } from '../core/breadcrumb.js';
import { loadIndex } from '../core/vehicle-matrix.js';
import { renderMasterCascade } from '../core/master-cascade.js';
import { buildMasterTree, masterTreeStats, parseTrim } from '../core/vehicle-master-tree.js';
import { store } from '../core/store.js';

let _index = null;
let _cascade = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** catalog_id → 보유 매물수 */
function productCounts() {
  const m = new Map();
  for (const p of (store.products || [])) {
    if (p._deleted || p.status === 'deleted') continue;
    if (p.catalog_id) m.set(p.catalog_id, (m.get(p.catalog_id) || 0) + 1);
  }
  return m;
}

export async function mount() {
  setBreadcrumbTail({ icon: 'ph ph-car-profile', label: '차종 마스터' });
  render();
  _index = await loadIndex();
  mountCascade();
}

export function unmount() {
  _index = null;
  _cascade = null;
}

function render() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <header style="display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--border);flex-shrink:0;">
        <span style="font-size:var(--fs-md);font-weight:var(--fw-semibold);">차종 마스터</span>
        <span id="vmStats" style="font-size:var(--fs-2xs);color:var(--text-muted);"></span>
        <span style="margin-left:auto;font-size:var(--fs-2xs);color:var(--text-muted);">
          ① 제조사 → ② 모델 → ③ 세부모델 → ④ 파워트레인 → ⑤ 트림
        </span>
      </header>
      <div style="flex:1;overflow-y:auto;padding:var(--sp-4);">
        <div id="vmCascade"></div>
        <div id="vmDetail" style="margin-top:var(--sp-4);"></div>
      </div>
    </div>`;
}

function mountCascade() {
  const stats = masterTreeStats(buildMasterTree(_index));
  const statsEl = document.getElementById('vmStats');
  if (statsEl) {
    statsEl.textContent =
      `제조사 ${stats.makers} · 모델 ${stats.models} · 세부모델 ${stats.subModels} · 파워트레인 ${stats.variants} · 트림 ${stats.trims}`;
  }

  const el = document.getElementById('vmCascade');
  _cascade = renderMasterCascade(el, _index, {
    counts: productCounts(),
    onSelect: (sel) => renderDetail(sel),
  });
}

/** 세부모델(catalog) 선택 시 그 안의 전체 파워트레인 → 트림 분해를 펼쳐 보여줌 */
function renderDetail(sel) {
  const el = document.getElementById('vmDetail');
  if (!el) return;
  if (!sel || !sel.catalogId) { el.innerHTML = ''; return; }

  const c = _index[sel.catalogId];
  if (!c) { el.innerHTML = ''; return; }

  const variantMap = new Map();
  for (const raw of (c.trims || [])) {
    const { variant, trim } = parseTrim(raw);
    const k = variant || '(미상)';
    if (!variantMap.has(k)) variantMap.set(k, []);
    if (!variantMap.get(k).includes(trim)) variantMap.get(k).push(trim);
  }
  const variants = [...variantMap];
  if (!variants.length) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:var(--fs-xs);">트림 데이터 없음</div>`;
    return;
  }

  el.innerHTML = `
    <div style="font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--text-sub);margin-bottom:var(--sp-2);">
      ${esc(sel.subModel || c.title)} — 파워트레인 ${variants.length} · 트림 ${(c.trims || []).length}
    </div>
    <div style="display:flex;flex-direction:column;gap:var(--sp-2);">
      ${variants.map(([variant, trims]) => {
        const active = variant === sel.variant;
        return `
          <div style="border:1px solid ${active ? 'var(--alert-blue-border)' : 'var(--border)'};border-radius:4px;overflow:hidden;${active ? 'box-shadow:0 0 0 1px var(--alert-blue-border);' : ''}">
            <div style="padding:4px 8px;background:${active ? 'var(--alert-blue-bg)' : 'var(--bg-header)'};font-size:var(--fs-sm);font-weight:var(--fw-semibold);">④ ${esc(variant)}</div>
            <div style="padding:5px 8px;font-size:var(--fs-xs);">
              ${trims.map(t => `<span style="display:inline-block;padding:1px 7px;margin:2px;background:${t === sel.trim && active ? 'var(--bg-selected)' : 'var(--bg-stripe)'};border:1px solid var(--border-soft);border-radius:3px;">${esc(t)}</span>`).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}
