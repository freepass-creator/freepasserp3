/**
 * 차종 마스터 관리 (admin) — JPKerp2 car-master.tsx 포팅
 * - 전체 차종 리스트 + 검색 + 필터 (제조사)
 * - 신규 등록 / 수정 / 삭제
 * - 한국 차종 263종 일괄 시드 import
 */
import { store } from '../core/store.js';
import { showToast } from '../core/toast.js';
import { setBreadcrumbTail } from '../core/breadcrumb.js';
import {
  watchVehicleMaster, createVehicleModel, updateVehicleModel, deleteVehicleModel,
  seedVehicleMaster, uniqueMakers,
} from '../core/vehicle-master.js';

let unsub = null;
let models = [];
let filterMaker = '';
let searchQuery = '';
let editingKey = null;

const CATEGORIES = [
  '경차', '소형 세단', '준중형 세단', '중형 세단', '준대형 세단', '대형 세단', '스포츠 세단',
  '소형 SUV', '준중형 SUV', '중형 SUV', '준대형 SUV', '대형 SUV',
  '소형 EV', '준중형 EV', '대형 EV SUV', '소형 EV SUV', '소형 EV 트럭',
  'MPV', '대형 MPV', '소형 트럭', '픽업트럭',
];
const FUEL_TYPES = ['가솔린', '디젤', 'LPG', '하이브리드', '전기', '수소'];

export function mount() {
  setBreadcrumbTail({ icon: 'ph ph-car-profile', label: '차종 마스터' });
  render();
  unsub = watchVehicleMaster((list) => {
    models = list;
    renderList();
  });
}

export function unmount() {
  unsub?.();
  unsub = null;
}

function render() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <header style="display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--c-border);flex-shrink:0;">
        <span style="font-size:var(--fs-md);font-weight:var(--fw-semibold);">차종 마스터</span>
        <span id="vmCount" style="font-size:var(--fs-xs);color:var(--c-text-muted);"></span>
        <span style="margin-left:auto;display:flex;gap:var(--sp-2);">
          <button class="btn btn-sm btn-outline" id="vmSeed"><i class="ph ph-download-simple"></i> 시드 일괄등록</button>
          <button class="btn btn-sm btn-primary" id="vmNew"><i class="ph ph-plus"></i> 신규 등록</button>
        </span>
      </header>
      <div style="display:flex;gap:var(--sp-2);padding:var(--sp-2) var(--sp-4);border-bottom:1px solid var(--c-border-soft);flex-shrink:0;">
        <input id="vmSearch" class="input input-sm" placeholder="모델·세부모델·차명 검색..." style="flex:1;">
        <select id="vmMakerFilter" class="input input-sm" style="width:140px;"><option value="">제조사 전체</option></select>
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
  document.getElementById('vmNew').addEventListener('click', () => openEditor(null));
  document.getElementById('vmSeed').addEventListener('click', runSeed);
}

function renderList() {
  const el = document.getElementById('vmList');
  if (!el) return;

  // 제조사 필터 옵션 갱신
  const makerSel = document.getElementById('vmMakerFilter');
  const makers = uniqueMakers(models);
  const curSel = makerSel.value;
  makerSel.innerHTML = `<option value="">제조사 전체 (${models.length})</option>` +
    makers.map(m => `<option value="${m.maker}" ${curSel === m.maker ? 'selected' : ''}>${m.maker} (${m.count})</option>`).join('');

  // 필터 적용
  let list = [...models];
  if (filterMaker) list = list.filter(v => v.maker === filterMaker);
  if (searchQuery) {
    list = list.filter(v => [v.maker, v.model, v.sub, v.car_name, v.code, v.type_number_pattern]
      .some(s => s && String(s).toLowerCase().includes(searchQuery)));
  }
  list.sort((a, b) => (a.maker + a.model + a.sub).localeCompare(b.maker + b.model + b.sub, 'ko'));

  document.getElementById('vmCount').textContent = `${list.length}/${models.length} 종`;

  if (!list.length) {
    el.innerHTML = `<div style="padding:var(--sp-8);text-align:center;color:var(--c-text-muted);">차종 없음 — "시드 일괄등록" 또는 "신규 등록"</div>`;
    return;
  }
  el.innerHTML = list.map(v => {
    const period = `${v.year_start || ''}~${v.year_end || ''}`;
    const spec = [
      v.displacement ? `${v.displacement}cc` : '',
      v.seats ? `${v.seats}인승` : '',
      v.battery_kwh ? `${v.battery_kwh}kWh` : '',
      v.fuel_type, v.category,
    ].filter(Boolean).join(' | ');
    return `
      <div class="vm-row" data-key="${v._key}" style="display:grid;grid-template-columns:80px 110px 1fr auto auto;gap:var(--sp-3);padding:var(--sp-2) var(--sp-4);border-bottom:1px solid var(--c-border-soft);align-items:center;cursor:pointer;">
        <span style="font-size:var(--fs-xs);color:var(--c-text-sub);">${v.maker || '-'}</span>
        <span style="font-size:var(--fs-xs);color:var(--c-text-sub);">${v.model || '-'}</span>
        <span style="font-size:var(--fs-sm);font-weight:var(--fw-medium);">${v.sub || '-'}</span>
        <span style="font-size:var(--fs-2xs);color:var(--c-text-muted);">${period}</span>
        <span style="font-size:var(--fs-2xs);color:var(--c-text-muted);">${spec}</span>
      </div>
    `;
  }).join('');
  el.querySelectorAll('.vm-row').forEach(row => {
    row.addEventListener('click', () => {
      const v = models.find(x => x._key === row.dataset.key);
      if (v) openEditor(v);
    });
  });
}

async function runSeed() {
  if (!confirm('한국 차종 263종을 일괄 등록합니다. 이미 있는 차종은 건너뜁니다. 계속?')) return;
  showToast('시드 import 시작...');
  try {
    const result = await seedVehicleMaster(({ i, total, added }) => {
      if (i % 20 === 0) console.log(`[seed] ${i}/${total} (추가 ${added})`);
    });
    showToast(`완료: 추가 ${result.added} | 스킵 ${result.skipped} / 총 ${result.total}`);
  } catch (e) {
    console.error('[vmSeed]', e);
    showToast(`시드 실패: ${e?.code || e?.message}`, 'error');
  }
}

function openEditor(v) {
  editingKey = v?._key || null;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:var(--c-overlay-dark);z-index:var(--z-overlay);display:flex;align-items:center;justify-content:center;padding:var(--sp-4);';
  modal.innerHTML = `
    <div style="background:var(--c-surface);border-radius:var(--ctrl-r);width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
      <header style="display:flex;align-items:center;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--c-border);">
        <span style="font-size:var(--fs-md);font-weight:var(--fw-semibold);flex:1;">${v ? '차종 수정' : '신규 차종'}</span>
        <button id="vmCancel" class="btn btn-sm btn-ghost"><i class="ph ph-x"></i></button>
      </header>
      <div style="flex:1;overflow-y:auto;padding:var(--sp-4);display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);">
        ${fld('제조사', 'maker', v?.maker)}
        ${fld('모델', 'model', v?.model)}
        ${fld('세부모델', 'sub', v?.sub, { full: true })}
        ${fld('트림', 'trim', v?.trim)}
        ${fld('차명 (등록증)', 'car_name', v?.car_name)}
        ${fld('형식번호 패턴', 'type_number_pattern', v?.type_number_pattern)}
        ${fld('생산 시작', 'year_start', v?.year_start)}
        ${fld('생산 종료', 'year_end', v?.year_end, { placeholder: '현재' })}
        ${fldSelect('카테고리', 'category', v?.category, CATEGORIES)}
        ${fldSelect('연료', 'fuel_type', v?.fuel_type, FUEL_TYPES)}
        ${fld('배기량 (cc)', 'displacement', v?.displacement, { type: 'number' })}
        ${fld('승차정원', 'seats', v?.seats, { type: 'number' })}
        ${fld('구동방식', 'drive_type', v?.drive_type, { placeholder: '전륜/후륜/4륜' })}
        ${fld('변속기', 'transmission', v?.transmission)}
        ${fld('엔진형식', 'engine_type', v?.engine_type)}
        ${fld('배터리 (kWh)', 'battery_kwh', v?.battery_kwh, { type: 'number' })}
        ${fld('EV 주행거리 (km)', 'ev_range', v?.ev_range, { type: 'number' })}
        ${fld('내부코드', 'code', v?.code)}
      </div>
      <footer style="display:flex;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--c-border);">
        ${v ? `<button id="vmDel" class="btn btn-sm btn-danger"><i class="ph ph-trash"></i> 삭제</button>` : ''}
        <button id="vmSave" class="btn btn-sm btn-primary" style="margin-left:auto;"><i class="ph ph-check"></i> 저장</button>
      </footer>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.getElementById('vmCancel').addEventListener('click', close);
  document.getElementById('vmSave').addEventListener('click', async () => {
    const data = Object.fromEntries(
      [...modal.querySelectorAll('[data-f]')].map(el => {
        const key = el.dataset.f;
        let val = el.value.trim();
        if (el.type === 'number') val = val ? Number(val) : undefined;
        return [key, val || undefined];
      })
    );
    if (!data.maker || !data.model || !data.sub) { showToast('제조사·모델·세부모델 필수', 'error'); return; }
    try {
      if (editingKey) await updateVehicleModel(editingKey, data);
      else await createVehicleModel(data);
      showToast('저장됨');
      close();
    } catch (e) { showToast(`실패: ${e?.code || e?.message}`, 'error'); }
  });
  document.getElementById('vmDel')?.addEventListener('click', async () => {
    if (!confirm(`"${v.sub}" 차종을 삭제하시겠습니까?`)) return;
    await deleteVehicleModel(v._key);
    showToast('삭제됨');
    close();
  });
}

function fld(label, key, val, opts = {}) {
  const type = opts.type || 'text';
  const ph = opts.placeholder || '';
  const full = opts.full ? 'grid-column:1/-1;' : '';
  return `
    <label style="display:flex;flex-direction:column;gap:4px;${full}">
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">${label}</span>
      <input class="input input-sm" data-f="${key}" type="${type}" value="${val ?? ''}" placeholder="${ph}">
    </label>
  `;
}
function fldSelect(label, key, val, options) {
  return `
    <label style="display:flex;flex-direction:column;gap:4px;">
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">${label}</span>
      <select class="input input-sm" data-f="${key}">
        <option value="">-</option>
        ${options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </label>
  `;
}
