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
import { parseVehicleRegistration } from '../core/ocr-parsers/vehicle-registration.js';
import { inferCarModel } from '../core/car-model-infer.js';
import { getMakers, getModelsByMaker, getSubModels, findCarModel } from '../core/car-models.js';
import { pickPartner } from '../core/dialogs.js';
import {
  esc, shortStatus, fmtTime,
  listBody, emptyState, renderRoomItem,
  ffi, ffs, setHeadSave, flashSaved, bindFormSave,
} from '../core/ui-helpers.js';

/* v2 product-manage 옵션 — 차량 스펙 드롭다운 */
export const PRODUCT_OPTS = {
  vehicle_status: ['즉시출고','출고가능','상품화중','출고협의','출고불가'],
  product_type: ['중고렌트','신차렌트','중고구독','신차구독'],
  fuel_type: ['가솔린','디젤','LPG','하이브리드','전기','수소'],
  vehicle_class: ['경차','소형','준중형','중형','준대형','대형','SUV','RV','승합','화물','수입'],
  drive_type: ['전륜(FF)','후륜(FR)','4륜(AWD)','4륜(4WD)'],
  usage: ['자가용','영업용','관용'],
  year: Array.from({ length: 12 }, (_, i) => String(2026 - i)),
};

export const PRODUCT_TERMS = ['1', '12', '24', '36', '48', '60'];   // v2 PRICE_PERIODS
const MAX_PHOTOS = 30;
const UPLOAD_CONCURRENCY = 4;

/* ──────── A. 차종마스터 cascade picker (vehicle_master 엄격 매칭) ──────── */
function carInventoryCounts() {
  const byMaker = new Map();
  const byMakerModel = new Map();
  const byMakerModelSub = new Map();
  for (const p of store.products || []) {
    if (p._deleted || p.status === 'deleted') continue;
    const mk = p.maker || '', md = p.model || '', sb = p.sub_model || '';
    if (mk) byMaker.set(mk, (byMaker.get(mk) || 0) + 1);
    if (mk && md) byMakerModel.set(`${mk}|${md}`, (byMakerModel.get(`${mk}|${md}`) || 0) + 1);
    if (mk && md && sb) byMakerModelSub.set(`${mk}|${md}|${sb}`, (byMakerModelSub.get(`${mk}|${md}|${sb}`) || 0) + 1);
  }
  return { byMaker, byMakerModel, byMakerModelSub };
}

function renderCarPicker(p, dis = '') {
  const curMk = p.maker || '';
  const curMd = p.model || '';
  const curSub = p.sub_model || '';
  const makers = getMakers();
  const models = curMk ? getModelsByMaker(curMk) : [];
  const subs = (curMk && curMd) ? getSubModels(curMk, curMd) : [];

  return `${pickerSelect('제조사',   'maker', curMk, makers, { mk: curMk, md: curMd }, dis)}
          ${pickerSelect('모델',     'model', curMd, models, { mk: curMk, md: curMd }, dis)}
          ${pickerSelect('세부모델', 'sub_model', curSub, subs, { mk: curMk, md: curMd }, dis)}`;
}

function pickerSelect(label, field, cur, list, ctx, dis) {
  return `<div class="ff"><label>${esc(label)}</label>
    <select class="input" data-f="${esc(field)}" data-picker="${esc(field)}"${dis}>
      <option value="">선택</option>
      ${pickerOptionsHtml(list, cur, field, ctx)}
    </select>
  </div>`;
}

function pickerOptionsHtml(list, cur, field, ctx) {
  const { byMaker, byMakerModel, byMakerModelSub } = carInventoryCounts();
  const labelOf = (o) => {
    let n = 0;
    if (field === 'maker') n = byMaker.get(o) || 0;
    else if (field === 'model') n = byMakerModel.get(`${ctx.mk}|${o}`) || 0;
    else if (field === 'sub_model') n = byMakerModelSub.get(`${ctx.mk}|${ctx.md}|${o}`) || 0;
    return n > 0 ? `${o} (${n})` : o;
  };
  const inList = list.includes(cur);
  return list.map(o => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(labelOf(o))}</option>`).join('') +
    (cur && !inList ? `<option value="${esc(cur)}" selected>${esc(labelOf(cur))}</option>` : '');
}

function bindCarPicker(card, p) {
  const mkSel = card.querySelector('select[data-picker="maker"]');
  const mdSel = card.querySelector('select[data-picker="model"]');
  const sbSel = card.querySelector('select[data-picker="sub_model"]');
  if (!mkSel || !mdSel || !sbSel) return;

  const fillSelect = (sel, field, list, cur, ctx) => {
    sel.innerHTML = `<option value="">선택</option>` + pickerOptionsHtml(list, cur, field, ctx);
  };

  mkSel.addEventListener('change', () => {
    const newMk = mkSel.value;
    fillSelect(mdSel, 'model', newMk ? getModelsByMaker(newMk) : [], '', { mk: newMk, md: '' });
    fillSelect(sbSel, 'sub_model', [], '', { mk: newMk, md: '' });
    autoFillFromCarModel(card, newMk, '', '');
  });
  mdSel.addEventListener('change', () => {
    const mk = mkSel.value, newMd = mdSel.value;
    fillSelect(sbSel, 'sub_model', (mk && newMd) ? getSubModels(mk, newMd) : [], '', { mk, md: newMd });
    autoFillFromCarModel(card, mk, newMd, '');
  });
  sbSel.addEventListener('change', () => {
    autoFillFromCarModel(card, mkSel.value, mdSel.value, sbSel.value);
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
  if (!products.length) { body.innerHTML = emptyState('상품이 없습니다'); renderProductDetail(null); return; }
  const sorted = [...products].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  body.innerHTML = sorted.map((p, i) => {
    const photos = ((Array.isArray(p.photos) ? p.photos : []).length) ||
                   ((Array.isArray(p.image_urls) ? p.image_urls : []).length) ||
                   ((Array.isArray(p.images) ? p.images : []).length) || 0;
    const priceCount = Object.entries(p.price || {}).filter(([, v]) => Number(v?.rent) > 0).length;
    const vs = p.vehicle_status || '';
    const PROD_TONE = /즉시/.test(vs) ? 'green' : /가능/.test(vs) ? 'blue' : /협의/.test(vs) ? 'orange' : /불가/.test(vs) ? 'red' : 'gray';
    return renderRoomItem({
      id: p._key,
      icon: 'car-simple',
      badge: shortStatus(vs),
      tone: PROD_TONE,
      name: `${p.car_number || '-'} ${[p.maker, p.sub_model || p.model].filter(Boolean).join(' ')}`,
      time: fmtTime(p.updated_at || p.created_at),
      msg: [p.trim_name || p.trim, p.year ? p.year + '년' : '', p.fuel_type, photos ? `사진 ${photos}` : ''].filter(Boolean).join(' · ') || '-',
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
    assetCard.querySelector('.ws4-body').innerHTML = `
      ${sect('기본정보', 'identification-card', `
        ${ffi('차량번호',  'car_number', p.car_number, dis)}
        ${ffi('차대번호',  'vin',        p.vin, dis)}
        ${ro('공급코드',   p.provider_company_code)}
        ${ro('파트너코드', p.partner_code)}
        ${ro('상품코드',   p.product_code)}
        ${ro('상품UID',    p.product_uid || p._key)}
      `)}
      ${sect('제조사스펙', 'car-simple', `
        ${renderCarPicker(p, dis)}
        ${ffi('트림',      'trim_name',     p.trim_name || p.trim, dis)}
        ${ffi('옵션',      'options',       optsValue, dis)}
        ${ffi('외장색',    'ext_color',     p.ext_color, dis)}
        ${ffi('내장색',    'int_color',     p.int_color, dis)}
        ${ffs('구동방식',  'drive_type',    p.drive_type, O.drive_type, dis)}
        ${ffs('차종구분',  'vehicle_class', p.vehicle_class, O.vehicle_class, dis)}
        ${ffi('차량가격',  'vehicle_price', p.vehicle_price, dis)}
      `)}
      ${sect('등록증스펙', 'file-text', `
        ${ffs('연식',      'year',          p.year ? String(p.year) : '', O.year, dis)}
        ${ffi('배기량',    'engine_cc',     p.engine_cc, dis)}
        ${ffi('승차정원',  'seats',         p.seats, dis)}
        ${ffs('연료',      'fuel_type',     p.fuel_type, O.fuel_type, dis)}
        ${ffi('최초등록일', 'first_registration_date', p.first_registration_date, dis)}
        ${ffs('용도',      'usage',         p.usage, O.usage, dis)}
        ${ffi('변속기',    'transmission',  p.transmission, dis)}
        ${ffi('차령만료일', 'vehicle_age_expiry_date', p.vehicle_age_expiry_date, dis)}
        ${ffi('위치',      'location',      p.location, dis)}
        <div class="ff"><label>메모</label><textarea class="input" data-f="partner_memo" style="height: 50px;"${dis}>${esc(p.partner_memo || p.note || '')}</textarea></div>
      `)}
    `;
    if (canEdit) {
      bindFormSave(page, 'products', p._key, p);
      bindCarPicker(assetCard, p);
    }
  }

  // 2. 가격 매트릭스 — v2 패턴 (저장: 원단위 raw integer / 표시: 콤마 toLocaleString)
  if (priceCard) {
    const disabled = canEdit ? '' : ' disabled';
    const O = PRODUCT_OPTS;
    const fmt = v => (v != null && v !== '') ? Number(v).toLocaleString('ko-KR') : '';
    const me = store.currentUser || {};
    const productProvider = p.provider_company_code || me.company_code || '';
    const policyOpts = (store.policies || []).filter(t => !t._deleted)
      .filter(t => me.role === 'admin' || !productProvider || t.provider_company_code === productProvider)
      .map(t => ({ code: t.policy_code || t._key, name: t.policy_name || t.term_name || '' }));
    const curPol = p.policy_code || '';
    const policySelectHtml = `
      <div class="ff"><label>정책코드</label><select class="input" data-f="policy_code"${disabled}>
        <option value="">선택</option>
        ${policyOpts.map(o => `<option value="${esc(o.code)}" ${o.code === curPol ? 'selected' : ''}>${esc(o.name ? `${o.name} (${o.code})` : o.code)}</option>`).join('')}
        ${curPol && !policyOpts.find(o => o.code === curPol) ? `<option value="${esc(curPol)}" selected>${esc(curPol)}</option>` : ''}
      </select></div>`;
    const rentRow = m => {
      const v = p.price?.[m] || {};
      return `<tr data-term="${m}">
        <td>${m}개월</td>
        <td><input class="input pd-price-input" data-period="${m}" data-type="rent" value="${esc(fmt(v.rent))}" placeholder="-" inputmode="numeric" style="text-align:right; width:100%;"${disabled}></td>
        <td><input class="input pd-price-input" data-period="${m}" data-type="deposit" value="${esc(fmt(v.deposit))}" placeholder="-" inputmode="numeric" style="text-align:right; width:100%;"${disabled}></td>
      </tr>`;
    };
    const feeRow = m => {
      const v = p.price?.[m] || {};
      const feeRaw = v.fee != null && v.fee !== '' ? v.fee : (v.commission || '');
      return `<tr data-term="${m}">
        <td>${m}개월</td>
        <td><input class="input pd-price-input" data-period="${m}" data-type="fee" value="${esc(fmt(feeRaw))}" placeholder="-" inputmode="numeric" style="text-align:right; width:100%;"${disabled}></td>
        <td><input class="input pd-price-memo" data-period="${m}" data-type="fee_memo" value="${esc(v.fee_memo || '')}" placeholder="-" style="width:100%;"${disabled}></td>
      </tr>`;
    };
    priceCard.querySelector('.ws4-body').innerHTML = `
      <div class="form-section-title"><i class="ph ph-scroll"></i>상태 · 정책</div>
      <div class="form-grid" style="margin-bottom: 12px;">
        ${policySelectHtml}
        ${ffs('상품구분', 'product_type',    p.product_type,    O.product_type,    disabled)}
        ${ffs('차량상태', 'vehicle_status',  p.vehicle_status,  O.vehicle_status,  disabled)}
        ${ffi('주행거리', 'mileage',         p.mileage,                              disabled)}
      </div>
      <div class="form-section-title"><i class="ph ph-currency-krw"></i>대여료 · 보증금</div>
      <table class="table pd-price-table" style="margin-bottom: 12px;" id="prodPriceTable">
        <colgroup><col style="width:60px;"><col style="width:50%;"><col style="width:50%;"></colgroup>
        <thead><tr><th>기간</th><th class="num">대여료</th><th class="num">보증금</th></tr></thead>
        <tbody>${PRODUCT_TERMS.map(rentRow).join('')}</tbody>
      </table>
      ${(role === 'admin' || role === 'agent' || role === 'agent_admin') ? `
        <div class="form-section-title"><i class="ph ph-percent"></i>수수료 · 비고 <span style="color:var(--text-weak); font-weight:400; font-size:11px;">(내부용)</span></div>
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
  const regImg       = p.registration_image || '';
  const regIsPdf     = regImg && (regImg.toLowerCase().includes('.pdf') || p.registration_type === 'pdf');
  const dis          = canEdit ? '' : ' disabled';

  photoCard.querySelector('.ws4-body').innerHTML = `
    ${sect('차량등록증', 'identification-card', `
      ${regImg
        ? `<div style="position:relative; display:inline-block;">
             ${regIsPdf
               ? `<a href="${esc(regImg)}" target="_blank" class="pd-reg-pdf"><i class="ph ph-file-pdf"></i>차량등록증.pdf</a>`
               : `<img src="${esc(regImg)}" class="pd-reg-image" id="pdRegImg">`}
             ${canEdit ? '<button class="pd-reg-del" id="pdRegDel"><i class="ph ph-x"></i> 제거</button>' : ''}
           </div>`
        : (canEdit ? `
            <label class="pd-dropzone" id="pdRegDropzone" for="pdRegFile">
              <i class="ph ph-identification-card"></i>
              <div class="pd-dropzone-text">차량등록증을 끌어놓거나 클릭해서 업로드</div>
              <div class="pd-dropzone-hint">이미지(JPG/PNG) 또는 PDF · 차명·등록일로 자동 매칭</div>
              <input type="file" id="pdRegFile" hidden accept="image/*,application/pdf">
            </label>` : '<div style="font-size:11px; color:var(--text-weak);">미등록</div>')}
    `)}
    ${sect('차량 사진', 'image-square', `
      ${allImgs.length ? `
        <div style="position:relative; margin-bottom:8px;">
          <img id="pdMainImg" src="${esc(allImgs[0])}" loading="lazy"
               style="width:100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 4px; cursor: zoom-in; background: var(--bg-stripe);">
          <div style="position:absolute; right:6px; bottom:6px; background:rgba(0,0,0,0.65); color:#fff; padding:2px 8px; border-radius:10px; font-size:11px;">
            <i class="ph ph-image"></i> ${allImgs.length}장
          </div>
          ${canEdit && uploadedImgs.length ? `<button class="pd-reg-del" id="pdMainDel" data-idx="0" title="대표 사진 삭제"><i class="ph ph-x"></i></button>` : ''}
        </div>` : ''}
      ${canEdit ? `
        <label class="pd-dropzone" id="pdDropzone" for="pdPhotoFile">
          <i class="ph ph-upload-simple"></i>
          <div class="pd-dropzone-text">이미지를 끌어놓거나 클릭해서 업로드</div>
          <div class="pd-dropzone-hint">최대 ${MAX_PHOTOS}장 · 첫 번째 = 대표 · 클릭하면 크게보기</div>
          <input type="file" id="pdPhotoFile" multiple hidden accept="image/*">
        </label>` : ''}
    `)}
    ${sect('사진 링크', 'link', `
      <textarea class="input" data-f="photo_link" rows="2" placeholder="https://... (콤마/줄바꿈 구분)" style="width:100%; resize:vertical;"${dis}>${esc(photoLink)}</textarea>
    `)}
  `;

  photoCard.querySelector('#pdMainImg')?.addEventListener('click', () => openFullscreen(allImgs, 0));
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
        if (hint) hint.textContent = `최대 ${MAX_PHOTOS}장 · 첫 번째 = 대표 · 클릭하면 크게보기`;
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
      showToast(`사진 ${ok}장 업로드 완료${fail ? ` · 실패 ${fail}장` : ''}`, fail ? 'error' : 'success');
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

/* 등록증 OCR + 차종마스터 추론 */
async function tryOCRRegistration(file) {
  try {
    showToast('OCR 분석 중...', 'info');
    const { text } = await ocrFile(file);
    if (!text || text.length < 20) return null;
    const parsed = parseVehicleRegistration(text);
    for (const k of Object.keys(parsed)) if (!parsed[k]) delete parsed[k];

    const inferred = inferCarModel(parsed.model, parsed.year, parsed.first_registration_date, store.carModels || []);
    if (inferred) {
      parsed.maker = inferred.maker;
      parsed.model = inferred.model;
      parsed.sub_model = inferred.sub_model;
      if (inferred.vehicle_class) parsed.vehicle_class = inferred.vehicle_class;
    }

    return Object.keys(parsed).length ? parsed : null;
  } catch (e) {
    console.error('[OCR]', e);
    showToast('OCR 실패', 'error');
    return null;
  }
}

function bindRegUpload(photoCard, p) {
  const regInput = photoCard.querySelector('#pdRegFile');
  const regZone  = photoCard.querySelector('#pdRegDropzone');
  const regDel   = photoCard.querySelector('#pdRegDel');

  const upload = async (file) => {
    if (!file) return;
    try {
      showToast('등록증 업로드 중...', 'info');
      const path = `product-images/${p._key}/reg_${Date.now()}_${file.name}`;
      const { url } = await uploadImage(path, file);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      await updateRecord(`products/${p._key}`, {
        registration_image: url,
        registration_type: isPdf ? 'pdf' : 'image',
        updated_at: Date.now(),
      });
      showToast('등록증 업로드 완료', 'success');

      // OCR 자동 채움
      const ocr = await tryOCRRegistration(file);
      if (ocr && Object.keys(ocr).length) {
        await updateRecord(`products/${p._key}`, { ...ocr, updated_at: Date.now() });
        showToast(`OCR: ${Object.keys(ocr).length}개 필드 자동 채움`, 'success');
      } else {
        showToast('OCR 결과 없음 — 수동 입력해주세요', 'info');
      }
    } catch (e) { console.error('[reg upload]', e); showToast('등록증 업로드 실패', 'error'); }
  };

  regInput?.addEventListener('change', async () => {
    await upload(regInput.files[0]);
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
      await upload(e.dataTransfer.files[0]);
    });
  }
  regDel?.addEventListener('click', async () => {
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

/* ──────── E. 신규 차량 등록 ──────── */
export function bindProductCreate() {
  const btn = document.querySelector('[data-page="product"] .ws4-list .ws4-head .btn-primary');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const me = store.currentUser;
    const role = me?.role;
    if (!(role === 'admin' || role === 'provider')) {
      return showToast('차량 등록은 공급사·관리자 전용', 'error');
    }
    const carNumber = prompt('차량번호 (예: 56다 1234):');
    if (!carNumber?.trim()) return;
    const norm = s => String(s || '').replace(/\s/g, '');
    const carNo = carNumber.trim();
    const dupe = (store.products || []).find(p => norm(p.car_number) === norm(carNo));
    if (dupe) return showToast('이미 등록된 차량번호', 'error');

    let partner;
    if (role === 'admin') {
      partner = await pickPartner('공급사');
      if (!partner) return;
    } else {
      partner = { partner_code: me.company_code || me.partner_code, partner_name: me.company_name || '' };
      if (!partner.partner_code) return showToast('소속 공급사 정보가 없습니다 — 관리자 문의', 'error');
    }
    try {
      await pushRecord('products', {
        car_number: carNo,
        provider_company_code: partner.partner_code,
        partner_code: partner.partner_code,
        product_code: `${carNo}_${partner.partner_code}`,
        vehicle_status: '상품화중',
        product_type: '중고렌트',
        is_active: true,
        created_at: Date.now(),
        created_by: me.uid,
      });
      showToast('차량 등록됨 — 자산정보를 채워주세요', 'success');
      location.hash = 'product';
    } catch (e) {
      console.error('[product create]', e);
      showToast('등록 실패 — ' + (e.message || e), 'error');
    }
  });
}
