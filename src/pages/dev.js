/**
 * pages/dev.js — 개발도구 (admin 전용)
 *
 * v2 admin/dev.js 의 8개 탭 기능 포팅:
 *  vehicle / notice / color / data / upload / sync / stock / tools
 *
 * v3 페이지 컨테이너(.pt-page[data-page="dev"]) 안에 마운트.
 */
import { store } from '../core/store.js';
import { watchRecord, updateRecord, softDelete, setRecord, fetchCollection } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { customConfirm } from '../core/confirm.js';
import { withLoading, setLoadingMessage } from '../core/loading.js';
import { esc, emptyState, renderRoomItem } from './../core/ui-helpers.js';
import { analyzeProduct, loadIndex, clearCache as clearMatrixCache } from '../core/vehicle-matrix.js';
import { fpIdsToNames } from '../core/fp-options-master.js';
import { isSystemAdmin } from '../core/admin-access.js';
import { parseTrim, buildMasterTree, masterTreeStats } from '../core/vehicle-master-tree.js';
import { renderMasterCascade } from '../core/master-cascade.js';

let devUnsubs = [];
let _activeDev = 'tools';

const DEV_TABS = [
  { id: 'matrix',  icon: 'list-magnifying-glass', label: '차종 매트릭스', sub: '카탈로그 ↔ 매물 매핑' },
  { id: 'vehicle', icon: 'car-profile',     label: '차종 마스터', sub: '제조사·모델·세부모델' },
  { id: 'color',   icon: 'palette',         label: '색상 옵션',   sub: '외장·내장 색상' },
  { id: 'data',    icon: 'database',        label: 'RTDB 현황',   sub: '컬렉션 viewer' },
  { id: 'upload',  icon: 'upload-simple',   label: '일괄 업로드', sub: 'CSV / Excel' },
  { id: 'stock',   icon: 'trash',           label: '데이터 삭제', sub: '재고 일괄 삭제' },
  { id: 'tools',   icon: 'wrench',          label: '시스템 도구', sub: '캐시·마이그레이션' },
];

const devLog = (msg) => {
  const el = document.getElementById('devLog');
  if (!el) return;
  el.textContent += `[${new Date().toLocaleTimeString('ko')}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
};

function ffv(label, value) {
  return `<div class="ff" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
    <label style="width:70px;color:var(--text-muted);font-size:12px;">${esc(label)}</label>
    <input class="input" value="${esc(value || '-')}" readonly style="flex:1;">
  </div>`;
}

export function renderDev() {
  const page = document.querySelector('.pt-page[data-page="dev"]');
  if (!page) return;
  const me = store.currentUser || {};
  if (!isSystemAdmin(me)) {
    page.innerHTML = `<div style="padding: var(--sp-6); color: var(--text-muted); text-align: center;">시스템 관리자만 접근 가능합니다.</div>`;
    return;
  }
  const active = DEV_TABS.find(t => t.id === _activeDev);
  // 차종 마스터 / RTDB 현황 / 데이터 삭제 — 본문이 list+detail 형태라 우측을 detail 로 사용 (로그 패널 숨김)
  const isWideTab = _activeDev === 'vehicle';
  page.innerHTML = `
    <div class="ws4">
      <!-- 좌 (1): 도구 목록 — 다른 페이지 목록과 동일 .room-item 규격 (간격 없이 딱 붙음) -->
      <div class="ws4-card ws4-list" style="flex: 1 1 0;">
        <div class="ws4-head"><span>개발도구</span></div>
        <div class="ws4-body no-pad">
          ${DEV_TABS.map(t => renderRoomItem({
            id: t.id,
            icon: t.icon,
            badge: '',
            tone: 'gray',
            name: t.label,
            time: '',
            msg: t.sub,
            meta: '',
            active: t.id === _activeDev,
          })).join('')}
        </div>
      </div>

      <!-- 가운데 (본문) -->
      <div class="ws4-card" style="flex: ${isWideTab ? '2' : '2'} 1 0;">
        <div class="ws4-head"><span>${esc(active?.label || '')}</span></div>
        <div class="ws4-body" id="devContent" style="padding: var(--sp-3); overflow: hidden; display: flex; flex-direction: column;"></div>
      </div>

      <!-- 우 (1): 차종 마스터일 때는 detail, 그 외는 로그 -->
      ${isWideTab ? `
        <div class="ws4-card" style="flex: 1 1 0;">
          <div class="ws4-head"><span>차종 상세</span></div>
          <div class="ws4-body" id="devDetail" style="padding: var(--sp-3); overflow-y: auto;"></div>
        </div>
      ` : `
        <div class="ws4-card" style="flex: 1 1 0;">
          <div class="ws4-head"><span>로그</span></div>
          <div class="ws4-body" id="devLog" style="padding: var(--sp-3); font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-sub); white-space: pre-wrap; overflow-y: auto;"></div>
        </div>
      `}
    </div>
  `;

  // 좌측 목록 클릭 — room-item.data-id 가 탭 id
  page.querySelectorAll('.ws4-list .room-item').forEach(item => {
    item.addEventListener('click', () => {
      _activeDev = item.dataset.id;
      // unsub 모든 구독 (탭 변경 시 누수 방지)
      devUnsubs.forEach(u => u?.());
      devUnsubs = [];
      renderDev();
    });
  });

  renderDevTab(_activeDev);
}

function renderDevTab(id) {
  const el = document.getElementById('devContent');
  if (!el) return;
  if (id === 'matrix')  return renderMatrixTab(el);
  if (id === 'tools')   return renderToolsTab(el);
  if (id === 'stock')   return renderStockTab(el);
  if (id === 'vehicle') return renderVehicleTab(el);
  if (id === 'color')   return renderColorTab(el);
  if (id === 'upload')  return renderUploadTab(el);
  if (id === 'data')    return renderDataTab(el);
}

/* ──────── 0. 차종 매트릭스 ──────── */
//  오플 sync 탭과 동일한 before/after 비교 — 좌(현재 매물) ↔ 우(매트릭스 적용 후)
//  변환 대상: sub_model / trim_name / options
//  options 매칭 안 된 토큰은 "매칭 실패" 로 표시
function renderMatrixTab(el) {
  // 분석 결과를 클로저에 저장 — 적용 시 재계산 없이 바로 사용
  let _lastResults = null;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;height:100%;min-height:0;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-sm btn-primary" id="mtxAnalyze"><i class="ph ph-play"></i> 매물 분석</button>
        <button class="btn btn-sm btn-success" id="mtxApply" disabled><i class="ph ph-check"></i> 확정만 적용 (high/medium)</button>
        <button class="btn btn-sm" id="mtxApplyAll" disabled style="color:#d97706;"><i class="ph ph-check-fat"></i> 확인필요 포함 모두 적용</button>
        <button class="btn btn-sm" id="mtxExport" disabled><i class="ph ph-download-simple"></i> 결과 JSON 다운로드</button>
        <button class="btn btn-sm" id="mtxCacheClear"><i class="ph ph-arrow-clockwise"></i> 카탈로그 캐시 초기화</button>
        <div style="flex:1;"></div>
        <select class="input" id="mtxFilterStatus" style="font-size:11px;padding:2px 6px;">
          <option value="">상태 전체</option>
          <option value="high">✓ 확정만</option>
          <option value="medium">◎ 추정만</option>
          <option value="low">⚠ 확인 필요만</option>
          <option value="none">✕ 카탈로그 없음만</option>
        </select>
        <select class="input" id="mtxFilterMaker" style="font-size:11px;padding:2px 6px;">
          <option value="">제조사 전체</option>
        </select>
        <span style="font-size:11px;color:var(--text-sub);" id="mtxSummary">대기 중</span>
      </div>
      <div id="mtxStats" style="font-size:10px;color:var(--text-sub);"></div>
      <div id="mtxPreview" style="flex:1 1 0;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:4px;background:#fff;">
        <div style="padding:24px;text-align:center;color:var(--text-muted);">「매물 분석」 버튼을 눌러주세요</div>
      </div>
    </div>
  `;

  el.querySelector('#mtxCacheClear').addEventListener('click', () => {
    clearMatrixCache();
    showToast('카탈로그 캐시 초기화');
  });

  // 변경 후 sub_model 추정 — 카탈로그 title 에서 maker prefix 제거
  function deriveNewSubModel(catalogTitle, maker) {
    if (!catalogTitle) return '';
    return catalogTitle.replace(new RegExp('^' + maker + '\\s+'), '').trim();
  }

  /* 일괄 적용 핵심 로직 — confidence 필터만 다르고 나머지 동일.
   *  includeLow=true 면 ok 한 모든 매칭 적용 (low 포함). */
  async function applyMatrix(includeLow) {
    if (!_lastResults || !_lastResults.length) return;
    const confOk = (r) => r.confidence === 'high' || r.confidence === 'medium' || (includeLow && r.confidence === 'low');
    const targets = _lastResults
      // catalog 매칭만 되어도 적용 — trim 없으면 trim 갱신 skip 하되 sub 는 갱신
      .filter(({ p, r }) => r.ok && confOk(r))
      .map(({ p, r }) => {
        const newSub = deriveNewSubModel(r.catalogTitle, p.maker);
        const newTrim = r.trimName || '';   // 빈 문자열이면 trim 갱신 skip
        const subChanged = (p.sub_model || '') !== newSub;
        const trimChanged = !!newTrim && (p.trim_name || p.trim || '') !== newTrim;
        const savedFp = Array.isArray(p.fp_options) ? p.fp_options : [];
        const fpAll = r.fpAll || [];
        const fpChanged = fpAll.length > 0 && (savedFp.length !== fpAll.length || !savedFp.every(id => fpAll.includes(id)));
        return { p, r, newSub, newTrim, subChanged, trimChanged, fpChanged, fpAll };
      })
      .filter(t => t.subChanged || t.trimChanged || t.fpChanged);

    if (!targets.length) {
      showToast('변경할 매물 없음');
      return;
    }
    const lowCount = targets.filter(t => t.r.confidence === 'low').length;
    const msg = lowCount
      ? `매물 ${targets.length}대 변경 (확인필요 ${lowCount}대 포함).\n원본은 sub_model_legacy / trim_name_legacy 로 백업됩니다.\n계속할까요?`
      : `매물 ${targets.length}대의 sub_model / trim_name / fp_options 를 일괄 변경합니다.\n원본은 sub_model_legacy / trim_name_legacy 로 백업됩니다.\n계속할까요?`;
    if (!confirm(msg)) return;

    const btnHigh = el.querySelector('#mtxApply');
    const btnAll  = el.querySelector('#mtxApplyAll');
    const summary = el.querySelector('#mtxSummary');
    btnHigh.disabled = true;
    btnAll.disabled = true;
    let done = 0, fail = 0;
    for (const t of targets) {
      const updates = {};
      if (t.subChanged) {
        if (t.p.sub_model_legacy == null) updates.sub_model_legacy = t.p.sub_model || '';
        updates.sub_model = t.newSub;
      }
      if (t.trimChanged) {
        const curTrim = t.p.trim_name || t.p.trim || '';
        if (t.p.trim_name_legacy == null) updates.trim_name_legacy = curTrim;
        updates.trim_name = t.newTrim;
      }
      if (t.fpChanged) {
        updates.fp_options = t.fpAll;
      }
      try {
        const id = t.p._key || t.p.id || t.p.product_uid;
        if (!id) throw new Error('no id');
        await updateRecord(`products/${id}`, updates);
        done++;
      } catch (err) {
        fail++;
        devLog(`[matrix-apply] 실패: ${t.p.car_number || t.p._key} — ${err.message}`);
      }
      if (done % 20 === 0) summary.textContent = `적용 중... ${done}/${targets.length}`;
    }
    summary.textContent = `✓ 적용 완료: ${done}건${fail ? ` / 실패 ${fail}건` : ''}`;
    showToast(`${done}대 적용`);
    btnHigh.disabled = false;
    btnAll.disabled = false;
  }

  el.querySelector('#mtxApply').addEventListener('click', () => applyMatrix(false));
  el.querySelector('#mtxApplyAll').addEventListener('click', () => applyMatrix(true));

  // 매물 분석 결과 JSON 다운로드 — 검수용
  el.querySelector('#mtxExport').addEventListener('click', () => {
    if (!_lastResults?.length) { showToast('먼저 매물 분석을 실행하세요'); return; }
    const out = _lastResults.map(({ p, r }) => ({
      // 매물 입력 자료
      car_number: p.car_number || '',
      maker: p.maker || '',
      model: p.model || '',
      sub_model: p.sub_model || '',
      trim_name: p.trim_name || p.trim || '',
      year: p.year || '',
      first_registration_date: p.first_registration_date || '',
      fuel_type: p.fuel_type || '',
      engine_cc: p.engine_cc || '',
      vehicle_class: p.vehicle_class || '',
      vehicle_status: p.vehicle_status || '',
      mileage: p.mileage || 0,
      vehicle_price: p.vehicle_price || 0,
      options_text: p.options || '',
      fp_options: p.fp_options || [],
      // 매칭 결과
      result: {
        ok: r.ok,
        confidence: r.confidence,
        catalogId: r.catalogId,
        catalogTitle: r.catalogTitle,
        catalogConfidence: r.catalogConfidence,
        trimName: r.trimName,
        trimConfidence: r.trimConfidence,
        trimAlts: r.trimAlts,
        fpAll: r.fpAll,
        basicCount: r.basicCount,
        priceMatch: r.priceMatch,
        runnerUp: r.runnerUp,
        score: r.score,
        reason: r.reason,
        requiresUserInput: r.requiresUserInput,
      },
    }));
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `matrix-analysis-${new Date().toISOString().slice(0,10).replace(/-/g,'')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`${out.length}대 분석 결과 다운로드`);
  });

  el.querySelector('#mtxAnalyze').addEventListener('click', async () => {
    const btn = el.querySelector('#mtxAnalyze');
    const summary = el.querySelector('#mtxSummary');
    const preview = el.querySelector('#mtxPreview');
    btn.disabled = true;
    summary.textContent = '카탈로그 로딩...';

    await loadIndex();

    const products = (store.products || []).filter(p => !p._deleted && p.status !== 'deleted');
    summary.textContent = `${products.length}개 매물 분석 중...`;

    const results = [];
    let cnt = { ok: 0, noCat: 0, review: 0, high: 0 };
    let i = 0;
    for (const p of products) {
      i++;
      const r = await analyzeProduct(p);
      if (!r.ok) cnt.noCat++;
      else {
        cnt.ok++;
        if (r.confidence === 'high') cnt.high++;
        if (r.requiresUserInput) cnt.review++;
      }
      results.push({ p, r });
      if (i % 50 === 0) summary.textContent = `진행 ${i}/${products.length}...`;
    }

    summary.textContent = `전체 ${products.length}대  ·  매칭 ${cnt.ok}  ·  확정 ${cnt.high}  ·  검토 필요 ${cnt.review}  ·  카탈로그 없음 ${cnt.noCat}`;
    _lastResults = results;
    el.querySelector('#mtxApply').disabled = false;
    el.querySelector('#mtxApplyAll').disabled = false;
    el.querySelector('#mtxExport').disabled = false;

    // 메이커별 통계 요약
    const byMaker = {};
    for (const { p, r } of results) {
      const m = p.maker || '(미상)';
      if (!byMaker[m]) byMaker[m] = { total: 0, high: 0, medium: 0, low: 0, none: 0 };
      byMaker[m].total++;
      if (!r.ok) byMaker[m].none++;
      else if (r.confidence === 'high') byMaker[m].high++;
      else if (r.confidence === 'medium') byMaker[m].medium++;
      else byMaker[m].low++;
    }
    const statsEl = el.querySelector('#mtxStats');
    statsEl.innerHTML = '<b>메이커별:</b> ' + Object.entries(byMaker)
      .sort((a,b) => b[1].total - a[1].total)
      .map(([m, s]) => `${esc(m)} <span style="color:#16a34a;">${s.high}</span>/<span style="color:#0284c7;">${s.medium}</span>/<span style="color:#d97706;">${s.low}</span>/<span style="color:#dc2626;">${s.none}</span>(=${s.total})`)
      .join('  ·  ');

    // 메이커 필터 옵션 채우기
    const makerSel = el.querySelector('#mtxFilterMaker');
    makerSel.innerHTML = '<option value="">제조사 전체</option>' +
      Object.keys(byMaker).sort().map(m => `<option value="${esc(m)}">${esc(m)} (${byMaker[m].total})</option>`).join('');

    const rank = r => !r.ok ? 1 : (r.confidence === 'low' ? 0 : (r.confidence === 'medium' ? 2 : 3));
    results.sort((a, b) => {
      const ra = rank(a.r), rb = rank(b.r);
      if (ra !== rb) return ra - rb;
      return (b.r.fpAll?.length || 0) - (a.r.fpAll?.length || 0);
    });

    const empty = '<span style="color:var(--text-muted);">·</span>';
    const e = v => v == null || v === '' ? empty : esc(String(v));

    // 카탈로그 title → 새 sub_model: maker prefix 제거 + 괄호 → 공백
    function newSubModel(catalogTitle, maker) {
      if (!catalogTitle) return '';
      let s = catalogTitle.replace(new RegExp('^' + maker + '\\s+'), '').trim();
      s = s.replace(/\s*\(([^)]+)\)\s*/g, ' $1 ').replace(/\s+/g, ' ').trim();
      return s;
    }
    function fpDisplay(ids) {
      if (!ids || !ids.length) return empty;
      const names = fpIdsToNames(ids);  // ID → 한글 이름
      const head = names.slice(0, 6).join(', ');
      return names.length > 6 ? `${esc(head)} <span style="color:var(--text-muted);">+${names.length - 6}</span>` : esc(head);
    }

    preview.innerHTML = `
      <table style="font-size:11px;border-collapse:collapse;white-space:nowrap;">
        <thead style="position:sticky;top:0;z-index:2;">
          <tr>
            <th colspan="2" style="padding:6px;background:var(--bg-header);color:var(--text-sub);border-right:3px solid var(--border-strong);">매물</th>
            <th colspan="5" style="padding:6px;background:var(--bg-stripe);color:var(--text-sub);border-right:3px solid var(--border-strong);">📋 현재</th>
            <th colspan="6" style="padding:6px;background:var(--alert-blue-bg);color:var(--alert-blue-text);">🎯 매트릭스 적용 후</th>
          </tr>
          <tr style="background:var(--bg-header);font-weight:500;color:var(--text-sub);">
            <th style="padding:4px 6px;text-align:left;">#</th>
            <th style="padding:4px 6px;text-align:left;border-right:3px solid var(--border-strong);">차량번호</th>
            <th style="padding:4px 6px;text-align:left;">제조사</th>
            <th style="padding:4px 6px;text-align:left;">모델</th>
            <th style="padding:4px 6px;text-align:left;">세부모델</th>
            <th style="padding:4px 6px;text-align:left;">세부트림</th>
            <th style="padding:4px 6px;text-align:left;border-right:3px solid var(--border-strong);">선택옵션</th>
            <th style="padding:4px 6px;text-align:left;">상태</th>
            <th style="padding:4px 6px;text-align:left;">제조사</th>
            <th style="padding:4px 6px;text-align:left;">모델</th>
            <th style="padding:4px 6px;text-align:left;">세부모델</th>
            <th style="padding:4px 6px;text-align:left;">세부트림</th>
            <th style="padding:4px 6px;text-align:left;">선택옵션 (표준)</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;

    function buildRow({ p, r }, idx) {
      let status, statusColor;
      if (!r.ok) { status = '✕ 카탈로그 없음'; statusColor = '#dc2626'; }
      else if (r.confidence === 'high') { status = '✓ 확정'; statusColor = '#16a34a'; }
      else if (r.confidence === 'medium') { status = '◎ 추정'; statusColor = '#0284c7'; }
      else { status = '⚠ 확인 필요'; statusColor = '#d97706'; }
      const rawOpts = Array.isArray(p.options) ? p.options.join(', ') : (p.options || '');
      const newSub = r.ok ? newSubModel(r.catalogTitle, p.maker) : '';
      const changed = (before, after) => after && before !== after;
      const sameStyle = 'color:var(--text-muted);';
      const changeStyle = 'font-weight:600;color:#0c4a6e;';
      const beforeBg = 'background:var(--bg-stripe);';
      const afterBg = 'background:var(--alert-blue-bg);';
      const todoCell = (label='매칭 실패') => `<td style="padding:4px 6px;background:#fef3c7;color:#92400e;font-style:italic;font-size:10px;">${label}</td>`;
      const newTrim = r.ok && r.trimName ? r.trimName : (p.trim_name || p.trim || '');
      const afterCell = (before, after) => {
        if (after == null || after === '') return todoCell();
        const sty = changed(before, after) ? changeStyle : sameStyle;
        return `<td style="padding:4px 6px;${afterBg}${sty}max-width:240px;overflow:hidden;text-overflow:ellipsis;" title="${esc(String(after))}">${esc(String(after))}</td>`;
      };
      const fpAfter = r.ok ? fpDisplay(r.fpAll) : null;
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:4px 6px;color:var(--text-muted);">${idx + 1}</td>
        <td style="padding:4px 6px;border-right:3px solid var(--border-strong);font-family:monospace;font-size:10px;">${e(p.car_number)}</td>
        <td style="padding:4px 6px;${beforeBg}">${e(p.maker)}</td>
        <td style="padding:4px 6px;${beforeBg}">${e(p.model)}</td>
        <td style="padding:4px 6px;${beforeBg}max-width:180px;overflow:hidden;text-overflow:ellipsis;" title="${esc(p.sub_model || '')}">${e(p.sub_model)}</td>
        <td style="padding:4px 6px;${beforeBg}max-width:140px;overflow:hidden;text-overflow:ellipsis;" title="${esc(p.trim_name || p.trim || '')}">${e(p.trim_name || p.trim)}</td>
        <td style="padding:4px 6px;${beforeBg}max-width:240px;overflow:hidden;text-overflow:ellipsis;border-right:3px solid var(--border-strong);" title="${esc(rawOpts)}">${esc(rawOpts.slice(0, 60))}${rawOpts.length > 60 ? '…' : ''}</td>
        <td style="padding:4px 6px;${afterBg}color:${statusColor};font-weight:500;">${status}</td>
        ${afterCell(p.maker, p.maker)}
        ${afterCell(p.model, p.model)}
        ${r.ok ? afterCell(p.sub_model, newSub) : todoCell()}
        ${r.ok ? afterCell(p.trim_name || p.trim, newTrim) : todoCell()}
        ${r.ok ? `<td style="padding:4px 6px;${afterBg}max-width:340px;overflow:hidden;text-overflow:ellipsis;" title="${esc(fpIdsToNames(r.fpAll || []).join(', '))}">${fpAfter}</td>` : todoCell('카탈로그 없음')}
      </tr>`;
    }
    function renderRows() {
      const fs = el.querySelector('#mtxFilterStatus').value;
      const fm = el.querySelector('#mtxFilterMaker').value;
      const filtered = results.filter(({ p, r }) => {
        if (fm && p.maker !== fm) return false;
        if (fs) {
          const conf = !r.ok ? 'none' : r.confidence;
          if (conf !== fs) return false;
        }
        return true;
      });
      preview.querySelector('tbody').innerHTML = filtered.map((row, i) => buildRow(row, i)).join('');
    }
    el.querySelector('#mtxFilterStatus').addEventListener('change', renderRows);
    el.querySelector('#mtxFilterMaker').addEventListener('change', renderRows);
    renderRows();

    btn.disabled = false;
  });
}

/* ──────── 1. 시스템 도구 ──────── */
function renderToolsTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">시스템</div>
        ${ffv('버전', 'v3.0.0')}
        ${ffv('Firebase', 'freepasserp3')}
        ${ffv('빌드', 'Vite 8')}
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">동작</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn btn-sm" id="devCacheClear"><i class="ph ph-trash"></i> 캐시 초기화 (localStorage)</button>
          <button class="btn btn-sm" id="devStoreView"><i class="ph ph-database"></i> Store 상태 보기</button>
          <button class="btn btn-sm" id="devReload"><i class="ph ph-arrow-clockwise"></i> 강제 새로고침</button>
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">일회성 마이그레이션</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn btn-sm" id="devMigrateTermPolicy"><i class="ph ph-swap"></i> policies: term_* → policy_*</button>
          <button class="btn btn-sm" id="devMigrateModelName"><i class="ph ph-swap"></i> model_name → model</button>
          <button class="btn btn-sm" id="devMigratePartnerType"><i class="ph ph-swap"></i> partner_type 영어 → 한글</button>
          <button class="btn btn-sm" id="devFillPartnerCode"><i class="ph ph-identification-card"></i> partner_code 공란채움 (= _key)</button>
          <button class="btn btn-sm" id="devMigrateUserCode"><i class="ph ph-identification-badge"></i> user_code 일괄부여</button>
          <button class="btn btn-sm" id="devMigrateCreditGrade"><i class="ph ph-swap"></i> credit_grade: 저신용 → 신용무관</button>
        </div>
      </div>
    </div>
  `;

  el.querySelector('#devCacheClear').addEventListener('click', () => {
    if (!confirm('localStorage 전체를 삭제할까요?')) return;
    localStorage.clear();
    devLog('✓ localStorage 초기화');
    showToast('캐시 초기화');
  });
  el.querySelector('#devStoreView').addEventListener('click', () => {
    devLog(JSON.stringify({
      products: (store.products||[]).length,
      contracts: (store.contracts||[]).length,
      settlements: (store.settlements||[]).length,
      rooms: (store.rooms||[]).length,
      users: (store.users||[]).length,
      partners: (store.partners||[]).length,
      currentUser: store.currentUser?.email,
    }, null, 2));
  });
  el.querySelector('#devReload').addEventListener('click', () => location.reload());

  el.querySelector('#devMigrateTermPolicy').addEventListener('click', () => migrateTermPolicy());
  el.querySelector('#devMigrateModelName').addEventListener('click', () => migrateModelName());
  el.querySelector('#devMigratePartnerType').addEventListener('click', () => migratePartnerType());
  el.querySelector('#devFillPartnerCode').addEventListener('click', () => fillPartnerCode());
  el.querySelector('#devMigrateUserCode').addEventListener('click', () => migrateUserCode());
  el.querySelector('#devMigrateCreditGrade').addEventListener('click', () => migrateCreditGrade());
}

async function migrateTermPolicy() {
  if (!confirm('policies/ 의 모든 문서에서 term_* → policy_* rename. 멱등.')) return;
  try {
    const { ref, get, update } = await import('firebase/database');
    const { db } = await import('../firebase/config.js');
    const snap = await get(ref(db, 'policies'));
    const all = snap.val() || {};
    let moved = 0, scanned = 0;
    for (const [k, v] of Object.entries(all)) {
      scanned++;
      const patch = {};
      if (v?.term_code != null) { if (v.policy_code == null) patch.policy_code = v.term_code; patch.term_code = null; }
      if (v?.term_name != null) { if (v.policy_name == null) patch.policy_name = v.term_name; patch.term_name = null; }
      if (v?.term_type != null) { if (v.policy_type == null) patch.policy_type = v.term_type; patch.term_type = null; }
      if (Object.keys(patch).length) { await update(ref(db, `policies/${k}`), patch); moved++; }
    }
    devLog(`✓ policies 스캔 ${scanned}건 | rename ${moved}건`);
    showToast(`마이그레이션 완료 (${moved}/${scanned})`);
  } catch (e) { devLog(`✗ ${e.message}`); showToast('실패', 'error'); }
}

async function migrateModelName() {
  if (!confirm('products·contracts·rooms·settlements 의 model_name → model rename. 멱등.')) return;
  try {
    const { ref, get, update } = await import('firebase/database');
    const { db } = await import('../firebase/config.js');
    const migrate = async (col, src, dst) => {
      const snap = await get(ref(db, col));
      const all = snap.val() || {};
      let moved = 0;
      for (const [k, v] of Object.entries(all)) {
        if (!v || typeof v !== 'object' || v[src] == null) continue;
        const patch = {};
        if (v[dst] == null) patch[dst] = v[src];
        patch[src] = null;
        await update(ref(db, `${col}/${k}`), patch);
        moved++;
      }
      return { scanned: Object.keys(all).length, moved };
    };
    const jobs = [
      ['products', 'model_name', 'model'],
      ['contracts', 'model_name_snapshot', 'model_snapshot'],
      ['contracts', 'model_name', 'model'],
      ['rooms', 'model_name', 'model'],
      ['settlements', 'model_name', 'model'],
    ];
    let total = 0;
    for (const [col, src, dst] of jobs) {
      try { const r = await migrate(col, src, dst); devLog(`  ${col}.${src}→${dst}: ${r.moved}/${r.scanned}`); total += r.moved; }
      catch (e) { devLog(`  ${col}.${src}: SKIP (${e.message})`); }
    }
    devLog(`✓ rename ${total}건`);
    showToast(`완료 (${total}건)`);
  } catch (e) { devLog(`✗ ${e.message}`); showToast('실패', 'error'); }
}

async function migratePartnerType() {
  if (!confirm('partners/ partner_type 영어→한글 (provider→공급사 등)')) return;
  try {
    const { ref, get, update } = await import('firebase/database');
    const { db } = await import('../firebase/config.js');
    const { partnerTypeLabel } = await import('../core/partner-types.js');
    const snap = await get(ref(db, 'partners'));
    const data = snap.val() || {};
    let count = 0;
    for (const [key, val] of Object.entries(data)) {
      const mapped = partnerTypeLabel(val.partner_type);   // 한/영 별칭 → 표준 한글 (단일 소스)
      if (mapped && mapped !== val.partner_type) {
        await update(ref(db, `partners/${key}`), { partner_type: mapped });
        count++;
      }
    }
    devLog(`✓ partner_type 한글화 ${count}건`);
    showToast(`${count}건 완료`);
  } catch (e) { devLog(`✗ ${e.message}`); showToast('실패', 'error'); }
}

async function fillPartnerCode() {
  if (!confirm('partner_code 공란인 파트너에 _key 를 코드로 채웁니다 (PT-XXXX). 멱등.')) return;
  try {
    const { ref, get, update } = await import('firebase/database');
    const { db } = await import('../firebase/config.js');
    const snap = await get(ref(db, 'partners'));
    const data = snap.val() || {};
    let count = 0;
    for (const [key, val] of Object.entries(data)) {
      if (!val || val._deleted) continue;
      if (!val.partner_code && !val.company_code) {
        await update(ref(db, `partners/${key}`), { partner_code: key });
        devLog(`  ${key} (${val.partner_name || ''}) → partner_code=${key}`);
        count++;
      }
    }
    devLog(`✓ partner_code 공란채움 ${count}건`);
    showToast(`${count}건 완료`);
  } catch (e) { devLog(`✗ ${e.message}`); showToast('실패', 'error'); }
}

async function migrateUserCode() {
  if (!confirm('user_code 미부여자에게 전역 시퀀스 부여 (UNNNN). 멱등.')) return;
  try {
    const { ref, get, update, runTransaction } = await import('firebase/database');
    const { db } = await import('../firebase/config.js');
    const snap = await get(ref(db, 'users'));
    const all = snap.val() || {};
    let maxSeq = 0;
    const missing = [];
    for (const [uid, u] of Object.entries(all)) {
      if (!u || u.status === 'deleted') continue;
      if (u.user_code) {
        const m = /^U(\d+)$/.exec(u.user_code);
        if (m) { const n = Number(m[1]); if (n > maxSeq) maxSeq = n; }
      } else {
        missing.push({ uid, createdAt: u.created_at || 0, name: u.name || '' });
      }
    }
    const counterRef = ref(db, 'counters/user_code_seq');
    const curSnap = await get(counterRef);
    const curVal = curSnap.val() || 0;
    if (curVal < maxSeq) {
      for (let v = curVal; v < maxSeq; v++) await runTransaction(counterRef, c => (c || 0) + 1);
      devLog(`  counter bump ${curVal}→${maxSeq}`);
    }
    missing.sort((a, b) => a.createdAt - b.createdAt);
    let assigned = 0;
    for (const { uid, name } of missing) {
      const result = await runTransaction(counterRef, c => (c || 0) + 1);
      if (!result.committed) { devLog(`  ✗ ${uid}`); continue; }
      const code = `U${String(result.snapshot.val()).padStart(4, '0')}`;
      await update(ref(db, `users/${uid}`), { user_code: code, updated_at: Date.now() });
      devLog(`  ${name || uid.slice(0,6)} → ${code}`);
      assigned++;
    }
    devLog(`✓ ${assigned}건 부여`);
    showToast(`${assigned}건 완료`);
  } catch (e) { devLog(`✗ ${e.message}`); showToast('실패', 'error'); }
}

async function migrateCreditGrade() {
  if (!confirm('credit_grade "저신용" → "신용무관" (policies + products). 멱등.')) return;
  try {
    const { ref, get, update } = await import('firebase/database');
    const { db } = await import('../firebase/config.js');
    let total = 0;
    for (const path of ['policies', 'products']) {
      const snap = await get(ref(db, path));
      const all = snap.val() || {};
      let moved = 0;
      for (const [k, v] of Object.entries(all)) {
        if (v?.credit_grade === '저신용') {
          await update(ref(db, `${path}/${k}`), { credit_grade: '신용무관' });
          moved++;
        }
      }
      devLog(`  ${path}: ${moved}건`);
      total += moved;
    }
    devLog(`✓ ${total}건 변환`);
    showToast(`${total}건 완료`);
  } catch (e) { devLog(`✗ ${e.message}`); showToast('실패', 'error'); }
}

/* ──────── 2. 재고 일괄 삭제 ──────── */
function renderStockTab(el) {
  const products = (store.products || []).filter(p => p.status !== 'deleted' && !p._deleted);
  const checked = new Set();
  const makers = [...new Set(products.map(p => p.maker).filter(Boolean))].sort();
  const statuses = [...new Set(products.map(p => p.vehicle_status).filter(Boolean))].sort();
  const partners = [...new Set(products.map(p => p.provider_company_code || p.partner_code).filter(Boolean))].sort();

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;height:100%;">
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <input class="input" id="stkQ" placeholder="차량번호/모델 검색" style="flex:1;min-width:140px;">
        <select class="input" id="stkMaker"><option value="">전체 제조사</option>${makers.map(m => `<option>${esc(m)}</option>`).join('')}</select>
        <select class="input" id="stkStatus"><option value="">전체 상태</option>${statuses.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        <select class="input" id="stkPartner"><option value="">전체 공급사</option>${partners.map(p => `<option>${esc(p)}</option>`).join('')}</select>
      </div>
      <div style="display:flex;gap:4px;align-items:center;">
        <span id="stkCount" style="font-size:11px;color:var(--text-muted);">0대</span>
        <button class="btn btn-sm" id="stkAll">전체 선택</button>
        <button class="btn btn-sm" id="stkNone">해제</button>
        <button class="btn btn-sm" style="margin-left:auto;" id="stkBlock" title="선택 매물을 출고불가로 변경 (삭제 X, 상태만)"><i class="ph ph-prohibit"></i> 선택 → 출고불가</button>
        <button class="btn btn-sm is-danger" id="stkDel"><i class="ph ph-trash"></i> 선택 삭제</button>
      </div>
      <div id="stkList" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:4px;"></div>
    </div>
  `;

  const filter = () => {
    const q = el.querySelector('#stkQ').value.toLowerCase().trim();
    const m = el.querySelector('#stkMaker').value;
    const s = el.querySelector('#stkStatus').value;
    const p = el.querySelector('#stkPartner').value;
    return products.filter(x => {
      if (m && x.maker !== m) return false;
      if (s && x.vehicle_status !== s) return false;
      if (p && (x.provider_company_code || x.partner_code) !== p) return false;
      if (q && ![x.car_number, x.model, x.maker, x.sub_model, x.provider_company_code, x.partner_code, x.policy_code, x.vehicle_status].some(v => v && String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  };

  const render = () => {
    const list = filter();
    el.querySelector('#stkCount').textContent = `${list.length}대 | 선택 ${checked.size}`;
    el.querySelector('#stkList').innerHTML = list.slice(0, 500).map(p => {
      const k = p._key || p.product_uid || p.product_code;
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--border);font-size:11px;">
        <input type="checkbox" data-k="${esc(k)}" ${checked.has(k) ? 'checked' : ''}>
        <span style="width:80px;">${esc(p.provider_company_code || p.partner_code || '-')}</span>
        <span style="width:80px;">${esc(p.car_number || '-')}</span>
        <span style="width:60px;">${esc(p.maker || '')}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.model || '')} ${esc(p.sub_model || '')}</span>
        <span style="width:60px;color:var(--text-muted);">${esc(p.vehicle_status || '')}</span>
      </div>`;
    }).join('') + (list.length > 500 ? `<div style="padding:8px;text-align:center;color:var(--text-muted);font-size:11px;">상위 500건 | 필터로 좁히세요</div>` : '');
    el.querySelectorAll('#stkList input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) checked.add(cb.dataset.k); else checked.delete(cb.dataset.k);
        el.querySelector('#stkCount').textContent = `${list.length}대 | 선택 ${checked.size}`;
      });
    });
  };

  ['stkQ', 'stkMaker', 'stkStatus', 'stkPartner'].forEach(id => {
    el.querySelector('#' + id).addEventListener(id === 'stkQ' ? 'input' : 'change', render);
  });
  el.querySelector('#stkAll').addEventListener('click', () => { filter().forEach(p => checked.add(p._key || p.product_uid || p.product_code)); render(); });
  el.querySelector('#stkNone').addEventListener('click', () => { checked.clear(); render(); });
  // 선택 → 출고불가 (삭제 X, 상태값만 변경). 청크 multi-update.
  el.querySelector('#stkBlock').addEventListener('click', async () => {
    if (!checked.size) return showToast('선택 없음', 'error');
    if (!await customConfirm({ message: `${checked.size}대를 출고불가로 변경하시겠습니까? (삭제 아님, 상태만)`, danger: true, okLabel: '출고불가 변경' })) return;
    const { ref, update } = await import('firebase/database');
    const { db } = await import('../firebase/config.js');
    const keys = [...checked];
    const CHUNK = 400;
    let n = 0;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = {};
      for (const k of keys.slice(i, i + CHUNK)) {
        slice[`products/${k}/vehicle_status`] = '출고불가';
        slice[`products/${k}/status`] = 'unavailable';
        slice[`products/${k}/status_label`] = '일괄 출고불가';
        slice[`products/${k}/updated_at`] = Date.now();
        n++;
      }
      await update(ref(db), slice);
      devLog(`[stock] 출고불가 ${Math.min(i + CHUNK, keys.length)}/${keys.length}`);
    }
    showToast(`${n}대 출고불가 처리`);
    checked.clear();
    render();
  });
  el.querySelector('#stkDel').addEventListener('click', async () => {
    if (!checked.size) return showToast('선택 없음', 'error');
    if (!await customConfirm({ message: `${checked.size}대를 삭제하시겠습니까? (soft delete)`, danger: true, okLabel: '삭제' })) return;
    let n = 0;
    for (const k of checked) { try { await softDelete(`products/${k}`); n++; } catch(e) {} }
    devLog(`✓ ${n}대 삭제`);
    showToast(`${n}대 완료`);
    checked.clear();
    render();
  });
  render();
}

/* ──────── 4. 색상 마스터 ──────── */
function renderColorTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">외장색</div>
        <div style="display:flex;gap:4px;margin-bottom:6px;">
          <input class="input" id="extIn" placeholder="색상명" style="flex:1;">
          <button class="btn btn-sm btn-primary" id="extAdd"><i class="ph ph-plus"></i> 추가</button>
        </div>
        <div id="extList" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">내장색</div>
        <div style="display:flex;gap:4px;margin-bottom:6px;">
          <input class="input" id="intIn" placeholder="색상명" style="flex:1;">
          <button class="btn btn-sm btn-primary" id="intAdd"><i class="ph ph-plus"></i> 추가</button>
        </div>
        <div id="intList" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
      </div>
    </div>
  `;
  const refresh = () => {
    const cm = store.colorMaster || {};
    const ext = cm.ext_colors || [];
    const intC = cm.int_colors || [];
    el.querySelector('#extList').innerHTML = ext.length
      ? ext.map(c => `<span class="chip">${esc(c)}<button class="chip-x" data-exd="${esc(c)}" title="삭제">×</button></span>`).join('')
      : '<span style="color:var(--text-muted);font-size:11px;">없음</span>';
    el.querySelector('#intList').innerHTML = intC.length
      ? intC.map(c => `<span class="chip">${esc(c)}<button class="chip-x" data-ind="${esc(c)}" title="삭제">×</button></span>`).join('')
      : '<span style="color:var(--text-muted);font-size:11px;">없음</span>';
    el.querySelectorAll('[data-exd]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`"${b.dataset.exd}" 삭제?`)) return;
      await updateRecord('color_master', { ext_colors: ext.filter(x => x !== b.dataset.exd) });
      showToast('삭제');
    }));
    el.querySelectorAll('[data-ind]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`"${b.dataset.ind}" 삭제?`)) return;
      await updateRecord('color_master', { int_colors: intC.filter(x => x !== b.dataset.ind) });
      showToast('삭제');
    }));
  };
  el.querySelector('#extAdd').addEventListener('click', async () => {
    const v = el.querySelector('#extIn').value.trim();
    if (!v) return;
    const ext = (store.colorMaster?.ext_colors || []);
    if (ext.includes(v)) return showToast('이미 있음', 'error');
    await updateRecord('color_master', { ext_colors: [...ext, v] });
    el.querySelector('#extIn').value = '';
    devLog(`✓ 외장색 추가: ${v}`);
  });
  el.querySelector('#intAdd').addEventListener('click', async () => {
    const v = el.querySelector('#intIn').value.trim();
    if (!v) return;
    const intC = (store.colorMaster?.int_colors || []);
    if (intC.includes(v)) return showToast('이미 있음', 'error');
    await updateRecord('color_master', { int_colors: [...intC, v] });
    el.querySelector('#intIn').value = '';
    devLog(`✓ 내장색 추가: ${v}`);
  });
  refresh();
  const cmUnsub = watchRecord('color_master', (val) => { store.colorMaster = val || {}; refresh(); });
  devUnsubs.push(cmUnsub);
}

/* ──────── 5. CSV 업로드 ──────── */
function renderUploadTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">상품 CSV 업로드</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">차량번호 컬럼 필수 | 헤더 첫 행</div>
        <input type="file" id="upFile" accept=".csv,.tsv" style="font-size:11px;margin-bottom:6px;">
        <button class="btn btn-sm btn-primary" id="upBtn"><i class="ph ph-upload-simple"></i> 업로드</button>
      </div>
    </div>
  `;
  el.querySelector('#upBtn').addEventListener('click', async () => {
    const file = el.querySelector('#upFile').files[0];
    if (!file) return showToast('파일 선택', 'error');
    devLog(`업로드: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`);
    const text = await file.text();
    const sep = file.name.endsWith('.tsv') ? '\t' : ',';
    const lines = text.split(/\r?\n/).map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim()));
    if (lines.length < 2) { devLog('✗ 데이터 없음'); return; }
    const headers = lines[0];
    const rows = lines.slice(1).filter(r => r.length >= 2);
    devLog(`헤더: ${headers.join(', ')}`);
    const carIdx = headers.findIndex(h => h.includes('차량번호') || h === 'car_number');
    if (carIdx < 0) { devLog('✗ 차량번호 컬럼 없음'); return showToast('차량번호 컬럼 필요', 'error'); }
    let saved = 0;
    for (const row of rows) {
      const carNumber = row[carIdx];
      if (!carNumber || !/[가-힣]/.test(carNumber)) continue;
      const product = {};
      headers.forEach((h, i) => { if (row[i]) product[h] = row[i]; });
      product.car_number = carNumber;
      product.source = 'csv_upload';
      const uid = `CSV_${carNumber.replace(/\s/g, '')}`;
      await setRecord(`products/${uid}`, {
        product_uid: uid,
        product_code: uid,
        ...product,
        status: 'available',
        vehicle_status: product.vehicle_status || '출고가능',
        created_at: Date.now(),
      });
      saved++;
    }
    devLog(`✓ ${saved}대 저장`);
    showToast(`${saved}대 업로드 완료`);
  });
}

/* ──────── 7. RTDB viewer ──────── */
function renderDataTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;height:100%;">
      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${['products','contracts','settlements','rooms','users','partners','policies','customers','home_notices','vehicle_master','color_master'].map(c =>
          `<button class="chip" data-col="${c}">${c}</button>`).join('')}
      </div>
      <div id="dataView" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:8px;"></div>
    </div>
  `;
  el.querySelectorAll('[data-col]').forEach(c => {
    c.addEventListener('click', async () => {
      el.querySelectorAll('[data-col]').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      const data = await fetchCollection(c.dataset.col);
      const view = el.querySelector('#dataView');
      view.innerHTML = `<div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;">${data.length}건 (상위 100건)</div>` +
        data.slice(0, 100).map(d => `<div style="font-size:10px;padding:2px 0;border-bottom:1px solid var(--border);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(JSON.stringify(d))}">${esc(d._key)}: ${esc(JSON.stringify(d).slice(0, 200))}</div>`).join('');
    });
  });
}

/* ──────── 8. 차종 마스터 (catalog 매트릭스 viewer) ────────
 *  데이터원: public/data/car-master/_index.json (단일 진실원)
 *  좌측 list: catalog 메이커/모델/세부모델/연식/트림수/상품수
 *  우측 detail: catalog json 미리보기 (view-only, 편집은 git stub 직접)
 */
let _vmCatalogIdx = null;
let _vmState = { selectedCid: null };
let _vmCascade = null;

const KOR_MAKER_ORDER = ['현대', '기아', '제네시스', '쌍용', 'KGM', '르노', '르노삼성', '쉐보레', '한국GM', 'GM대우', '대우'];

function _vmYy(v) { const m = (v || '').match(/^(\d{4})/); return m ? m[1].slice(2) : ''; }
function _vmYearLabel(c) {
  const ys = _vmYy(c.year_start);
  const ye = _vmYy(c.year_end);
  if (ys && (c.year_end === '현재' || !ye)) return `${ys}~`;
  if (ys && ye) return `${ys}~${ye}`;
  return '';
}

async function renderVehicleTab(el) {
  el.innerHTML = `<div style="padding:12px;text-align:center;color:var(--text-muted);"><i class="ph ph-spinner" style="animation:pd-zip-spin 1s linear infinite;"></i> catalog 로드 중...</div>`;
  try {
    _vmCatalogIdx = await loadIndex();
  } catch (e) {
    console.error('[vmTab] loadIndex 실패', e);
    el.innerHTML = `<div style="padding:12px;color:#dc2626;">catalog 로드 실패: ${e.message || e}</div>`;
    return;
  }
  if (!_vmCatalogIdx || Object.keys(_vmCatalogIdx).length === 0) {
    el.innerHTML = `<div style="padding:12px;color:#dc2626;">_index.json 비어있음 (build 확인 필요)</div>`;
    return;
  }
  drawVehicleTab(el);
}

function drawVehicleTab(el) {
  const idx = _vmCatalogIdx || {};
  const detailEl = document.getElementById('devDetail');

  // catalog_id → 보유 매물수
  const productCounts = new Map();
  for (const p of (store.products || [])) {
    if (p._deleted || p.status === 'deleted') continue;
    if (p.catalog_id) productCounts.set(p.catalog_id, (productCounts.get(p.catalog_id) || 0) + 1);
  }

  const stats = masterTreeStats(buildMasterTree(idx));

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;height:100%;overflow:auto;">
      <div style="font-size:11px;color:var(--text-sub);">
        제조사 ${stats.makers} · 모델 ${stats.models} · 세부모델 ${stats.subModels} · 파워트레인 ${stats.variants} · 트림 ${stats.trims}
      </div>
      <div id="vmCascade"></div>
      <div style="font-size:11px;color:var(--text-muted);"><i class="ph ph-info"></i> catalog json 단일 진실원 — 신규/편집은 git stub 직접</div>
    </div>
  `;

  const cascadeEl = el.querySelector('#vmCascade');
  _vmCascade = renderMasterCascade(cascadeEl, idx, {
    counts: productCounts,
    showId: true,                       // 개발도구이므로 catalog_id 노출
    onSelect: (s) => {
      _vmState.selectedCid = s.catalogId || null;
      if (detailEl) detailEl.innerHTML = renderVehicleDetail(s.catalogId ? idx[s.catalogId] : null);
    },
  });
}

function renderVehicleDetail(sel) {
  if (!sel) {
    return `<div style="text-align:center;color:var(--text-muted);padding:40px 0;font-size:12px;">왼쪽에서 catalog 선택<br><span style="font-size:11px;">신규 등록은 public/data/car-master/{id}.json 직접 추가</span></div>`;
  }
  const trims = Array.isArray(sel.trims) ? sel.trims : [];
  const cnt = (store.products || []).filter(p => !p._deleted && p.status !== 'deleted' && p.catalog_id === sel.id).length;
  const yr = _vmYearLabel(sel);
  const subModel = sel.maker && (sel.title || '').startsWith(sel.maker + ' ')
    ? sel.title.slice(sel.maker.length + 1).trim() : (sel.title || sel.id);

  // 5단계 분해 — 파워트레인(연료·배기량·구동·인승) → 트림. parseTrim 표준 순서 적용.
  const variantMap = new Map();
  for (const raw of trims) {
    const { variant, trim } = parseTrim(raw);
    const k = variant || '(미상)';
    if (!variantMap.has(k)) variantMap.set(k, []);
    if (!variantMap.get(k).includes(trim)) variantMap.get(k).push(trim);
  }
  const variants = [...variantMap];

  const rowKV = (label, val) => val ? `<div style="display:flex;gap:8px;margin-bottom:4px;font-size:12px;">
    <span style="width:64px;color:var(--text-muted);flex-shrink:0;">${esc(label)}</span>
    <span style="font-weight:500;">${esc(val)}</span>
  </div>` : '';

  return `
    <div style="margin-bottom:10px;font-weight:600;font-size:13px;">${esc(sel.title || sel.id)}</div>
    <!-- 5단계 -->
    <div style="display:flex;flex-direction:column;gap:2px;padding:8px 10px;background-color:var(--alert-blue-bg);border:1px solid var(--alert-blue-border);border-radius:4px;margin-bottom:10px;">
      ${rowKV('① 제조사', sel.maker)}
      ${rowKV('② 모델', sel.model_root)}
      ${rowKV('③ 세부모델', subModel)}
      <div style="font-size:11px;color:var(--text-weak);margin-top:2px;">④ 파워트레인 · ⑤ 트림 ↓</div>
    </div>
    ${cnt ? `<div style="margin-bottom:10px;padding:6px 10px;background-color:var(--bg-stripe);border-radius:4px;font-size:11px;color:var(--text-sub);">📦 등록 매물 ${cnt}대</div>` : ''}
    ${variants.length ? `
      <div style="font-size:11px;font-weight:600;color:var(--text-sub);margin-bottom:4px;">파워트레인 ${variants.length} · 트림 ${trims.length}</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${variants.map(([variant, ts]) => `
          <div style="border:1px solid var(--border);border-radius:4px;overflow:hidden;">
            <div style="padding:4px 8px;background-color:var(--bg-header);font-size:12px;font-weight:600;color:var(--text-main);">④ ${esc(variant)}</div>
            <div style="padding:5px 8px;font-size:11px;">
              ${ts.map(t => `<span style="display:inline-block;padding:1px 7px;margin:2px;background-color:var(--bg-stripe);border:1px solid var(--border-soft);border-radius:3px;">${esc(t)}</span>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    ` : '<div style="color:var(--text-muted);font-size:11px;">트림 데이터 없음</div>'}
    <div style="margin-top:14px;padding:8px;background-color:var(--bg-stripe);border-radius:4px;font-size:10px;color:var(--text-muted);font-family:monospace;">
      편집: <code>public/data/car-master/${esc(sel.id)}.json</code>
    </div>
  `;
}

