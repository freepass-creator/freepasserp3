/**
 * 차종 마스터 CRUD — admin.js 에서 분리
 *
 * 기존 admin.js (라인 910~2302) 를 그대로 이동. 모듈 상태는 파일 로컬로 캡슐화되어
 * admin.js 의 다른 탭(Partners/Users/Dev 나머지)과 간섭하지 않는다.
 *
 * 주의: devLog 는 admin.js 의 로컬 helper 였음. 같은 DOM 엘리먼트(#devLog)에
 * append 하도록 로컬에 재정의해서 기존 동작 유지.
 */
import { store } from '../../core/store.js';
import { showToast } from '../../core/toast.js';

/** admin.js 의 #devLog 패널(devTab 이 mount 됐을 때만 존재)에 로그 한 줄 append.
 *  admin.js 의 devLog 와 동일 구현 — 분리 후에도 같은 패널에 찍힌다. */
const devLog = (msg) => {
  const el = document.getElementById('devLog');
  if (el) el.textContent += `[${new Date().toLocaleTimeString('ko')}] ${msg}\n`;
};

/* 차종 마스터 CRUD */
let _vmUnsub = null;
let _vmModels = [];
let _vmFilterMaker = '';
let _vmSearch = '';
let _vmMode = 'idle'; // idle | view | edit | new | prep
let _vmSelectedKey = null;
let _vmForm = null;
let _vmShowArchived = false;
let _vmPrepRows = [];

// JPKerp2 lib/data/vehicle-constants.ts 기준 (엔카 2026 택소노미)
const VM_CATEGORIES = [
  '경차', '경형 SUV', '경형 EV',
  '소형 SUV', '소형 EV SUV', '소형 EV', '소형 트럭', '소형 EV 트럭',
  '준중형 세단', '준중형 SUV', '준중형 EV', '준중형 EV SUV',
  '중형 세단', '중형 SUV', '중형 EV 세단', '중형 EV SUV',
  '준대형 세단', '준대형 SUV',
  '대형 세단', '대형 SUV', '대형 MPV', '대형 EV SUV',
  '스포츠 세단', '수소 SUV', '픽업트럭',
];
const VM_FUELS = ['가솔린', '디젤', '하이브리드', '전기', 'LPG'];
const VM_ORIGINS = ['국산', '수입'];
const VM_POWERTRAINS = ['내연', '하이브리드', '전기', '수소'];
const VM_BODY_SHAPES = ['세단', '해치백', 'SUV', 'RV/MPV', '쿠페', '컨버터블', '왜건', '트럭', '승합', '기타'];
const VM_SIZE_CLASSES = ['경차', '소형', '준중형', '중형', '준대형', '대형'];

const VM_EMPTY_FORM = {
  maker: '', model: '', sub: '', code: '',
  production_start: '', production_end: '현재',   // 엔카 기준 (YYYY-MM)
  category: '', fuel_type: '',
  origin: '', powertrain: '',
  seats: '', displacement: '', battery_kwh: '',
  // 엔카 확장 필드 (JPKerp2 RtdbCarModel)
  body_type: '', size_class: '',
  type_number_pattern: '', engine_type: '',
  car_name: '',
  maker_code: '', maker_eng: '',
  popularity: '', model_popularity: '',
};

export function renderVehicleTab(el) {
  el.innerHTML = `
    <div id="vmRoot" style="display:flex;flex-direction:column;height:100%;gap:var(--sp-2);">
      <!-- 상단 액션바 -->
      <div id="vmActions" style="display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;"></div>

      <!-- 메인: 좌측 그리드 + 우측 상세 -->
      <div style="display:flex;gap:var(--sp-2);flex:1;min-height:0;">
        <!-- 좌측 리스트 -->
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid var(--c-border-soft);border-radius:var(--ctrl-r);overflow:hidden;">
          <div style="display:flex;gap:var(--sp-2);padding:var(--sp-2);border-bottom:1px solid var(--c-border-soft);align-items:center;">
            <input class="input input-sm" id="vmSearch" placeholder="모델·세부모델·코드" style="flex:1;">
            <select class="input input-sm" id="vmMakerFilter" style="width:120px;"><option value="">전체</option></select>
            <span id="vmStats" style="font-size:var(--fs-2xs);color:var(--c-text-muted);"></span>
          </div>
          <div id="vmList" style="flex:1;overflow-y:auto;"></div>
        </div>

        <!-- 우측 상세/편집 패널 (모드 전환) -->
        <aside id="vmDetail" style="width:360px;flex-shrink:0;border:1px solid var(--c-border-soft);border-radius:var(--ctrl-r);overflow-y:auto;display:none;"></aside>
      </div>
    </div>
  `;

  _vmUnsub?.();
  _vmMode = 'idle';
  _vmSelectedKey = null;
  _vmForm = { ...VM_EMPTY_FORM };

  import('../../core/vehicle-master.js').then((vm) => {
    _vmUnsub = vm.watchVehicleMaster((list) => {
      _vmModels = list;
      renderVmActions(vm);
      renderVmList(vm);
      renderVmDetail(vm);
    });

    document.getElementById('vmSearch').addEventListener('input', (e) => {
      _vmSearch = e.target.value.trim();
      renderVmList(vm);
    });
    document.getElementById('vmMakerFilter').addEventListener('change', (e) => {
      _vmFilterMaker = e.target.value;
      renderVmList(vm);
    });
  });
}

function renderVmActions(vm) {
  const el = document.getElementById('vmActions');
  if (!el) return;
  const selected = _vmModels.find(v => v._key === _vmSelectedKey);
  const archivedCount = _vmModels.filter(m => m.archived).length;
  const editable = _vmMode === 'edit' || _vmMode === 'new';

  if (_vmMode === 'prep') {
    const checked = _vmPrepRows.filter(r => r.checked && !r.in_jpkerp).length;
    el.innerHTML = `
      <button class="btn btn-sm btn-ghost" id="vmPrepCancel"><i class="ph ph-x"></i> 취소</button>
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">${_vmPrepRows.length}건 발견 · 선택 ${checked}건</span>
      <button class="btn btn-sm btn-primary" id="vmPrepCommit" style="margin-left:auto;"><i class="ph ph-check"></i> 선택 ${checked}건 등록</button>
    `;
    document.getElementById('vmPrepCancel')?.addEventListener('click', () => {
      _vmMode = 'idle'; _vmPrepRows = [];
      renderVmActions(vm); renderVmList(vm); renderVmDetail(vm);
    });
    document.getElementById('vmPrepCommit')?.addEventListener('click', () => vmPrepCommit(vm));
    return;
  }

  if (editable) {
    el.innerHTML = `
      <button class="btn btn-sm btn-ghost" id="vmCancel"><i class="ph ph-x"></i> 취소</button>
      <button class="btn btn-sm btn-primary" id="vmSave" style="margin-left:auto;"><i class="ph ph-check"></i> ${_vmMode === 'edit' ? '수정 저장' : '등록'}</button>
    `;
  } else if (_vmMode === 'view' && selected) {
    el.innerHTML = `
      <button class="btn btn-sm btn-outline" id="vmEdit"><i class="ph ph-pencil"></i> 수정</button>
      <button class="btn btn-sm btn-outline" style="color:var(--c-err);" id="vmDelete"><i class="ph ph-trash"></i> 삭제</button>
      <button class="btn btn-sm btn-primary" id="vmNew" style="margin-left:auto;"><i class="ph ph-plus"></i> 차종 추가</button>
    `;
  } else {
    el.innerHTML = `
      <button class="btn btn-sm ${_vmShowArchived ? 'btn-primary' : 'btn-outline'}" id="vmToggleArchived" title="15년 초과 단종 모델 포함/제외">
        <i class="ph ${_vmShowArchived ? 'ph-eye' : 'ph-eye-slash'}"></i>
        ${_vmShowArchived ? '전체 보기' : `단종 숨김${archivedCount ? ` (${archivedCount})` : ''}`}
      </button>
      <button class="btn btn-sm btn-outline" style="color:var(--c-err);" id="vmDeleteAll" title="vehicle_master 전체 soft-delete (개발용)"><i class="ph ph-trash"></i> 전체 삭제</button>
      <button class="btn btn-sm btn-primary" id="vmEncar" title="엔카 마스터 1092건 (production_start/end · maker_code · popularity 포함) — 멱등 재실행 가능"><i class="ph ph-download-simple"></i> 엔카 마스터 가져오기</button>
      <button class="btn btn-sm btn-outline" id="vmResync" title="vehicle_master 전체 삭제 후 엔카 마스터 1092건만 재임포트 — JPKerp2와 정확히 일치"><i class="ph ph-arrow-clockwise"></i> JPKerp 완전 동기화</button>
      <button class="btn btn-sm btn-outline" id="vmAudit" title="products 의 (maker·model·sub_model) 조합 전수 감사 — 매칭/ambig/결측 상세 리포트"><i class="ph ph-list-magnifying-glass"></i> 차종 감사</button>
      <button class="btn btn-sm btn-outline" id="vmNormalize" title="products 의 maker/model/sub_model 을 엔카 마스터 표준 명칭으로 정규화"><i class="ph ph-magic-wand"></i> 상품 정규화</button>
      <button class="btn btn-sm btn-outline" id="vmAutoReg" title="엔카 미수록 제조사·모델 상품들을 차종마스터에 자동 등록"><i class="ph ph-plus-circle"></i> 누락 차종 등록</button>
      <button class="btn btn-sm btn-primary" id="vmNew" style="margin-left:auto;"><i class="ph ph-plus"></i> 차종 추가</button>
    `;
  }

  // 핸들러 바인딩
  document.getElementById('vmToggleArchived')?.addEventListener('click', () => {
    _vmShowArchived = !_vmShowArchived;
    renderVmActions(vm); renderVmList(vm);
  });
  document.getElementById('vmEncar')?.addEventListener('click', () => vmEncarImportAction(vm));
  document.getElementById('vmResync')?.addEventListener('click', () => vmFullResyncAction(vm));
  document.getElementById('vmAudit')?.addEventListener('click', () => vmAuditAction(vm));
  document.getElementById('vmNormalize')?.addEventListener('click', () => vmNormalizeProductsAction(vm));
  document.getElementById('vmAutoReg')?.addEventListener('click', () => vmAutoRegisterAction(vm));
  document.getElementById('vmDeleteAll')?.addEventListener('click', () => vmDeleteAllAction(vm));
  document.getElementById('vmNew')?.addEventListener('click', () => {
    _vmMode = 'new'; _vmSelectedKey = null; _vmForm = { ...VM_EMPTY_FORM };
    renderVmActions(vm); renderVmDetail(vm);
  });
  document.getElementById('vmEdit')?.addEventListener('click', () => {
    if (!selected) return;
    _vmMode = 'edit'; _vmForm = vmFormFromRow(selected);
    renderVmActions(vm); renderVmDetail(vm);
  });
  document.getElementById('vmDelete')?.addEventListener('click', async () => {
    if (!selected) return;
    if (!confirm(`${selected.maker} ${selected.sub} 삭제?`)) return;
    await vm.deleteVehicleModel(selected._key);
    devLog(`[vm] 삭제: ${selected.maker} ${selected.sub}`);
    showToast('삭제됨');
    _vmMode = 'idle'; _vmSelectedKey = null;
    renderVmActions(vm); renderVmDetail(vm);
  });
  document.getElementById('vmCancel')?.addEventListener('click', () => {
    if (_vmMode === 'edit' && selected) {
      _vmMode = 'view'; _vmForm = vmFormFromRow(selected);
    } else {
      _vmMode = 'idle'; _vmSelectedKey = null; _vmForm = { ...VM_EMPTY_FORM };
    }
    renderVmActions(vm); renderVmDetail(vm);
  });
  document.getElementById('vmSave')?.addEventListener('click', () => vmSaveAction(vm));
}

function vmFormFromRow(r) {
  return {
    maker: r.maker || '', model: r.model || '', sub: r.sub || '', code: r.code || '',
    // production_* 우선, 없으면 year_* 폴백 (레거시 호환)
    production_start: String(r.production_start ?? r.year_start ?? ''),
    production_end: String(r.production_end ?? r.year_end ?? '현재'),
    category: r.category || '', fuel_type: r.fuel_type || '',
    origin: r.origin || '', powertrain: r.powertrain || '',
    seats: r.seats ? String(r.seats) : '',
    displacement: r.displacement ? String(r.displacement) : '',
    battery_kwh: r.battery_kwh ? String(r.battery_kwh) : '',
    body_type: r.body_type || '', size_class: r.size_class || '',
    type_number_pattern: r.type_number_pattern || '',
    engine_type: r.engine_type || '',
    car_name: r.car_name || '',
    maker_code: r.maker_code || '', maker_eng: r.maker_eng || '',
    popularity: r.popularity ? String(r.popularity) : '',
    model_popularity: r.model_popularity ? String(r.model_popularity) : '',
  };
}

function renderVmList(vm) {
  const listEl = document.getElementById('vmList');
  const makerSel = document.getElementById('vmMakerFilter');
  if (!listEl || !makerSel) return;

  // prep 모드: 체크박스 테이블
  if (_vmMode === 'prep') {
    makerSel.disabled = true;
    document.getElementById('vmSearch').disabled = true;
    listEl.innerHTML = `
      <div style="display:grid;grid-template-columns:30px 30px 80px 110px 1fr 60px 50px;gap:6px;padding:6px var(--sp-2);border-bottom:1px solid var(--c-border);background:var(--c-bg-sub);font-size:var(--fs-2xs);color:var(--c-text-muted);position:sticky;top:0;z-index:1;">
        <span><input type="checkbox" id="vmPrepAll" ${_vmPrepRows.every(r => r.checked || r.in_jpkerp) ? 'checked' : ''}></span>
        <span>#</span><span>제조사</span><span>모델</span><span>세부모델</span><span style="text-align:right;">보유</span><span>상태</span>
      </div>
      ${_vmPrepRows.map((r, i) => `
        <div style="display:grid;grid-template-columns:30px 30px 80px 110px 1fr 60px 50px;gap:6px;padding:6px var(--sp-2);border-bottom:1px solid var(--c-border-soft);font-size:var(--fs-xs);align-items:center;${r.in_jpkerp ? 'opacity:0.5;' : ''}">
          <span><input type="checkbox" data-prep-idx="${i}" ${r.checked ? 'checked' : ''} ${r.in_jpkerp ? 'disabled' : ''}></span>
          <span style="color:var(--c-text-muted);">${i + 1}</span>
          <span>${r.maker}</span>
          <span>${r.model}</span>
          <span style="font-weight:var(--fw-medium);">${r.sub}</span>
          <span style="text-align:right;color:var(--c-accent);">${r.product_count || 0}</span>
          <span style="font-size:var(--fs-2xs);color:${r.in_jpkerp ? 'var(--c-ok)' : 'var(--c-warn)'};">${r.in_jpkerp ? '등록됨' : '미등록'}</span>
        </div>
      `).join('')}
    `;
    document.getElementById('vmPrepAll')?.addEventListener('change', (e) => {
      _vmPrepRows.forEach(r => { if (!r.in_jpkerp) r.checked = e.target.checked; });
      renderVmList(vm); renderVmActions(vm);
    });
    listEl.querySelectorAll('[data-prep-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        _vmPrepRows[Number(cb.dataset.prepIdx)].checked = cb.checked;
        renderVmActions(vm);
      });
    });
    return;
  }

  // 일반 모드
  makerSel.disabled = false;
  document.getElementById('vmSearch').disabled = false;

  const makers = vm.uniqueMakers(_vmModels);
  const cur = makerSel.value;
  makerSel.innerHTML = `<option value="">전체 (${_vmModels.length})</option>` +
    makers.map(m => `<option value="${m.maker}" ${cur === m.maker ? 'selected' : ''}>${m.maker} (${m.count})</option>`).join('');

  // asset_count 계산 — products 에서 maker+model+sub 매칭 수
  const countByKey = new Map();
  for (const p of (store.products || [])) {
    if (p._deleted || p.status === 'deleted') continue;
    const k = [p.maker, p.model, p.sub_model].filter(Boolean).join('|');
    countByKey.set(k, (countByKey.get(k) || 0) + 1);
  }

  let list = _vmModels.map(v => ({
    ...v,
    asset_count: countByKey.get([v.maker, v.model, v.sub].filter(Boolean).join('|')) || 0,
  }));

  // 불량 레코드 제외 (maker·model·sub 모두 비어있는 것)
  list = list.filter(v => v.maker || v.model || v.sub);

  if (!_vmShowArchived) list = list.filter(v => !v.archived);
  if (_vmFilterMaker) list = list.filter(v => v.maker === _vmFilterMaker);
  if (_vmSearch) {
    const q = _vmSearch.toLowerCase();
    list = list.filter(v => [v.maker, v.model, v.sub, v.car_name, v.code, v.type_number_pattern]
      .some(s => s && String(s).toLowerCase().includes(q)));
  }
  // JPKerp 기본 정렬: 보유 내림차순
  list.sort((a, b) => b.asset_count - a.asset_count);

  document.getElementById('vmStats').textContent = `${list.length}/${_vmModels.length}종`;

  if (!list.length) {
    listEl.innerHTML = `<div style="padding:var(--sp-6);text-align:center;color:var(--c-text-muted);font-size:var(--fs-xs);">${_vmModels.length === 0 ? '차종 없음 — "차종 시드" 로 일괄등록 시작' : '결과 없음'}</div>`;
    return;
  }

  listEl.innerHTML = `
    <div style="display:grid;grid-template-columns:30px 70px 90px 1fr 50px 90px 75px 75px 50px;gap:6px;padding:6px var(--sp-2);border-bottom:1px solid var(--c-border);background:var(--c-bg-sub);font-size:var(--fs-2xs);color:var(--c-text-muted);position:sticky;top:0;z-index:1;">
      <span>#</span><span>제조사</span><span>모델</span><span>세부모델</span><span>제조국</span><span>차종구분</span><span>생산시작</span><span>생산종료</span><span style="text-align:right;">보유</span>
    </div>
    ${list.map((v, i) => `
      <div class="vm-row ${v._key === _vmSelectedKey ? 'is-active' : ''}" data-key="${v._key}"
           style="display:grid;grid-template-columns:30px 70px 90px 1fr 50px 90px 75px 75px 50px;gap:6px;padding:6px var(--sp-2);border-bottom:1px solid var(--c-border-soft);cursor:pointer;font-size:var(--fs-xs);align-items:center;${v._key === _vmSelectedKey ? 'background:var(--c-accent-soft);' : ''}">
        <span style="color:var(--c-text-muted);">${i + 1}</span>
        <span style="font-weight:var(--fw-semibold);">${v.maker || '-'}</span>
        <span>${v.model || '-'}</span>
        <span style="font-weight:var(--fw-medium);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${v.sub || '-'}</span>
        <span style="color:${v.origin === '수입' ? 'var(--c-accent)' : 'var(--c-text-sub)'};font-weight:${v.origin === '수입' ? 'var(--fw-semibold)' : 'normal'};">${v.origin || '-'}</span>
        <span style="color:var(--c-text-sub);">${v.category || '-'}</span>
        <span style="color:var(--c-text-sub);font-size:var(--fs-2xs);">${v.production_start || v.year_start || '-'}</span>
        <span style="color:${(v.production_end || v.year_end) === '현재' ? 'var(--c-ok)' : 'var(--c-text-sub)'};font-size:var(--fs-2xs);font-weight:${(v.production_end || v.year_end) === '현재' ? 'var(--fw-semibold)' : 'normal'};">${v.production_end || v.year_end || '-'}</span>
        <span style="text-align:right;color:${v.asset_count > 0 ? 'var(--c-accent)' : 'var(--c-text-muted)'};font-weight:${v.asset_count > 0 ? 'var(--fw-semibold)' : 'normal'};">${v.asset_count}</span>
      </div>
    `).join('')}
  `;

  listEl.querySelectorAll('.vm-row').forEach(row => {
    row.addEventListener('click', () => {
      _vmSelectedKey = row.dataset.key;
      _vmMode = 'view';
      _vmForm = vmFormFromRow(_vmModels.find(v => v._key === _vmSelectedKey));
      renderVmActions(vm); renderVmList(vm); renderVmDetail(vm);
    });
  });
}

function renderVmDetail(vm) {
  const el = document.getElementById('vmDetail');
  if (!el) return;
  if (_vmMode === 'idle') { el.style.display = 'none'; return; }
  el.style.display = 'block';

  const selected = _vmModels.find(v => v._key === _vmSelectedKey);

  if (_vmMode === 'view' && selected) {
    const kv = (k, v, style = '') => v ? `<dt style="color:var(--c-text-muted);">${k}</dt><dd style="margin:0;${style}">${v}</dd>` : '';
    el.innerHTML = `
      <div style="padding:var(--sp-4);">
        <div style="font-size:var(--fs-lg);font-weight:var(--fw-semibold);margin-bottom:2px;">${selected.maker} <span style="color:var(--c-text-sub);font-weight:var(--fw-medium);">${selected.model}</span></div>
        <div style="font-size:var(--fs-md);color:var(--c-text-sub);margin-bottom:var(--sp-3);">${selected.sub}</div>
        <dl style="display:grid;grid-template-columns:auto 1fr;gap:6px var(--sp-3);margin:0;font-size:var(--fs-sm);">
          ${kv('구분', selected.origin ? `<b style="color:${selected.origin === '수입' ? 'var(--c-accent)' : 'var(--c-text)'};">${selected.origin}</b>` : '')}
          ${kv('동력', selected.powertrain ? `<b style="color:${selected.powertrain === '전기' ? 'var(--c-ok)' : selected.powertrain === '하이브리드' ? 'var(--c-warn)' : 'var(--c-text)'};">${selected.powertrain}</b>` : '')}
          ${kv('코드', selected.code)}
          ${kv('생산기간', `${selected.production_start || selected.year_start || '?'} ~ ${selected.production_end || selected.year_end || '현재'}`)}
          ${kv('분류', selected.category)}
          ${kv('차체', selected.body_type)}
          ${kv('크기', selected.size_class)}
          ${kv('연료', selected.fuel_type)}
          ${kv('승차정원', selected.seats ? `${selected.seats}인승` : '')}
          ${kv('배기량', selected.displacement ? `${selected.displacement.toLocaleString()}cc` : '')}
          ${kv('배터리', selected.battery_kwh ? `${selected.battery_kwh} kWh` : '')}
          ${kv('차명(등록증)', selected.car_name)}
          ${kv('형식번호', selected.type_number_pattern ? `<code style="font-family:monospace;">${selected.type_number_pattern}</code>` : '')}
          ${kv('엔진형식', selected.engine_type)}
          ${kv('제조사 코드', selected.maker_code)}
          ${kv('제조사 영문', selected.maker_eng)}
          ${kv('인기도', selected.popularity ?? '')}
        </dl>
      </div>
    `;
    return;
  }

  if (_vmMode === 'edit' || _vmMode === 'new') {
    const row = (label, key, val, opts = {}) => {
      const type = opts.type || 'text';
      const ph = opts.placeholder || '';
      return `
        <div style="display:flex;flex-direction:column;gap:3px;">
          <label style="font-size:var(--fs-2xs);color:var(--c-text-muted);">${label}</label>
          <input class="input input-sm" data-vmf="${key}" type="${type}" value="${val ?? ''}" placeholder="${ph}">
        </div>
      `;
    };
    const sel = (label, key, val, opts) => `
      <div style="display:flex;flex-direction:column;gap:3px;">
        <label style="font-size:var(--fs-2xs);color:var(--c-text-muted);">${label}</label>
        <select class="input input-sm" data-vmf="${key}">
          <option value="">-</option>
          ${opts.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
    `;
    const f = _vmForm;
    el.innerHTML = `
      <div style="padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-2);">
        <div style="font-size:var(--fs-md);font-weight:var(--fw-semibold);">
          <i class="ph ${_vmMode === 'edit' ? 'ph-pencil' : 'ph-plus-circle'}"></i>
          ${_vmMode === 'edit' ? '차종 수정' : '새 차종 추가'}
        </div>
        ${row('제조사 *', 'maker', f.maker, { placeholder: '현대' })}
        ${row('모델명 *', 'model', f.model, { placeholder: '아반떼' })}
        ${row('세부모델 *', 'sub', f.sub, { placeholder: '아반떼 CN7 23-' })}
        ${row('내부코드', 'code', f.code, { placeholder: 'CN7' })}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${row('생산시작', 'production_start', f.production_start, { placeholder: '2023-04 또는 2023' })}
          ${row('생산종료', 'production_end', f.production_end, { placeholder: '현재 또는 2024-12' })}
        </div>
        ${sel('분류', 'category', f.category, VM_CATEGORIES)}
        ${sel('제조국', 'origin', f.origin, VM_ORIGINS)}
        ${sel('동력', 'powertrain', f.powertrain, VM_POWERTRAINS)}
        ${sel('연료', 'fuel_type', f.fuel_type, VM_FUELS)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${row('배기량 (cc)', 'displacement', f.displacement, { type: 'number' })}
          ${row('승차정원', 'seats', f.seats, { type: 'number' })}
        </div>
        ${row('배터리 (kWh)', 'battery_kwh', f.battery_kwh, { type: 'number' })}

        <div style="margin-top:var(--sp-2);padding-top:var(--sp-2);border-top:1px solid var(--c-border-soft);font-size:var(--fs-2xs);color:var(--c-text-muted);font-weight:var(--fw-semibold);">엔카 확장</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${sel('차체', 'body_type', f.body_type, VM_BODY_SHAPES)}
          ${sel('크기', 'size_class', f.size_class, VM_SIZE_CLASSES)}
        </div>
        ${row('차명 (등록증)', 'car_name', f.car_name, { placeholder: '아반떼(CN7)' })}
        ${row('형식번호 패턴', 'type_number_pattern', f.type_number_pattern, { placeholder: 'CN7* 또는 정규식' })}
        ${row('엔진형식', 'engine_type', f.engine_type, { placeholder: 'G4FL, D4HB' })}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${row('제조사 코드', 'maker_code', f.maker_code, { placeholder: '예: 101' })}
          ${row('제조사 영문', 'maker_eng', f.maker_eng, { placeholder: 'Hyundai' })}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);">
          ${row('인기도', 'popularity', f.popularity, { type: 'number' })}
          ${row('모델 인기도', 'model_popularity', f.model_popularity, { type: 'number' })}
        </div>
      </div>
    `;
    // 폼 입력 → _vmForm 동기화
    el.querySelectorAll('[data-vmf]').forEach(inp => {
      inp.addEventListener('input', () => { _vmForm[inp.dataset.vmf] = inp.value; });
      inp.addEventListener('change', () => { _vmForm[inp.dataset.vmf] = inp.value; });
    });
  }
}

/* ── 차종 시드 · 기존 보완 · 전체 삭제 · 저장 · 삭제 액션 ── */

async function vmSaveAction(vm) {
  const f = _vmForm;
  if (!f.maker || !f.model || !f.sub) { showToast('제조사·모델·세부모델 필수', 'error'); return; }
  const payload = {
    maker: f.maker.trim(), model: f.model.trim(), sub: f.sub.trim(),
    code: f.code.trim() || undefined,
    production_start: f.production_start.trim() || undefined,
    production_end: f.production_end.trim() || '현재',
    // year_* 레거시 필드는 저장 안 함 (기존 레코드는 읽기만)
    category: f.category || undefined,
    fuel_type: f.fuel_type || undefined,
    origin: f.origin || undefined,
    powertrain: f.powertrain || undefined,
    seats: f.seats ? Number(f.seats) : undefined,
    displacement: f.displacement ? Number(f.displacement) : undefined,
    battery_kwh: f.battery_kwh ? Number(f.battery_kwh) : undefined,
    body_type: f.body_type || undefined,
    size_class: f.size_class || undefined,
    car_name: f.car_name?.trim() || undefined,
    type_number_pattern: f.type_number_pattern?.trim() || undefined,
    engine_type: f.engine_type?.trim() || undefined,
    maker_code: f.maker_code?.trim() || undefined,
    maker_eng: f.maker_eng?.trim() || undefined,
    popularity: f.popularity ? Number(f.popularity) : undefined,
    model_popularity: f.model_popularity ? Number(f.model_popularity) : undefined,
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  try {
    if (_vmMode === 'edit' && _vmSelectedKey) {
      await vm.updateVehicleModel(_vmSelectedKey, payload);
      devLog(`[vm] 수정: ${payload.maker} ${payload.sub}`);
      showToast('수정됨');
      _vmMode = 'view';
    } else {
      const exists = _vmModels.some(m => m.maker === payload.maker && m.model === payload.model && m.sub === payload.sub);
      if (exists) { showToast('이미 등록된 세부모델', 'error'); return; }
      const key = await vm.createVehicleModel(payload);
      devLog(`[vm] 추가: ${payload.maker} ${payload.sub} (${key})`);
      showToast('추가됨');
      _vmSelectedKey = key;
      _vmMode = 'view';
    }
    renderVmActions(vm); renderVmDetail(vm);
  } catch (e) {
    showToast(`저장 실패: ${e?.message}`, 'error');
  }
}

/** 차종 감사 — products 의 (maker | model | sub_model) 조합을 전수 분석.
 *  상태별 분류 (✅ 정확 / 🔄 정규화 가능 / ⚠ 애매 (model만 같음) / ❓ 결측 / ❌ 미등록) */
function vmAuditAction(vm) {
  const products = (store.products || []).filter(p => p.status !== 'deleted' && !p._deleted);
  if (!products.length) { showToast('상품 없음'); return; }

  // 15년 이상 된 세대는 아예 후보 풀에서 제외 (사용자 정책)
  //  - production_start 가 15년 이상 전이면 제외 (옛 세대 전부 컷)
  //  - production_end 가 15년 이상 전이면 제외 (단종 오래된 것)
  const thisYear = new Date().getFullYear();
  const cutoffYear = thisYear - 15;    // 현재 2026 기준 2011 이하 excluded
  const toInt4 = v => {
    if (!v || v === '현재') return null;
    const m = String(v).match(/(\d{4})/);
    return m ? Number(m[1]) : null;
  };
  const tooOld = m => {
    const ys = toInt4(m?.production_start ?? m?.year_start);
    if (ys && ys <= cutoffYear) return true;
    const ye = toInt4(m?.production_end ?? m?.year_end);
    if (ye && ye <= cutoffYear) return true;
    return false;
  };
  const master = _vmModels.filter(m => m.maker && m.sub && !m.archived && !tooOld(m));

  // 매칭 도우미 — normalize 와 동일 로직을 연산
  const stripYear = s => String(s || '')
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+\d{2,4}\s*-\s*\d{0,4}\s*$/, '').replace(/\s+\d{4}\s*$/, '')
    .replace(/\s*\(페리\d*\)\s*/g, ' ').replace(/\s*페리\d*\s*/g, ' ')
    .replace(/^\s*더\s*뉴\s*/, '').replace(/^\s*신\s*형\s*/, '')
    .replace(/^\s*올\s*뉴\s*/, '').replace(/^\s*뉴\s+/, '').trim();
  const norm = s => stripYear(s).toLowerCase().replace(/[\s()\/\-.,~·_]/g, '');
  const yearNum = p => { const y = Number(p?.year); return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null; };
  const yearOf = ym => { const m = String(ym || '').match(/^(\d{4})/); return m ? Number(m[1]) : null; };
  const withinRange = (p, m) => {
    const y = yearNum(p); if (!y) return null;
    const ys = yearOf(m.production_start ?? m.year_start);
    const ye = m.production_end === '현재' || !m.production_end ? 9999 : (yearOf(m.production_end ?? m.year_end) ?? 9999);
    if (!ys) return null;
    return y >= ys && y <= ye;
  };
  const productTokens = p => {
    const src = [p?.trim_name, p?.trim, p?.model_code, p?.engine_code, p?.options, p?.sub_model].filter(Boolean).join(' ');
    return new Set((src.match(/[A-Za-z0-9]+|[가-힯]+/g) || []).map(x => x.toLowerCase()));
  };
  const pickBest = (p, cands) => {
    if (!cands?.length) return null;
    if (cands.length === 1) return cands[0];
    const py = yearNum(p);
    if (py) { const ir = cands.filter(m => withinRange(p, m) === true); if (ir.length) cands = ir; }
    const pTks = productTokens(p);
    const scored = cands.map(m => {
      const mCode = String(m.code || '').toLowerCase();
      const codeHit = mCode && pTks.has(mCode) ? 5 : 0;
      const subCodes = (String(m.sub || '').match(/[A-Za-z0-9]{2,}/g) || []).map(x => x.toLowerCase());
      const subCodeHit = subCodes.filter(c => pTks.has(c)).length * 3;
      const mSubTks = (String(m.sub || '').match(/[A-Za-z0-9]+|[가-힯]+/g) || []).map(x => x.toLowerCase());
      const softHits = mSubTks.filter(t => pTks.has(t) && t.length > 1).length;
      return { m, score: codeHit + subCodeHit + softHits, pop: Number(m.popularity || m.model_popularity || 0), ys: yearOf(m.production_start ?? m.year_start) || 0 };
    });
    scored.sort((a, b) => (b.score - a.score) || (b.pop - a.pop) || (b.ys - a.ys));
    return scored[0].m;
  };

  const idxExact = new Map();
  const idxBySub = new Map();
  const byMakerModel = new Map();
  for (const m of master) {
    idxExact.set(`${m.maker}|${m.model}|${m.sub}`, m);
    const n = norm(m.sub);
    if (n) { if (!idxBySub.has(n)) idxBySub.set(n, []); idxBySub.get(n).push(m); }
    const mkm = `${m.maker}|${m.model || ''}`;
    if (!byMakerModel.has(mkm)) byMakerModel.set(mkm, []);
    byMakerModel.get(mkm).push(m);
  }

  // 상품별로 matchProduct 돌려서 결과 집계
  const matchProduct = (p) => {
    if (!p.maker && !p.sub_model) return { stage: 'unmatched', target: null };
    let best = null, stage = '';
    const isGeneric = p.maker && p.model && (!p.sub_model || p.sub_model === p.model);
    if (!isGeneric) {
      const exactKey = `${p.maker || ''}|${p.model || ''}|${p.sub_model || ''}`;
      if (idxExact.has(exactKey)) { best = idxExact.get(exactKey); stage = 'exact'; }
      if (!best && p.sub_model) {
        const list = idxBySub.get(norm(p.sub_model)) || [];
        if (list.length === 1) { best = list[0]; stage = 'norm'; }
        else if (list.length > 1) {
          const byMk = list.filter(m => m.maker === p.maker && m.model === p.model);
          const byM = list.filter(m => m.maker === p.maker);
          best = pickBest(p, byMk.length ? byMk : byM.length ? byM : list);
          stage = 'norm-multi';
        }
      }
      if (!best && p.maker && p.sub_model) {
        const nSub = norm(p.sub_model);
        const cands = master.filter(m => m.maker === p.maker && nSub && (norm(m.sub).includes(nSub) || nSub.includes(norm(m.sub))));
        best = pickBest(p, cands); if (best) stage = 'partial';
      }
      if (!best && p.model && p.sub_model) {
        const nSub = norm(p.sub_model);
        const cands = master.filter(m => m.model === p.model && (norm(m.sub) === nSub || norm(m.sub).includes(nSub) || nSub.includes(norm(m.sub))));
        best = pickBest(p, cands); if (best) stage = 'maker-fix';
      }
    }
    if (!best && p.maker && p.model) {
      const cands = master.filter(m => m.maker === p.maker && m.model === p.model);
      if (cands.length) { best = pickBest(p, cands); stage = 'generic'; }
    }
    return { stage: best ? stage : 'unmatched', target: best };
  };

  // 상품 전수 매칭 → 결과별 집계
  const agg = new Map(); // key: "fromMaker|fromModel|fromSub → toMaker|toModel|toSub" → { count, stage }
  const unmatched = [];
  for (const p of products) {
    const r = matchProduct(p);
    if (!r.target) {
      unmatched.push(p);
      continue;
    }
    const from = `${p.maker || '?'} / ${p.model || '?'} / ${p.sub_model || '—'}`;
    const to = `${r.target.maker} / ${r.target.model} / ${r.target.sub}`;
    const key = `${from} → ${to}`;
    if (!agg.has(key)) agg.set(key, { from, to, stage: r.stage, count: 0, sampleYears: new Set() });
    const a = agg.get(key);
    a.count++;
    if (p.year) a.sampleYears.add(String(p.year));
  }

  const rows = [...agg.values()].sort((a, b) => b.count - a.count);
  const total = products.length;
  const changeRows = rows.filter(r => {
    const [from, to] = r.from === r.to ? [null, null] : [r.from, r.to];
    return from && to && r.from !== r.to;
  });
  const sameRows = rows.filter(r => r.from === r.to);

  devLog(`=== 차종 감사 (${new Date().toLocaleString('ko')}) ===`);
  devLog(`상품 ${total}건 · 매칭 성공 ${total - unmatched.length}건 · 실패 ${unmatched.length}건`);
  devLog(`변경 필요 ${changeRows.reduce((s,r)=>s+r.count,0)}건 (${changeRows.length}조합) · 이미 표준 ${sameRows.reduce((s,r)=>s+r.count,0)}건`);
  devLog('');

  devLog(`--- 변경 필요 (상위 30, stage=매칭단계) ---`);
  for (const r of changeRows.slice(0, 30)) {
    const yrs = r.sampleYears.size ? ` [yr: ${[...r.sampleYears].sort().slice(0, 4).join(',')}${r.sampleYears.size > 4 ? '+' : ''}]` : '';
    devLog(`  ${String(r.count).padStart(4)} × ${r.from}`);
    devLog(`       → ${r.to}  (${r.stage})${yrs}`);
  }

  if (unmatched.length) {
    devLog('');
    devLog(`--- ❌ 매칭 실패 (상위 10) ---`);
    const byCombo = new Map();
    for (const p of unmatched) {
      const k = `${p.maker || '?'} / ${p.model || '?'} / ${p.sub_model || '—'}`;
      byCombo.set(k, (byCombo.get(k) || 0) + 1);
    }
    const sorted = [...byCombo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [k, n] of sorted) devLog(`  ${String(n).padStart(4)} × ${k}`);
    devLog('→ "누락 차종 등록" 실행 후 재감사');
  }

  devLog('');
  devLog(`매칭 단계: exact=정확 / norm=정규화 / partial=부분일치 / maker-fix=제조사교정 / generic=세대추론`);

  showToast(`감사 완료 — 로그 확인 (변경 ${changeRows.reduce((s,r)=>s+r.count,0)}건 / 실패 ${unmatched.length}건)`);
}

/** 엔카 마스터에 없는 제조사·차종을 products 에서 추출해서 vehicle_master 에 자동 등록.
 *  정규화 실패 상품 구제용 — 람보르기니·페라리·벤틀리 등 엔카 택소노미 외 차종.
 *  등록 후 "상품 정규화" 재실행하면 대부분 매칭됨. */
async function vmAutoRegisterAction(vm) {
  const products = (store.products || []).filter(p => p.status !== 'deleted' && !p._deleted);
  if (!products.length) { showToast('상품 없음'); return; }

  // 기존 마스터에 이미 있는 (maker|sub) 조합 인덱스 — 중복 등록 방지
  const existing = new Set();
  for (const m of _vmModels) {
    if (m.maker && m.sub) existing.add(`${m.maker}|${m.sub}`);
  }

  // 제조사별 국산/수입 추정 — JPKerp2 DOMESTIC_MAKERS 준용
  const DOMESTIC = new Set(['현대', '기아', '제네시스', '르노', 'KGM', '쌍용', '쉐보레']);

  // 등록 후보 추출 — 중복 제거 (maker|sub_model 기준)
  const toAdd = new Map();       // key: "maker|sub_model" → row
  const byMakerCount = new Map();
  for (const p of products) {
    const mk = (p.maker || '').trim();
    const sub = (p.sub_model || '').trim();
    if (!mk || !sub) continue;
    const key = `${mk}|${sub}`;
    if (existing.has(key)) continue;
    if (toAdd.has(key)) {
      toAdd.get(key)._count++;
      continue;
    }
    toAdd.set(key, {
      maker: mk,
      model: (p.model || '').trim() || sub,              // model 없으면 sub_model로 대체
      sub,
      car_name: sub,                                     // 등록증 매칭키 초깃값
      origin: DOMESTIC.has(mk) ? '국산' : '수입',
      source: 'from_products',
      status: 'active',
      _count: 1,
    });
    byMakerCount.set(mk, (byMakerCount.get(mk) || 0) + 1);
  }

  if (!toAdd.size) {
    showToast('등록할 누락 차종이 없습니다 — 모든 상품의 차종이 이미 마스터에 있음');
    return;
  }

  // 제조사별 요약 (상위 10개)
  const makerSummary = [...byMakerCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([mk, n]) => `  ${mk}: ${n}종`)
    .join('\n');

  if (!confirm(
    `products 에서 미등록 차종 ${toAdd.size}종 발견\n\n`
    + `제조사별 요약:\n${makerSummary}${byMakerCount.size > 10 ? `\n  외 ${byMakerCount.size - 10}개 제조사` : ''}\n\n`
    + `자동 등록 (source: 'from_products')?\n`
    + `※ category·production 등 메타는 비워두고, 이후 수동 편집 가능합니다.`
  )) return;

  devLog(`[vmAutoReg] ${toAdd.size}종 등록 시작`);
  const { ref: dbRef, update: dbUpdate, push: dbPush } = await import('firebase/database');
  const { db } = await import('../../firebase/config.js');
  const updates = {};
  const now = Date.now();
  for (const row of toAdd.values()) {
    const key = dbPush(dbRef(db, 'vehicle_master')).key;
    const { _count, ...payload } = row;
    updates[`vehicle_master/${key}`] = { ...payload, created_at: now, updated_at: now };
  }
  try {
    const keys = Object.keys(updates);
    const CHUNK = 400;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
      await dbUpdate(dbRef(db), slice);
      devLog(`[vmAutoReg] ${Math.min(i + CHUNK, keys.length)}/${keys.length} 패스`);
    }
    devLog(`[vmAutoReg] 완료 · ${toAdd.size}종 등록`);
    showToast(`${toAdd.size}종 등록 — "상품 정규화" 재실행하면 매칭됩니다`);
  } catch (e) {
    showToast(`실패: ${e.message}`, 'error');
  }
}

/** products 의 maker/model/sub_model 을 vehicle_master 의 표준 명칭으로 정규화
 *  매칭: (maker|model|sub_model) exact → (sub_model normalized) → (maker+sub_model 부분일치) */
async function vmNormalizeProductsAction(vm) {
  const products = (store.products || []).filter(p => p.status !== 'deleted' && !p._deleted);
  if (!products.length) { showToast('상품 없음'); return; }

  // 15년 이상 단종된 master 는 후보 풀에서 제외 (사용자 정책: 15년 전 모델은 없다고 간주)
  const thisYear = new Date().getFullYear();
  const minEndYear = thisYear - 15;
  const tooOld = m => {
    const ye = m?.production_end;
    if (!ye || ye === '현재') return false;
    const y = Number(String(ye).match(/^(\d{4})/)?.[1]);
    return y && y < minEndYear;
  };
  const master = _vmModels.filter(m => m.maker && m.model && m.sub && !m.archived && !tooOld(m));
  if (!master.length) { showToast('엔카 마스터가 비어있음 — 먼저 import', 'error'); return; }

  // 1) 연식 suffix 제거 ("쏘렌토 MQ4 20-" → "쏘렌토 MQ4", "아반떼 CN7 2023-" → "아반떼 CN7")
  // 2) "(페리)", "(페리2)", "더뉴"/"더 뉴", "신형" 같은 표기 제거
  // 3) 공백·괄호·하이픈·점·한국 정식/전각 문자 제거 후 소문자화
  const stripYear = s => String(s || '')
    // 전각 문자 정규화 (유저가 IME 전각으로 입력한 "（ＣＮ７）" 같은 케이스)
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+\d{2,4}\s*-\s*\d{0,4}\s*$/, '')   // " 20-", " 2020-", " 20-22"
    .replace(/\s+\d{4}\s*$/, '')                     // trailing " 2023"
    .replace(/\s*\(페리\d*\)\s*/g, ' ')              // "(페리)", "(페리2)" → space
    .replace(/\s*페리\d*\s*/g, ' ')                  // 괄호 없는 "페리"
    .replace(/^\s*더\s*뉴\s*/, '')                   // "더 뉴 " or "더뉴" (공백 선택)
    .replace(/^\s*신\s*형\s*/, '')                   // "신형"
    .replace(/^\s*올\s*뉴\s*/, '')                   // "올 뉴", "올뉴"
    .replace(/^\s*뉴\s+/, '')                        // "뉴 " (단독 prefix)
    .trim();
  const norm = s => stripYear(s).toLowerCase().replace(/[\s()\/\-.,~·_]/g, '');

  const idxExact = new Map();        // "maker|model|sub" → row
  const idxBySub = new Map();        // normSub → [row, ...]
  for (const m of master) {
    idxExact.set(`${m.maker}|${m.model}|${m.sub}`, m);
    const n = norm(m.sub);
    if (n) {
      if (!idxBySub.has(n)) idxBySub.set(n, []);
      idxBySub.get(n).push(m);
    }
  }

  // 연식 기간 체크 — master.production_start ~ production_end 범위 안에 product.year 가 들어가는가
  // product.year 뿐 아니라 trim_name/sub_model/options 에서도 연식 추출
  //  지원 형식: "2023", "2023년", "2023-01", "23", "26MY", "2026MY"
  const yy2to4 = yy => yy > 50 ? 1900 + yy : 2000 + yy;
  const validYear = y => (y >= 1900 && y <= 2100 ? y : null);
  const yearNum = (p) => {
    // 1. product.year 필드
    const raw = String(p?.year ?? '').trim();
    let m = raw.match(/\d{4}/);
    if (m) return validYear(Number(m[0]));
    m = raw.match(/^(\d{2})\s*[년-]?/);
    if (m) return validYear(yy2to4(Number(m[1])));
    // 2. trim_name·sub_model·options 에서 "MY" 패턴 fallback
    const ctx = [p?.trim_name, p?.trim, p?.sub_model, p?.options].filter(Boolean).join(' ');
    m = ctx.match(/(\d{4})\s*MY\b/i);                         // "2026 MY", "2026MY"
    if (m) return validYear(Number(m[1]));
    m = ctx.match(/\b(\d{2})\s*MY\b/i);                       // "26MY"
    if (m) return validYear(yy2to4(Number(m[1])));
    return null;
  };
  const yearOf = (ym) => {
    const m = String(ym || '').match(/(\d{4})/);
    return m ? Number(m[1]) : null;
  };
  const withinRange = (p, m) => {
    const y = yearNum(p);
    if (!y) return null;                                        // 연식 없으면 판정 유보
    const ys = yearOf(m.production_start ?? m.year_start);
    const ye = m.production_end === '현재' || !m.production_end ? 9999 : (yearOf(m.production_end ?? m.year_end) ?? 9999);
    if (!ys) return null;
    return y >= ys && y <= ye;
  };
  // 토큰 추출 — 영숫자는 붙여서 ("MQ4" 가 ["MQ","4"] 로 쪼개지지 않도록)
  //  product 의 모든 식별 필드 (trim·모델코드·엔진코드·옵션·sub_model) 에서 추출
  const productTokens = p => {
    const src = [p?.trim_name, p?.trim, p?.model_code, p?.engine_code, p?.options, p?.sub_model]
      .filter(Boolean).join(' ');
    return (src.match(/[A-Za-z0-9]+|[가-힯]+/g) || []).map(x => x.toLowerCase());
  };
  /** 여러 후보 중 최선 선택 — 연식 HARD FILTER + 세대코드 가중치
   *  1. product.year 범위 매칭 → 범위 일치만 후보로 축소
   *  2. master.code ("CN7", "MQ4") 가 product 의 토큰에 있으면 세대 확정 (+5)
   *  3. master.sub 토큰이 product 토큰에 있으면 +1 (양방향)
   *  4. popularity 내림차순
   *  5. production_start 내림차순 (최신) */
  const pickBest = (p, cands) => {
    if (!cands || !cands.length) return null;
    if (cands.length === 1) return cands[0];

    // 1) 연식 hard filter
    const py = yearNum(p);
    if (py) {
      const inRange = cands.filter(m => withinRange(p, m) === true);
      if (inRange.length) cands = inRange;
    } else {
      // 연식 없으면 "최근 10년" 내 생산 레코드 우선 (대부분 상품이 최근차량이라는 사전지식)
      const thisYear = new Date().getFullYear();
      const recentCutoff = thisYear - 10;
      const recent = cands.filter(m => {
        const ys = yearOf(m.production_start ?? m.year_start) || 0;
        const ye = m.production_end === '현재' ? thisYear + 1 : (yearOf(m.production_end ?? m.year_end) ?? 0);
        return ye >= recentCutoff;
      });
      if (recent.length) cands = recent;
    }

    // 2-5) 점수화
    const pTks = new Set(productTokens(p));
    const pFuel = String(p?.fuel_type || '').toLowerCase();
    const pIsEv = pFuel === '전기' || /ev|전기/i.test(p?.powertrain || '') || /ev|전기/i.test(p?.vehicle_class || '');
    const pIsHybrid = pFuel === '하이브리드' || /하이브리드/i.test(p?.powertrain || '');

    const scored = cands.map(m => {
      // 세대코드 강력 가중 — 예: master.code="MQ4" & product.trim contains "MQ4"
      const mCode = String(m.code || '').toLowerCase();
      const codeHit = mCode && pTks.has(mCode) ? 5 : 0;

      // master.sub 내 영숫자 코드(괄호 안) 도 동일하게 체크 — 예: "(CN7)"
      const subCodes = (String(m.sub || '').match(/[A-Za-z0-9]{2,}/g) || []).map(x => x.toLowerCase());
      const subCodeHit = subCodes.filter(c => pTks.has(c)).length * 3;

      // master.sub 전체 토큰 일치 수 (부드러운 가중)
      const mSubTks = (String(m.sub || '').match(/[A-Za-z0-9]+|[가-힯]+/g) || []).map(x => x.toLowerCase());
      const softHits = mSubTks.filter(t => pTks.has(t) && t.length > 1).length;

      // 연료/파워트레인 일치 — 전기차/하이브리드 오매칭 방지
      // product 내연 → master "EV/전기" 포함 = −10 (거의 배제)
      // product 전기 → master "EV/전기" 포함 = +3 (우선)
      const mSubLc = String(m.sub || '').toLowerCase();
      const mIsEv = /\bev\b|전기/.test(mSubLc) || m.powertrain === '전기' || m.fuel_type === '전기';
      const mIsHybrid = /하이브리드|hybrid/.test(mSubLc) || m.powertrain === '하이브리드' || m.fuel_type === '하이브리드';
      let fuelScore = 0;
      if (pIsEv && mIsEv) fuelScore += 3;
      else if (!pIsEv && mIsEv) fuelScore -= 10;       // 내연차인데 master 가 EV면 크게 감점
      if (pIsHybrid && mIsHybrid) fuelScore += 3;
      else if (!pIsHybrid && mIsHybrid && !pIsEv) fuelScore -= 5;  // 하이브리드도 유사

      const ys = yearOf(m.production_start ?? m.year_start) || 0;
      return {
        m,
        score: codeHit + subCodeHit + softHits + fuelScore,
        pop: Number(m.popularity || m.model_popularity || 0),
        ys,
      };
    });
    scored.sort((a, b) => (b.score - a.score) || (b.pop - a.pop) || (b.ys - a.ys));
    return scored[0].m;
  };

  let unchanged = 0, unmatched = 0;
  const changes = [];
  const changedMaker = [];
  const unmatchedSamples = [];
  // 단계별 집계 — "검증 보완" — 매칭 신뢰도 가시화
  const stageCount = { exact: 0, norm: 0, 'norm-multi': 0, partial: 0, 'maker-fix': 0, generic: 0 };

  for (const p of products) {
    if (!p.maker && !p.sub_model) { unmatched++; continue; }
    let best = null, stage = '';

    // Generic sub 판정 — 세대 정보 없는 케이스
    const strippedSub = stripYear(p.sub_model || '').trim();
    const isGeneric = p.maker && p.model && (
      !p.sub_model ||
      p.sub_model === p.model ||
      strippedSub === p.model ||
      strippedSub === '' ||
      (strippedSub && norm(strippedSub) === norm(p.model))
    );

    if (!isGeneric) {
      // ① 완전일치
      const exactKey = `${p.maker || ''}|${p.model || ''}|${p.sub_model || ''}`;
      if (idxExact.has(exactKey)) { best = idxExact.get(exactKey); stage = 'exact'; }

      // ② sub 정규화 일치 (maker/model 일치 우선 → 연식·트림 가중치)
      if (!best && p.sub_model) {
        const list = idxBySub.get(norm(p.sub_model)) || [];
        if (list.length === 1) { best = list[0]; stage = 'norm'; }
        else if (list.length > 1) {
          const byMakerModel = list.filter(m => m.maker === p.maker && m.model === p.model);
          const byMaker = list.filter(m => m.maker === p.maker);
          best = pickBest(p, byMakerModel.length ? byMakerModel : byMaker.length ? byMaker : list);
          stage = 'norm-multi';
        }
      }

      // ③ maker + sub 부분일치
      if (!best && p.maker && p.sub_model) {
        const nSub = norm(p.sub_model);
        const cands = master.filter(m => m.maker === p.maker && nSub && (norm(m.sub).includes(nSub) || nSub.includes(norm(m.sub))));
        best = pickBest(p, cands);
        if (best) stage = 'partial';
      }

      // ④ maker 무시하고 model + sub 로 매칭 (maker 오입력 교정용 — "기아 그랜저" → "현대 그랜저")
      if (!best && p.model && p.sub_model) {
        const nSub = norm(p.sub_model);
        const cands = master.filter(m => m.model === p.model && (norm(m.sub) === nSub || norm(m.sub).includes(nSub) || nSub.includes(norm(m.sub))));
        best = pickBest(p, cands);
      }
    }

    // ⑤ generic 또는 지금까지 실패 — maker+model 후보에서 연식·트림으로 세대 자동 특정
    //  · "현대/쏘나타/쏘나타" + year=2022 + trim="1.6 터보 인스퍼레이션" → DN8 세대 매칭
    //  · 1세대 "쏘나타" 같은 옛 세대가 stage ② 에서 잘못 잡히는 것 방지
    if (!best && p.maker && p.model) {
      const cands = master.filter(m => m.maker === p.maker && m.model === p.model);
      if (cands.length) best = pickBest(p, cands);
    }

    if (!best) {
      unmatched++;
      if (unmatchedSamples.length < 8) unmatchedSamples.push(`  · ${p.maker || '?'} / ${p.model || '?'} / ${p.sub_model || '?'}`);
      continue;
    }

    // 매칭 성공 — 단, year 는 절대 건드리지 않음 (product.year 는 실제 차량 제작연도라 정확)
    const identical = best.maker === p.maker && best.model === p.model && best.sub === p.sub_model;

    if (identical) {
      unchanged++;
    } else {
      const change = {
        key: p._key,
        from: { maker: p.maker, model: p.model, sub_model: p.sub_model },
        to:   { maker: best.maker, model: best.model, sub_model: best.sub },
        makerChanged: best.maker !== p.maker,
      };
      changes.push(change);
      if (change.makerChanged) changedMaker.push(change);
    }
  }

  const sampleChanges = changes.slice(0, 6).map(c =>
    `  ${c.from.maker || '-'} / ${c.from.model || '-'} / ${c.from.sub_model || '-'}\n    → ${c.to.maker} / ${c.to.model} / ${c.to.sub_model}`
  ).join('\n');
  const sampleMakerChanges = changedMaker.slice(0, 6).map(c =>
    `  ⚠ ${c.from.maker || '-'} → ${c.to.maker}  (${c.to.sub_model})`
  ).join('\n');

  if (!confirm(
    `상품 ${products.length}건 분석 결과\n`
    + `  변경 필요: ${changes.length}건`
    + (changedMaker.length ? ` (제조사 교정 ${changedMaker.length})` : '')
    + `\n`
    + `  이미 표준: ${unchanged}건\n`
    + `  매칭 실패: ${unmatched}건\n\n`
    + `※ year(연식) 필드는 건드리지 않습니다.\n\n`
    + (changedMaker.length ? `제조사 교정 예시:\n${sampleMakerChanges}\n\n` : '')
    + (changes.length ? `전체 변경 예시:\n${sampleChanges}\n\n` : '')
    + (unmatched ? `매칭 실패 예시:\n${unmatchedSamples.join('\n')}\n\n` : '')
    + `${changes.length}건 적용?`)) return;

  if (!changes.length) { showToast('변경 사항 없음'); return; }

  const { ref: dbRef, update: dbUpdate } = await import('firebase/database');
  const { db } = await import('../../firebase/config.js');
  const updates = {};
  const now = Date.now();
  for (const c of changes) {
    updates[`products/${c.key}/maker`] = c.to.maker;
    updates[`products/${c.key}/model`] = c.to.model;
    updates[`products/${c.key}/sub_model`] = c.to.sub_model;
    updates[`products/${c.key}/updated_at`] = now;
  }
  const keys = Object.keys(updates);
  const CHUNK = 400;
  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
      await dbUpdate(dbRef(db), slice);
      devLog(`[vmNormalize] ${Math.min(i + CHUNK, keys.length)}/${keys.length} 패스`);
    }
    devLog(`[vmNormalize] 완료 · ${changes.length}건 정규화`);
    showToast(`${changes.length}건 정규화 완료`);
  } catch (e) {
    showToast(`실패: ${e.message}`, 'error');
  }
}

async function vmSeedAction(vm) {
  const { KOREAN_CAR_MODELS, subWithYear } = await import('../../core/car-models-seed.js');
  const existing = new Set(_vmModels.map(m => `${m.maker}|${m.model}|${m.sub}`));
  const toAdd = KOREAN_CAR_MODELS.filter(s => !existing.has(`${s.maker}|${s.model}|${subWithYear(s.sub, s.year_start)}`));
  if (!toAdd.length) { showToast(`차종 ${KOREAN_CAR_MODELS.length}종 모두 이미 등록됨`); return; }
  if (!confirm(`차종 ${toAdd.length}종 등록 (이미 ${KOREAN_CAR_MODELS.length - toAdd.length}종 존재). 진행?`)) return;
  devLog(`[vmSeed] ${toAdd.length}종 등록 시작...`);
  try {
    const result = await vm.seedVehicleMaster(({ i, total, added, skipped }) => {
      if (i % 30 === 0 || i === total) devLog(`[vmSeed] ${i}/${total} (추가 ${added} · 스킵 ${skipped})`);
    });
    devLog(`[vmSeed] 완료: 추가 ${result.added} · 스킵 ${result.skipped}`);
    showToast(`${result.added}종 시드 완료`);
  } catch (e) { showToast(`시드 실패: ${e?.message}`, 'error'); }
}

/** JPKerp2 완전 동기화 — vehicle_master 전체 하드 삭제 후 엔카 시드만 재임포트.
 *  결과: JPKerp2의 `import-vehicle-master.mjs --replace` 실행 결과와 1:1 일치 */
async function vmFullResyncAction(vm) {
  const before = _vmModels.length;
  const msg1 = `⚠ JPKerp2 완전 동기화\n\n`
    + `현재 vehicle_master ${before}건을 모두 하드 삭제하고\n`
    + `엔카 마스터 1092건만 새로 임포트합니다.\n\n`
    + `이전 "차종 시드"로 들어온 연식 suffix 형식 (예: "아반떼 CN7 22-") 이 모두 제거되고\n`
    + `엔카 표준 ("더 뉴 아반떼 (CN7)") 만 남습니다.\n\n`
    + `계속?`;
  if (!confirm(msg1)) return;
  if (!confirm(`마지막 확인 — ${before}건 삭제 후 1092건 재임포트`)) return;

  const { ref: dbRef, remove: dbRemove, update: dbUpdate } = await import('firebase/database');
  const { db } = await import('../../firebase/config.js');

  devLog(`[vmResync] 1/2 — vehicle_master ${before}건 전체 삭제`);
  try {
    await dbRemove(dbRef(db, 'vehicle_master'));
  } catch (e) {
    showToast(`삭제 실패: ${e.message}`, 'error');
    return;
  }

  devLog(`[vmResync] 2/2 — 엔카 1092건 임포트`);
  let rows;
  try {
    const res = await fetch('/data/encar-master-seed.json', { cache: 'no-store' });
    rows = await res.json();
  } catch (e) {
    showToast(`엔카 JSON 로드 실패: ${e.message}`, 'error');
    return;
  }

  const updates = {};
  const now = Date.now();
  for (const r of rows) {
    const { _key, ...payload } = r;
    updates[`vehicle_master/${_key}`] = { ...payload, created_at: now, updated_at: now };
  }
  const keys = Object.keys(updates);
  const CHUNK = 400;
  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
      await dbUpdate(dbRef(db), slice);
      devLog(`[vmResync] 배치 ${Math.min(i + CHUNK, keys.length)}/${keys.length}`);
    }
    devLog(`[vmResync] 완료 · JPKerp2 와 1:1 일치 (${rows.length}건)`);
    showToast(`완전 동기화 완료: ${rows.length}건`);
  } catch (e) {
    showToast(`임포트 실패: ${e.message}`, 'error');
  }
}

/** JPKerp2 /scripts/vehicle-master-seed.json (엔카 1092건) 일괄 import
 *  _key (encar_xxx) 기반 멱등 · 기존 레코드는 엔카 필드만 merge */
async function vmEncarImportAction(vm) {
  let rows;
  try {
    const res = await fetch('/data/encar-master-seed.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (e) {
    showToast(`엔카 JSON 로드 실패: ${e.message}`, 'error');
    return;
  }
  if (!Array.isArray(rows) || !rows.length) {
    showToast('엔카 JSON 비어있음', 'error');
    return;
  }

  // 기존 레코드 index: maker|model|sub → key
  const existingByCombo = new Map();
  const existingByKey = new Map();
  for (const m of _vmModels) {
    if (m._key) existingByKey.set(m._key, m);
    const combo = [m.maker, m.model, m.sub].filter(Boolean).join('|');
    if (combo && !existingByCombo.has(combo)) existingByCombo.set(combo, m);
  }

  const toAdd = [];
  const toMerge = [];
  for (const r of rows) {
    const combo = [r.maker, r.model, r.sub].filter(Boolean).join('|');
    const byKey = r._key && existingByKey.get(r._key);
    const byCombo = existingByCombo.get(combo);
    const existing = byKey || byCombo;
    if (existing) toMerge.push({ key: existing._key, row: r });
    else toAdd.push(r);
  }

  if (!confirm(
    `엔카 마스터 ${rows.length}건 import\n`
    + `  신규 추가: ${toAdd.length}\n`
    + `  기존 병합 (production_*·popularity·maker_code 채움): ${toMerge.length}\n\n`
    + `진행?`)) return;

  devLog(`[vmEncar] 시작 · 추가 ${toAdd.length} · 병합 ${toMerge.length}`);
  const { ref: dbRef, update: dbUpdate } = await import('firebase/database');
  const { db } = await import('../../firebase/config.js');

  // 멀티패스 update로 배치 처리 — 청크당 200건씩 1 라운드트립
  const MERGE_FIELDS = ['production_start','production_end','car_name','maker_eng','maker_code','popularity','model_popularity','category','archived','source'];
  const updates = {};
  const now = Date.now();
  for (const r of toAdd) {
    const { _key, ...payload } = r;
    updates[`vehicle_master/${_key}`] = { ...payload, created_at: now, updated_at: now };
  }
  for (const { key, row } of toMerge) {
    for (const f of MERGE_FIELDS) {
      if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
        updates[`vehicle_master/${key}/${f}`] = row[f];
      }
    }
    updates[`vehicle_master/${key}/updated_at`] = now;
  }

  const keys = Object.keys(updates);
  const CHUNK = 400;
  let ok = 0, fail = 0;
  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
      try {
        await dbUpdate(dbRef(db), slice);
        ok += Object.keys(slice).length;
        devLog(`[vmEncar] 배치 ${Math.min(i + CHUNK, keys.length)}/${keys.length}`);
      } catch (e) { fail += Object.keys(slice).length; console.error('[vmEncar] 배치 실패', e); }
    }
    devLog(`[vmEncar] 완료 · 패스 ${ok} · 실패 ${fail}`);
    showToast(`엔카 import 완료 (신규 ${toAdd.length} · 병합 ${toMerge.length})`);
  } catch (e) {
    showToast(`import 실패: ${e.message}`, 'error');
  }
}

async function vmEnrichAction(vm) {
  const { KOREAN_CAR_MODELS, inferOrigin, inferPowertrain, inferFuel, subWithYear } = await import('../../core/car-models-seed.js');
  const seedByKey = new Map();
  for (const s of KOREAN_CAR_MODELS) seedByKey.set(`${s.maker}|${s.model}|${subWithYear(s.sub, s.year_start)}`, s);

  const targets = _vmModels.filter(m => {
    const isEv = m.powertrain === '전기' || /EV|전기/i.test(m.category || '');
    return !m.category || !m.origin || !m.powertrain || !m.displacement || !m.seats
      || !m.code || !m.year_start
      || (isEv && !m.battery_kwh)
      || (!isEv && !m.fuel_type);
  });
  if (!targets.length) { showToast('모든 레코드 스펙 완성 상태'); return; }
  const matchedBySeed = targets.filter(m => seedByKey.has(`${m.maker}|${m.model}|${m.sub}`)).length;
  if (!confirm(`${targets.length}개 보완 대상:\n· 시드 매칭 ${matchedBySeed}개 (스펙 전부 채움)\n· 매칭 실패 ${targets.length - matchedBySeed}개 (제조사로 구분만 추정)\n\n진행?`)) return;
  devLog(`[vm] enrich 시작: ${targets.length}건`);
  let ok = 0, fail = 0;
  for (const m of targets) {
    try {
      const seed = seedByKey.get(`${m.maker}|${m.model}|${m.sub}`);
      const patch = {};
      if (seed) {
        if (!m.category && seed.category) patch.category = seed.category;
        if (!m.code && seed.code) patch.code = seed.code;
        if (!m.year_start && seed.year_start) patch.year_start = seed.year_start;
        if (!m.year_end && seed.year_end) patch.year_end = seed.year_end;
        if (!m.origin) patch.origin = inferOrigin(seed.maker);
        if (!m.powertrain) patch.powertrain = inferPowertrain(seed.category);
        if (!m.fuel_type) patch.fuel_type = seed.fuel_type || inferFuel(seed.category);
        if (!m.displacement && seed.displacement) patch.displacement = seed.displacement;
        if (!m.seats && seed.seats) patch.seats = seed.seats;
        if (!m.battery_kwh && seed.battery_kwh) patch.battery_kwh = seed.battery_kwh;
      } else {
        if (!m.origin && m.maker) patch.origin = inferOrigin(m.maker);
        if (!m.powertrain && m.category) patch.powertrain = inferPowertrain(m.category);
        if (!m.fuel_type && m.category) patch.fuel_type = inferFuel(m.category);
      }
      if (Object.keys(patch).length) {
        await vm.updateVehicleModel(m._key, patch);
        ok++;
      }
    } catch (e) { fail++; }
  }
  devLog(`[vm] enrich 완료: ${ok}건 성공 / ${fail}건 실패`);
  showToast(`${ok}건 보완 완료${fail ? ` (${fail}건 실패)` : ''}`);
}

function vmStartPrep(vm) {
  // products 에서 고유 차종 조합 추출
  const merged = new Map();
  for (const p of (store.products || [])) {
    if (p._deleted || p.status === 'deleted') continue;
    const maker = (p.maker || '').trim();
    const model = (p.model || '').trim();
    const sub = (p.sub_model || '').trim();
    if (!maker && !model && !sub) continue;
    const id = [maker, model, sub].filter(Boolean).join('|');
    let cur = merged.get(id);
    if (!cur) {
      cur = { id, maker: maker || '미지정', model: model || '—', sub: sub || model || '—', product_count: 0, in_jpkerp: false, checked: true };
      merged.set(id, cur);
    }
    cur.product_count++;
  }
  // 이미 vehicle_master 에 있는지 확인
  const existing = new Set(_vmModels.map(m => [m.maker, m.model, m.sub].filter(Boolean).join('|')));
  merged.forEach(r => {
    if (existing.has(r.id)) { r.in_jpkerp = true; r.checked = false; }
  });
  _vmPrepRows = [...merged.values()].sort((a, b) => {
    if (a.in_jpkerp !== b.in_jpkerp) return a.in_jpkerp ? 1 : -1;
    return b.product_count - a.product_count;
  });
  if (!_vmPrepRows.length) { showToast('products 에서 추출할 차종 없음'); return; }
  _vmMode = 'prep';
  renderVmActions(vm); renderVmList(vm); renderVmDetail(vm);
}

async function vmPrepCommit(vm) {
  const toAdd = _vmPrepRows.filter(r => r.checked && !r.in_jpkerp);
  if (!toAdd.length) { showToast('등록 대상 없음'); return; }
  if (!confirm(`${toAdd.length}종 vehicle_master 에 등록?`)) return;
  devLog(`[vmPrep] ${toAdd.length}건 등록 시작...`);
  let ok = 0, fail = 0;
  for (const r of toAdd) {
    try {
      await vm.createVehicleModel({
        maker: r.maker, model: r.model, sub: r.sub,
        year_end: '현재', status: 'active', seeded_from: 'products_prep',
      });
      ok++;
    } catch (e) { fail++; }
  }
  devLog(`[vmPrep] 완료: ${ok}건 성공 / ${fail}건 실패`);
  showToast(`${ok}종 등록 완료${fail ? ` (${fail} 실패)` : ''}`);
  _vmMode = 'idle'; _vmPrepRows = [];
  renderVmActions(vm); renderVmList(vm); renderVmDetail(vm);
}

async function vmDeleteAllAction(vm) {
  const { ref, remove } = await import('firebase/database');
  const { db } = await import('../../firebase/config.js');
  const active = _vmModels.length;
  if (!active) { showToast('삭제할 레코드 없음'); return; }

  // 불량 레코드 (maker/model/sub 모두 비어있는 것) 자동 감지
  const broken = _vmModels.filter(m => !m.maker && !m.model && !m.sub);
  if (broken.length && broken.length < active) {
    if (confirm(`불량 레코드 ${broken.length}건을 찾았습니다 (빈 데이터). 먼저 정리?\n· 확인: 불량만 하드 삭제\n· 취소: 전체 삭제로 진행`)) {
      let ok = 0;
      for (const m of broken) {
        try { await remove(ref(db, `vehicle_master/${m._key}`)); ok++; } catch {}
      }
      devLog(`[vm] 불량 ${ok}건 정리 완료`);
      showToast(`불량 ${ok}건 정리 완료`);
      return;
    }
  }

  if (!confirm(`⚠ vehicle_master ${active}건 전체 하드 삭제.\n복구 불가. 진행?`)) return;
  if (!confirm(`마지막 확인: ${active}건 전체 하드 삭제`)) return;
  devLog(`[vm] 전체 삭제 시작: ${active}건`);
  try {
    await remove(ref(db, 'vehicle_master'));
    devLog(`[vm] 전체 삭제 완료`);
    showToast(`${active}건 삭제 완료`);
  } catch (e) {
    showToast(`삭제 실패: ${e?.message}`, 'error');
  }
}

function openVmEditor(v, updateFn, deleteFn, createFn) {
  const isEdit = !!v?._key;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:var(--c-overlay-dark);z-index:9999;display:flex;align-items:center;justify-content:center;padding:var(--sp-4);';
  modal.innerHTML = `
    <div style="background:var(--c-surface);border-radius:var(--ctrl-r);width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
      <header style="display:flex;align-items:center;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--c-border);">
        <span style="font-size:var(--fs-md);font-weight:var(--fw-semibold);flex:1;">${isEdit ? '차종 수정' : '신규 차종'}</span>
        <button id="vmCancel" class="btn btn-sm btn-ghost"><i class="ph ph-x"></i></button>
      </header>
      <div style="flex:1;overflow-y:auto;padding:var(--sp-4);display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);">
        ${vmFld('제조사', 'maker', v?.maker)}
        ${vmFld('모델', 'model', v?.model)}
        ${vmFld('세부모델', 'sub', v?.sub, { full: true, hint: '예: 그랜저 GN7 22-' })}
        ${vmFld('트림', 'trim', v?.trim)}
        ${vmFld('차명 (등록증)', 'car_name', v?.car_name)}
        ${vmFld('형식번호 패턴', 'type_number_pattern', v?.type_number_pattern, { hint: '예: CN7*' })}
        ${vmFld('생산 시작', 'year_start', v?.year_start, { placeholder: 'YYYY 또는 YYYY-MM' })}
        ${vmFld('생산 종료', 'year_end', v?.year_end, { placeholder: '현재 또는 YYYY' })}
        ${vmSel('카테고리', 'category', v?.category, VM_CATEGORIES)}
        ${vmSel('연료', 'fuel_type', v?.fuel_type, VM_FUELS)}
        ${vmFld('배기량 (cc)', 'displacement', v?.displacement, { type: 'number' })}
        ${vmFld('승차정원', 'seats', v?.seats, { type: 'number' })}
        ${vmFld('구동방식', 'drive_type', v?.drive_type, { placeholder: '전륜/후륜/4륜' })}
        ${vmFld('변속기', 'transmission', v?.transmission)}
        ${vmFld('엔진형식', 'engine_type', v?.engine_type)}
        ${vmFld('배터리 (kWh)', 'battery_kwh', v?.battery_kwh, { type: 'number' })}
        ${vmFld('EV 주행거리 (km)', 'ev_range', v?.ev_range, { type: 'number' })}
        ${vmFld('내부코드', 'code', v?.code)}
      </div>
      <footer style="display:flex;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--c-border);">
        ${isEdit ? `<button id="vmDel" class="btn btn-sm btn-outline" style="color:var(--c-err);"><i class="ph ph-trash"></i> 삭제</button>` : ''}
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
      [...modal.querySelectorAll('[data-f]')].map(inp => {
        const key = inp.dataset.f;
        let val = inp.value.trim();
        if (inp.type === 'number') val = val ? Number(val) : undefined;
        return [key, val || undefined];
      })
    );
    if (!data.maker || !data.model || !data.sub) { showToast('제조사·모델·세부모델 필수', 'error'); return; }
    try {
      if (isEdit) await updateFn(v._key, data);
      else await createFn(data);
      devLog(`[vmEdit] ${isEdit ? '수정' : '신규'}: ${data.maker} ${data.model} ${data.sub}`);
      showToast(isEdit ? '수정됨' : '추가됨');
      close();
    } catch (e) {
      showToast(`실패: ${e?.code || e?.message}`, 'error');
    }
  });
  document.getElementById('vmDel')?.addEventListener('click', async () => {
    if (!confirm(`"${v.sub}" 삭제?`)) return;
    await deleteFn(v._key);
    devLog(`[vmEdit] 삭제: ${v.maker} ${v.model} ${v.sub}`);
    showToast('삭제됨');
    close();
  });
}

function vmFld(label, key, val, opts = {}) {
  const type = opts.type || 'text';
  const ph = opts.placeholder || opts.hint || '';
  const full = opts.full ? 'grid-column:1/-1;' : '';
  return `
    <label style="display:flex;flex-direction:column;gap:4px;${full}">
      <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">${label}</span>
      <input class="input input-sm" data-f="${key}" type="${type}" value="${val ?? ''}" placeholder="${ph}">
    </label>
  `;
}
function vmSel(label, key, val, options) {
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
