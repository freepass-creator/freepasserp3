/**
 * pages/contract.js — 계약 관리 페이지 (v3 ERP)
 *
 * Export:
 *   - CONTRACT_STATUSES
 *   - renderContractList, renderContractDetail
 *   - renderContractWorkV2(c) → HTML
 *   - bindContractWorkV2(stepCard, c, { reRender })  // workspace 에서 호출 시 reRender 주입
 *   - createContractFromRoomLocal(room)              // 임시 계약 생성 (workspace 에서 호출)
 *   - makeTempContractCode, allocateRealContractCode
 *
 * 분리 원칙: workspace 의존성 제거 — bindContractWorkV2 가 페이지별 재렌더 콜백을 외부 주입받음.
 */
import { store, findProduct, findProductByUid } from '../core/store.js';
import { pushRecord, updateRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { openFullscreen } from '../core/product-detail-render.js';
import { filterByRole } from '../core/roles.js';
import { STEPS as CONTRACT_STEPS_V2, getStepStates, getProgress } from '../core/contract-steps.js';
import { notifyProviderAndAdmin } from '../core/notify.js';
import { pickAgent, pickOrCreateCustomer } from '../core/dialogs.js';
import {
  esc, fmtDate, fmtTime, fmtListDate,
  listBody, emptyState, renderRoomItem, flashSaved,
  providerNameByCode, providerLabelByCode, formatMainLine, renderInfoSections, fmtMoneyMan,
} from '../core/ui-helpers.js';

export const CONTRACT_STATUSES = ['계약요청', '계약대기', '계약발송', '계약완료', '계약취소'];

/* 화면 표시용 라벨 매핑 — DB 값(계약취소)는 그대로 두고 라벨만 진행취소로
 *  (가계약 단계 취소는 정식 계약 취소가 아니므로) */
export const STATUS_LABEL = {
  '계약요청': '계약요청',
  '계약대기': '계약대기',
  '계약발송': '계약발송',
  '계약완료': '계약완료',
  '계약취소': '진행취소',
};

const STATUS_BADGE = {
  '계약요청': { txt: '요청', tone: 'blue' },
  '계약대기': { txt: '대기', tone: 'orange' },
  '계약발송': { txt: '발송', tone: 'orange' },
  '계약완료': { txt: '완료', tone: 'green' },
  '계약취소': { txt: '취소', tone: 'red' },
};

/* ── 계약 코드 포맷 통일 ──
 *  임시(가계약): TMP-YYMMDD-NN  (예: TMP-260429-01)
 *  정식(체결):   CT-YYMMDD-NN   (예: CT-260429-01)
 *  같은 포맷이라 진행취소·완료 시 prefix 만 바꿔 변환 가능 */
function todayYYMMDD() {
  const d = new Date();
  return String(d.getFullYear()).slice(-2)
       + String(d.getMonth() + 1).padStart(2, '0')
       + String(d.getDate()).padStart(2, '0');
}

export async function makeTempContractCode() {
  const dateStr = todayYYMMDD();
  const { nextSequence } = await import('../firebase/collections.js');
  const seq = await nextSequence(`contract_temp_${dateStr}`);
  return `TMP-${dateStr}-${String(seq).padStart(2, '0')}`;
}

export async function allocateRealContractCode() {
  const dateStr = todayYYMMDD();
  const { nextSequence } = await import('../firebase/collections.js');
  const seq = await nextSequence(`contract_${dateStr}`);
  return `CT-${dateStr}-${String(seq).padStart(2, '0')}`;
}

export function renderContractList(contracts) {
  const body = listBody('contract');
  if (!body) return;
  // 데이터 미로드 (undefined/null) — prototype HTML 보존 (UI 손대지 않음)
  if (!Array.isArray(contracts)) return;
  let list = contracts.filter(c => !c._deleted);
  list = filterByRole(list, store.currentUser);
  if (!list.length) { body.innerHTML = emptyState('계약이 없습니다'); renderContractDetail(null); return; }
  const sorted = [...list].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  body.innerHTML = sorted.map((c, i) => {
    const status = c.contract_status || '-';
    const sb = STATUS_BADGE[status] || { txt: status.slice(0, 2), tone: 'gray' };
    const rent = c.rent_amount_snapshot || c.monthly_rent;
    const dep = c.deposit_amount_snapshot || c.deposit;
    const term = c.rent_month_snapshot || c.contract_term;
    const rentStr = fmtMoneyMan(rent);
    const depStr  = fmtMoneyMan(dep);
    const termStr = term ? `${term}개월` : '';
    // 메인 — 계약자명 차량번호 세부모델 공급사명 (구분자 없이 문단처럼)
    const customerName = c.customer_name || '계약자미정';
    const providerName = providerNameByCode(c.provider_company_code || c.partner_code, store);
    const mainLine = [customerName, c.car_number_snapshot, c.sub_model_snapshot, providerName].filter(Boolean).join(' ');
    // 보조 — 영업채널 | 영업자 | 대여료/보증금/기간 | 진행단계
    const priceLine = [rentStr, depStr, termStr].filter(Boolean).join('/');
    const subParts = [
      c.agent_channel_code || c.agent_channel,
      c.agent_code,
      priceLine,
      status,
    ].filter(Boolean);
    // 진행단계 — 대기 / 진행 / 완료 / 취소 (아이콘 톤 통일)
    const stage = /완료/.test(status) ? 'done'
                : /취소/.test(status) ? 'cancel'
                : /(요청)/.test(status) ? 'pending'
                : 'progress';
    const stageMeta = {
      pending:  { icon: 'clock',         badge: '대기', tone: 'orange' },
      progress: { icon: 'arrow-circle-right', badge: '진행', tone: 'blue' },
      done:     { icon: 'check-circle',  badge: '완료', tone: 'green' },
      cancel:   { icon: 'x-circle',      badge: '취소', tone: 'gray' },
    }[stage];
    return renderRoomItem({
      id: c.contract_code || c._key,
      icon: stageMeta.icon,
      badge: stageMeta.badge,
      tone: stageMeta.tone,
      name: mainLine,
      time: fmtDate(c.contract_date || c.created_at),
      msg: subParts.join(' | ') || '-',
      meta: c.contract_code || '',
      active: i === 0,
    });
  }).join('');
  renderContractDetail(sorted[0]);
}

/* 계약 진행상황 + 상세 + 조건 — 우측 3개 패널 갱신 */
export function renderContractDetail(c) {
  const page = document.querySelector('.pt-page[data-page="contract"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  const [, stepCard, detailCard, condCard] = cards;

  if (!c) {
    if (stepCard) stepCard.querySelector('.ws4-body').innerHTML = emptyState('선택된 계약이 없습니다');
    if (detailCard) detailCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    if (condCard) condCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    return;
  }

  // 1. 진행상황 — 입력 중(메모 포커스)에는 재렌더 스킵해서 튕김 방지
  if (stepCard) {
    const stepBody = stepCard.querySelector('.ws4-body');
    const focused = document.activeElement;
    const isTypingInStep = focused && stepBody.contains(focused) && (focused.tagName === 'TEXTAREA' || focused.tagName === 'INPUT');
    if (!isTypingInStep) {
      stepBody.innerHTML = renderContractWorkV2(c);
      bindContractWorkV2(stepCard, c, { reRender: () => renderContractDetail(c) });
    }
  }

  // 2. 계약 상세 — 4개 섹션 (계약자 / 차량 / 대여조건 / 관계자)
  if (detailCard) {
    const termN = c.rent_month_snapshot || c.contract_term;
    const rentN = c.rent_amount_snapshot || c.monthly_rent;
    const depN = c.deposit_amount_snapshot || c.deposit;

    // 같은 customer_uid 의 다른 계약 카운트 (재계약 표시용)
    const sameCustomerCount = c.customer_uid
      ? (store.contracts || []).filter(x => x.customer_uid === c.customer_uid && x._key !== c._key && !x._deleted).length
      : 0;
    const customerLabel = sameCustomerCount > 0
      ? `${c.customer_name || ''} | 다른계약 ${sameCustomerCount}건`
      : (c.customer_name || '');

    // 1) 계약자 정보
    const customerRows = [
      ['계약자', customerLabel],
      ['생년월일', c.customer_birth],
      ['연락처', c.customer_phone],
      ['사업자', c.customer_is_business ? '예' : ''],
      ['사업자번호', c.customer_business_number],
      ['법인/상호명', c.customer_company_name],
      ['배송지', c.delivery_region],
    ].filter(([, v]) => v);

    // 2) 차량 정보 — 차량명은 모델·세부모델 중복 가능성 있어 한 줄에 합쳐서 표시
    const vehicleLine = [c.maker_snapshot, c.model_snapshot, c.sub_model_snapshot].filter(Boolean).join(' ');
    const carRows = [
      ['차량번호', c.car_number_snapshot],
      ['차량명', vehicleLine || c.vehicle_name_snapshot],
      ['연식', c.year_snapshot ? c.year_snapshot + '년' : ''],
      ['연료', c.fuel_type_snapshot],
      ['색상', c.ext_color_snapshot],
    ].filter(([, v]) => v);

    // 3) 대여 조건 정보
    const rentRows = [
      ['대여기간', termN ? termN + '개월' : ''],
      ['월대여료', fmtMoneyMan(rentN, '만원')],
      ['보증금', fmtMoneyMan(depN, '만원')],
      ['계약일', fmtDate(c.contract_date)],
      ['심사기준', c.credit_grade_snapshot],
      ['정책명', c.policy_name_snapshot],
    ].filter(([, v]) => v);

    // 4) 관계자 정보 — 공급사는 "회사명 (코드)" 같이 표시 (사용자 요청)
    const providerLabel = providerLabelByCode(c.provider_company_code || c.partner_code, store);
    const partyRows = [
      ['공급사', providerLabel || c.provider_company_code],
      ['영업채널', c.agent_channel_code],
      ['영업자', c.agent_code],
      ['정책코드', c.policy_code],
      ['계약코드', c.contract_code + (c.is_draft ? ' (임시)' : '')],
    ].filter(([, v]) => v);

    // 공용 헬퍼 — sections 스펙으로 form-section-title + info-grid 통합 렌더
    detailCard.querySelector('.ws4-body').innerHTML = renderInfoSections([
      { icon: 'user',         label: '계약자 정보',  rows: customerRows },
      { icon: 'car-simple',   label: '차량 정보',    rows: carRows },
      { icon: 'currency-krw', label: '대여조건 정보', rows: rentRows },
      { icon: 'users',        label: '관계자 정보',  rows: partyRows },
    ]);
  }

  // 3. 첨부 서류 (면허증·신분증·통장사본·재직·사업자등록증 등)
  if (condCard) {
    renderContractDocs(condCard, c, { readOnly: true });
  }
}

export function renderContractDocs(card, c, opts = {}) {
  const role = store.currentUser?.role;
  const canEdit = !opts.readOnly && (role === 'admin' || role === 'agent' || role === 'agent_admin' || role === 'provider');
  const body = card.querySelector('.ws4-body');

  // 기존 서류 섹션 제거 후 재생성 (body 전체를 덮어쓰지 않음)
  body.querySelector('.ct-docs-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'ct-docs-wrap';
  body.appendChild(wrap);

  // 면허증 — PC(doc_license) 우선, 모바일(customer_license_url) fallback
  const license = c.doc_license || c.customer_license_url || '';
  const licenseEditable = !!c.doc_license;

  // 첨부서류 — PC 배열(doc_attachments) + 모바일 객체(customer_docs) 통합
  const _extractUrl = v => { while (v && typeof v === 'object') v = v.url || v[Object.keys(v)[0]]; return typeof v === 'string' ? v : ''; };
  const _toArray = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : v ? [v] : []);
  const docAtts = _toArray(c.doc_attachments).map(_extractUrl).filter(Boolean);
  console.log('[docs-render] raw:', c.doc_attachments, 'parsed:', docAtts);
  const mobileDocs = c.customer_docs
    ? Object.values(c.customer_docs).filter(d => d && !d._deleted && d.url)
    : [];
  const attachments = [
    ...docAtts.map((url, i) => ({ url, deletable: canEdit, docIndex: i })),
    ...mobileDocs.map(d => ({ url: d.url, name: d.name, deletable: false })),
  ];
  const isPdf = (u) => u && /\.pdf(\?|$)/i.test(u);

  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;padding:8px;">
      <!-- 1. 운전면허증 — 한 장 큰 미리보기 + OCR -->
      <div style="border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--bg-card);">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${license ? 'var(--alert-green-bg)' : 'var(--bg-stripe)'};border-bottom:1px solid var(--border);">
          <i class="ph ph-identification-card" style="font-size:14px;color:${license ? 'var(--alert-green-text)' : 'var(--text-sub)'};"></i>
          <span style="flex:1;font-size:12px;font-weight:500;">운전면허증 <span style="color:var(--alert-red-text);">*</span></span>
          ${license ? '<span style="font-size:10px;color:var(--alert-green-text);">제출됨</span>' : '<span style="font-size:10px;color:var(--text-muted);">미제출</span>'}
          ${license && canEdit && licenseEditable ? `
            <button class="btn" style="height:22px;padding:0 8px;font-size:11px;color:var(--alert-red-text);" id="ctLicenseDel"><i class="ph ph-x"></i></button>
          ` : ''}
        </div>
        ${license ? `
          <div style="padding:8px;display:flex;justify-content:center;background:var(--bg-stripe);">
            ${isPdf(license)
              ? `<a href="${esc(license)}" target="_blank" style="display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:var(--text-link);text-decoration:none;padding:32px;"><i class="ph ph-file-pdf" style="font-size:48px;"></i><span>PDF 보기</span></a>`
              : `<img src="${esc(license)}" style="max-width:100%;max-height:280px;border-radius:4px;cursor:zoom-in;display:block;" data-doc-img="${esc(license)}">`}
          </div>
        ` : (canEdit ? `
          <label class="pd-dropzone" for="ctLicenseUpload" style="margin:8px;">
            <i class="ph ph-identification-card"></i>
            <div class="pd-dropzone-text">면허증을 끌어놓거나 클릭해서 업로드</div>
            <div class="pd-dropzone-hint">이미지(JPG/PNG) 또는 PDF | 자동 OCR</div>
            <input type="file" id="ctLicenseUpload" hidden accept="image/*,application/pdf">
          </label>
        ` : '<div style="padding:16px;font-size:11px;color:var(--text-muted);text-align:center;">미제출</div>')}
      </div>

      <!-- 2. 첨부 서류 — 썸네일 그리드 -->
      <div style="border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--bg-card);">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-stripe);border-bottom:1px solid var(--border);">
          <i class="ph ph-paperclip" style="font-size:14px;color:var(--text-sub);"></i>
          <span style="flex:1;font-size:12px;font-weight:500;">첨부 서류</span>
          <span style="font-size:10px;color:var(--text-muted);">${attachments.length}개</span>
          ${canEdit && attachments.length ? `
            <label style="height:22px;padding:0 8px;font-size:11px;border:1px solid var(--border);border-radius:2px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;background:var(--bg-card);">
              <i class="ph ph-plus"></i> 추가
              <input type="file" hidden accept="image/*,application/pdf" multiple class="ctAttUploadAdd">
            </label>
          ` : ''}
        </div>
        <div style="padding:8px;">
          ${attachments.length ? `
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:6px;">
              ${attachments.map((att, i) => `
                <div style="position:relative;aspect-ratio:1/1;border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--bg-stripe);">
                  ${isPdf(att.url)
                    ? `<a href="${esc(att.url)}" target="_blank" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--alert-red-text);text-decoration:none;font-size:9px;gap:2px;"><i class="ph ph-file-pdf" style="font-size:24px;"></i><span>PDF</span></a>`
                    : `<img src="${esc(att.url)}" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in;display:block;" data-doc-img="${esc(att.url)}">`}
                  ${att.deletable ? `<button data-att-del="${att.docIndex}" style="position:absolute;top:2px;right:2px;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;"><i class="ph ph-x"></i></button>` : ''}
                  <span style="position:absolute;bottom:2px;left:2px;background:rgba(0,0,0,0.6);color:#fff;font-size:9px;padding:1px 4px;border-radius:2px;">${i + 1}</span>
                </div>
              `).join('')}
              ${canEdit ? `
                <label style="aspect-ratio:1/1;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:10px;border:1px dashed var(--border);border-radius:4px;gap:2px;">
                  <i class="ph ph-plus" style="font-size:18px;"></i>
                  <span>추가</span>
                  <input type="file" hidden accept="image/*,application/pdf" multiple class="ctAttUploadAdd">
                </label>
              ` : ''}
            </div>
          ` : (canEdit ? `
            <label class="pd-dropzone">
              <i class="ph ph-paperclip"></i>
              <div class="pd-dropzone-text">첨부 서류를 끌어놓거나 클릭해서 업로드</div>
              <div class="pd-dropzone-hint">이미지(JPG/PNG) 또는 PDF | 여러 개 가능</div>
              <input type="file" hidden accept="image/*,application/pdf" multiple class="ctAttUploadAdd">
            </label>
          ` : '<div style="padding:16px;font-size:11px;color:var(--text-muted);text-align:center;">첨부된 서류 없음</div>')}
        </div>
      </div>
    </div>
  `;

  // 이미지 클릭 → 풀스크린 (모든 역할 — readOnly 포함)
  const allDocImgs = [...wrap.querySelectorAll('[data-doc-img]')].map(el => el.dataset.docImg);
  wrap.querySelectorAll('[data-doc-img]').forEach(img => {
    img.addEventListener('click', () => {
      const startIdx = allDocImgs.indexOf(img.dataset.docImg);
      openFullscreen(allDocImgs, Math.max(0, startIdx));
    });
  });

  if (!canEdit) return;

  // 면허증 업로드 + 자동 OCR — 차량등록증과 동일한 UX (업로드 = 자동 분석)
  wrap.querySelector('#ctLicenseUpload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      showToast('면허증 업로드 중...', 'info');
      const { uploadImage, uploadFile } = await import('../firebase/storage-helper.js');
      const isImage = file.type?.startsWith('image/');
      const path = `contract-files/${c._key}/license_${Date.now()}_${file.name}`;
      const { url } = isImage ? await uploadImage(path, file) : await uploadFile(path, file);
      await updateRecord(`contracts/${c._key}`, { doc_license: url, updated_at: Date.now() });
      c.doc_license = url;
      showToast('면허증 업로드 완료', 'success');
      renderContractDocs(card, c, opts);

      // 자동 OCR — 이미지·PDF 모두 ocrFile 로 텍스트 추출 후 driver-license 파서로 필드 매핑
      try {
        showToast('OCR 분석 중...', 'info');
        const { ocrFile } = await import('../core/ocr.js');
        const { parseDriverLicense } = await import('../core/ocr-parsers/driver-license.js');
        const { text } = await ocrFile(file);
        if (!text || text.length < 20) { showToast('OCR 텍스트 부족 — 수동 입력', 'info'); return; }
        const parsed = parseDriverLicense(text);
        // 빈 필드 제거 (병합 시 기존 값 보존)
        for (const k of Object.keys(parsed)) if (!parsed[k]) delete parsed[k];
        if (Object.keys(parsed).length) {
          // 기존 계약자 정보가 있으면 보존, 빈 칸만 자동 채움
          const merged = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (!c[k]) merged[k] = v;     // 비어있을 때만 채움
          }
          if (Object.keys(merged).length) {
            await updateRecord(`contracts/${c._key}`, { ...merged, doc_license_ocr_text: text, updated_at: Date.now() });
            Object.assign(c, merged);
            c.doc_license_ocr_text = text;
            showToast(`OCR: ${Object.keys(merged).length}개 필드 자동 채움`, 'success');
            renderContractDocs(card, c, opts);
          } else {
            await updateRecord(`contracts/${c._key}`, { doc_license_ocr_text: text, updated_at: Date.now() });
            showToast('OCR 완료 (모든 필드 이미 입력됨)', 'info');
          }
        } else {
          showToast('OCR 결과 없음 — 수동 입력해주세요', 'info');
        }
      } catch (ocrErr) {
        console.warn('[license OCR]', ocrErr);
        showToast('OCR 실패 — 수동 입력', 'info');
      }
    } catch (err) {
      console.error('[license upload]', err);
      showToast('업로드 실패: ' + (err.message || err), 'error');
    }
  });

  // 면허증 삭제
  wrap.querySelector('#ctLicenseDel')?.addEventListener('click', async () => {
    if (!confirm('면허증을 제거할까요?')) return;
    await updateRecord(`contracts/${c._key}`, { doc_license: null, updated_at: Date.now() });
    c.doc_license = null;
    showToast('면허증 제거됨');
    renderContractDocs(card, c, opts);
  });

  // 첨부서류 다중 업로드 — 이미지/PDF 분기 (v2 패턴). 빈 상태/추가 입력 모두 동일 핸들러
  wrap.querySelectorAll('input.ctAttUploadAdd').forEach(input => {
    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      try {
        showToast(`${files.length}개 파일 업로드 중...`, 'info');
        const { uploadImage, uploadFile } = await import('../firebase/storage-helper.js');
        const newUrls = [];
        for (const file of files) {
          const isImage = file.type?.startsWith('image/');
          const path = `contract-files/${c._key}/att_${Date.now()}_${file.name}`;
          const { url } = isImage ? await uploadImage(path, file) : await uploadFile(path, file);
          console.log('[doc-upload]', file.name, 'type:', file.type, 'isImage:', isImage, 'url:', url);
          newUrls.push(url);
        }
        const next = [..._toArray(c.doc_attachments).map(_extractUrl).filter(Boolean), ...newUrls];
        await updateRecord(`contracts/${c._key}`, { doc_attachments: next, updated_at: Date.now() });
        c.doc_attachments = next;
        showToast(`${newUrls.length}개 업로드 완료`, 'success');
        renderContractDocs(card, c, opts);
      } catch (err) {
        console.error('[att upload]', err);
        showToast('업로드 실패: ' + (err.message || err), 'error');
      }
    });
  });

  // 첨부서류 개별 삭제 (PC 업로드분만 — docIndex 기반)
  wrap.querySelectorAll('[data-att-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.attDel);
      if (!confirm('첨부 서류를 제거할까요?')) return;
      const cur = _toArray(c.doc_attachments).map(_extractUrl).filter(Boolean);
      cur.splice(idx, 1);
      await updateRecord(`contracts/${c._key}`, { doc_attachments: cur, updated_at: Date.now() });
      c.doc_attachments = cur;
      showToast('제거됨');
      renderContractDocs(card, c, opts);
    });
  });

}

/* v2 contract.js renderWork 동등 — 진행 단계 + 클릭 + 드롭다운 + 취소/완료 + 메모 */
export function renderContractWorkV2(c) {
  if (!c) return emptyState('계약 데이터 없음');
  const status = c.contract_status || '계약요청';
  const isCancelled = status === '계약취소';
  const isCompleted = status === '계약완료';
  const role = store.currentUser?.role || 'agent';
  const isAdmin = role === 'admin';
  const states = getStepStates(c);
  const prog = getProgress(c);

  // 계약완료 상태에서는 모든 단계의 체크박스가 체크된 채로 보이도록 강제 (UI 표시 전용).
  //   - 데이터상 일부 sub-check 가 비어있는 마이그레이션 케이스도 시각적 일관성 유지
  //   - rejected 셀은 그대로 X 표시 유지
  if (isCompleted) {
    for (const stId of Object.keys(states)) {
      const st = states[stId];
      st.locked = false;
      if (!st.rejected) {
        st.done = true;
        for (const ss of st.subStates) {
          if (!ss.rejected) ss.done = true;
        }
      }
    }
  }

  // 4단계 — 한 줄 = 영업자 | → | 공급사 (7단계 시절 레이아웃, 4줄로 축소)
  // 정책:
  //   - 활성 단계 (locked X / done X): 본인 액터 = 편집 모드 안 들어가도 즉시 입력 가능
  //   - 한 번 done 처리된 셀: 본인은 못 풀고 admin 만 원복/변경 가능 ("관리자에게 요청")
  //   - rejected/auto 단계: 누구도 변경 불가 (rejected 는 admin 도 X — 실수 복구는 별도 정책)
  const renderCell = (sub, st) => {
    const c2 = sub.choices;
    const isOwner = (sub.actor === 'agent'    && (role === 'agent' || role === 'agent_admin'))
                 || (sub.actor === 'provider' && role === 'provider')
                 || (sub.actor === 'admin'    && role === 'admin')
                 || (sub.paymentShared && (role === 'provider' || role === 'agent' || role === 'agent_admin'));
    const canClick = isAdmin || isOwner;
    // 본인은 done 셀 못 건드림. admin 만 원복 허용.
    const canEdit = canClick && !st.locked && !sub.rejected && !sub.auto
                    && (!sub.done || isAdmin);
    const cls = sub.rejected ? 'rejected' : sub.done ? 'done' : st.locked ? 'locked' : 'pending';
    // 체크박스 형태 — phosphor regular weight (fill weight 미로드)
    const icon = sub.rejected ? 'ph-x-square' : sub.done ? 'ph-check-square' : 'ph-square';
    const display = sub.choice && sub.choice !== 'yes' && sub.choice !== true ? sub.choice : sub.label;
    const adminBy = c[sub.key + '_by'] === 'admin' ? '<span class="ct-step-admin">관리자</span>' : '';
    // admin 이 done 셀을 풀 수 있을 때 — 시각적으로 "취소 가능" 표시 (title 툴팁)
    const adminUndoTitle = (isAdmin && sub.done) ? ' title="관리자: 다시 클릭하면 원복"' : '';
    return `
      <div class="ct-step-cell ${cls}${canEdit && !c2 ? ' clickable' : ''}" data-key="${esc(sub.key)}"${adminUndoTitle}>
        <i class="ph ${icon}"></i>
        ${c2 && canEdit ? `<select class="ct-step-select" data-key="${esc(sub.key)}">
          <option value="">${esc(sub.label)}</option>
          ${c2.map(ch => `<option value="${esc(ch)}" ${sub.choice === ch ? 'selected' : ''}>${esc(ch)}</option>`).join('')}
        </select>` : `<span>${esc(display)}</span>`}
        ${adminBy}
      </div>
    `;
  };

  const stepRow = (step, idx) => {
    const st = states[step.id] || {};
    const subs = st.subStates || [];
    const agentSub = subs.find(s => s.actor === 'agent');
    const respSub = subs.find(s => s.actor === 'provider' || s.actor === 'admin');
    if (!agentSub || !respSub) return '';
    const arrowCls = st.rejected ? 'is-rejected' : st.done ? 'is-done' : '';
    return `
      <div class="ct-step-row">
        ${renderCell(agentSub, st)}
        <div class="ct-step-arrow ${arrowCls}"><i class="ph ph-caret-right"></i></div>
        ${renderCell(respSub, st)}
      </div>
    `;
  };

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:12px;">
        <b style="color:var(--text-main);">${esc(c.contract_code || '-')}</b>
        ${c.customer_name ? ' | ' + esc(c.customer_name) : ''}
        <span style="margin-left:6px;color:var(--text-sub);">${esc(STATUS_LABEL[status] || status)}</span>
      </div>
      <span style="font-size:12px;color:${prog.done === prog.total ? 'var(--alert-green-text)' : 'var(--alert-blue-text)'};">${prog.done}/${prog.total}</span>
    </div>
    <div class="ct-steps">
      <div class="ct-step-row ct-step-head">
        <div>영업</div>
        <div></div>
        <div>공급·관리</div>
      </div>
      ${CONTRACT_STEPS_V2.map(stepRow).join('')}
    </div>

    <!-- 취소/완료 상태 — 모두 동일 정렬 (display:flex + justify-content:center). 디스플레이/버튼 모두 통일 -->
    <div style="margin-top:10px;">
      ${isCancelled
        ? `<div style="color:var(--alert-red-text);padding:6px;display:flex;align-items:center;justify-content:center;gap:4px;"><i class="ph ph-prohibit"></i>진행 취소됨</div>`
        : isCompleted
          ? `<div style="color:var(--alert-green-text);padding:6px;display:flex;align-items:center;justify-content:center;gap:4px;"><i class="ph ph-check-circle"></i>계약 완료</div>`
          : `<button class="btn btn-sm" id="ctCancelBtn" style="width:100%;color:var(--alert-red-text);justify-content:center;"><i class="ph ph-prohibit"></i>진행 취소</button>
             ${prog.done === prog.total ? `<button class="btn btn-sm btn-primary" id="ctCompleteBtn" style="width:100%;margin-top:4px;justify-content:center;"><i class="ph ph-check-circle"></i>계약 완료</button>` : ''}`
      }
    </div>

    <!-- 진행 메모 (영업/공급/관리) — 역할별 권한:
         agent / agent_admin → agent_memo 만 편집
         provider → provider_memo 만 편집
         admin → 전부 편집 가능
         그 외 readonly (permanent-lock) -->
    <div style="margin-top:12px;color:var(--text-sub);margin-bottom:6px;font-size:12px;font-weight:500;"><i class="ph ph-note"></i> 진행 메모</div>
    <div class="info-grid" style="grid-template-columns: 60px 1fr; gap: 6px;">
      ${(() => {
        const memoRow = (label, field, ownerRoles) => {
          const canEditMemo = isAdmin || ownerRoles.includes(role);
          const lockAttr = canEditMemo
            ? ' readonly data-edit-lock="1"'              // 본인 역할 → 2-click 후 편집
            : ' readonly data-permanent-lock="1"';        // 다른 역할 → 영구 잠금 (보기만)
          return `<div class="lab">${label}</div>
            <textarea class="input" data-memo="${field}" rows="2" placeholder="-"${lockAttr}>${esc(c[field] || '')}</textarea>`;
        };
        return memoRow('영업', 'agent_memo', ['agent', 'agent_admin'])
             + memoRow('공급', 'provider_memo', ['provider'])
             + memoRow('관리', 'admin_memo', []);    // admin 만 (위 isAdmin 체크에서 통과)
      })()}
    </div>
  `;
}

/* 단계별 알림 매핑 — 출고 문의만 공급사·관리자에 알림톡 발송. 그 외 단계는 무알림. */
const STEP_NOTIFY = {
  agent_delivery_inquiry: { subject: '출고 문의', tmpl: 'new_inquiry', text: '출고 문의가 도착했습니다.' },
};

/* renderContractWorkV2 의 클릭/드롭다운/메모/취소·완료 이벤트 바인딩
 *  options.reRender — 호출자가 자기 페이지 재렌더 함수 주입 (workspace / contract 양쪽 호환) */
export function bindContractWorkV2(stepCard, c, options = {}) {
  if (!c?._key || !c?.contract_code) return;   // _key=Firebase 자동키(저장 경로), contract_code=찾기용 코드
  const role = store.currentUser?.role || 'agent';
  const isAdmin = role === 'admin';
  const reRender = options.reRender || (() => renderContractDetail(c));

  // 단계 셀 클릭 (단순 체크 토글) — 영업측 단계 ON 시 공급사·관리자에 알림톡
  stepCard.querySelectorAll('.ct-step-cell.clickable, .ct-substep-cell.clickable').forEach(cell => {
    cell.addEventListener('click', async () => {
      const key = cell.dataset.key;
      if (!key) return;
      const cur = c[key] === true || c[key] === 'yes';
      const next = !cur;
      const update = { [key]: next };
      if (isAdmin) update[`${key}_by`] = next ? 'admin' : '';
      try {
        await updateRecord(`contracts/${c._key}`, update);
        c[key] = next;
        reRender();
        // 영업 측 단계 활성화(true) 시 공급사·관리자에 알림톡
        if (next && STEP_NOTIFY[key]) {
          const n = STEP_NOTIFY[key];
          const car = c.car_number_snapshot || '';
          const customer = c.customer_name || '';
          notifyProviderAndAdmin({
            template: n.tmpl,
            providerCode: c.provider_company_code,
            subject: n.subject,
            message: `[Freepass]\n${car} ${customer ? customer + ' ' : ''}${n.text}\n계약: ${c.contract_code || ''}`,
          }).catch(() => null);
        }
      } catch (e) { alert('저장 실패: ' + (e.message || e)); }
    });
  });

  // 드롭다운 (출고 가능/협의/불가, 서류 승인/부결)
  stepCard.querySelectorAll('.ct-step-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const key = sel.dataset.key;
      const val = sel.value;
      const update = { [key]: val };
      if (isAdmin) update[`${key}_by`] = val ? 'admin' : '';
      try {
        await updateRecord(`contracts/${c._key}`, update);
        c[key] = val;
        reRender();
      } catch (e) { alert('저장 실패: ' + (e.message || e)); }
    });
  });

  // 메모 일괄 저장 — 역할 권한 없는 textarea(permanent-lock)는 스킵.
  //  blur 시 자동저장 X, [저장] 버튼이 stepCard.__flushSave() 호출 시 일괄 저장.
  const memoTracked = [];
  stepCard.querySelectorAll('textarea[data-memo]').forEach(ta => {
    if (ta.dataset.permanentLock === '1') return;
    let original = ta.value;
    memoTracked.push({ ta, field: ta.dataset.memo, getOriginal: () => original, setOriginal: v => { original = v; } });
  });
  if (memoTracked.length) {
    stepCard.dataset.flushHost = '1';
    stepCard.__flushSave = async () => {
      const patch = {};
      const flashEls = [];
      for (const m of memoTracked) {
        if (m.ta.value === m.getOriginal()) continue;
        patch[m.field] = m.ta.value;
        flashEls.push(m.ta);
      }
      if (!Object.keys(patch).length) return 0;
      try {
        patch.updated_at = Date.now();
        await updateRecord(`contracts/${c._key}`, patch);
        for (const m of memoTracked) { c[m.field] = m.ta.value; m.setOriginal(m.ta.value); }
        flashSaved(flashEls);
        return 1;
      } catch (e) { console.error('[contract memo] save fail', e); return 0; }
    };
  }

  // 진행 취소 (가계약 단계 — 정식 계약 전)
  stepCard.querySelector('#ctCancelBtn')?.addEventListener('click', async () => {
    if (!confirm('진행 중인 계약을 취소하시겠습니까?\n차량 상태도 함께 복구됩니다.')) return;
    try {
      await updateRecord(`contracts/${c._key}`, {
        contract_status: '계약취소',
        cancelled_at: Date.now(),
        cancelled_by: store.currentUser?.uid,
      });
      // 차량 상태 복구 — 같은 차량의 다른 활성 계약 없으면 '출고가능'으로
      if (c.product_uid) {
        const others = (store.contracts || []).filter(x =>
          x._key !== c._key && x.product_uid === c.product_uid && !x._deleted &&
          (x.contract_status === '계약요청' || x.contract_status === '계약대기' || x.contract_status === '계약발송')
        );
        if (!others.length) {
          await updateRecord(`products/${c.product_uid}`, { vehicle_status: '출고가능', updated_at: Date.now() });
        }
      }
      showToast('진행 취소됨', 'info');
    } catch (e) { showToast('취소 실패: ' + (e.message || e), 'error'); }
  });

  // 계약 완료 — 임시 코드 → 정식 코드 promote, 같은 차량의 다른 완료 계약 차단
  stepCard.querySelector('#ctCompleteBtn')?.addEventListener('click', async () => {
    if (c.product_uid) {
      const alreadyDone = (store.contracts || []).find(x =>
        x._key !== c._key && x.product_uid === c.product_uid &&
        x.contract_status === '계약완료' && !x._deleted
      );
      if (alreadyDone) {
        return showToast(`이미 완료된 계약이 있습니다 | ${alreadyDone.contract_code}`, 'error');
      }
    }
    if (!confirm('계약을 완료 처리하시겠습니까?')) return;
    try {
      const oldCode = c.contract_code;
      const newCode = await allocateRealContractCode();
      await updateRecord(`contracts/${c._key}`, {
        contract_code: newCode,
        is_draft: false,
        contract_status: '계약완료',
        completed_at: Date.now(),
        completed_by: store.currentUser?.uid,
      });
      if (c.product_uid) {
        await updateRecord(`products/${c.product_uid}`, {
          vehicle_status: '출고불가', updated_at: Date.now(),
        });
      }
      const linkedRoom = (store.rooms || []).find(r => r.linked_contract === oldCode);
      if (linkedRoom) {
        await updateRecord(`rooms/${linkedRoom._key}`, { linked_contract: newCode });
      }
      const product = findProduct(c.product_uid) || findProductByUid(c.product_uid);
      notifyProviderAndAdmin({
        template: 'contract_done',
        providerCode: c.provider_company_code,
        subject: '계약 체결',
        message: `[Freepass]\n${product?.car_number || c.car_number_snapshot || ''} ${c.customer_name || ''} 계약이 체결됐습니다 (${newCode}).`,
      }).catch(() => null);
      showToast(`계약 완료 | ${newCode}`, 'success');
    } catch (e) {
      console.error('[contract complete]', e);
      showToast('완료 실패: ' + (e.message || e), 'error');
    }
  });
}

/* 룸에서 계약 생성 — 권한별 영업자 배정 분기 + 임시 코드 + 차량상태 + 알림
 *  - 영업자(agent/agent_admin) 본인이 만들면 → 본인 자동 배정
 *  - 관리자(admin)가 만들면 → pickAgent 다이얼로그 → 선택된 영업자 배정 */
export async function createContractFromRoomLocal(room) {
  if (!room) return;
  const me = store.currentUser;
  if (!me) return;
  if (!(me.role === 'agent' || me.role === 'agent_admin' || me.role === 'admin')) {
    showToast('계약 생성 권한이 없습니다', 'error');
    return;
  }

  // 영업자 결정
  let agent;
  if (me.role === 'admin') {
    agent = await pickAgent();
    if (!agent) return;
  } else {
    agent = me;
  }

  // 계약자(고객) 결정
  const customer = await pickOrCreateCustomer();
  if (!customer) return;

  const product = (store.products || []).find(p => p._key === room.product_uid || p.car_number === (room.vehicle_number || room.car_number));
  const code = await makeTempContractCode();
  try {
    // 신규 고객이면 customers 에 먼저 저장해 key 확보 (search.js 와 동일 — 없으면 customer_uid undefined 로 set 실패)
    let customerKey = customer._key;
    if (!customer._existing) {
      customerKey = await pushRecord('customers', {
        name: customer.name,
        phone: customer.phone,
        birth: customer.birth || '',
        is_business: !!customer.is_business,
        business_number: customer.business_number || '',
        company_name: customer.company_name || '',
        created_by: me.uid,
      });
    }
    await pushRecord('contracts', {
      contract_code: code,
      is_draft: true,
      product_uid: room.product_uid,
      product_code: product?.product_code,
      // 차량 snapshot
      car_number_snapshot: product?.car_number || room.vehicle_number,
      maker_snapshot: product?.maker || room.maker,
      model_snapshot: product?.model || room.model,
      sub_model_snapshot: product?.sub_model || room.sub_model,
      vehicle_name_snapshot: product ? `${product.maker || ''} ${product.sub_model || product.model || ''}`.trim() : '',
      year_snapshot: product?.year,
      fuel_type_snapshot: product?.fuel_type,
      ext_color_snapshot: product?.ext_color,
      // 계약자 참조 + snapshot
      customer_uid: customerKey,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_birth: customer.birth || '',
      customer_is_business: !!customer.is_business,
      // 관계자
      agent_uid: agent.uid || agent._key,
      agent_code: agent.user_code,
      agent_name: agent.name,
      agent_channel_code: agent.agent_channel_code || agent.channel_code,
      provider_company_code: room.provider_company_code || product?.provider_company_code,
      provider_uid: room.provider_uid,
      // 정책 snapshot
      policy_code: product?.policy_code,
      policy_name_snapshot: product?._policy?.policy_name,
      credit_grade_snapshot: product?._policy?.credit_grade,
      // 메타
      contract_status: '계약요청',
      contract_date: new Date().toISOString().slice(0, 10),
      created_at: Date.now(),
      created_by: me.uid,
    });
    await updateRecord(`rooms/${room._key}`, { linked_contract: code });
    if (product?._key) {
      // 차량 상태 자동 전환 — 임시 계약 생성 시 '출고협의' (이미 출고불가면 유지)
      const vsUpdate = (product.vehicle_status === '출고불가') ? {} : { vehicle_status: '출고협의' };
      await updateRecord(`products/${product._key}`, {
        ...vsUpdate,
        assigned_agent_uid: agent.uid || agent._key,
        assigned_agent_code: agent.user_code,
        assigned_agent_name: agent.name,
        assigned_at: Date.now(),
        updated_at: Date.now(),
      });
    }
    // 알림 — 공급사 + 관리자에게 신규 계약 알림
    notifyProviderAndAdmin({
      template: 'new_inquiry',
      providerCode: product?.provider_company_code,
      subject: '신규 계약 생성',
      message: `[Freepass]\n${agent.name || '영업자'}님이 ${product?.car_number || ''} ${product?.maker || ''} ${product?.sub_model || product?.model || ''} 계약(${code})을 생성했습니다.`,
    }).catch(() => null);

    showToast(`계약 생성됨 | ${agent.name || agent.user_code} 배정 | ${code}`, 'success');
  } catch (e) {
    console.error('[contract create]', e);
    showToast('계약 생성 실패 — ' + (e.message || e), 'error');
  }
}
