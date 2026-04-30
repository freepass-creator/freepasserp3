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
import { saveNotice, deleteNotice, uploadNoticeImage } from '../firebase/notices.js';
import { esc, emptyState, renderRoomItem, fmtMoneyMan } from './../core/ui-helpers.js';
import { analyzeProduct, loadIndex, clearCache as clearMatrixCache } from '../core/vehicle-matrix.js';
import { fpIdsToNames } from '../core/fp-options-master.js';

let devUnsubs = [];
let _activeDev = 'tools';

const DEV_TABS = [
  { id: 'matrix',  icon: 'list-magnifying-glass', label: '차종 매트릭스', sub: '카탈로그 ↔ 매물 매핑' },
  { id: 'vehicle', icon: 'car-profile',     label: '차종 마스터', sub: '제조사·모델·세부모델' },
  { id: 'notice',  icon: 'megaphone',       label: '공지',        sub: '대시보드 공지 CRUD' },
  { id: 'color',   icon: 'palette',         label: '색상 옵션',   sub: '외장·내장 색상' },
  { id: 'data',    icon: 'database',        label: 'RTDB 현황',   sub: '컬렉션 viewer' },
  { id: 'upload',  icon: 'upload-simple',   label: '일괄 업로드', sub: 'CSV / Excel' },
  { id: 'sync',    icon: 'google-drive-logo', label: '외부 상품 동기화', sub: '공급사별 외부 시트 → products' },
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
  if (me.role !== 'admin') {
    page.innerHTML = `<div style="padding: var(--sp-6); color: var(--text-muted); text-align: center;">관리자만 접근 가능합니다.</div>`;
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
  if (id === 'notice')  return renderNoticeTab(el);
  if (id === 'vehicle') return renderVehicleTab(el);
  if (id === 'color')   return renderColorTab(el);
  if (id === 'upload')  return renderUploadTab(el);
  if (id === 'sync')    return renderSyncTab(el);
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
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-sm btn-primary" id="mtxAnalyze"><i class="ph ph-play"></i> 매물 분석</button>
        <button class="btn btn-sm btn-success" id="mtxApply" disabled><i class="ph ph-check"></i> 확정 일괄 적용</button>
        <button class="btn btn-sm" id="mtxCacheClear"><i class="ph ph-arrow-clockwise"></i> 카탈로그 캐시 초기화</button>
        <span style="margin-left:auto;font-size:11px;color:var(--text-sub);" id="mtxSummary">대기 중</span>
      </div>
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

  el.querySelector('#mtxApply').addEventListener('click', async () => {
    if (!_lastResults || !_lastResults.length) return;
    // 적용 대상: high/medium 신뢰도 + 트림 매칭 성공 + 실제 변경 발생
    const targets = _lastResults
      .filter(({ p, r }) => r.ok && (r.confidence === 'high' || r.confidence === 'medium') && r.trimName)
      .map(({ p, r }) => {
        const newSub = deriveNewSubModel(r.catalogTitle, p.maker);
        const newTrim = r.trimName;
        const subChanged = (p.sub_model || '') !== newSub;
        const trimChanged = (p.trim_name || p.trim || '') !== newTrim;
        return { p, r, newSub, newTrim, subChanged, trimChanged };
      })
      .filter(t => t.subChanged || t.trimChanged);

    if (!targets.length) {
      showToast('변경할 매물 없음');
      return;
    }
    if (!confirm(`매물 ${targets.length}대의 sub_model / trim_name 을 일괄 변경합니다.\n원본은 sub_model_legacy / trim_name_legacy 로 백업됩니다.\n계속할까요?`)) return;

    const btn = el.querySelector('#mtxApply');
    const summary = el.querySelector('#mtxSummary');
    btn.disabled = true;
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
      try {
        const id = t.p._key || t.p.id || t.p.product_uid;
        if (!id) throw new Error('no id');
        await updateRecord('products', id, updates);
        done++;
      } catch (err) {
        fail++;
        devLog(`[matrix-apply] 실패: ${t.p.car_number || t.p._key} — ${err.message}`);
      }
      if (done % 20 === 0) summary.textContent = `적용 중... ${done}/${targets.length}`;
    }
    summary.textContent = `✓ 적용 완료: ${done}건${fail ? ` / 실패 ${fail}건` : ''}`;
    showToast(`${done}대 적용`);
    btn.disabled = false;
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
        <tbody>
          ${results.map(({ p, r }, idx) => {
            let status, statusColor;
            if (!r.ok) { status = '✕ 카탈로그 없음'; statusColor = '#dc2626'; }
            else if (r.confidence === 'high') { status = '✓ 확정'; statusColor = '#16a34a'; }
            else if (r.confidence === 'medium') { status = '◎ 추정'; statusColor = '#0284c7'; }
            else { status = '⚠ 확인 필요'; statusColor = '#d97706'; }

            const rawOpts = Array.isArray(p.options) ? p.options.join(', ') : (p.options || '');
            const newSub = r.ok ? newSubModel(r.catalogTitle, p.maker) : '';

            // 변경되는 셀은 강조, 그대로면 회색 (visual diff)
            const changed = (before, after) => after && before !== after;
            const sameStyle = 'color:var(--text-muted);';   // 그대로 = 흐림
            const changeStyle = 'font-weight:600;color:#0c4a6e;'; // 바뀜 = 진한 파랑

            const beforeBg = 'background:var(--bg-stripe);';
            const afterBg = 'background:var(--alert-blue-bg);';
            const todoCell = (label='매칭 실패') => `<td style="padding:4px 6px;background:#fef3c7;color:#92400e;font-style:italic;font-size:10px;">${label}</td>`;

            // 변경 후 값들 (카탈로그 매칭 OK일 때)
            const newMaker = p.maker;  // 보통 동일
            const newModel = p.model;  // 보통 동일
            const newTrim = r.ok && r.trimName ? r.trimName : (p.trim_name || p.trim || '');

            // 셀 헬퍼: 변경 셀 — 변경됐으면 강조
            const afterCell = (before, after, isFp = false) => {
              if (after == null || after === '') return todoCell();
              const sty = changed(before, after) ? changeStyle : sameStyle;
              return `<td style="padding:4px 6px;${afterBg}${sty}max-width:240px;overflow:hidden;text-overflow:ellipsis;" title="${esc(String(after))}">${esc(String(after))}</td>`;
            };

            // 선택옵션 변경 후 = FP IDs
            const fpAfter = r.ok ? fpDisplay(r.fpAll) : null;

            return `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:4px 6px;color:var(--text-muted);">${idx + 1}</td>
              <td style="padding:4px 6px;border-right:3px solid var(--border-strong);font-family:monospace;font-size:10px;">${e(p.car_number)}</td>

              <!-- 현재 5개 -->
              <td style="padding:4px 6px;${beforeBg}">${e(p.maker)}</td>
              <td style="padding:4px 6px;${beforeBg}">${e(p.model)}</td>
              <td style="padding:4px 6px;${beforeBg}max-width:180px;overflow:hidden;text-overflow:ellipsis;" title="${esc(p.sub_model || '')}">${e(p.sub_model)}</td>
              <td style="padding:4px 6px;${beforeBg}max-width:140px;overflow:hidden;text-overflow:ellipsis;" title="${esc(p.trim_name || p.trim || '')}">${e(p.trim_name || p.trim)}</td>
              <td style="padding:4px 6px;${beforeBg}max-width:240px;overflow:hidden;text-overflow:ellipsis;border-right:3px solid var(--border-strong);" title="${esc(rawOpts)}">${esc(rawOpts.slice(0, 60))}${rawOpts.length > 60 ? '…' : ''}</td>

              <!-- 적용 후 6개 (상태 + 5필드) -->
              <td style="padding:4px 6px;${afterBg}color:${statusColor};font-weight:500;">${status}</td>
              ${afterCell(p.maker, newMaker)}
              ${afterCell(p.model, newModel)}
              ${r.ok ? afterCell(p.sub_model, newSub) : todoCell()}
              ${r.ok ? afterCell(p.trim_name || p.trim, newTrim) : todoCell()}
              ${r.ok ? `<td style="padding:4px 6px;${afterBg}max-width:340px;overflow:hidden;text-overflow:ellipsis;" title="${esc(fpIdsToNames(r.fpAll || []).join(', '))}">${fpAfter}</td>` : todoCell('카탈로그 없음')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

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
    const snap = await get(ref(db, 'partners'));
    const data = snap.val() || {};
    const MAP = { provider: '공급사', channel: '영업채널', supplier: '공급사', sales_channel: '영업채널', operator: '운영사' };
    let count = 0;
    for (const [key, val] of Object.entries(data)) {
      const cur = (val.partner_type || '').toLowerCase();
      const mapped = MAP[cur];
      if (mapped && mapped !== val.partner_type) {
        await update(ref(db, `partners/${key}`), { partner_type: mapped });
        count++;
      }
    }
    devLog(`✓ partner_type 한글화 ${count}건`);
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
        <button class="btn btn-sm is-danger" style="margin-left:auto;" id="stkDel"><i class="ph ph-trash"></i> 선택 삭제</button>
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
  el.querySelector('#stkDel').addEventListener('click', async () => {
    if (!checked.size) return showToast('선택 없음', 'error');
    if (!confirm(`${checked.size}대 삭제 (soft delete)?`)) return;
    let n = 0;
    for (const k of checked) { try { await softDelete(`products/${k}`); n++; } catch(e) {} }
    devLog(`✓ ${n}대 삭제`);
    showToast(`${n}대 완료`);
    checked.clear();
    render();
  });
  render();
}

/* ──────── 3. 공지 CRUD ──────── */
function renderNoticeTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">새 공지 등록</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <input class="input" id="ncTitle" placeholder="제목">
          <textarea class="input" id="ncContent" rows="3" placeholder="내용" style="height:auto;"></textarea>
          <input type="file" id="ncImg" accept="image/*" style="font-size:11px;">
          <button class="btn btn-sm btn-primary" id="ncSave"><i class="ph ph-megaphone"></i> 등록</button>
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">공지 목록</div>
        <div id="ncList"></div>
      </div>
    </div>
  `;
  const renderList = async () => {
    const notices = await fetchCollection('home_notices');
    const list = notices.filter(n => n.status !== 'deleted').sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    el.querySelector('#ncList').innerHTML = list.length ? list.map(n => `
      <div style="padding:8px;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:500;font-size:12px;">${esc(n.title || '')}</div>
            <div style="font-size:11px;color:var(--text-muted);white-space:pre-wrap;">${esc(n.content || '')}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${new Date(n.created_at || 0).toLocaleString('ko')}</div>
          </div>
          <button class="btn btn-xs is-danger" data-del="${esc(n._key)}"><i class="ph ph-x"></i></button>
        </div>
      </div>
    `).join('') : emptyState('공지 없음');
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('삭제?')) return;
      await deleteNotice(b.dataset.del);
      showToast('삭제 완료'); renderList();
    }));
  };
  el.querySelector('#ncSave').addEventListener('click', async () => {
    const title = el.querySelector('#ncTitle').value.trim();
    const content = el.querySelector('#ncContent').value.trim();
    if (!title) return showToast('제목 필수', 'error');
    let image_url = '';
    const f = el.querySelector('#ncImg').files[0];
    if (f) image_url = await uploadNoticeImage(f);
    await saveNotice({ title, content, image_url, created_by: store.currentUser?.user_code || '' });
    showToast('등록 완료'); devLog(`✓ 공지: ${title}`);
    el.querySelector('#ncTitle').value = '';
    el.querySelector('#ncContent').value = '';
    el.querySelector('#ncImg').value = '';
    renderList();
  });
  renderList();
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

/* ──────── 6. 시트 동기화 ────────
 *  오토플러스(파트너코드 RP023) 구글시트 → products 일괄 동기화.
 *  v1 freepasserp 의 /api/sync/external-sheet 를 v3 Vercel Serverless 로 포팅 (api/sync/external-sheet.js).
 *  플로우: [가져오기] 서버에서 시트 읽고 products 객체 반환 → 미리보기 → [적용] 클라이언트가 Firebase 일괄 write.
 */
let _syncFetched = null;

function renderSyncTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;height:100%;">
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">오토플러스 (RP023) — 판매차량리스트(수수료100)</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
          <a href="https://docs.google.com/spreadsheets/d/1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U/edit?gid=741650737" target="_blank" style="color:var(--alert-blue-text);">원본 시트 열기 ↗</a>
          · 파트너코드: RP023 · 출처: external_sheet
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary" id="syncFetchBtn"><i class="ph ph-google-drive-logo"></i> 시트 읽기</button>
          <button class="btn btn-sm" id="syncApplyBtn" disabled><i class="ph ph-cloud-arrow-up"></i> Firebase 적용</button>
          <button class="btn btn-sm" id="syncShowRules" title="시트 컬럼 → products 변환 규칙 펼치기"><i class="ph ph-info"></i> 변환 규칙</button>
          <span id="syncStatusMsg" style="font-size:11px;color:var(--text-muted);align-self:center;margin-left:auto;"></span>
        </div>
      </div>
      <div id="syncRulesBox" style="display:none;border:1px solid var(--border);border-radius:4px;padding:10px;background:var(--bg-stripe);font-size:11px;line-height:1.6;"></div>
      <div id="syncPreview" style="flex:1;overflow:auto;border:1px solid var(--border);border-radius:4px;display:none;"></div>
    </div>
  `;
  const fetchBtn = el.querySelector('#syncFetchBtn');
  const applyBtn = el.querySelector('#syncApplyBtn');
  const statusMsg = el.querySelector('#syncStatusMsg');
  const preview = el.querySelector('#syncPreview');
  const rulesBox = el.querySelector('#syncRulesBox');
  const rulesBtn = el.querySelector('#syncShowRules');

  rulesBtn.addEventListener('click', () => {
    if (rulesBox.style.display === 'block') { rulesBox.style.display = 'none'; return; }
    rulesBox.style.display = 'block';
    rulesBox.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">📋 시트 → products 변환 규칙</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="border-bottom:1px solid var(--border);color:var(--text-sub);">
          <th style="text-align:left;padding:4px 6px;width:140px;">시트 컬럼</th>
          <th style="text-align:left;padding:4px 6px;width:160px;">products 필드</th>
          <th style="text-align:left;padding:4px 6px;">변환</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:3px 6px;">차량번호</td><td style="padding:3px 6px;font-family:monospace;">car_number</td><td style="padding:3px 6px;color:var(--text-sub);">한글 포함된 값만 통과 (헤더·빈 행 제외)</td></tr>
          <tr><td style="padding:3px 6px;">(차량번호 셀의 스마트칩)</td><td style="padding:3px 6px;font-family:monospace;">photo_link</td><td style="padding:3px 6px;color:var(--text-sub);">셀의 chipRuns → drive.google.com URL 추출</td></tr>
          <tr><td style="padding:3px 6px;">차종 (또는 모델명)</td><td style="padding:3px 6px;font-family:monospace;">raw_model_short</td><td style="padding:3px 6px;color:var(--text-sub);">원본 그대로 — 차종 매트릭스에서 maker/model 매핑</td></tr>
          <tr><td style="padding:3px 6px;">풀네임 / 차명</td><td style="padding:3px 6px;font-family:monospace;">raw_model_full</td><td style="padding:3px 6px;color:var(--text-sub);">원본 그대로</td></tr>
          <tr><td style="padding:3px 6px;">색상</td><td style="padding:3px 6px;font-family:monospace;">ext_color</td><td style="padding:3px 6px;color:var(--text-sub);">원본 그대로</td></tr>
          <tr><td style="padding:3px 6px;">연료</td><td style="padding:3px 6px;font-family:monospace;">fuel_type</td><td style="padding:3px 6px;color:var(--text-sub);">원본 그대로</td></tr>
          <tr><td style="padding:3px 6px;">주행거리</td><td style="padding:3px 6px;font-family:monospace;">mileage</td><td style="padding:3px 6px;color:var(--text-sub);">숫자만 추출 (콤마/단위 제거)</td></tr>
          <tr><td style="padding:3px 6px;">최초등록일</td><td style="padding:3px 6px;font-family:monospace;">first_registration_date<br>year</td><td style="padding:3px 6px;color:var(--text-sub);">날짜 그대로 + 앞 4자리 → "YY년식"</td></tr>
          <tr><td style="padding:3px 6px;">현위치</td><td style="padding:3px 6px;font-family:monospace;">location</td><td style="padding:3px 6px;color:var(--text-sub);">원본 그대로</td></tr>
          <tr><td style="padding:3px 6px;" rowspan="3">판매상태</td><td style="padding:3px 6px;font-family:monospace;">status</td><td style="padding:3px 6px;color:var(--text-sub);">판매중·할인판매 → <code>available</code> / 그 외 → <code>unavailable</code></td></tr>
          <tr><td style="padding:3px 6px;font-family:monospace;">vehicle_status</td><td style="padding:3px 6px;color:var(--text-sub);">판매중→<code>출고가능</code>, 계약중→<code>계약완료</code>, 계약요청→<code>계약대기</code>, 보류·매각·완료·수리→<code>출고불가</code></td></tr>
          <tr><td style="padding:3px 6px;font-family:monospace;">status_label</td><td style="padding:3px 6px;color:var(--text-sub);">시트 원문 상태 그대로 보존</td></tr>
          <tr><td style="padding:3px 6px;">옵션</td><td style="padding:3px 6px;font-family:monospace;">options</td><td style="padding:3px 6px;color:var(--text-sub);">원본 그대로 (텍스트)</td></tr>
          <tr><td style="padding:3px 6px;">비고</td><td style="padding:3px 6px;font-family:monospace;">partner_memo</td><td style="padding:3px 6px;color:var(--text-sub);">원본 그대로</td></tr>
          <tr><td style="padding:3px 6px;" rowspan="3">12·24·36개월 임대료 (3만km)</td><td style="padding:3px 6px;font-family:monospace;">price.12.rent<br>price.24.rent<br>price.36.rent</td><td style="padding:3px 6px;color:var(--text-sub);">숫자만 추출 (월 임대료)</td></tr>
          <tr><td style="padding:3px 6px;font-family:monospace;">price.{N}.deposit</td><td style="padding:3px 6px;color:var(--text-sub);">국산 → rent × <b>2</b><br>수입 → rent × <b>3</b><br>(차종에 BMW·벤츠·아우디 등 키워드 있으면 수입 판정)</td></tr>
          <tr><td style="padding:3px 6px;font-family:monospace;">product_type</td><td style="padding:3px 6px;color:var(--text-sub);">고정값 <code>중고구독</code></td></tr>
        </tbody>
      </table>
      <div style="margin-top:8px;font-weight:600;">🆔 식별자</div>
      <div style="color:var(--text-sub);margin-top:2px;">
        <code>product_uid</code> = <code>EXT_</code> + md5(<code>RP023_차량번호</code>) 의 첫 12자리 — 차량번호 기준 고정. 차량번호 같으면 매번 같은 uid 생성 → 멱등 동기화.<br>
        <code>product_code</code> = <code>RP023_차량번호</code><br>
        <code>provider_company_code</code> = <code>RP023</code> · <code>partner_code</code> = <code>RP023</code> · <code>source</code> = <code>external_sheet</code> · <code>is_active</code> = <code>true</code>
      </div>
      <div style="margin-top:8px;font-weight:600;">🔄 적용 규칙</div>
      <div style="color:var(--text-sub);margin-top:2px;">
        <b>신규 차량</b> → 풀세트로 등록 (위 모든 필드 + 빈 maker/model/sub_model/trim_name)<br>
        <b>기존 차량</b> → 가격·상태·주행·메모·위치·사진만 갱신 (수기 보정한 maker/model 등은 보존)<br>
        <b>시트에서 빠진 차량</b> → <code>_deleted: true</code> soft-delete (RP023 + external_sheet 인 것만 대상)
      </div>
    `;
  });

  fetchBtn.addEventListener('click', async () => {
    fetchBtn.disabled = true;
    applyBtn.disabled = true;
    _syncFetched = null;
    preview.style.display = 'none';
    statusMsg.textContent = '시트 읽는 중...';
    devLog('[sync] 오토플러스 시트 fetch 시작');
    try {
      const res = await fetch('/api/sync/external-sheet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '시트 읽기 실패');

      // 기존 vehicle_master 기준 자동 분류 — store.carModels 인덱스로 raw_model_short/full → maker/model/sub_model/trim
      const { buildVehicleIndex, matchVehicle } = await import('../core/vehicle-matcher.js');
      const vmIndex = buildVehicleIndex(store.carModels || []);
      let matched = 0;
      for (const p of Object.values(data.products || {})) {
        const m = matchVehicle(p.raw_model_short || '', p.raw_model_full || '', p.first_registration_date || '', vmIndex);
        if (m.maker)     p.maker = m.maker;
        if (m.model)     p.model = m.model;
        if (m.sub_model) p.sub_model = m.sub_model;
        if (m.trim_name) p.trim_name = m.trim_name;
        if (m.maker && m.model) matched++;
      }

      _syncFetched = data;
      const items = Object.values(data.products || {});
      const unmatched = items.length - matched;
      devLog(`[sync] ✓ ${data.synced}건 · 스킵 ${data.skipped}건 · 자동분류 ${matched}/${items.length}`);
      statusMsg.textContent = `${items.length}건 — 자동분류 ${matched} · 미매칭 ${unmatched} — 확인 후 [Firebase 적용]`;

      // 미리보기 — 좌(시트 추출 raw) ↔ 우(상품찾기에 들어갈 컬럼 그대로) 가로스크롤
      //  우측은 search 페이지의 PRODUCT_COLS 순서 그대로 — 빈 셀(차종 매트릭스 매핑 필요)은 회색 ❓ 표시
      preview.style.display = 'block';
      const fmt = n => n ? Number(n).toLocaleString('ko-KR') : '';
      const fmtMan = fmtMoneyMan;   // 공용 헬퍼 alias (지역 호환)
      const td = (html, opts = {}) => `<td style="padding:4px 6px;${opts.r ? 'text-align:right;font-variant-numeric:tabular-nums;' : ''}${opts.bg ? `background:${opts.bg};` : ''}${opts.bold ? 'font-weight:500;' : ''}${opts.mono ? 'font-family:monospace;font-size:10px;' : ''}${opts.nowrap ? 'white-space:nowrap;' : ''}">${html}</td>`;
      const empty = '<span style="color:var(--text-muted);">❓</span>';
      const e = v => v == null || v === '' ? empty : esc(String(v));
      // 검색 페이지에 들어갈 값 (변환 후) 셀 — 파란 배경
      const map = (v) => td(e(v), { bg: 'var(--alert-blue-bg)', bold: !!v });
      // 시트원본 셀 — 주황 배경
      const raw = (v) => td(e(v), { bg: 'var(--alert-orange-bg)' });
      // 차종 매트릭스에서 매핑할 칸 — 회색 placeholder (값 없을 때)
      const todoMap = '<td style="padding:4px 6px;background:var(--bg-stripe);color:var(--text-muted);font-style:italic;font-size:10px;">차종 매트릭스</td>';
      // 자동 분류된 칸 — 초록 배경 (vehicle_master 매칭 성공) / 빈값이면 todoMap
      const autoMap = (v) => v ? `<td style="padding:4px 6px;background:var(--alert-green-bg);color:var(--alert-green-text);font-weight:500;">${esc(String(v))}</td>` : todoMap;

      preview.innerHTML = `
        <table style="font-size:11px;border-collapse:collapse;white-space:nowrap;">
          <thead style="position:sticky;top:0;z-index:2;">
            <!-- 그룹 헤더 -->
            <tr>
              <th colspan="7" style="padding:6px;background:var(--alert-orange-bg);color:var(--alert-orange-text);border-right:3px solid var(--border-strong);">📄 시트 추출 (오토플러스 원본)</th>
              <th colspan="22" style="padding:6px;background:var(--alert-blue-bg);color:var(--alert-blue-text);">🗂 상품찾기 컬럼 (반영 후)</th>
            </tr>
            <!-- 컬럼 헤더 -->
            <tr style="background:var(--bg-header);font-weight:500;color:var(--text-sub);">
              <!-- 시트 원본 -->
              <th style="padding:4px 6px;text-align:left;">차량번호</th>
              <th style="padding:4px 6px;text-align:left;">차종</th>
              <th style="padding:4px 6px;text-align:left;">풀네임</th>
              <th style="padding:4px 6px;text-align:left;">상태원문</th>
              <th style="padding:4px 6px;text-align:left;">색상</th>
              <th style="padding:4px 6px;text-align:left;">연료</th>
              <th style="padding:4px 6px;text-align:left;border-right:3px solid var(--border-strong);">12·24·36개월</th>
              <!-- 우: 상품찾기 PRODUCT_COLS 순서 그대로 -->
              <th style="padding:4px 6px;text-align:left;">차량상태</th>
              <th style="padding:4px 6px;text-align:left;">신차/중고</th>
              <th style="padding:4px 6px;text-align:left;">렌트/구독</th>
              <th style="padding:4px 6px;text-align:left;">차량번호</th>
              <th style="padding:4px 6px;text-align:left;">제조사</th>
              <th style="padding:4px 6px;text-align:left;">모델</th>
              <th style="padding:4px 6px;text-align:left;">세부모델</th>
              <th style="padding:4px 6px;text-align:left;">연식</th>
              <th style="padding:4px 6px;text-align:right;">주행거리</th>
              <th style="padding:4px 6px;text-align:left;">연료</th>
              <th style="padding:4px 6px;text-align:left;">외장색</th>
              <th style="padding:4px 6px;text-align:left;">내장색</th>
              <th style="padding:4px 6px;text-align:center;">사진</th>
              <th style="padding:4px 6px;text-align:right;">12개월</th>
              <th style="padding:4px 6px;text-align:right;">12보증</th>
              <th style="padding:4px 6px;text-align:right;">24개월</th>
              <th style="padding:4px 6px;text-align:right;">24보증</th>
              <th style="padding:4px 6px;text-align:right;">36개월</th>
              <th style="padding:4px 6px;text-align:right;">36보증</th>
              <th style="padding:4px 6px;text-align:left;">세부트림</th>
              <th style="padding:4px 6px;text-align:left;">옵션</th>
              <th style="padding:4px 6px;text-align:left;">공급사</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(p => {
              const r12 = p.price?.['12']?.rent, r24 = p.price?.['24']?.rent, r36 = p.price?.['36']?.rent;
              const d12 = p.price?.['12']?.deposit, d24 = p.price?.['24']?.deposit, d36 = p.price?.['36']?.deposit;
              const origin = /^신차/.test(p.product_type || '') ? '신차' : (/^중고/.test(p.product_type || '') ? '중고' : '');
              const way = /구독$/.test(p.product_type || '') ? '구독' : (/렌트$/.test(p.product_type || '') ? '렌트' : '');
              return `<tr style="border-bottom:1px solid var(--border);">
                <!-- 시트 원본 7칸 -->
                ${raw(p.car_number)}
                ${raw(p.raw_model_short)}
                <td style="padding:4px 6px;background:var(--alert-orange-bg);max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(p.raw_model_full)}">${e(p.raw_model_full)}</td>
                ${raw(p.status_label)}
                ${raw(p.ext_color)}
                ${raw(p.fuel_type)}
                <td style="padding:4px 6px;background:var(--alert-orange-bg);text-align:right;font-variant-numeric:tabular-nums;border-right:3px solid var(--border-strong);">${[r12, r24, r36].map(fmt).filter(Boolean).join(' / ') || '-'}</td>
                <!-- 상품찾기 컬럼 22칸 -->
                ${map(p.vehicle_status)}
                ${map(origin)}
                ${map(way)}
                ${map(p.car_number)}
                ${autoMap(p.maker)}
                ${autoMap(p.model)}
                ${autoMap(p.sub_model)}
                ${map(p.year)}
                ${td(p.mileage ? p.mileage.toLocaleString('ko-KR') : empty, { r: true, bg: 'var(--alert-blue-bg)' })}
                ${map(p.fuel_type)}
                ${map(p.ext_color)}
                ${todoMap}<!-- 내장색은 시트에 없음 — 항상 매트릭스 매핑 필요 -->
                <td style="padding:4px 6px;text-align:center;background:var(--alert-blue-bg);">${p.photo_link ? `<a href="${esc(p.photo_link)}" target="_blank">📷</a>` : empty}</td>
                ${td(fmtMan(r12) || empty, { r: true, bg: 'var(--alert-blue-bg)' })}
                ${td(fmtMan(d12) || empty, { r: true, bg: 'var(--alert-blue-bg)' })}
                ${td(fmtMan(r24) || empty, { r: true, bg: 'var(--alert-blue-bg)' })}
                ${td(fmtMan(d24) || empty, { r: true, bg: 'var(--alert-blue-bg)' })}
                ${td(fmtMan(r36) || empty, { r: true, bg: 'var(--alert-blue-bg)' })}
                ${td(fmtMan(d36) || empty, { r: true, bg: 'var(--alert-blue-bg)' })}
                ${autoMap(p.trim_name)}
                <td style="padding:4px 6px;background:var(--alert-blue-bg);max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(p.options)}">${e(p.options)}</td>
                ${map(p.partner_code)}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
      applyBtn.disabled = false;
    } catch (e) {
      devLog(`[sync] ✗ ${e.message}`);
      statusMsg.textContent = `오류: ${e.message}`;
      showToast(e.message || '시트 읽기 실패', 'error');
    } finally {
      fetchBtn.disabled = false;
    }
  });

  applyBtn.addEventListener('click', async () => {
    if (!_syncFetched) return;
    applyBtn.disabled = true;
    fetchBtn.disabled = true;
    statusMsg.textContent = 'Firebase 동기화 중...';
    try {
      const products = _syncFetched.products || {};
      const incomingUids = new Set(Object.keys(products));
      // 기존 RP023 + external_sheet products 조회 — 시트에서 빠진 차량은 soft-delete
      const existing = (store.products || []).filter(p =>
        p.source === 'external_sheet' &&
        p.provider_company_code === _syncFetched.provider_code &&
        !p._deleted
      );
      const { ref, update } = await import('firebase/database');
      const { db } = await import('../firebase/config.js');
      const updates = {};
      let added = 0, updated = 0, deleted = 0;
      for (const [uid, p] of Object.entries(products)) {
        const found = existing.find(x => x.product_uid === uid || x._key === uid);
        if (found) {
          // 기존 — 가격·상태·메모는 항상 업데이트
          updates[`products/${found._key}/price`] = p.price;
          updates[`products/${found._key}/vehicle_status`] = p.vehicle_status;
          updates[`products/${found._key}/status`] = p.status;
          updates[`products/${found._key}/status_label`] = p.status_label;
          updates[`products/${found._key}/mileage`] = p.mileage;
          updates[`products/${found._key}/options`] = p.options;
          updates[`products/${found._key}/partner_memo`] = p.partner_memo;
          updates[`products/${found._key}/location`] = p.location;
          updates[`products/${found._key}/photo_link`] = p.photo_link;
          updates[`products/${found._key}/updated_at`] = p.updated_at;
          // 차종 분류 (maker/model/sub_model/trim) — 비어있을 때만 자동 채움 (수기 보정 보존)
          if (!found.maker     && p.maker)     updates[`products/${found._key}/maker`]     = p.maker;
          if (!found.model     && p.model)     updates[`products/${found._key}/model`]     = p.model;
          if (!found.sub_model && p.sub_model) updates[`products/${found._key}/sub_model`] = p.sub_model;
          if (!found.trim_name && p.trim_name) updates[`products/${found._key}/trim_name`] = p.trim_name;
          updated++;
        } else {
          updates[`products/${uid}`] = p;
          added++;
        }
      }
      // 시트에서 빠진 — soft-delete
      for (const x of existing) {
        if (!incomingUids.has(x.product_uid) && !incomingUids.has(x._key)) {
          updates[`products/${x._key}/_deleted`] = true;
          updates[`products/${x._key}/updated_at`] = Date.now();
          deleted++;
        }
      }
      // 청크 단위 multi-update (Firebase 한 번에 너무 많은 키 쏘면 거부)
      const keys = Object.keys(updates);
      const CHUNK = 400;
      for (let i = 0; i < keys.length; i += CHUNK) {
        const slice = {};
        for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
        await update(ref(db), slice);
        devLog(`[sync] 배치 ${Math.min(i + CHUNK, keys.length)}/${keys.length}`);
      }
      devLog(`[sync] ✓ 적용 완료 — 신규 ${added} · 업데이트 ${updated} · 삭제 ${deleted}`);
      statusMsg.textContent = `완료 — 신규 ${added}, 업데이트 ${updated}, 삭제 ${deleted}`;
      showToast(`동기화 완료 (신규 ${added} · 업데이트 ${updated} · 삭제 ${deleted})`);
      _syncFetched = null;
    } catch (e) {
      devLog(`[sync] ✗ ${e.message}`);
      statusMsg.textContent = `오류: ${e.message}`;
      showToast(`동기화 실패: ${e.message}`, 'error');
      applyBtn.disabled = false;
    } finally {
      fetchBtn.disabled = false;
    }
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

/* ──────── 8. 차종 마스터 (엔카마스터) ──────── */
const VM_CATEGORIES = ['경차','소형차','준중형차','중형차','준대형차','대형차','SUV','RV','승합','화물','수입세단','수입SUV','스포츠카','전기차'];
const VM_FUELS = ['가솔린','디젤','LPG','하이브리드','전기','수소'];
const VM_ORIGINS = ['국산','수입'];
const VM_POWERTRAINS = ['내연','하이브리드','전기','수소'];

let _vmState = {
  selectedKey: null,
  mode: 'idle',     // idle / view / edit / new
  filterMaker: '',
  filterQ: '',
  showArchived: false,
  models: [],       // vehicle_master rows
  productCounts: new Map(),  // maker|model|sub → count
};

function renderVehicleTab(el) {
  el.innerHTML = `<div style="padding:12px;text-align:center;color:var(--text-muted);"><i class="ph ph-spinner" style="animation:pd-zip-spin 1s linear infinite;"></i> 로딩 중...</div>`;

  // 데이터 로드 + 구독
  const loadAndRender = async () => {
    const data = await fetchCollection('vehicle_master');
    _vmState.models = data.filter(m => m.status !== 'deleted');
    // 상품 카운트 — products 의 maker|model|sub 매칭 수
    const cnt = new Map();
    for (const p of (store.products || [])) {
      if (p._deleted || p.status === 'deleted') continue;
      const k = [p.maker, p.model, p.sub_model].filter(Boolean).join('|');
      if (k) cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    _vmState.productCounts = cnt;
    drawVehicleTab(el);
  };

  loadAndRender();
  // 실시간 동기화 — vehicle_master 변경 시 자동 갱신
  const unsub = watchRecord('vehicle_master', () => loadAndRender());
  devUnsubs.push(unsub);
}

/* 정렬 우선순위 — 국산 메이저 → 국산 기타 → 수입.
   같은 그룹 내에서는 제조사명 → 모델명 → 세부모델 모두 한국어 로케일 asc */
const KOR_MAKER_ORDER = ['현대', '기아', '제네시스', '쌍용', 'KGM', '르노', '르노삼성', '쉐보레', '한국GM', 'GM대우', '대우'];

function vehicleSortKey(m) {
  const isKor = m.origin === '국산' || KOR_MAKER_ORDER.includes(m.maker);
  const korIdx = KOR_MAKER_ORDER.indexOf(m.maker);
  // 1) 국산 먼저(0) / 수입 나중(1)
  // 2) 국산 메이저 우선순위 인덱스 (없으면 999)
  // 3) 제조사명 asc
  return [isKor ? 0 : 1, korIdx >= 0 ? korIdx : 999, m.maker || ''];
}

function drawVehicleTab(el) {
  const { selectedKey, mode, filterMaker, filterQ, showArchived, models, productCounts } = _vmState;
  const detailEl = document.getElementById('devDetail');

  // 제조사 select 옵션 — 정렬 순서대로
  const makerSet = new Set(models.map(m => m.maker).filter(Boolean));
  const makers = [...makerSet].sort((a, b) => {
    const ai = KOR_MAKER_ORDER.indexOf(a), bi = KOR_MAKER_ORDER.indexOf(b);
    const aIsKor = ai >= 0, bIsKor = bi >= 0;
    if (aIsKor !== bIsKor) return aIsKor ? -1 : 1;
    if (aIsKor) return ai - bi;
    return a.localeCompare(b, 'ko');
  });

  const filtered = models
    .filter(m => showArchived || !m.archived)
    .filter(m => !filterMaker || m.maker === filterMaker)
    .filter(m => {
      if (!filterQ) return true;
      const q = filterQ.toLowerCase();
      return [m.maker, m.model, m.sub, m.car_name, m.category].some(v => v && String(v).toLowerCase().includes(q));
    })
    .map(m => ({ ...m, _count: productCounts.get([m.maker, m.model, m.sub].filter(Boolean).join('|')) || 0 }));

  // 정렬 — 국산우선 → 제조사우선순위 → 제조사명 → 모델명 → 세부모델
  filtered.sort((a, b) => {
    const ka = vehicleSortKey(a), kb = vehicleSortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    const m1 = String(a.maker || '').localeCompare(String(b.maker || ''), 'ko');
    if (m1) return m1;
    const m2 = String(a.model || '').localeCompare(String(b.model || ''), 'ko');
    if (m2) return m2;
    return String(a.sub || '').localeCompare(String(b.sub || ''), 'ko');
  });

  // 제조사별 그룹 행 삽입 — 같은 제조사 처음 등장 시 헤더 row
  const archivedCount = models.filter(m => m.archived).length;
  const sel = selectedKey ? models.find(m => m._key === selectedKey) : null;

  const rowsHtml = filtered.length ? filtered.slice(0, 800).map(m => {
    const rowSel = m._key === selectedKey;
    return `<tr data-key="${esc(m._key)}" style="cursor:pointer;${rowSel ? 'background:var(--bg-selected);' : ''}">
      <td>${esc(m.maker || '-')}</td>
      <td>${esc(m.model || '-')}</td>
      <td>${esc(m.sub || m.car_name || '-')}${m.archived ? ' <span style="color:var(--text-muted);font-size:9px;">[단종]</span>' : ''}</td>
      <td style="color:var(--text-sub);">${esc(m.category || '')}</td>
      <td style="color:var(--text-sub);">${esc(m.year_start || '')}</td>
      <td style="color:var(--text-sub);">${esc(m.year_end || '')}</td>
      <td style="text-align:right;">${m._count || ''}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">데이터 없음</td></tr>`;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;height:100%;">
      <!-- 필터바 -->
      <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
        <input class="input" id="vmQ" placeholder="검색 (제조사·모델·세부)" value="${esc(filterQ)}" style="flex:1;min-width:140px;">
        <select class="input" id="vmMaker" style="width:140px;">
          <option value="">전체 제조사 (${models.length})</option>
          ${makers.map(m => `<option value="${esc(m)}" ${m === filterMaker ? 'selected' : ''}>${esc(m)} (${models.filter(x => x.maker === m).length})</option>`).join('')}
        </select>
        <label style="font-size:11px;color:var(--text-sub);display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" id="vmShowArchived" ${showArchived ? 'checked' : ''}> 단종 ${archivedCount}건
        </label>
        <button class="btn btn-sm btn-primary" id="vmNew"><i class="ph ph-plus"></i> 새 차종</button>
      </div>

      <!-- 목록만 (상세는 우측 패널) -->
      <div style="flex:1;border:1px solid var(--border);border-radius:4px;overflow:auto;min-width:0;">
        <table class="table" style="width:100%;font-size:11px;">
          <thead style="position:sticky;top:0;background:var(--bg-header);z-index:1;">
            <tr>
              <th style="text-align:left;">제조사</th>
              <th style="text-align:left;">모델</th>
              <th style="text-align:left;">세부모델</th>
              <th style="text-align:left;">차종구분</th>
              <th style="text-align:left;">생산시작</th>
              <th style="text-align:left;">생산종료</th>
              <th style="text-align:right;">상품수</th>
            </tr>
          </thead>
          <tbody id="vmRows">${rowsHtml}</tbody>
        </table>
        ${filtered.length > 800 ? `<div style="padding:8px;text-align:center;color:var(--text-muted);font-size:11px;">상위 800건 | 총 ${filtered.length}건 (필터로 좁히세요)</div>` : ''}
      </div>
    </div>
  `;

  // 우측 detail 패널 채우기
  if (detailEl) detailEl.innerHTML = renderVehicleDetail(sel, mode);

  // 필터 이벤트
  el.querySelector('#vmQ').addEventListener('input', (e) => { _vmState.filterQ = e.target.value; drawVehicleTab(el); });
  el.querySelector('#vmMaker').addEventListener('change', (e) => { _vmState.filterMaker = e.target.value; drawVehicleTab(el); });
  el.querySelector('#vmShowArchived').addEventListener('change', (e) => { _vmState.showArchived = e.target.checked; drawVehicleTab(el); });
  el.querySelector('#vmNew').addEventListener('click', () => { _vmState.selectedKey = null; _vmState.mode = 'new'; drawVehicleTab(el); });

  // 행 클릭 → 선택
  el.querySelectorAll('#vmRows tr[data-key]').forEach(tr => {
    tr.addEventListener('click', () => {
      _vmState.selectedKey = tr.dataset.key;
      _vmState.mode = 'view';
      drawVehicleTab(el);
    });
  });

  // 상세 패널 액션 (우측 detail 영역에서)
  bindVehicleDetailActions(el, sel);
}

function renderVehicleDetail(sel, mode) {
  if (mode === 'idle' || (!sel && mode === 'view')) {
    return `<div style="text-align:center;color:var(--text-muted);padding:40px 0;font-size:12px;">왼쪽에서 차종 선택<br><span style="font-size:11px;">또는 우상단 "새 차종" 추가</span></div>`;
  }

  const isEdit = mode === 'edit' || mode === 'new';
  const m = sel || {};
  const row = (label, field, value, type = 'input', opts = null) => {
    if (!isEdit && (value == null || value === '')) return '';
    if (isEdit) {
      if (type === 'select') {
        return `<div class="ff" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
          <label style="width:80px;color:var(--text-muted);font-size:11px;">${esc(label)}</label>
          <select class="input" data-vm-f="${field}" style="flex:1;">
            <option value="">-</option>
            ${(opts || []).map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select>
        </div>`;
      }
      return `<div class="ff" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
        <label style="width:80px;color:var(--text-muted);font-size:11px;">${esc(label)}</label>
        <input class="input" data-vm-f="${field}" value="${esc(value || '')}" style="flex:1;">
      </div>`;
    }
    return `<div style="display:flex;gap:8px;margin-bottom:4px;font-size:12px;">
      <span style="width:80px;color:var(--text-muted);">${esc(label)}</span>
      <span>${esc(value)}</span>
    </div>`;
  };

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-weight:600;font-size:13px;">${isEdit ? (mode === 'new' ? '새 차종 등록' : '편집') : `${esc(m.maker || '')} ${esc(m.sub || m.car_name || '')}`}</span>
      <div style="display:flex;gap:4px;">
        ${isEdit ? `
          <button class="btn btn-sm btn-primary" id="vmSave"><i class="ph ph-check"></i> 저장</button>
          <button class="btn btn-sm" id="vmCancel">취소</button>
        ` : `
          <button class="btn btn-sm" id="vmEdit"><i class="ph ph-pencil"></i> 편집</button>
          <button class="btn btn-sm" id="vmArchive">${m.archived ? '복원' : '단종'}</button>
          <button class="btn btn-sm is-danger" id="vmDelete"><i class="ph ph-trash"></i></button>
        `}
      </div>
    </div>
    <div>
      ${row('제조사*', 'maker', m.maker || '')}
      ${row('모델*', 'model', m.model || '')}
      ${row('세부모델*', 'sub', m.sub || m.car_name || '')}
      ${row('분류', 'category', m.category || '', 'select', VM_CATEGORIES)}
      ${row('연료', 'fuel_type', m.fuel_type || '', 'select', VM_FUELS)}
      ${row('구분', 'origin', m.origin || '', 'select', VM_ORIGINS)}
      ${row('동력', 'powertrain', m.powertrain || '', 'select', VM_POWERTRAINS)}
      ${row('생산 시작', 'year_start', m.year_start || '')}
      ${row('생산 종료', 'year_end', m.year_end || '')}
      ${row('승차정원', 'seats', m.seats || '')}
      ${row('배기량', 'displacement', m.displacement || '')}
      ${row('배터리(kWh)', 'battery_kwh', m.battery_kwh || '')}
      ${row('코드', 'code', m.code || '')}
      ${!isEdit && m._count ? `<div style="margin-top:12px;padding:8px;background:var(--bg-stripe);border-radius:4px;font-size:11px;color:var(--text-sub);">📦 등록된 상품 ${m._count}대</div>` : ''}
    </div>
  `;
}

function bindVehicleDetailActions(el, sel) {
  const detailEl = el.querySelector('[data-vm-f="maker"]')?.closest('div')?.parentElement;
  const collectForm = () => {
    const data = {};
    el.querySelectorAll('[data-vm-f]').forEach(input => {
      const f = input.dataset.vmF;
      const v = input.value.trim();
      if (v) data[f] = v;
    });
    return data;
  };

  el.querySelector('#vmSave')?.addEventListener('click', async () => {
    const form = collectForm();
    if (!form.maker || !form.model || !form.sub) { showToast('제조사·모델·세부모델 필수', 'error'); return; }

    // 숫자 변환
    if (form.seats) form.seats = Number(form.seats);
    if (form.displacement) form.displacement = Number(form.displacement);
    if (form.battery_kwh) form.battery_kwh = Number(form.battery_kwh);

    try {
      const { ref, get, push, set, update } = await import('firebase/database');
      const { db } = await import('../firebase/config.js');
      if (_vmState.mode === 'new') {
        // 중복 체크
        const dup = _vmState.models.some(m => m.maker === form.maker && m.model === form.model && m.sub === form.sub);
        if (dup) { showToast('이미 등록된 세부모델', 'error'); return; }
        const newRef = push(ref(db, 'vehicle_master'));
        await set(newRef, { ...form, status: 'active', created_at: Date.now(), updated_at: Date.now() });
        _vmState.selectedKey = newRef.key;
        devLog(`✓ 차종 추가: ${form.maker} ${form.sub}`);
        showToast(`${form.maker} ${form.sub} 추가`, 'success');
      } else {
        await update(ref(db, `vehicle_master/${_vmState.selectedKey}`), { ...form, updated_at: Date.now() });
        devLog(`✓ 차종 수정: ${form.maker} ${form.sub}`);
        showToast('수정 완료', 'success');
      }
      _vmState.mode = 'view';
      drawVehicleTab(el);
    } catch (e) {
      console.error('[vm save]', e);
      devLog(`✗ 저장 실패: ${e.message}`);
      showToast('저장 실패: ' + (e.code || e.message), 'error');
    }
  });

  el.querySelector('#vmCancel')?.addEventListener('click', () => {
    _vmState.mode = sel ? 'view' : 'idle';
    drawVehicleTab(el);
  });
  el.querySelector('#vmEdit')?.addEventListener('click', () => { _vmState.mode = 'edit'; drawVehicleTab(el); });

  el.querySelector('#vmArchive')?.addEventListener('click', async () => {
    if (!sel) return;
    const next = !sel.archived;
    try {
      await updateRecord(`vehicle_master/${sel._key}`, { archived: next, updated_at: Date.now() });
      devLog(`${next ? '✓ 단종' : '✓ 복원'}: ${sel.maker} ${sel.sub}`);
      showToast(next ? '단종 처리' : '복원 완료');
    } catch (e) { showToast('실패: ' + e.message, 'error'); }
  });

  el.querySelector('#vmDelete')?.addEventListener('click', async () => {
    if (!sel) return;
    if (!confirm(`"${sel.maker} ${sel.sub}" 삭제? (soft delete)`)) return;
    try {
      await softDelete(`vehicle_master/${sel._key}`);
      devLog(`✓ 삭제: ${sel.maker} ${sel.sub}`);
      _vmState.selectedKey = null;
      _vmState.mode = 'idle';
      showToast('삭제 완료');
    } catch (e) { showToast('실패: ' + e.message, 'error'); }
  });
}
