/**
 * 차종 마스터 페이지 — catalog 매트릭스 단일 진실원 viewer
 *  - 데이터원: public/data/car-master/_index.json (399 catalog)
 *  - 검색/필터/메이커 그룹화
 *  - row 클릭 시 detail 모달 (catalog json 미리보기 — view only)
 *  - 신규 등록/수정/삭제는 catalog json 직접 추가/편집 (dev 도구)
 *
 * vehicle_master Firebase 컬렉션은 deprecate — 차종 마스터 화면은 catalog 기반.
 */
import { showToast } from '../core/toast.js';
import { setBreadcrumbTail } from '../core/breadcrumb.js';
import { loadIndex, loadCatalog } from '../core/vehicle-matrix.js';

let _index = null;
let filterMaker = '';
let searchQuery = '';

function yy(v) { const m = (v || '').match(/^(\d{4})/); return m ? m[1].slice(2) : ''; }
function yearLabel(c) {
  const ys = yy(c.year_start);
  const ye = yy(c.year_end);
  if (ys && (c.year_end === '현재' || !ye)) return `${ys}~`;
  if (ys && ye) return `${ys}~${ye}`;
  return '';
}

function makerCounts(idx) {
  const m = new Map();
  for (const c of Object.values(idx)) {
    if (!c.maker) continue;
    m.set(c.maker, (m.get(c.maker) || 0) + 1);
  }
  return [...m.entries()]
    .map(([maker, count]) => ({ maker, count }))
    .sort((a, b) => a.maker.localeCompare(b.maker, 'ko'));
}

export async function mount() {
  setBreadcrumbTail({ icon: 'ph ph-car-profile', label: '차종 마스터' });
  render();
  _index = await loadIndex();
  renderList();
}

export function unmount() {
  _index = null;
}

function render() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <header style="display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--c-border);flex-shrink:0;">
        <span style="font-size:var(--fs-md);font-weight:var(--fw-semibold);">차종 마스터</span>
        <span id="vmCount" style="font-size:var(--fs-xs);color:var(--c-text-muted);"></span>
        <span style="margin-left:var(--sp-2);font-size:var(--fs-2xs);color:var(--c-text-muted);">
          <i class="ph ph-info"></i> catalog json 단일 진실원 (수정은 git stub 직접)
        </span>
      </header>
      <div style="display:flex;gap:var(--sp-2);padding:var(--sp-2) var(--sp-4);border-bottom:1px solid var(--c-border-soft);flex-shrink:0;">
        <input id="vmSearch" class="input input-sm" placeholder="제조사·모델·세부모델 검색..." style="flex:1;">
        <select id="vmMakerFilter" class="input input-sm" style="width:160px;"><option value="">제조사 전체</option></select>
      </div>
      <div id="vmList" style="flex:1;overflow-y:auto;"></div>
    </div>
  `;
  document.getElementById('vmSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderList();
  });
  document.getElementById('vmMakerFilter').addEventListener('change', (e) => {
    filterMaker = e.target.value;
    renderList();
  });
}

function renderList() {
  const el = document.getElementById('vmList');
  if (!el || !_index) return;

  const total = Object.keys(_index).length;
  const makers = makerCounts(_index);
  const makerSel = document.getElementById('vmMakerFilter');
  const curSel = makerSel.value;
  makerSel.innerHTML = `<option value="">제조사 전체 (${total})</option>` +
    makers.map(m => `<option value="${m.maker}" ${curSel === m.maker ? 'selected' : ''}>${m.maker} (${m.count})</option>`).join('');

  let list = Object.values(_index);
  if (filterMaker) list = list.filter(c => c.maker === filterMaker);
  if (searchQuery) {
    list = list.filter(c => [c.maker, c.model_root, c.title, c.id]
      .some(s => s && String(s).toLowerCase().includes(searchQuery)));
  }
  // 메이커 → model_root → year_start desc 정렬
  list.sort((a, b) => {
    if (a.maker !== b.maker) return (a.maker || '').localeCompare(b.maker || '', 'ko');
    if ((a.model_root || '') !== (b.model_root || '')) return (a.model_root || '').localeCompare(b.model_root || '', 'ko');
    return (b.year_start || '').localeCompare(a.year_start || '');
  });

  document.getElementById('vmCount').textContent = `${list.length}/${total} 종`;

  if (!list.length) {
    el.innerHTML = `<div style="padding:var(--sp-8);text-align:center;color:var(--c-text-muted);">검색 결과 없음</div>`;
    return;
  }

  el.innerHTML = list.map(c => {
    const yr = yearLabel(c);
    const trimCount = Array.isArray(c.trims) ? c.trims.length : 0;
    return `
      <div class="vm-row" data-cid="${c.id}" style="display:grid;grid-template-columns:90px 110px 1fr 90px 60px 130px;gap:var(--sp-3);padding:var(--sp-2) var(--sp-4);border-bottom:1px solid var(--c-border-soft);align-items:center;cursor:pointer;font-size:var(--fs-xs);">
        <span style="color:var(--c-text-sub);">${c.maker || '-'}</span>
        <span style="color:var(--c-text-sub);">${c.model_root || '-'}</span>
        <span style="font-weight:var(--fw-medium);">${(c.title || '').replace(c.maker + ' ', '') || c.id}</span>
        <span style="color:var(--c-text-muted);font-size:var(--fs-2xs);">${yr || '-'}</span>
        <span style="color:var(--c-text-muted);font-size:var(--fs-2xs);">${trimCount ? `트림 ${trimCount}` : '-'}</span>
        <span style="color:var(--c-text-muted);font-family:monospace;font-size:var(--fs-2xs);">${c.id}</span>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.vm-row').forEach(row => {
    row.addEventListener('click', () => {
      const cid = row.dataset.cid;
      openDetail(cid);
    });
  });
}

async function openDetail(catalogId) {
  if (!catalogId) return;
  try {
    const c = await loadCatalog(catalogId);
    if (!c) { showToast(`catalog 로드 실패: ${catalogId}`); return; }

    const trims = c.trims || {};
    const trimRows = Object.entries(trims).map(([name, t]) => {
      const price = t?.price?.base ? `${(t.price.base / 10000).toLocaleString()}만` : '-';
      return `<tr><td style="padding:4px 8px;">${name}</td><td style="padding:4px 8px;color:var(--c-text-muted);">${t?.slug || ''}</td><td style="padding:4px 8px;text-align:right;">${price}</td></tr>`;
    }).join('');

    const aliases = Array.isArray(c.aliases) && c.aliases.length
      ? c.aliases.map(a => `<span style="display:inline-block;padding:1px 6px;margin:2px;background:var(--c-surface-2);border-radius:3px;font-size:var(--fs-2xs);">${a}</span>`).join('')
      : '<span style="color:var(--c-text-muted);">-</span>';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;inset:0;background:var(--c-overlay-dark);z-index:var(--z-overlay);display:flex;align-items:center;justify-content:center;padding:var(--sp-4);';
    modal.innerHTML = `
      <div style="background:var(--c-surface);border-radius:var(--ctrl-r);width:100%;max-width:640px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
        <header style="display:flex;align-items:center;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--c-border);">
          <span style="font-size:var(--fs-md);font-weight:var(--fw-semibold);flex:1;">${c.title || c.catalog_id}</span>
          <button id="vmDetailClose" class="btn btn-sm btn-ghost"><i class="ph ph-x"></i></button>
        </header>
        <div style="flex:1;overflow-y:auto;padding:var(--sp-4);font-size:var(--fs-xs);">
          <div style="display:grid;grid-template-columns:100px 1fr;gap:var(--sp-2) var(--sp-3);margin-bottom:var(--sp-4);">
            <span style="color:var(--c-text-muted);">catalog_id</span><span style="font-family:monospace;">${c.catalog_id || catalogId}</span>
            <span style="color:var(--c-text-muted);">제조사</span><span>${c.maker || '-'}</span>
            <span style="color:var(--c-text-muted);">모델</span><span>${c.model_root || '-'}</span>
            <span style="color:var(--c-text-muted);">생산</span><span>${c.year_start || '-'} ~ ${c.year_end || '-'}</span>
            <span style="color:var(--c-text-muted);">source</span><span>${c.source || '-'}</span>
            <span style="color:var(--c-text-muted);">aliases</span><span>${aliases}</span>
          </div>
          ${trimRows ? `
            <div style="font-weight:var(--fw-semibold);margin-bottom:var(--sp-2);">트림 (${Object.keys(trims).length})</div>
            <table style="width:100%;border-collapse:collapse;border:1px solid var(--c-border-soft);">
              <thead><tr style="background:var(--c-surface-2);"><th style="padding:4px 8px;text-align:left;">이름</th><th style="padding:4px 8px;text-align:left;">slug</th><th style="padding:4px 8px;text-align:right;">가격</th></tr></thead>
              <tbody>${trimRows}</tbody>
            </table>
          ` : '<div style="color:var(--c-text-muted);">트림 데이터 없음</div>'}
          ${c.note ? `<div style="margin-top:var(--sp-3);padding:var(--sp-2);background:var(--c-surface-2);border-radius:4px;color:var(--c-text-sub);"><b>note:</b> ${c.note}</div>` : ''}
        </div>
        <footer style="display:flex;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--c-border);justify-content:flex-end;">
          <span style="flex:1;font-size:var(--fs-2xs);color:var(--c-text-muted);align-self:center;">수정은 catalog json 직접 편집: <code>public/data/car-master/${c.catalog_id || catalogId}.json</code></span>
          <button id="vmDetailOk" class="btn btn-sm">닫기</button>
        </footer>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.getElementById('vmDetailClose').addEventListener('click', close);
    document.getElementById('vmDetailOk').addEventListener('click', close);
  } catch (e) {
    console.error('[vmDetail]', e);
    showToast('catalog 로드 실패: ' + (e.message || e));
  }
}
