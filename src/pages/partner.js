/**
 * pages/partner.js — 파트너 관리 페이지 (v3 ERP)
 *
 * 의존: core/store, firebase/db, core/toast, core/ui-helpers
 * Export: renderPartnerList / renderPartnerDetail / bindPartnerCreate
 */
import { store } from '../core/store.js';
import { setRecord, updateRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import {
  esc, fmtDate, fmtFullTime,
  listBody, emptyState, renderRoomItem,
  setHeadSave, bindFormSave, renderInfoGrid, ffi,
} from '../core/ui-helpers.js';
import { ocrFile } from '../core/ocr.js';
import { parseBusinessRegistration } from '../core/ocr-parsers/business-registration.js';
import { parseBankbook } from '../core/ocr-parsers/bankbook.js';
import { parseVehicleRegistration, deriveMakerFromRegistration } from '../core/ocr-parsers/vehicle-registration.js';
import { findCatalog, loadCatalog } from '../core/vehicle-matrix.js';
import { customConfirm } from '../core/confirm.js';

export function renderPartnerList(partners) {
  const body = listBody('partners');
  if (!body) return;
  if (!Array.isArray(partners)) return;   // 미로드 — prototype 보존
  if (!partners.length) { body.innerHTML = emptyState('파트너가 없습니다'); renderPartnerDetail(null); return; }
  // v2 partners: partner_code (HCAP), partner_name (현대캐피탈)
  const pCode = (pa) => pa.partner_code || pa.company_code || pa._key;
  const pName = (pa) => pa.partner_name || pa.company_name || pCode(pa);
  const sorted = [...partners].sort((a, b) => String(pName(a)).localeCompare(String(pName(b)), 'ko'));
  body.innerHTML = sorted.map((pa, i) => {
    const ptype = pa.partner_type || '';
    const isAgent = ptype === '영업채널' || ptype === 'sales_channel';
    const isOperator = ptype === '운영사' || ptype === 'operator';
    const typeBadge = isAgent ? { txt: '영업', tone: 'orange', icon: 'storefront' }
                     : isOperator ? { txt: '운영', tone: 'red', icon: 'gear' }
                     : { txt: '공급', tone: 'blue', icon: 'buildings' };
    const code = pCode(pa);
    const typeLabel = isAgent ? '영업채널' : (isOperator ? '운영사' : '공급사');
    // 유형별 카운트
    let stats = '';
    if (isAgent) {
      const agentCount = (store.users || []).filter(u => u.agent_channel_code === code).length;
      const ctCount = (store.contracts || []).filter(c => c.agent_channel_code === code).length;
      stats = `영업${agentCount} 계약${ctCount}`;
    } else if (isOperator) {
      const userCount = (store.users || []).filter(u => u.company_code === code).length;
      stats = `사용자${userCount}`;
    } else {
      const carCount = (store.products || []).filter(p => p.provider_company_code === code || p.partner_code === code).length;
      const ctCount = (store.contracts || []).filter(c => c.provider_company_code === code).length;
      stats = `차량${carCount} 계약${ctCount}`;
    }
    // 메인: 파트너명 코드  /  우측: 등록일
    const mainLine = [pName(pa), code].filter(Boolean).join(' ');
    // 보조: 유형 | 담당자 | 연락처 | 통계
    const subParts = [typeLabel, pa.contact_name, pa.phone, stats].filter(Boolean);
    return renderRoomItem({
      id: pa._key,
      icon: typeBadge.icon,
      badge: typeBadge.txt,
      tone: typeBadge.tone,
      name: mainLine,
      time: fmtDate(pa.created_at),
      msg: subParts.join(' | ') || '-',
      meta: '',
      active: i === 0,
    });
  }).join('');
  renderPartnerDetail(sorted[0]);
}

export function renderPartnerDetail(pa) {
  const page = document.querySelector('.pt-page[data-page="partners"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  // [목록(0), 파트너정보(1, 편집), 파트너상세(2 = .ws4-detail, RO), 활동이력(3)]
  const editCard = cards[1], detailCard = cards[2], historyCard = cards[3];

  if (!pa) {
    [editCard, detailCard, historyCard].forEach(c => { if (c) c.querySelector('.ws4-body').innerHTML = emptyState('-'); });
    return;
  }
  const role = store.currentUser?.role;
  const canEdit = role === 'admin';
  const dis = canEdit ? '' : ' disabled';

  // 1. 편집 폼
  if (editCard) {
    const partnerTypeOpts = [
      ['공급사', /(공급|provider)/i],
      ['영업채널', /(영업|sales)/i],
      ['운영사', /(운영|operator)/i],
    ];
    setHeadSave(editCard, '파트너 정보', canEdit, 'partner');
    const lockSel = canEdit ? ' data-edit-lock="1"' : dis;   // select 는 readonly 불가
    // 재고관리(product.js) 와 동일한 sect 패턴 — form-section-title + form-grid
    const sect = (title, icon, body) => `<div class="form-section-title"><i class="ph ph-${icon}"></i>${esc(title)}</div><div class="form-grid">${body}</div>`;
    editCard.querySelector('.ws4-body').innerHTML = `
      ${sect('식별', 'hash', `
        ${ffi('파트너코드',     'partner_code',    pa.partner_code || pa.company_code || '', dis)}
        <div class="ff"><label>유형</label><select class="input" data-f="partner_type"${lockSel}>${partnerTypeOpts.map(([label, re]) => `<option value="${esc(label)}" ${re.test(pa.partner_type || '공급사') ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
      `)}
      ${sect('등록증 정보', 'identification-card', `
        ${ffi('상호(법인명)',   'partner_name',    pa.partner_name || pa.company_name || '', dis)}
        ${ffi('대표자',         'ceo_name',        pa.ceo_name,        dis)}
        ${ffi('사업자번호',     'business_number', pa.business_number, dis)}
        ${ffi('법인등록번호',   'corp_number',     pa.corp_number,     dis)}
        ${ffi('개업일',         'open_date',       pa.open_date,       dis)}
        ${ffi('업태',           'industry',        pa.industry,        dis)}
        ${ffi('종목',           'category',        pa.category,        dis)}
        ${ffi('세무서',         'tax_office',      pa.tax_office,      dis)}
        ${ffi('사업장 주소',    'address',         pa.address,         dis)}
        ${ffi('본점 소재지',    'hq_address',      pa.hq_address,      dis)}
      `)}
      ${sect('통장 정보', 'bank', `
        ${ffi('은행',           'bank_name',       pa.bank_name,       dis)}
        ${ffi('계좌번호',       'bank_account',    pa.bank_account,    dis)}
        ${ffi('예금주',         'bank_holder',     pa.bank_holder,     dis)}
      `)}
      ${sect('선택 정보', 'note-pencil', `
        ${ffi('담당자',         'contact_name',    pa.contact_name,    dis)}
        ${ffi('직급',           'contact_title',   pa.contact_title,   dis)}
        ${ffi('연락처',         'phone',           pa.phone,           dis)}
        ${ffi('이메일',         'email',           pa.email,           dis)}
        <div class="ff" style="grid-column:1/-1;"><label>비고</label><textarea class="input" data-f="memo" style="height:50px;"${canEdit ? ' readonly data-edit-lock="1"' : dis}>${esc(pa.memo || '')}</textarea></div>
      `)}
    `;
    // 첨부 OCR 은 4번 패널 (historyCard) 에서 트리거 → editCard 폼 입력
  }

  // 2. 활동 통계 (RO) — 매물/계약 수치 + 활동이력 timeline
  if (detailCard) {
    const head = detailCard.querySelector('.ws4-head span');
    if (head) head.textContent = '활동 통계';
    const code = pa.partner_code || pa.company_code || pa._key;
    const allProducts = store.products || [];
    const allContracts = store.contracts || [];
    const cars = allProducts.filter(p => p.provider_company_code === code || p.partner_code === code);
    const carAvail = cars.filter(c => !['출고불가','계약완료'].includes(c.vehicle_status)).length;
    const carContracted = cars.filter(c => c.vehicle_status === '출고불가').length;
    const contracts = allContracts.filter(c => c.provider_company_code === code || c.agent_company === code);
    const ctDone = contracts.filter(c => c.contract_status === '계약완료').length;
    const ctOngoing = contracts.length - ctDone;
    const thisMonth = (() => {
      const m = new Date(); const y = m.getFullYear(), mo = m.getMonth();
      return contracts.filter(c => { const t = c.created_at; if (!t) return false; const d = new Date(t); return d.getFullYear() === y && d.getMonth() === mo; }).length;
    })();
    const rows = [
      ['상태', pa.is_active === false ? '비활성' : '활성'],
      ['총 매물', cars.length + '대'],
      ['  · 출고가능', carAvail + '대'],
      ['  · 계약완료', carContracted + '대'],
      ['총 계약', contracts.length + '건'],
      ['  · 완료', ctDone + '건'],
      ['  · 진행중', ctOngoing + '건'],
      ['이번달 신규', thisMonth + '건'],
      ['등록일', fmtDate(pa.created_at), true],
      ['최근 활동', fmtFullTime(pa.last_active_at), true],
    ].filter(([, v]) => v != null && v !== '');
    const events = Array.isArray(pa.events) ? [...pa.events].sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
    const timelineHtml = events.length ? `
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border-soft);">
        <div class="text-weak" style="font-size:11px;margin-bottom:6px;">최근 활동 ${events.length}건</div>
        ${events.slice(0, 5).map(ev => `
          <div class="timeline-row" style="font-size:11px;">
            <span class="text-weak">${esc(fmtFullTime(ev.at))}</span> | ${esc(ev.status || '-')}
            <div class="text-sub">${esc(ev.note || '')}</div>
          </div>
        `).join('')}
      </div>
    ` : '';
    detailCard.querySelector('.ws4-body').innerHTML = renderInfoGrid(rows) + timelineHtml;
  }

  // 3. 첨부 (등록증·통장사본 + 차량등록증 일괄) — 통일 .pd-dropzone 규격
  if (historyCard) {
    const head = historyCard.querySelector('.ws4-head span');
    if (head) head.textContent = '문서 첨부 / 차량등록증 일괄';
    // 재고관리(product.js) 와 동일한 sect 패턴 — form-section-title + form-grid (1열 dropzone)
    const sect = (title, icon, body) => `<div class="form-section-title"><i class="ph ph-${icon}"></i>${esc(title)}</div><div class="form-grid">${body}</div>`;
    historyCard.querySelector('.ws4-body').innerHTML = canEdit ? `
      ${sect('회사 문서', 'file-text', `
        <label class="pd-dropzone" data-act="biz-reg-zone" style="grid-column:1/-1;">
          <i class="ph ph-identification-card"></i>
          <div class="pd-dropzone-text">사업자등록증 업로드</div>
          <div class="pd-dropzone-hint">이미지(JPG/PNG) 또는 PDF | OCR 로 등록증 정보 자동 채움</div>
          <input type="file" hidden accept="image/*,application/pdf" data-act="biz-reg-input">
        </label>
        <label class="pd-dropzone" data-act="bankbook-zone" style="grid-column:1/-1;">
          <i class="ph ph-bank"></i>
          <div class="pd-dropzone-text">통장사본 업로드</div>
          <div class="pd-dropzone-hint">이미지(JPG/PNG) 또는 PDF | OCR 로 은행/계좌/예금주 자동 채움</div>
          <input type="file" hidden accept="image/*,application/pdf" data-act="bankbook-input">
        </label>
      `)}
      ${sect('차량등록증 일괄 등록', 'files', `
        <label class="pd-dropzone" data-act="vreg-zone" style="grid-column:1/-1;">
          <i class="ph ph-files"></i>
          <div class="pd-dropzone-text">차량등록증 여러 장 업로드</div>
          <div class="pd-dropzone-hint">이미지/PDF 다중 선택 | OCR 후 매물 일괄 신규 등록 (정책·대여료는 재고관리에서)</div>
          <input type="file" hidden accept="image/*,application/pdf" multiple data-act="vreg-input">
        </label>
        <div data-act="vreg-list" style="grid-column:1/-1;display:flex;flex-direction:column;gap:4px;font-size:11px;"></div>
        <div data-act="vreg-actions" style="grid-column:1/-1;display:none;gap:6px;">
          <button type="button" class="btn btn-primary btn-sm" data-act="vreg-commit">
            <i class="ph ph-check"></i>일괄 등록
          </button>
          <button type="button" class="btn btn-outline btn-sm" data-act="vreg-clear">
            <i class="ph ph-x"></i>취소
          </button>
        </div>
      `)}
    ` : `<div class="text-weak">관리자/공급사 전용 기능</div>`;
    if (canEdit) {
      bindAttachUploads(editCard, pa, historyCard);
      bindVehicleRegBatch(historyCard, pa);
    }
  }

  if (canEdit) bindFormSave(page, 'partners', pa._key, pa);
}

/* 신규등록은 하단 액션바(setPageActions) 의 createNewPartner 가 처리 — app.js 정의 */

/**
 * 사업자등록증 + 통장사본 dropzone (4번 패널) → OCR → 파서 → editCard (2번 패널) 폼 자동 채움.
 * 기존 값은 보존. 채워진 필드는 사용자가 확인 후 패널 헤더의 [수정→저장] 으로 확정.
 */
function bindAttachUploads(editCard, pa, zoneCard) {
  bindOneAttach(editCard, zoneCard, pa, {
    zoneSel: '[data-act="biz-reg-zone"]',
    inSel:   '[data-act="biz-reg-input"]',
    label:   '사업자등록증',
    parser:  parseBusinessRegistration,
    formFields:  ['partner_name', 'ceo_name', 'business_number', 'corp_number', 'open_date', 'industry', 'category', 'tax_office', 'address', 'hq_address'],
    extraFields: ['entity_type'],
  });
  bindOneAttach(editCard, zoneCard, pa, {
    zoneSel: '[data-act="bankbook-zone"]',
    inSel:   '[data-act="bankbook-input"]',
    label:   '통장사본',
    parser:  parseBankbook,
    formFields:  ['bank_name', 'bank_account', 'bank_holder'],
    extraFields: [],
  });
}

function bindOneAttach(editCard, zoneCard, pa, opts) {
  const zone  = zoneCard.querySelector(opts.zoneSel);
  const input = zoneCard.querySelector(opts.inSel);
  if (!zone || !input) return;
  const origText = zone.querySelector('.pd-dropzone-text')?.textContent || '';

  // 드래그앤드롭
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.add('is-drop-target');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.remove('is-drop-target');
  }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) processFile(f);
  });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) processFile(file);
  });

  async function processFile(file) {
    zone.classList.add('is-uploading');
    const text = zone.querySelector('.pd-dropzone-text');
    if (text) text.textContent = 'OCR 중...';
    try {
      const { text: ocrText } = await ocrFile(file, {
        onProgress: ({ stage, done, total }) => {
          if (text) text.textContent = `${stage} ${done}/${total}`;
        },
      });
      const parsed = opts.parser(ocrText);
      const filled = applyParsedToForm(editCard, pa, parsed, opts.formFields, opts.extraFields);
      if (filled.length) showToast(`${opts.label} 자동입력: ${filled.join(', ')}`, 'success');
      else showToast(`${opts.label}: 추출된 값 없음`, 'warn');
    } catch (e) {
      console.warn(`[${opts.label} ocr]`, e);
      showToast(`${opts.label} OCR 실패: ${e.message || e}`, 'error');
    } finally {
      zone.classList.remove('is-uploading');
      if (text) text.textContent = origText;
      input.value = '';
    }
  }
}

/**
 * 차량등록증 일괄 업로드 → 각 파일 OCR → 파서 → 미리보기 → 사용자 확인 → products 레코드 일괄 push.
 * provider_company_code = 현재 파트너 코드. 정책/대여료는 비워두고 재고관리 페이지에서 채우도록.
 */
function bindVehicleRegBatch(card, pa) {
  const zone     = card.querySelector('[data-act="vreg-zone"]');
  const input    = card.querySelector('[data-act="vreg-input"]');
  const list     = card.querySelector('[data-act="vreg-list"]');
  const actions  = card.querySelector('[data-act="vreg-actions"]');
  const commitBtn= card.querySelector('[data-act="vreg-commit"]');
  const clearBtn = card.querySelector('[data-act="vreg-clear"]');
  if (!zone || !input) return;
  const origText = zone.querySelector('.pd-dropzone-text')?.textContent || '';

  let staged = [];   // [{ file, parsed, error }]

  // 드래그앤드롭
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.add('is-drop-target');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.remove('is-drop-target');
  }));
  zone.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) processBatch(files);
  });

  clearBtn?.addEventListener('click', () => {
    staged = [];
    list.innerHTML = '';
    actions.style.display = 'none';
  });

  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    if (files.length) processBatch(files);
  });

  async function processBatch(files) {
    zone.classList.add('is-uploading');
    const textEl = zone.querySelector('.pd-dropzone-text');
    list.innerHTML = '';

    let done = 0;
    const results = await Promise.all(files.map(async (file) => {
      try {
        const { text } = await ocrFile(file);
        const parsed = parseVehicleRegistration(text);
        return { file, parsed };
      } catch (e) {
        return { file, error: e.message || String(e) };
      } finally {
        done++;
        if (textEl) textEl.textContent = `OCR ${done}/${files.length}`;
      }
    }));

    // 검증 + 중복 체크 — 기존 products 와 비교
    const existing = store.products || [];
    const carNumSet = new Set(existing.map(p => (p.car_number || '').trim()).filter(Boolean));
    const vinSet = new Set(existing.map(p => (p.vin || '').trim()).filter(Boolean));

    staged = results.map(r => {
      if (r.error) return { ...r, status: 'error', reason: r.error };
      const p = r.parsed || {};
      // 검증
      if (!p.car_number) return { ...r, status: 'invalid', reason: '차량번호 추출 실패' };
      if (!/^\d{2,3}[가-힣]\s?\d{4}$/.test(p.car_number.replace(/\s/g, ''))) {
        return { ...r, status: 'invalid', reason: '차량번호 형식 오류' };
      }
      if (p.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(p.vin)) {
        return { ...r, status: 'invalid', reason: 'VIN 형식 오류' };
      }
      // 중복 체크
      if (carNumSet.has(p.car_number.trim())) {
        return { ...r, status: 'duplicate', reason: `중복: ${p.car_number}` };
      }
      if (p.vin && vinSet.has(p.vin.trim())) {
        return { ...r, status: 'duplicate', reason: `중복 VIN: ${p.vin}` };
      }
      return { ...r, status: 'ok' };
    });

    list.innerHTML = staged.map((r, idx) => {
      const tone = { ok: 'green', duplicate: 'orange', invalid: 'red', error: 'red' }[r.status];
      const sym = { ok: '✓', duplicate: '⚠', invalid: '✗', error: '✗' }[r.status];
      const reasonHtml = r.reason ? `<span style="color:var(--alert-${tone}-text);">${esc(r.reason)}</span>` : '';
      const p = r.parsed || {};
      const summary = !r.error
        ? [p.car_number, p.cert_car_name, p.year && `${p.year}년`].filter(Boolean).join(' · ')
        : '';
      const enabled = r.status === 'ok';
      return `<div>
        <label style="display:flex;align-items:center;gap:6px;cursor:${enabled ? 'pointer' : 'not-allowed'};opacity:${enabled ? 1 : 0.65};">
          <input type="checkbox" data-idx="${idx}" ${enabled ? 'checked' : 'disabled'}>
          <span style="color:var(--alert-${tone}-text);font-weight:600;">${sym}</span>
          <span class="text-weak" style="min-width:120px;">${esc(r.file.name)}</span>
          <span>${esc(summary)}</span>
          ${reasonHtml}
        </label>
      </div>`;
    }).join('');
    const okCount = staged.filter(r => r.status === 'ok').length;
    const dupCount = staged.filter(r => r.status === 'duplicate').length;
    const invCount = staged.filter(r => r.status === 'invalid' || r.status === 'error').length;
    if (staged.length) {
      list.insertAdjacentHTML('afterbegin', `
        <div style="font-size:11px;color:var(--text-weak);padding:4px 0;border-bottom:1px solid var(--border-soft);margin-bottom:4px;">
          전체 ${staged.length} | <span style="color:var(--alert-green-text);">정상 ${okCount}</span> | <span style="color:var(--alert-orange-text);">중복 ${dupCount}</span> | <span style="color:var(--alert-red-text);">실패 ${invCount}</span>
        </div>
      `);
    }
    actions.style.display = okCount > 0 ? 'flex' : 'none';
    zone.classList.remove('is-uploading');
    if (textEl) textEl.textContent = origText;
    input.value = '';
  }

  commitBtn?.addEventListener('click', async () => {
    const checks = card.querySelectorAll('[data-act="vreg-list"] input[type="checkbox"]:checked');
    const targets = [...checks].map(cb => staged[Number(cb.dataset.idx)]).filter(r => r && r.status === 'ok' && r.parsed?.car_number);
    if (!targets.length) {
      showToast('등록할 매물이 없습니다', 'warn');
      return;
    }
    // 마지막 race-check — 검증 후 화면에서 대기하는 동안 다른 곳에서 등록됐을 수 있음
    const latestCarNums = new Set((store.products || []).map(p => (p.car_number || '').trim()).filter(Boolean));
    const latestVins    = new Set((store.products || []).map(p => (p.vin || '').trim()).filter(Boolean));
    const safe = targets.filter(r => {
      if (latestCarNums.has(r.parsed.car_number.trim())) return false;
      if (r.parsed.vin && latestVins.has(r.parsed.vin.trim())) return false;
      return true;
    });
    if (safe.length < targets.length) {
      const skipped = targets.length - safe.length;
      const ok = await customConfirm({
        title: '중복 감지',
        message: `${skipped}건이 등록 직전 다른 곳에서 추가됐습니다. 나머지 ${safe.length}건만 등록할까요?`,
        okLabel: `${safe.length}건 등록`,
      });
      if (!ok) return;
    }
    targets.length = 0;
    targets.push(...safe);
    if (!targets.length) {
      showToast('등록 가능한 매물이 없습니다', 'warn');
      return;
    }
    const ok = await customConfirm({
      title: '일괄 등록 확인',
      message: `${targets.length}대의 매물을 ${pa.partner_name || pa.partner_code} 공급으로 등록합니다.\n정책·대여료는 등록 후 재고관리에서 입력해주세요.`,
      okLabel: '등록',
    });
    if (!ok) return;

    commitBtn.disabled = true;
    commitBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 등록 중...';
    const { allocateManualProductUid } = await import('../firebase/collections.js');
    const code = pa.partner_code || pa.company_code || pa._key;
    let success = 0, fail = 0;
    for (const r of targets) {
      try {
        const uid = await allocateManualProductUid();
        const p = r.parsed;
        // 제조사 추론 + catalog 매칭 → maker/model/sub_model 자동 채움
        const maker = deriveMakerFromRegistration(p);
        let model = '', subModel = '';
        if (maker) {
          try {
            const match = await findCatalog(maker, p.cert_car_name, p.cert_car_name, {
              fuel_type: p.fuel_type,
              year: p.year,
              first_registration_date: p.first_registration_date,
              type_number: p.type_number,
            });
            if (match?.catalogId) {
              const cat = await loadCatalog(match.catalogId);
              if (cat) { model = cat.model || ''; subModel = cat.title || cat.sub_model || ''; }
            }
          } catch (e) { console.warn('[catalog match]', e); }
        }
        const rec = {
          _key: uid,
          product_uid: uid,
          product_code: uid,
          provider_company_code: code,
          partner_code: code,
          vehicle_status: '상품화중',
          product_type: '중고렌트',
          // 제조사 스펙 — catalog 매칭 결과 (실패 시 빈 값, 재고관리에서 수동 입력)
          maker: maker || '',
          model,
          sub_model: subModel,
          // 등록증에서 추출
          car_number: p.car_number || '',
          vin: p.vin || '',
          cert_car_name: p.cert_car_name || '',
          year: p.year || null,
          engine_cc: p.engine_cc || null,
          type_number: p.type_number || '',
          engine_type: p.engine_type || '',
          seats: p.seats || null,
          fuel_type: p.fuel_type || '',
          first_registration_date: p.first_registration_date || '',
          vehicle_class: p.vehicle_class || '',
          usage: p.usage || '',
          created_at: Date.now(),
        };
        await setRecord(`products/${uid}`, rec);
        success++;
      } catch (e) {
        console.warn('[vreg batch]', r.file.name, e);
        fail++;
      }
    }
    showToast(`${success}대 등록 완료${fail ? ` / ${fail}대 실패` : ''}`, fail ? 'warn' : 'success');
    staged = [];
    list.innerHTML = '';
    actions.style.display = 'none';
    commitBtn.disabled = false;
    commitBtn.innerHTML = '<i class="ph ph-check"></i> 일괄 등록';
    });
}

/** 파싱 결과를 폼 필드 + extras 에 주입 (빈 필드만). 채워진 필드 라벨 배열 반환. */
function applyParsedToForm(editCard, pa, parsed, formFields, extraFields) {
  const filled = [];
  for (const key of formFields) {
    const v = parsed[key];
    if (!v) continue;
    const input = editCard.querySelector(`[data-f="${key}"]`);
    if (!input) continue;
    if (input.value && input.value.trim()) continue;   // 기존 값 보존
    input.value = v;
    input.removeAttribute('readonly');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const label = input.closest('.ff')?.querySelector('label')?.textContent || key;
    filled.push(label);
  }
  // 폼에 노출 안 되는 확장 필드는 partners 레코드에 직접 patch (빈 필드만)
  const extras = {};
  for (const k of extraFields) {
    if (parsed[k] && !pa[k]) extras[k] = parsed[k];
  }
  if (Object.keys(extras).length) {
    updateRecord(`partners/${pa._key}`, extras, { silent: true })
      .then(() => Object.assign(pa, extras))
      .catch(err => console.warn('[partner ocr patch]', err));
    filled.push(...Object.keys(extras));
  }
  return filled;
}
