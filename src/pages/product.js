/**
 * pages/product.js — 재고 관리 페이지 (v3 ERP)
 *
 * 4패널: 목록 | 자산정보(편집) | 가격매트릭스(편집) | 사진/등록증
 *
 * Export:
 *   - PRODUCT_OPTS, PRODUCT_TERMS
 *   - renderProductList, renderProductDetail
 *   - bindProductCreate
 *
 * 의존: store, firebase/db, firebase/storage-helper, core/* 일체
 */
import { store } from '../core/store.js';
import { pushRecord, updateRecord } from '../firebase/db.js';
import { uploadImage } from '../firebase/storage-helper.js';
import { showToast } from '../core/toast.js';
import {
  productImages, productExternalImages, supportedDriveSource, toProxiedImage,
} from '../core/product-photos.js';
import { openFullscreen } from '../core/product-detail-render.js';
import { ocrFile } from '../core/ocr.js';
import { extractDocument } from '../core/ocr-gemini.js';
import { getOptionPool, splitOptionInput, findSimilarInPool } from '../core/trim-options.js';
import { parseVehicleRegistration, deriveMakerFromRegistration } from '../core/ocr-parsers/vehicle-registration.js';
import { inferCarModel } from '../core/car-model-infer.js';
import { findCarModel } from '../core/car-models.js';
import { analyzeProduct as analyzeMatrix, loadIndex as loadMatrixIndex, findCatalog as findMatrixCatalog, loadCatalog as loadMatrixCatalog } from '../core/vehicle-matrix.js';
import {
  ensureCatalogSource,
  getCatalogMakers, getCatalogModels, getCatalogSubModels, getCatalogTrims,
  findCatalogBySubModel, getCatalogById, titleToSubModel,
} from '../core/catalog-source.js';
// 모듈 import 시 catalog _index.json prefetch — 로드 완료 시 재고 페이지 활성이면 자산정보 재렌더
ensureCatalogSource().then(() => {
  if (document.querySelector('.pt-page.active')?.dataset.page === 'product') {
    const activeId = document.querySelector('.pt-page[data-page="product"] .room-item.is-active')?.dataset.id;
    const target = (store.products || []).find(x => x._key === activeId) || (store.products || [])[0];
    if (target) renderProductDetail(target);
  }
});
import { fpIdsToNames, FP_POPULAR_PRIMARY, FP_POPULAR_SECONDARY } from '../core/fp-options-master.js';
import { pickPartner } from '../core/dialogs.js';
import {
  esc, shortStatus, fmtTime, fmtDate, fmtMileage,
  listBody, emptyState, renderRoomItem,
  ffi, ffs, setHeadSave, flashSaved, bindFormSave,
  providerNameByCode, providerLabelByCode, formatMainLine,
} from '../core/ui-helpers.js';

/* v2 product-manage 옵션 — 차량 스펙 드롭다운 */
export const PRODUCT_OPTS = {
  vehicle_status: ['즉시출고','출고가능','상품화중','출고협의','출고불가'],
  product_type: ['중고렌트','신차렌트','중고구독','신차구독'],
  fuel_type: ['가솔린','디젤','LPG','하이브리드','전기','수소'],
  vehicle_class: ['경차','소형','준중형','중형','준대형','대형','SUV','RV','승합','화물','수입'],
  drive_type: ['전륜(FF)','후륜(FR)','4륜(AWD)','4륜(4WD)'],
  transmission: ['자동','수동','CVT','DCT','세미오토'],
  usage: ['자가용','영업용','관용'],
  year: Array.from({ length: 12 }, (_, i) => String(2026 - i)),
};

export const PRODUCT_TERMS = ['1', '12', '24', '36', '48', '60'];   // v2 PRICE_PERIODS
const MAX_PHOTOS = 30;
const UPLOAD_CONCURRENCY = 4;

/* ──────── A. 차종 매트릭스 4단 cascade picker (catalog _index.json 기반) ──────── */
//  메이커 → 모델(model_root) → 세부모델(catalog title - maker prefix) → 트림(catalog.trims)
//  catalog_id 는 hidden input 으로 자동 추적 (세부모델 선택 시 set, 매칭 시 사용)

/** 매물 보유대수 — 메이커/모델/세부모델별 (cascade option label "(N)" 표기) */
function inventoryCounts() {
  const m = new Map(), mm = new Map(), mms = new Map();
  for (const p of store.products || []) {
    if (p._deleted || p.status === 'deleted') continue;
    const mk = p.maker || '', md = p.model || '', sb = p.sub_model || '';
    if (mk) m.set(mk, (m.get(mk) || 0) + 1);
    if (mk && md) mm.set(`${mk}|${md}`, (mm.get(`${mk}|${md}`) || 0) + 1);
    if (mk && md && sb) mms.set(`${mk}|${md}|${sb}`, (mms.get(`${mk}|${md}|${sb}`) || 0) + 1);
  }
  return { m, mm, mms };
}

function renderCarPicker(p, dis = '') {
  const curMk = p.maker || '';
  const curMd = p.model || '';
  const curSub = p.sub_model || '';
  const curTrim = p.trim_name || p.trim || '';
  const curCid = p.catalog_id
    || (findCatalogBySubModel(curMk, curSub)?.id || '');

  const makers = getCatalogMakers();
  const models = curMk ? getCatalogModels(curMk) : [];
  const subs = (curMk && curMd) ? getCatalogSubModels(curMk, curMd) : [];
  const trims = curCid ? getCatalogTrims(curCid) : [];

  // sub_model option: { val, label, attr } — data-cid 로 catalog_id 추적, label 에 생산년도 표기
  const yy = (v) => { const m = (v || '').match(/^(\d{4})/); return m ? m[1].slice(2) : ''; };
  const yearLabel = (s) => {
    const ys = yy(s.year_start);
    const ye = yy(s.year_end);
    if (ys && (s.year_end === '현재' || !ye)) return ` (${ys}~)`;
    if (ys && ye) return ` (${ys}~${ye})`;
    return '';
  };
  const subOpts = subs.map(s => ({ val: s.sub, label: s.sub + yearLabel(s), attr: ` data-cid="${esc(s.id)}"` }));
  const makerOpts = makers.map(m => ({ val: m, label: m }));
  const modelOpts = models.map(m => ({ val: m, label: m }));
  const trimOpts = trims.map(t => ({ val: t, label: t }));

  return `${pickerSelect('제조사',   'maker',     curMk,   makerOpts, { ctx: 'maker', mk: curMk }, dis)}
          ${pickerSelect('모델',     'model',     curMd,   modelOpts, { ctx: 'model', mk: curMk }, dis)}
          ${pickerSelect('세부모델', 'sub_model', curSub,  subOpts,   { ctx: 'sub_model', mk: curMk, md: curMd }, dis)}
          ${pickerSelect('트림',     'trim_name', curTrim, trimOpts,  { ctx: 'trim' }, dis)}
          <input type="hidden" data-f="catalog_id" value="${esc(curCid)}">`;
}

/** opts = [{ val, label, attr? }, ...]  ctx = { ctx, mk?, md? } */
function pickerSelect(label, field, cur, opts, ctx, dis) {
  const lockAttr = dis ? '' : ' data-edit-lock="1"';
  return `<div class="ff"><label>${esc(label)}</label>
    <select class="input" data-f="${esc(field)}" data-picker="${esc(field)}"${dis}${lockAttr}>
      <option value="">선택</option>
      ${pickerOptionsHtml(opts, cur, ctx)}
    </select>
  </div>`;
}

function pickerOptionsHtml(opts, cur, ctx) {
  const { m, mm, mms } = inventoryCounts();
  const countOf = (val) => {
    if (ctx.ctx === 'maker') return m.get(val) || 0;
    if (ctx.ctx === 'model') return mm.get(`${ctx.mk}|${val}`) || 0;
    if (ctx.ctx === 'sub_model') return mms.get(`${ctx.mk}|${ctx.md}|${val}`) || 0;
    return 0;
  };
  const labelOf = (o) => {
    const n = countOf(o.val);
    return n > 0 ? `${o.label} (${n})` : o.label;
  };
  const inList = opts.some(o => o.val === cur);
  return opts.map(o => `<option value="${esc(o.val)}"${o.attr || ''} ${o.val === cur ? 'selected' : ''}>${esc(labelOf(o))}</option>`).join('')
    + (cur && !inList ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '');
}

function bindCarPicker(card, p) {
  const mkSel = card.querySelector('select[data-picker="maker"]');
  const mdSel = card.querySelector('select[data-picker="model"]');
  const sbSel = card.querySelector('select[data-picker="sub_model"]');
  const tmSel = card.querySelector('select[data-picker="trim_name"]');
  const cidIn = card.querySelector('input[data-f="catalog_id"]');
  if (!mkSel || !mdSel || !sbSel || !tmSel) return;

  const fill = (sel, opts, cur, ctx) => {
    sel.innerHTML = `<option value="">선택</option>` + pickerOptionsHtml(opts, cur, ctx);
  };
  const yy = (v) => { const m = (v || '').match(/^(\d{4})/); return m ? m[1].slice(2) : ''; };
  const yearLabel = (s) => {
    const ys = yy(s.year_start);
    const ye = yy(s.year_end);
    if (ys && (s.year_end === '현재' || !ye)) return ` (${ys}~)`;
    if (ys && ye) return ` (${ys}~${ye})`;
    return '';
  };
  const subsToOpts = (subs) => subs.map(s => ({ val: s.sub, label: s.sub + yearLabel(s), attr: ` data-cid="${esc(s.id)}"` }));
  const arrToOpts = (arr) => arr.map(v => ({ val: v, label: v }));

  mkSel.addEventListener('change', () => {
    const newMk = mkSel.value;
    fill(mdSel, arrToOpts(newMk ? getCatalogModels(newMk) : []), '', { ctx: 'model', mk: newMk });
    fill(sbSel, [], '', { ctx: 'sub_model', mk: newMk, md: '' });
    fill(tmSel, [], '', { ctx: 'trim' });
    if (cidIn) cidIn.value = '';
    autoFillFromCarModel(card, newMk, '', '');
  });
  mdSel.addEventListener('change', () => {
    const mk = mkSel.value, newMd = mdSel.value;
    const subs = (mk && newMd) ? getCatalogSubModels(mk, newMd) : [];
    fill(sbSel, subsToOpts(subs), '', { ctx: 'sub_model', mk, md: newMd });
    fill(tmSel, [], '', { ctx: 'trim' });
    if (cidIn) cidIn.value = '';
    autoFillFromCarModel(card, mk, newMd, '');
  });
  sbSel.addEventListener('change', () => {
    const mk = mkSel.value;
    const sub = sbSel.value;
    // 선택된 option 의 data-cid → catalog_id 자동 set
    const opt = sbSel.selectedOptions[0];
    const cid = opt?.dataset?.cid || (findCatalogBySubModel(mk, sub)?.id || '');
    if (cidIn) cidIn.value = cid;
    fill(tmSel, arrToOpts(cid ? getCatalogTrims(cid) : []), '', { ctx: 'trim' });
    autoFillFromCarModel(card, mk, mdSel.value, sub);
  });
  tmSel.addEventListener('change', () => {
    autoFillFromCarModel(card, mkSel.value, mdSel.value, sbSel.value);
  });
}

/* 트림 입력 필드에 카탈로그 트림 자동완성(datalist) 부착 */
async function refreshTrimDatalist(card, p) {
  const trimInput = card.querySelector('[data-f="trim_name"]');
  if (!trimInput) return;
  const live = {
    maker: card.querySelector('[data-f="maker"]')?.value || p.maker,
    sub_model: card.querySelector('[data-f="sub_model"]')?.value || p.sub_model,
    model: card.querySelector('[data-f="model"]')?.value || p.model,
  };
  if (!live.maker) return;
  try {
    const cat = await findMatrixCatalog(live.maker, live.sub_model, live.model);
    if (!cat) return;
    const c = await loadMatrixCatalog(cat.catalogId);
    if (!c?.trims) return;
    const trims = Object.keys(c.trims);
    if (!trims.length) return;
    // datalist 생성/갱신
    let dl = card.querySelector('#mtxTrimList');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'mtxTrimList';
      card.appendChild(dl);
    }
    dl.innerHTML = trims.map(t => `<option value="${esc(t)}">`).join('');
    trimInput.setAttribute('list', 'mtxTrimList');
  } catch {}
}

/* 차량번호 중복 검증 — input 변경 시 store.products 와 비교, 중복이면 경고 + 값 되돌림 */
function bindCarNumberDupCheck(card, p) {
  const input = card.querySelector('[data-f="car_number"]');
  if (!input) return;
  const original = p.car_number || '';
  const check = () => {
    const v = (input.value || '').trim();
    if (!v) return;
    const dup = (store.products || []).find(x =>
      x._key !== p._key && !x._deleted && (x.car_number || '').trim() === v
    );
    if (dup) {
      const owner = dup.provider_company_code || dup.partner_code || '?';
      showToast(`이미 등록된 차량번호: ${v} (공급사: ${owner})`, 'error');
      // 입력값 되돌림 (저장 차단)
      input.value = original;
      input.focus();
    }
  };
  input.addEventListener('blur', check);
  // change 시에도 — Enter 등으로 즉시 확인
  input.addEventListener('change', check);
}

/* 트림 매칭 결과로 옵션 chip 풀 갱신 — chip 클릭 토글 + product.options 자동 저장 */
async function refreshTrimOptionChips(card, p) {
  const chipsBox = card.querySelector('#trimOptionsChips');
  const hint     = card.querySelector('#trimOptionsHint');
  const hidden   = card.querySelector('input[type="hidden"][data-f="options"]');
  if (!chipsBox || !hidden) return;
  const live = {
    maker:     card.querySelector('[data-f="maker"]')?.value || p.maker,
    model:     card.querySelector('[data-f="model"]')?.value || p.model,
    sub_model: card.querySelector('[data-f="sub_model"]')?.value || p.sub_model,
    trim_name: card.querySelector('[data-f="trim_name"]')?.value || p.trim_name,
    fuel_type: p.fuel_type,
    year: p.year,
    first_registration_date: p.first_registration_date,
  };
  let pool;
  try { pool = await getOptionPool(live); } catch (e) { pool = { groups: [], allNames: new Set(), source: 'none' }; }
  // 디버깅 — 사용자가 안 나온다고 할 때 콘솔에서 어디 단계에서 빠지는지 추적용
  console.debug('[trim-chips]', { live: { maker: live.maker, model: live.model, sub_model: live.sub_model, trim_name: live.trim_name }, source: pool.source, groups: pool.groups.length, catalogId: pool.catalogId, trimName: pool.trimName });

  // 현재 선택된 옵션들 (product.options 또는 hidden value)
  const currentText = hidden.value || (Array.isArray(p.options) ? p.options.join(', ') : (p.options || ''));
  const currentSet = new Set(splitOptionInput(currentText));

  if (!pool.groups.length) {
    chipsBox.innerHTML = '';
    if (hint) {
      const reason = {
        'none':           '제조사 미입력',
        'no-trim':        '트림을 먼저 선택하세요',
        'no-catalog':     '카탈로그에 등록되지 않은 차종',
        'no-trim-match':  '이 트림의 옵션 데이터 없음',
        'stub-catalog':   '카탈로그 옵션 데이터 미완성 (stub) — 위키카 OCR 진행 중',
      }[pool.source] || '옵션 풀 없음';
      hint.innerHTML = `<i class="ph ph-info"></i> ${reason} — 아래 직접 입력으로 추가하세요`;
    }
  } else {
    chipsBox.innerHTML = pool.groups.map(g => `
      <div style="grid-column:1/-1;width:100%;margin-top:4px;">
        <div class="text-weak" style="font-size:10px;margin-bottom:3px;">${esc(g.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;">
          ${g.options.map(o => `
            <span class="chip${currentSet.has(o.name) ? ' active' : ''}" data-opt="${esc(o.name)}" style="cursor:pointer;font-size:11px;padding:1px 6px;line-height:1.4;height:auto;">
              ${esc(o.name)}
            </span>
          `).join('')}
        </div>
      </div>
    `).join('');
    if (hint) {
      const label = pool.source === 'maker-wide'
        ? `제조사 카탈로그 전체 옵션 (트림 「${esc(pool.trimName)}」 매칭 실패)`
        : `트림 「${esc(pool.trimName)}」 옵션`;
      hint.innerHTML = `<i class="ph ph-check-circle"></i> ${label} — 클릭으로 토글`;
    }
  }

  // chip 클릭 → 토글 + 자동 저장
  chipsBox.querySelectorAll('.chip[data-opt]').forEach(chip => {
    chip.addEventListener('click', async () => {
      const name = chip.dataset.opt;
      const cur = new Set(splitOptionInput(hidden.value || ''));
      if (cur.has(name)) cur.delete(name); else cur.add(name);
      const next = [...cur];
      hidden.value = next.join(', ');
      chip.classList.toggle('active');
      try {
        await updateRecord(`products/${p._key}`, { options: next, updated_at: Date.now() }, { silent: true });
        p.options = next;
      } catch (e) { showToast('옵션 저장 실패', 'error'); }
    });
  });
}

/* 직접 입력 input 처리 — 콤마/슬래시 split + 풀 유사도 알림 + 자동 저장 */
function bindOptionsManualInput(card, p) {
  const input = card.querySelector('#optionsManualInput');
  const hidden = card.querySelector('input[type="hidden"][data-f="options"]');
  if (!input || !hidden) return;
  // Enter 또는 blur 시 저장
  const commit = async () => {
    const tokens = splitOptionInput(input.value);
    if (!tokens.length) return;
    // 현재 옵션들과 합치기 (중복 제거)
    const cur = new Set(splitOptionInput(hidden.value || ''));
    // 풀 유사도 체크
    try {
      const pool = await getOptionPool({
        maker: card.querySelector('[data-f="maker"]')?.value || p.maker,
        model: card.querySelector('[data-f="model"]')?.value || p.model,
        sub_model: card.querySelector('[data-f="sub_model"]')?.value || p.sub_model,
        trim_name: card.querySelector('[data-f="trim_name"]')?.value || p.trim_name,
        fuel_type: p.fuel_type, year: p.year, first_registration_date: p.first_registration_date,
      });
      const sims = findSimilarInPool(tokens, pool.allNames);
      if (sims.length) {
        const msg = sims.map(s => `'${s.token}' ↔ '${s.match}' (${s.similarity})`).join(', ');
        showToast(`비슷한 풀 옵션 있음: ${msg}`, 'warn');
      }
    } catch {}
    for (const t of tokens) cur.add(t);
    const next = [...cur];
    hidden.value = next.join(', ');
    input.value = '';
    try {
      await updateRecord(`products/${p._key}`, { options: next, updated_at: Date.now() }, { silent: true });
      p.options = next;
      // chip 영역 다시 그려서 새로 추가된 옵션 active 표시
      refreshTrimOptionChips(card, p);
      showToast(`옵션 추가: ${tokens.join(', ')}`, 'success');
    } catch (e) { showToast('옵션 저장 실패', 'error'); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) commit();
  });
}

/* 차종 매트릭스 매칭 결과를 banner 로 표시 — 카탈로그/트림/표준옵션 + 정정 액션 */
async function refreshMatrixBanner(card, p) {
  const banner = card.querySelector('#mtxBanner');
  if (!banner) return;
  // 최신 form 값 반영 (사용자 편집 중에도 정확)
  const live = {
    ...p,
    maker: card.querySelector('[data-f="maker"]')?.value || p.maker,
    model: card.querySelector('[data-f="model"]')?.value || p.model,
    sub_model: card.querySelector('[data-f="sub_model"]')?.value || p.sub_model,
    trim_name: card.querySelector('[data-f="trim_name"]')?.value || p.trim_name,
    options: card.querySelector('[data-f="options"]')?.value || p.options,
  };
  if (!live.maker) { banner.style.display = 'none'; return; }
  try {
    await loadMatrixIndex();
    const r = await analyzeMatrix(live);
    if (!r.ok) {
      banner.style.display = 'block';
      banner.style.borderLeftColor = '#dc2626';
      banner.style.background = '#fef2f2';
      banner.innerHTML = `<b style="color:#dc2626;">⚠ 차종 매트릭스 매칭 안 됨</b> — 우리 카탈로그(67개)에 ${esc(live.maker)} ${esc(live.sub_model || '')} 없음. (${esc(r.reason || '')})`;
      return;
    }
    const trimNote = r.trimName ? `<b>${esc(r.trimName)}</b>` : '<span style="color:#d97706;">트림 미매칭</span>';
    const fpCnt = r.fpAll?.length || 0;
    const fpSample = fpCnt ? fpIdsToNames(r.fpAll.slice(0, 6)).join(', ') + (fpCnt > 6 ? ` +${fpCnt - 6}` : '') : '';
    let confColor = '#16a34a', confLabel = '확정';
    if (r.confidence === 'medium') { confColor = '#0284c7'; confLabel = '추정'; }
    else if (r.confidence === 'low') { confColor = '#d97706'; confLabel = '확인 필요'; }
    // 카탈로그 표준 model_root + sub_model 명 (메이커 prefix 제거)
    const catEntry = getCatalogById(r.catalogId);
    const standardModel = catEntry?.model_root || '';
    const standardSub = (r.catalogTitle || '').replace(new RegExp('^' + (live.maker || '') + '\\s+'), '').trim();
    const modelDiffers = standardModel && (live.model || '').trim() !== standardModel;
    const subDiffers = standardSub && (live.sub_model || '').trim() !== standardSub;
    const trimDiffers = r.trimName && (live.trim_name || '').trim() !== r.trimName;
    const cidDiffers = r.catalogId && (live.catalog_id || p.catalog_id || '') !== r.catalogId;
    const anyDiff = modelDiffers || subDiffers || trimDiffers || cidDiffers;
    banner.style.display = 'block';
    banner.style.borderLeftColor = confColor;
    banner.style.background = r.confidence === 'low' ? '#fffbeb' : 'var(--alert-blue-bg)';
    // fp_options 저장 여부 — 이미 저장된 IDs 와 비교
    const savedFp = Array.isArray(p.fp_options) ? p.fp_options : [];
    const fpDiffers = fpCnt > 0 && (savedFp.length !== fpCnt || !savedFp.every(id => r.fpAll.includes(id)));

    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span><b style="color:${confColor};">✓ 매트릭스 ${confLabel}</b> · ${esc(r.catalogTitle)} · ${trimNote} · 표준옵션 <b>${fpCnt}개</b></span>
        ${anyDiff ? `<button class="btn btn-sm" id="mtxApplyOne" style="font-size:10px;padding:2px 8px;">차종/트림 정정</button>` : ''}
        ${fpDiffers ? `<button class="btn btn-sm btn-success" id="mtxApplyFp" style="font-size:10px;padding:2px 8px;">표준옵션 ${fpCnt}개 저장</button>` : (savedFp.length === fpCnt && fpCnt > 0 ? `<span style="font-size:10px;color:#16a34a;">✓ 저장됨</span>` : '')}
      </div>
      ${fpSample ? `<div style="color:var(--text-sub);font-size:10px;margin-top:2px;" title="${esc(fpIdsToNames(r.fpAll || []).join(', '))}">${esc(fpSample)}</div>` : ''}
      ${modelDiffers ? `<div style="color:#0c4a6e;font-size:10px;margin-top:2px;">→ model: <s>${esc(live.model || '')}</s> → <b>${esc(standardModel)}</b></div>` : ''}
      ${subDiffers ? `<div style="color:#0c4a6e;font-size:10px;">→ sub_model: <s>${esc(live.sub_model || '')}</s> → <b>${esc(standardSub)}</b></div>` : ''}
      ${trimDiffers ? `<div style="color:#0c4a6e;font-size:10px;">→ trim_name: <s>${esc(live.trim_name || '')}</s> → <b>${esc(r.trimName)}</b></div>` : ''}
    `;
    // 표준옵션 저장 버튼 — updateRecord(path, data) 시그니처
    const applyFpBtn = banner.querySelector('#mtxApplyFp');
    if (applyFpBtn) {
      applyFpBtn.addEventListener('click', async () => {
        try {
          await updateRecord(`products/${p._key}`, { fp_options: r.fpAll });
          p.fp_options = r.fpAll;
          showToast(`표준옵션 ${fpCnt}개 저장`);
          refreshMatrixBanner(card, p);
        } catch (e) {
          console.error('[matrix fp save]', e);
          showToast('저장 실패: ' + (e.message || e));
        }
      });
    }
    // 정정 적용 버튼 — updateRecord(path, data) 시그니처
    const applyBtn = banner.querySelector('#mtxApplyOne');
    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        const updates = {};
        if (modelDiffers) {
          if (p.model_legacy == null) updates.model_legacy = p.model || '';
          updates.model = standardModel;
        }
        if (subDiffers) {
          if (p.sub_model_legacy == null) updates.sub_model_legacy = p.sub_model || '';
          updates.sub_model = standardSub;
        }
        if (trimDiffers) {
          if (p.trim_name_legacy == null) updates.trim_name_legacy = p.trim_name || p.trim || '';
          updates.trim_name = r.trimName;
        }
        if (cidDiffers) {
          updates.catalog_id = r.catalogId;
        }
        try {
          await updateRecord(`products/${p._key}`, updates);
          Object.assign(p, updates);
          // form 입력값도 업데이트
          if (modelDiffers) {
            const el = card.querySelector('[data-f="model"]'); if (el) el.value = standardModel;
          }
          if (subDiffers) {
            const el = card.querySelector('[data-f="sub_model"]'); if (el) el.value = standardSub;
          }
          if (trimDiffers) {
            const el = card.querySelector('[data-f="trim_name"]'); if (el) el.value = r.trimName;
          }
          if (cidDiffers) {
            const el = card.querySelector('[data-f="catalog_id"]'); if (el) el.value = r.catalogId;
          }
          showToast('매트릭스 정정 적용');
          refreshMatrixBanner(card, p);
        } catch (e) {
          console.error('[matrix apply]', e);
          showToast('적용 실패: ' + (e.message || e));
        }
      });
    }
  } catch (err) {
    banner.style.display = 'none';
  }
}

/* 표준옵션 chip — FP 인기 15개 (PRIMARY 10 + SECONDARY 5).
 *  매물 fp_options 에 group.ids 중 하나라도 있으면 활성. 클릭 시 토글 → 자동저장.
 *  PRIMARY (큰 칩) + SECONDARY (작은 칩) 위계 분리. */
function renderFpChips(p, canEdit) {
  const saved = new Set(Array.isArray(p.fp_options) ? p.fp_options : []);
  const isOn = (group) => group.ids.some(id => saved.has(id));
  const cls = (on) => on ? 'chip is-active' : 'chip';
  const renderOne = (g, sm = false) => {
    const onCls = cls(isOn(g));
    const sty = sm ? 'font-size:11px;padding:0 6px;height:20px;' : 'font-size:12px;padding:0 8px;height:24px;';
    return `<button type="button" class="${onCls}" data-fp-grp="${esc(g.label)}" style="${sty}"${canEdit ? '' : ' disabled'}>${g.icon ? `<i class="ph ph-${g.icon}"></i> ` : ''}${esc(g.label)}</button>`;
  };
  return `<div class="form-section-title"><i class="ph ph-list-checks"></i> 표준 주요옵션 <span class="form-section-hint" style="font-size:10px;color:var(--text-muted);">15개 (인기 10 + 보조 5). 매트릭스 매칭 후 자동 저장 + 직접 토글 가능.</span></div>
    <div class="ff fp-chips" data-fp-chips style="display:flex;flex-direction:column;gap:6px;padding:0 4px;">
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${FP_POPULAR_PRIMARY.map(g => renderOne(g, false)).join('')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${FP_POPULAR_SECONDARY.map(g => renderOne(g, true)).join('')}
      </div>
    </div>`;
}

/* fp chip 클릭 핸들러 — 토글 + Firebase 자동저장 */
function bindFpChips(card, p) {
  const wrap = card.querySelector('[data-fp-chips]');
  if (!wrap) return;
  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-fp-grp]');
    if (!btn || btn.disabled) return;
    const label = btn.dataset.fpGrp;
    const group = [...FP_POPULAR_PRIMARY, ...FP_POPULAR_SECONDARY].find(g => g.label === label);
    if (!group) return;
    const cur = new Set(Array.isArray(p.fp_options) ? p.fp_options : []);
    const isOn = group.ids.some(id => cur.has(id));
    if (isOn) {
      // 토글 OFF — 그룹의 모든 ID 제거
      for (const id of group.ids) cur.delete(id);
    } else {
      // 토글 ON — 첫 번째 (대표) ID 추가. 다중 변형 (썬루프 일반/파노라마/세이프티) 은 매트릭스가 정확한 ID 결정.
      cur.add(group.ids[0]);
    }
    const newOptions = [...cur];
    p.fp_options = newOptions;
    btn.classList.toggle('is-active');
    try {
      await updateRecord(`products/${p._key}`, { fp_options: newOptions });
    } catch (err) {
      console.error('[fp chip save]', err);
      btn.classList.toggle('is-active');   // rollback
    }
  });
}

/* 세부모델 선택되면 vehicle_master 매칭 row 의 vehicle_class·fuel_type 자동 채움 */
function autoFillFromCarModel(card, maker, model, sub_model) {
  if (!maker || !model || !sub_model) return;
  const m = findCarModel({ maker, model, sub_model });
  if (!m) return;
  const setIfEmpty = (field, value) => {
    if (!value) return;
    const el = card.querySelector(`[data-f="${field}"]`);
    if (el && !el.value) el.value = value;
  };
  setIfEmpty('vehicle_class', m.vehicle_class || m.category);
  setIfEmpty('fuel_type', m.fuel_type);
}

/* ──────── B. 목록 + 4패널 상세 ──────── */
export function renderProductList(products) {
  const body = listBody('product');
  if (!body) return;
  if (!Array.isArray(products)) return;
  // 역할별 가시성 — provider 는 자기 회사 차량만, agent/agent_admin/admin 은 전체
  const me = store.currentUser;
  let visible = products;
  if (me?.role === 'provider') {
    visible = products.filter(p =>
      p.provider_company_code === me.company_code ||
      p.partner_code === me.company_code ||
      p.provider_uid === me.uid
    );
  }
  if (!visible.length) { body.innerHTML = emptyState('상품이 없습니다'); renderProductDetail(null); return; }
  const sorted = [...visible].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  body.innerHTML = sorted.map((p, i) => {
    const priceCount = Object.entries(p.price || {}).filter(([, v]) => Number(v?.rent) > 0).length;
    const vs = p.vehicle_status || '';
    const PROD_TONE = /즉시/.test(vs) ? 'green' : /가능/.test(vs) ? 'blue' : /협의/.test(vs) ? 'orange' : /불가/.test(vs) ? 'red' : 'gray';
    const PROD_ICON = /즉시/.test(vs) ? 'lightning' : /가능/.test(vs) ? 'circle' : /협의/.test(vs) ? 'chat-circle' : /불가/.test(vs) ? 'prohibit' : 'car-simple';
    // 메인: 차량번호 세부모델 공급사명(한글)  /  우측: 수정일
    const mainLine = formatMainLine(
      p.car_number,
      p.sub_model,                                 // 모델 X 세부모델만
      providerNameByCode(p.provider_company_code || p.partner_code, store),
    );
    // 보조: 제조사 | 연식 | 주행 | 연료 | 색상  (상태는 좌측 아바타 뱃지로 표시)
    const colorPair = [p.ext_color, p.int_color].filter(Boolean).join('/');
    const subParts = [
      p.maker,
      p.year ? `${p.year}년` : '',
      p.mileage ? fmtMileage(p.mileage) + 'km' : '',
      p.fuel_type,
      colorPair,
    ].filter(Boolean);
    return renderRoomItem({
      id: p._key,
      icon: PROD_ICON,
      badge: shortStatus(vs),
      tone: PROD_TONE,
      name: mainLine,
      time: fmtDate(p.updated_at || p.created_at),
      msg: subParts.join(' · ') || '-',
      meta: priceCount ? `${priceCount}종` : '',
      active: i === 0,
    });
  }).join('');
  renderProductDetail(sorted[0]);
}

/* 재고관리 우측 — 자산정보 / 가격매트릭스(편집) / 사진 */
export function renderProductDetail(p) {
  const page = document.querySelector('.pt-page[data-page="product"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  const assetCard = cards[1];
  const priceCard = cards[2];
  const photoCard = cards[3];

  if (!p) {
    if (assetCard) assetCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    if (priceCard) priceCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    if (photoCard) photoCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    return;
  }

  const role = store.currentUser?.role;
  const canEdit = role === 'admin' || role === 'provider';
  const dis = canEdit ? '' : ' disabled';

  // 1. 자산 정보 — 기본정보 / 제조사스펙 / 등록증스펙 3섹션
  if (assetCard) {
    setHeadSave(assetCard, '자산 정보', canEdit, 'asset');
    const O = PRODUCT_OPTS;
    const optsArr = Array.isArray(p.options) ? p.options : (p.options ? String(p.options).split(/[·,\/]/).map(s => s.trim()).filter(Boolean) : []);
    const optsValue = optsArr.join(', ');
    const ro = (label, value) => `<div class="ff"><label>${esc(label)}</label><input type="text" class="input" value="${esc(value || '')}" readonly></div>`;
    const sect = (title, icon, body) => `<div class="form-section-title"><i class="ph ph-${icon}"></i>${esc(title)}</div><div class="form-grid">${body}</div>`;
    // 공급코드 — admin 은 드롭다운, 그 외는 readonly 코드.
    // 운영사/영업채널 제외, 그 외 모든 파트너 노출. 현재값이 옵션에 없으면 fallback 추가.
    const curProv = p.provider_company_code || '';
    const providerOptions = (store.partners || [])
      .filter(pa => !pa._deleted)
      .filter(pa => {
        const t = pa.partner_type || '';
        return !(t === '운영사' || t === 'operator' || t === '영업채널' || t === 'sales_channel');
      })
      .map(pa => {
        const code = pa.partner_code || pa.company_code || pa._key;
        const name = pa.partner_name || pa.company_name || code;
        // 코드 + 회사명 순 (코드로 먼저 인지, 회사명으로 확인)
        return { value: code, label: `${code} ${name}` };
      })
      // 코드 가나다순 정렬 — 일관된 순서
      .sort((a, b) => a.value.localeCompare(b.value, 'ko'));
    // 현재 product 의 공급코드가 옵션에 없으면 fallback 옵션 추가
    if (curProv && !providerOptions.some(o => o.value === curProv)) {
      const name = providerNameByCode(curProv, store) || '';
      providerOptions.unshift({ value: curProv, label: name ? `${curProv} ${name}` : curProv });
    }
    // 2-click 수정 패턴 — data-edit-lock 으로 첫 클릭은 선택, 두 번째 클릭에 드롭다운 열림
    const lockSel = dis ? '' : ' data-edit-lock="1"';
    const providerField = (role === 'admin')
      ? `<div class="ff"><label>공급코드</label><select class="input" data-f="provider_company_code"${dis}${lockSel}>
          <option value="">-</option>
          ${providerOptions.map(o => `<option value="${esc(o.value)}" ${curProv === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></div>`
      : `<div class="ff"><label>공급코드</label><input type="text" class="input" value="${esc(curProv ? `${curProv} ${providerNameByCode(curProv, store) || ''}`.trim() : '-')}" readonly></div>`;
    assetCard.querySelector('.ws4-body').innerHTML = `
      ${sect('기본정보', 'identification-card', `
        ${ffi('차량번호',  'car_number', p.car_number, dis)}
        ${providerField}
        ${ro('상품코드',   p.product_code)}
      `)}
      ${sect('제조사스펙', 'car-simple', `
        ${renderCarPicker(p, dis)}
        <div class="ff" style="grid-column:1/-1;" id="trimOptionsArea">
          <label>선택옵션</label>
          <div id="trimOptionsChips" class="trim-options-chips" style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;"></div>
          <div id="trimOptionsHint" class="text-weak" style="font-size:11px;margin-top:4px;">트림 선택 시 옵션 칩이 자동 채워집니다.</div>
          <input type="text" class="input" id="optionsManualInput" placeholder="직접 입력 — 콤마(,) 또는 슬래시(/) 로 구분" style="margin-top:6px;"${dis}${canEdit ? ' readonly data-edit-lock="1"' : ''}>
          <input type="hidden" data-f="options" value="${esc(optsValue)}">
        </div>
        <div class="ff" id="mtxBanner" style="display:none;border-left:3px solid var(--alert-blue-text);padding:8px 12px;background:var(--alert-blue-bg);font-size:11px;line-height:1.5;border-radius:4px;margin:4px 0;"></div>
        ${ffi('외장색',    'ext_color',     p.ext_color, dis)}
        ${ffi('내장색',    'int_color',     p.int_color, dis)}
        ${ffs('구동방식',  'drive_type',    p.drive_type, O.drive_type, dis)}
        ${ffs('변속기',    'transmission',  p.transmission, O.transmission, dis)}
        ${ffs('차종구분',  'vehicle_class', p.vehicle_class, O.vehicle_class, dis)}
        ${ffi('차량가격',  'vehicle_price', p.vehicle_price, dis)}
        ${ffi('차령만료일', 'vehicle_age_expiry_date', p.vehicle_age_expiry_date, dis)}
        ${ffi('위치',      'location',      p.location, dis)}
        <div class="ff" style="grid-column:1/-1;"><label>메모</label><textarea class="input" data-f="partner_memo" style="height:50px;"${dis}${canEdit ? ' readonly data-edit-lock="1"' : ''}>${esc(p.partner_memo || p.note || '')}</textarea></div>
      `)}
      ${sect('등록증스펙', 'file-text', `
        ${ffi('차명(등록증)', 'cert_car_name', p.cert_car_name, dis)}
        ${ffi('차대번호',  'vin',           p.vin, dis)}
        ${ffs('연식',      'year',          p.year ? String(p.year) : '', O.year, dis)}
        ${ffi('배기량',    'engine_cc',     p.engine_cc, dis)}
        ${ffi('승차정원',  'seats',         p.seats, dis)}
        ${ffs('연료',      'fuel_type',     p.fuel_type, O.fuel_type, dis)}
        ${ffi('최초등록일', 'first_registration_date', p.first_registration_date, dis)}
        ${ffi('형식번호',  'type_number',   p.type_number, dis)}
        ${ffi('원동기형식', 'engine_type',   p.engine_type, dis)}
        ${ffs('용도',      'usage',         p.usage, O.usage, dis)}
      `)}
      ${renderFpChips(p, canEdit)}
    `;
    if (canEdit) {
      bindFormSave(page, 'products', p._key, p);
      bindCarPicker(assetCard, p);
      bindFpChips(assetCard, p);   // FP 인기옵션 chip 토글 (자동저장)
      bindCarNumberDupCheck(assetCard, p);   // 차량번호 중복 검증
    }
    // 차종 매트릭스 매칭 미리보기 — 비동기로 banner 채우기 + 필드 변경 시 자동 갱신
    refreshMatrixBanner(assetCard, p);
    refreshTrimDatalist(assetCard, p);  // 트림 자동완성 옵션 채우기
    refreshTrimOptionChips(assetCard, p);   // 트림 옵션 chip 영역
    if (canEdit) bindOptionsManualInput(assetCard, p);
    let _mtxDebounce;
    const triggerRefresh = () => {
      clearTimeout(_mtxDebounce);
      _mtxDebounce = setTimeout(() => {
        refreshMatrixBanner(assetCard, p);
        refreshTrimDatalist(assetCard, p);
        refreshTrimOptionChips(assetCard, p);   // 트림 변경 시 chip 풀 갱신
      }, 250);
    };
    ['maker','model','sub_model','trim_name','options'].forEach(f => {
      const el = assetCard.querySelector(`[data-f="${f}"]`);
      if (el) el.addEventListener('change', triggerRefresh);
      if (el && el.tagName === 'INPUT') el.addEventListener('input', triggerRefresh);
    });
  }

  // 2. 가격 매트릭스 — v2 패턴 (저장: 원단위 raw integer / 표시: 콤마 toLocaleString)
  if (priceCard) {
    const disabled = canEdit ? '' : ' disabled';
    const O = PRODUCT_OPTS;
    const fmt = v => (v != null && v !== '') ? Number(v).toLocaleString('ko-KR') : '';
    const lockAttr = canEdit ? ' readonly data-edit-lock="1"' : '';
    const lockSelAttr = canEdit ? ' data-edit-lock="1"' : '';
    const me = store.currentUser || {};
    const productProvider = p.provider_company_code || me.company_code || '';
    const policyOpts = (store.policies || []).filter(t => !t._deleted)
      .filter(t => me.role === 'admin' || !productProvider || t.provider_company_code === productProvider)
      .map(t => ({ code: t.policy_code || t._key, name: t.policy_name || t.term_name || '' }));
    const curPol = p.policy_code || '';
    const policySelectHtml = `
      <div class="ff"><label>정책코드</label><select class="input" data-f="policy_code"${disabled}${lockSelAttr}>
        <option value="">선택</option>
        ${policyOpts.map(o => `<option value="${esc(o.code)}" ${o.code === curPol ? 'selected' : ''}>${esc(o.name ? `${o.name} (${o.code})` : o.code)}</option>`).join('')}
        ${curPol && !policyOpts.find(o => o.code === curPol) ? `<option value="${esc(curPol)}" selected>${esc(curPol)}</option>` : ''}
      </select></div>`;
    const rentRow = m => {
      const v = p.price?.[m] || {};
      return `<tr data-term="${m}">
        <td>${m}개월</td>
        <td><input class="input pd-price-input" data-period="${m}" data-type="rent" value="${esc(fmt(v.rent))}" placeholder="-" inputmode="numeric" style="text-align:right; width:100%;"${disabled}${lockAttr}></td>
        <td><input class="input pd-price-input" data-period="${m}" data-type="deposit" value="${esc(fmt(v.deposit))}" placeholder="-" inputmode="numeric" style="text-align:right; width:100%;"${disabled}${lockAttr}></td>
      </tr>`;
    };
    const feeRow = m => {
      const v = p.price?.[m] || {};
      const feeRaw = v.fee != null && v.fee !== '' ? v.fee : (v.commission || '');
      return `<tr data-term="${m}">
        <td>${m}개월</td>
        <td><input class="input pd-price-input" data-period="${m}" data-type="fee" value="${esc(fmt(feeRaw))}" placeholder="-" inputmode="numeric" style="text-align:right; width:100%;"${disabled}${lockAttr}></td>
        <td><input class="input pd-price-memo" data-period="${m}" data-type="fee_memo" value="${esc(v.fee_memo || '')}" placeholder="-" style="width:100%;"${disabled}${lockAttr}></td>
      </tr>`;
    };
    priceCard.querySelector('.ws4-body').innerHTML = `
      <div class="form-section-title"><i class="ph ph-scroll"></i>상태 | 정책</div>
      <div class="form-grid" style="margin-bottom: 12px;">
        ${policySelectHtml}
        ${ffs('상품구분', 'product_type',    p.product_type,    O.product_type,    disabled)}
        ${ffs('차량상태', 'vehicle_status',  p.vehicle_status,  O.vehicle_status,  disabled)}
        ${ffi('주행거리', 'mileage',         p.mileage,                              disabled)}
      </div>
      <div class="form-section-title"><i class="ph ph-currency-krw"></i>대여료 | 보증금</div>
      <table class="table pd-price-table" style="margin-bottom: 12px;" id="prodPriceTable">
        <colgroup><col style="width:60px;"><col style="width:50%;"><col style="width:50%;"></colgroup>
        <thead><tr><th>기간</th><th class="num">대여료</th><th class="num">보증금</th></tr></thead>
        <tbody>${PRODUCT_TERMS.map(rentRow).join('')}</tbody>
      </table>
      ${(role === 'admin' || role === 'agent' || role === 'agent_admin') ? `
        <div class="form-section-title"><i class="ph ph-percent"></i>수수료 | 비고 <span style="color:var(--text-weak); font-weight:400; font-size:12px;">(내부용)</span></div>
        <table class="table pd-price-table" id="prodFeeTable">
          <colgroup><col style="width:60px;"><col style="width:50%;"><col style="width:50%;"></colgroup>
          <thead><tr><th>기간</th><th class="num">수수료</th><th>비고</th></tr></thead>
          <tbody>${PRODUCT_TERMS.map(feeRow).join('')}</tbody>
        </table>
      ` : ''}
    `;
    if (canEdit) bindProductPriceEdit(p);
  }

  // 3. 상품 사진 — 사진 / 사진 링크 / 등록증 3섹션
  if (photoCard) renderProductPhotoPanel(photoCard, p, canEdit);
}

/* ──────── C. 사진/등록증 패널 ──────── */
async function uploadParallel(files, pathFn, onProgress) {
  const urls = new Array(files.length);
  let nextIdx = 0, done = 0;
  onProgress?.(0, files.length);
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= files.length) break;
      try {
        const { url } = await uploadImage(pathFn(files[i], i), files[i]);
        urls[i] = url;
      } catch (e) {
        console.error('[upload]', files[i].name, e);
        urls[i] = null;
      }
      done++;
      onProgress?.(done, files.length);
    }
  }));
  return urls;
}

function renderProductPhotoPanel(photoCard, p, canEdit) {
  const sect = (title, icon, body) => `<div class="form-section-title"><i class="ph ph-${icon}"></i>${esc(title)}</div>${body}`;
  const uploadedImgs = productImages(p);
  const extImgs      = productExternalImages(p);
  const allImgs      = [...new Set([...uploadedImgs, ...extImgs])].map(toProxiedImage);
  const photoLink    = p.photo_link || '';
  // Drive 폴더 / autoplus / moderentcar 등 서버 스크래핑 필요 URL 자동 해석
  //  product-detail-render.js / catalog-app.js 와 동일 규격 — image_urls 비어있고 photo_link 가 지원 사이트면
  //  fetchDriveFolderImages 로 URL 목록 받아서 product 에 임시 주입(메모리만, _drive_folder_virtual)
  const driveSource = supportedDriveSource(p);
  if (driveSource && !p._drive_folder_virtual && !uploadedImgs.length) {
    import('../core/drive-photos.js').then(m => {
      m.fetchDriveFolderImages(driveSource).then(urls => {
        if (!urls?.length) return;
        p.image_urls = urls;
        p._drive_folder_virtual = true;
        // 같은 product 가 여전히 active 일 때만 재렌더 (사용자가 다른 차로 넘어갔으면 무시)
        const activeId = document.querySelector('.pt-page[data-page="product"] .ws4-list .room-item.active')?.dataset.id;
        if (activeId === p._key) renderProductPhotoPanel(photoCard, p, canEdit);
      }).catch(() => {});
    });
  }
  const regImg       = p.registration_image || '';
  const regIsPdf     = regImg && (regImg.toLowerCase().includes('.pdf') || p.registration_type === 'pdf');
  const dis          = canEdit ? '' : ' disabled';

  photoCard.querySelector('.ws4-body').innerHTML = `
    ${sect('사진 첨부', 'image-square', `
      ${allImgs.length ? `
        <div class="pd-photo-grid" style="grid-column:1/-1;">
          ${allImgs.map((src, i) => `
            <div class="pd-photo-item${i === 0 ? ' is-primary' : ''}" data-idx="${i}" data-src="${esc(src)}">
              <img src="${esc(src)}" loading="lazy">
              ${i === 0 ? '<span class="pd-photo-badge">대표</span>' : ''}
              ${canEdit && i > 0 ? `<button class="pd-photo-set-primary" data-idx="${i}" title="대표 사진으로 설정"><i class="ph ph-crown"></i></button>` : ''}
              ${canEdit ? `<button class="pd-photo-del" data-idx="${i}" title="삭제"><i class="ph ph-x"></i></button>` : ''}
            </div>
          `).join('')}
        </div>
        <div style="grid-column:1/-1;font-size:11px;color:var(--text-weak);margin:4px 0 8px;">
          <i class="ph ph-image"></i> ${allImgs.length}장 — 클릭: 크게보기 / <i class="ph ph-crown"></i> 대표 설정
        </div>
      ` : ''}
      ${canEdit ? `
        <label class="pd-dropzone" id="pdDropzone" for="pdPhotoFile" style="grid-column:1/-1;">
          <i class="ph ph-upload-simple"></i>
          <div class="pd-dropzone-text">차량사진 업로드</div>
          <div class="pd-dropzone-hint">이미지 (JPG/PNG) 다중 선택 — 최대 ${MAX_PHOTOS}장</div>
          <input type="file" id="pdPhotoFile" multiple hidden accept="image/*">
        </label>` : ''}
    `)}
    ${sect('사진 링크', 'link', `
      <textarea class="input" data-f="photo_link" rows="2" placeholder="https://... (콤마/줄바꿈 구분)" style="grid-column:1/-1;width:100%;resize:vertical;"${dis}${canEdit ? ' readonly data-edit-lock="1"' : ''}>${esc(photoLink)}</textarea>
    `)}
    ${sect('차량등록증', 'identification-card', `
      ${regImg ? `
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border-soft);border-radius:4px;font-size:11px;">
          <i class="ph ph-identification-card" style="font-size:14px;color:var(--text-weak);"></i>
          <span class="text-weak">등록된 등록증:</span>
          ${regIsPdf
            ? `<a href="${esc(regImg)}" target="_blank">차량등록증.pdf</a>`
            : `<a href="${esc(regImg)}" target="_blank">차량등록증 이미지</a>`}
          ${canEdit ? '<button class="btn btn-outline btn-xs" id="pdRegDel" style="margin-left:auto;"><i class="ph ph-x"></i>제거</button>' : ''}
        </div>
      ` : ''}
      ${canEdit ? `
        <label class="pd-dropzone" id="pdRegDropzone" for="pdRegFile" style="grid-column:1/-1;">
          <i class="ph ph-identification-card"></i>
          <div class="pd-dropzone-text">차량등록증 업로드 (OCR)</div>
          <div class="pd-dropzone-hint">이미지 또는 PDF | OCR 로 등록증 정보 자동 채움 + PDF 는 사진 첨부 끝에 미리보기 추가</div>
          <input type="file" id="pdRegFile" hidden accept="image/*,application/pdf">
        </label>` : `${regImg ? '' : '<div style="grid-column:1/-1;font-size:12px;color:var(--text-weak);">미등록</div>'}`}
    `)}
  `;

  // 썸네일 클릭 → 크게보기 (해당 idx 부터)
  photoCard.querySelectorAll('.pd-photo-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;       // 버튼 클릭은 위임
      const idx = Number(el.dataset.idx) || 0;
      openFullscreen(allImgs, idx);
    });
  });
  // 대표 사진 설정 — image_urls 배열에서 해당 idx 를 맨 앞으로 이동
  photoCard.querySelectorAll('.pd-photo-set-primary').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx) || 0;
      const src = allImgs[idx];
      if (!src) return;
      // image_urls 만 재배치 (외부 photo_link 는 그대로)
      const cur = Array.isArray(p.image_urls) ? [...p.image_urls] : [];
      const pos = cur.indexOf(src);
      if (pos > 0) {
        cur.splice(pos, 1);
        cur.unshift(src);
      } else if (pos === -1) {
        // 외부 링크가 대표로 지정된 경우 — image_urls 맨 앞에 추가 (photo_link 우선)
        cur.unshift(src);
      }
      try {
        await updateRecord(`products/${p._key}`, { image_urls: cur, updated_at: Date.now() });
        p.image_urls = cur;
        renderProductPhotoPanel(photoCard, p, canEdit);
      } catch (err) { console.error('[set-primary]', err); }
    });
  });
  // 삭제 버튼 (개별 사진)
  photoCard.querySelectorAll('.pd-photo-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx) || 0;
      const src = allImgs[idx];
      if (!src || !confirm('이 사진을 삭제할까요?')) return;
      const cur = Array.isArray(p.image_urls) ? p.image_urls.filter(u => u !== src) : [];
      try {
        await updateRecord(`products/${p._key}`, { image_urls: cur, updated_at: Date.now() });
        p.image_urls = cur;
        renderProductPhotoPanel(photoCard, p, canEdit);
      } catch (err) { console.error('[photo-del]', err); }
    });
  });
  photoCard.querySelector('#pdRegImg')?.addEventListener('click', () => openFullscreen([regImg], 0));

  photoCard.querySelector('textarea[data-f="photo_link"]')?.addEventListener('blur', async (e) => {
    const v = e.target.value;
    if ((p.photo_link || '') === v) return;
    try {
      await updateRecord(`products/${p._key}`, { photo_link: v, updated_at: Date.now() });
      p.photo_link = v;
      flashSaved(e.target);
    } catch (err) { console.error('[photo_link]', err); alert('저장 실패'); }
  });

  if (!canEdit) return;
  bindPhotoUpload(photoCard, p, uploadedImgs);
  bindRegUpload(photoCard, p);
}

function bindPhotoUpload(photoCard, p, currentImgs) {
  const fileInput = photoCard.querySelector('#pdPhotoFile');
  const dropzone  = photoCard.querySelector('#pdDropzone');

  const upload = async (files) => {
    // 차량 사진 dropzone — 이미지만 (등록증은 별도 dropzone 에서 OCR 처리)
    const imgFiles = files.filter(f => f.type.startsWith('image/'));
    if (!imgFiles.length) return;
    const remaining = MAX_PHOTOS - currentImgs.length;
    if (remaining <= 0) return showToast(`사진 최대 ${MAX_PHOTOS}장`, 'error');
    const target = imgFiles.slice(0, remaining);

    const setProgress = (done, total) => {
      if (!dropzone) return;
      const txt = dropzone.querySelector('.pd-dropzone-text');
      const hint = dropzone.querySelector('.pd-dropzone-hint');
      if (done < total) {
        if (txt) txt.textContent = `업로드 중 ${done}/${total}`;
        if (hint) hint.textContent = `${Math.round(done/total*100)}% 완료`;
        dropzone.classList.add('is-uploading');
      } else {
        if (txt) txt.textContent = '이미지를 끌어놓거나 클릭해서 업로드';
        if (hint) hint.textContent = `최대 ${MAX_PHOTOS}장 | 첫 번째 = 대표 | 클릭하면 크게보기`;
        dropzone.classList.remove('is-uploading');
      }
    };

    try {
      const urls = await uploadParallel(
        target,
        (file, i) => `product-images/${p._key}/car_${Date.now()}_${i}_${file.name}`,
        setProgress,
      );
      const next = [...currentImgs, ...urls.filter(Boolean)];
      await updateRecord(`products/${p._key}`, { image_urls: next, updated_at: Date.now() });
      const ok = urls.filter(Boolean).length;
      const fail = target.length - ok;
      showToast(`사진 ${ok}장 업로드 완료${fail ? ` | 실패 ${fail}장` : ''}`, fail ? 'error' : 'success');
    } catch (e) {
      console.error('[photo upload]', e);
      showToast('업로드 실패 — ' + (e.message || e), 'error');
    } finally {
      setProgress(target.length, target.length);
    }
  };

  fileInput?.addEventListener('change', async () => {
    await upload(Array.from(fileInput.files));
    fileInput.value = '';
  });
  if (dropzone) {
    dropzone.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dropzone.classList.add('is-drop-target'); }
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-drop-target'));
    dropzone.addEventListener('drop', async e => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      dropzone.classList.remove('is-drop-target');
      await upload(Array.from(e.dataTransfer.files));
    });
  }

  // 대표 사진 삭제
  photoCard.querySelector('#pdMainDel')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentImgs.length) return;
    if (!confirm('대표 사진을 삭제할까요?')) return;
    const next = currentImgs.slice(1);
    await updateRecord(`products/${p._key}`, { image_urls: next, updated_at: Date.now() });
  });
}

/* OCR 결과 → 자산정보/제조사스펙 폼 input 직접 채움 + flashSaved (초록 ring 1.5초).
 * watchCollection 콜백 재렌더 기다리지 않고 즉시 시각 반영.
 * select 의 경우 옵션에 없는 값이면 콘솔 경고 (디버깅용). */
function applyOcrFieldsToForm(p, fields) {
  const page = document.querySelector('.pt-page[data-page="product"]');
  if (!page) return [];
  const filled = [];
  const skipped = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val == null || val === '') continue;
    const el = page.querySelector(`[data-f="${key}"]`);
    if (!el) { skipped.push(`${key}(no-input)`); continue; }
    const v = String(val);
    if (el.tagName === 'SELECT') {
      const ok = [...el.options].some(o => o.value === v);
      if (!ok) { skipped.push(`${key}=${v}(no-option)`); continue; }
    }
    el.value = v;
    el.removeAttribute('readonly');
    flashSaved(el);
    filled.push(key);
  }
  if (skipped.length) console.warn('[ocr→form] skipped:', skipped);
  return filled;
}

/* 등록증 OCR + 제조사스펙 자동 채움 + 공급코드 매칭.
 *  Gemini schema-based extraction (jpkerp-v4 패턴 포팅).
 *  onProgress: dropzone 진행 텍스트 갱신용 콜백. */
async function tryOCRRegistration(file, onProgress) {
  const progress = (msg) => onProgress?.(msg);
  try {
    const r = await extractDocument(file, 'vehicle_reg', { onProgress: progress });
    if (!r.ok) {
      showToast(`OCR 실패: ${r.error}`, 'error');
      return null;
    }
    // Gemini 결과 → freepasserp3 product 필드명으로 매핑
    const e = r.extracted || {};
    const parsed = {};
    if (e.car_number) parsed.car_number = e.car_number;
    if (e.car_name) parsed.cert_car_name = e.car_name;
    if (e.type_number) parsed.type_number = e.type_number;
    if (e.car_year_month) parsed.year = String(e.car_year_month).slice(0, 4);
    if (e.vin) parsed.vin = e.vin;
    if (e.engine_type) parsed.engine_type = e.engine_type;
    if (e.usage_type) parsed.usage = e.usage_type;
    if (e.engine_cc) parsed.engine_cc = String(e.engine_cc);
    if (e.seats) parsed.seats = Number(e.seats);
    if (e.fuel_type) parsed.fuel_type = e.fuel_type;
    if (e.first_registration_date) {
      parsed.first_registration_date = String(e.first_registration_date).replace(/-/g, '.');
      if (!parsed.year) parsed.year = String(e.first_registration_date).slice(0, 4);
    }
    if (e.owner_name) parsed.owner_name = e.owner_name;
    if (e.owner_biz_no) parsed.owner_biz_no = e.owner_biz_no;
    // category_hint → vehicle_class 정규화 (대형 승용 → 대형, 중형 승합 → 승합)
    if (e.category_hint) {
      const v = String(e.category_hint);
      if (/승합/.test(v)) parsed.vehicle_class = '승합';
      else if (/화물/.test(v)) parsed.vehicle_class = '화물';
      else {
        const sz = v.match(/(경형|소형|중형|대형)/);
        if (sz) parsed.vehicle_class = sz[1] === '경형' ? '경차' : sz[1];
      }
    }

    // 1) maker 추론 + catalog 매칭 (제조사스펙 자동 채움)
    progress('차종 매칭 중...');
    const maker = deriveMakerFromRegistration(parsed);
    if (maker) parsed.maker = maker;
    // cert_car_name → 모델 후보 (catalog 매칭 실패해도 일단 model 에 차명 넣음)
    if (parsed.cert_car_name && !parsed.model) {
      // 차명 첫 단어가 보통 모델명 ("그랜저 하이브리드" → "그랜저")
      parsed.model = parsed.cert_car_name.split(/\s+/)[0] || parsed.cert_car_name;
    }
    if (maker) {
      try {
        const { findCatalog, loadCatalog } = await import('../core/vehicle-matrix.js');
        const match = await findCatalog(maker, parsed.cert_car_name, parsed.cert_car_name, {
          fuel_type: parsed.fuel_type,
          year: parsed.year,
          first_registration_date: parsed.first_registration_date,
          type_number: parsed.type_number,
        });
        if (match?.catalogId) {
          const cat = await loadCatalog(match.catalogId);
          if (cat) {
            // catalog json: { model_root, title, maker, ... } — model_root 가 모델명, title 이 세부모델
            if (cat.model_root) parsed.model = cat.model_root;
            else if (cat.model) parsed.model = cat.model;
            // 세부모델 — title 에서 maker prefix 제거 ("현대 그랜저 IG 하이브리드" → "그랜저 IG 하이브리드")
            const title = cat.title || cat.sub_model || '';
            parsed.sub_model = title.replace(new RegExp(`^${maker}\\s+`), '').trim() || title;
          }
        }
      } catch (e) { console.warn('[catalog match]', e); }
    }

    // 2) car_models (vehicle_master) fallback — catalog 매칭 실패 시
    if (!parsed.sub_model) {
      const inferred = inferCarModel(parsed.cert_car_name, parsed.year, parsed.first_registration_date, store.carModels || []);
      if (inferred) {
        parsed.maker = parsed.maker || inferred.maker;
        parsed.model = parsed.model || inferred.model;
        parsed.sub_model = inferred.sub_model;
        if (inferred.vehicle_class) parsed.vehicle_class = inferred.vehicle_class;
      }
    }

    // 3) 공급코드 매칭 — owner_name (등록증 ⑨ 성명/명칭) ↔ partners.partner_name
    progress('공급사 매칭 중...');
    if (parsed.owner_name) {
      const norm = (s) => String(s || '').replace(/[\s\(\)\(\)㈜주식회사유한회사]/g, '').toLowerCase();
      const target = norm(parsed.owner_name);
      const partner = (store.partners || [])
        .filter(pa => !pa._deleted)
        .find(pa => {
          const t = pa.partner_type || '';
          if (t === '운영사' || t === 'operator' || t === '영업채널' || t === 'sales_channel') return false;
          const name = norm(pa.partner_name || pa.company_name);
          if (!name || !target) return false;
          return name === target || name.includes(target) || target.includes(name);
        });
      if (partner) {
        parsed.provider_company_code = partner.partner_code || partner.company_code || partner._key;
        parsed.partner_code = parsed.provider_company_code;
      }
    }

    return Object.keys(parsed).length ? parsed : null;
  } catch (e) {
    console.error('[OCR]', e);
    showToast('OCR 실패', 'error');
    return null;
  }
}

/* PDF 첫 페이지를 JPG File 로 변환 — 차량사진 그리드에 등록증 미리보기로 추가용 */
async function pdfFirstPageToImage(pdfFile) {
  const pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
  const buf = await pdfFile.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return new File([blob], pdfFile.name.replace(/\.pdf$/i, '.jpg'), { type: 'image/jpeg' });
}

/* 등록증 업로드 헬퍼 — OCR + 폼 직접 채움 + Storage + PDF→이미지 변환. */
async function uploadRegistration(p, file) {
  if (!file) return;
  // 편집모드 자동 진입 — 보기모드에서 등록증 올렸을 때 폼 input 의 readonly 자동 해제
  if (!document.body.classList.contains('is-edit-mode')) {
    window.toggleEditMode?.(true);
  }
  const zone = document.querySelector('.pt-page[data-page="product"] #pdRegDropzone');
  const textEl = zone?.querySelector('.pd-dropzone-text');
  const iconEl = zone?.querySelector(':scope > i');
  const origText = textEl?.textContent || '';
  const origIconClass = iconEl?.className || '';
  zone?.classList.add('is-uploading');
  if (iconEl) iconEl.className = 'ph ph-circle-notch';   // 회전 가능한 아이콘

  // 1) OCR 먼저 — dropzone 진행 표시 + 폼 직접 채움 + flash
  try {
    const ocrFields = await tryOCRRegistration(file, (msg) => {
      if (textEl) textEl.textContent = msg;
    });
    if (ocrFields && Object.keys(ocrFields).length) {
      // 자산 정보 폼 input 직접 채움 + flash (watchCollection 콜백 기다리지 않음)
      const filled = applyOcrFieldsToForm(p, ocrFields);
      // RTDB 동기화 (영구 저장)
      await updateRecord(`products/${p._key}`, { ...ocrFields, updated_at: Date.now() }, { silent: true });
      Object.assign(p, ocrFields);
      showToast(`OCR: ${filled.length}개 필드 자동 채움`, 'success');
    } else {
      showToast('OCR 결과 없음 — 수동 입력해주세요', 'info');
    }
  } catch (e) {
    console.error('[reg ocr]', e);
    showToast(`OCR 실패: ${e?.message || e}`, 'error');
  } finally {
    zone?.classList.remove('is-uploading');
    if (textEl) textEl.textContent = origText;
    if (iconEl) iconEl.className = origIconClass;
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  // 2) Storage 업로드 (등록증 원본 + PDF인 경우 변환된 이미지)
  try {
    showToast('등록증 파일 저장 중...', 'info');
    const regPath = `product-images/${p._key}/reg_${Date.now()}_${file.name}`;
    const { url: regUrl } = await uploadImage(regPath, file);
    const patch = {
      registration_image: regUrl,
      registration_type: isPdf ? 'pdf' : 'image',
      updated_at: Date.now(),
    };
    // PDF → 첫 페이지 이미지 변환 + 차량사진 끝에 추가
    if (isPdf) {
      try {
        const imgFile = await pdfFirstPageToImage(file);
        const imgPath = `product-images/${p._key}/reg-img_${Date.now()}_${imgFile.name}`;
        const { url: imgUrl } = await uploadImage(imgPath, imgFile);
        const cur = Array.isArray(p.image_urls) ? p.image_urls : [];
        patch.image_urls = [...cur, imgUrl];
      } catch (e) {
        console.warn('[reg pdf→img]', e);
      }
    }
    await updateRecord(`products/${p._key}`, patch);
    showToast('등록증 파일 저장 완료', 'success');
  } catch (e) {
    console.error('[reg upload]', e);
    const msg = e?.code === 'storage/unauthorized'
      ? '파일 저장 권한 없음 — Firebase Storage rules 배포 필요 (firebase deploy --only storage)'
      : `파일 저장 실패: ${e?.message || e?.code || e}`;
    showToast(msg, 'error');
  }
}

function bindRegUpload(photoCard, p) {
  const regInput = photoCard.querySelector('#pdRegFile');
  const regZone  = photoCard.querySelector('#pdRegDropzone');

  regInput?.addEventListener('change', async () => {
    const f = regInput.files?.[0];
    if (f) await uploadRegistration(p, f);
    regInput.value = '';
  });
  if (regZone) {
    regZone.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); regZone.classList.add('is-drop-target'); }
    });
    regZone.addEventListener('dragleave', () => regZone.classList.remove('is-drop-target'));
    regZone.addEventListener('drop', async e => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      regZone.classList.remove('is-drop-target');
      await uploadRegistration(p, e.dataTransfer.files[0]);
    });
  }
  photoCard.querySelector('#pdRegDel')?.addEventListener('click', async () => {
    if (!confirm('등록증을 제거할까요?')) return;
    await updateRecord(`products/${p._key}`, { registration_image: null, registration_type: null, updated_at: Date.now() });
  });
}

/* ──────── D. 가격 매트릭스 인라인 편집 (v2 패턴) ──────── */
function bindProductPriceEdit(p) {
  const page = document.querySelector('.pt-page[data-page="product"]');
  // 가격 패널 상단 form-grid (정책·구분·상태·주행) — 변경 시 즉시 저장
  const priceCard = page.querySelectorAll('.ws4-card')[2];
  priceCard?.querySelectorAll('.form-grid [data-f]').forEach(el => {
    const evt = el.tagName === 'SELECT' ? 'change' : 'blur';
    el.addEventListener(evt, async () => {
      const f = el.dataset.f;
      const v = el.value;
      if (p[f] === v) return;
      try {
        await updateRecord(`products/${p._key}`, { [f]: v, updated_at: Date.now() });
        p[f] = v;
        flashSaved(el);
      } catch (e) {
        console.error('[product field] save fail', e);
        alert('저장 실패 — ' + (e.message || e));
      }
    });
  });
  page.querySelectorAll('.pd-price-input, .pd-price-memo').forEach(inp => {
    const isMemo = inp.classList.contains('pd-price-memo');
    let originalValue = inp.value;
    if (!isMemo) {
      inp.addEventListener('focus', () => {
        inp.value = inp.value.replace(/[^\d]/g, '');
        originalValue = inp.value;
      });
      inp.addEventListener('input', () => {
        const cleaned = inp.value.replace(/[^\d]/g, '');
        if (cleaned !== inp.value) inp.value = cleaned;
      });
    } else {
      inp.addEventListener('focus', () => { originalValue = inp.value; });
    }
    inp.addEventListener('blur', async () => {
      const val = inp.value.trim();
      if (val === originalValue) {
        if (!isMemo && val !== '') inp.value = Number(val).toLocaleString('ko-KR');
        return;
      }
      const saved = isMemo ? (val || null) : (val ? Number(val) : null);
      const m = inp.dataset.period, t = inp.dataset.type;
      try {
        await updateRecord(`products/${p._key}`, { [`price/${m}/${t}`]: saved });
        const next = { ...(p.price || {}) };
        next[m] = { ...(next[m] || {}), [t]: saved };
        p.price = next;
        originalValue = val;
        if (!isMemo && val !== '') inp.value = Number(val).toLocaleString('ko-KR');
        flashSaved(inp);
      } catch (e) {
        console.error('[product price] save fail', e);
        alert('저장 실패 — ' + (e.message || e));
      }
    });
  });
}

/* 신규등록은 하단 액션바(setPageActions) 의 createNewProduct 가 처리 — app.js 정의 */
