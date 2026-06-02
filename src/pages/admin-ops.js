/**
 * pages/admin-ops.js — 관리자 페이지 (role='admin' 전용)
 *
 * 개발도구(dev.js, 시스템관리자 전용)에서 운영성 기능만 분리:
 *   - sync   : 외부 상품 동기화 (오플시트 / 공급시트 자동탐지 / 종합)
 *   - notice : 대시보드 공지 CRUD
 *
 * 자동 동기화(api/sync/auto.js, Vercel Cron)는 매일 1회 백그라운드 실행 중.
 * 여기 [외부 상품 동기화]는 즉시 반영이 필요할 때 쓰는 수동 경로.
 *
 * 페이지 컨테이너(.pt-page[data-page="admin"]) 안에 마운트.
 */
import { store } from '../core/store.js';
import { fetchCollection } from '../firebase/db.js';
import { showToast } from '../core/toast.js';
import { customConfirm } from '../core/confirm.js';
import { saveNotice, deleteNotice, uploadNoticeImage } from '../firebase/notices.js';
import { esc, emptyState, renderRoomItem, fmtMoneyMan } from '../core/ui-helpers.js';
import { rowsToTsv } from '../core/jonghap-export.js';

let _activeTab = 'jonghap';
let _syncFetched = null;

const TABS = [
  { id: 'jonghap', icon: 'table',            label: '종합표 만들기',   sub: '매물 → 종합탭 붙여넣기' },
  { id: 'sync',    icon: 'google-drive-logo', label: '외부 상품 동기화', sub: '오플시트 / 공급시트 자동탐지 / 종합' },
  { id: 'notice',  icon: 'megaphone',         label: '공지',           sub: '대시보드 공지 CRUD' },
];

/* 로그 패널(#aoLog) 출력 — dev.js 의 devLog 와 동일 역할 */
const devLog = (msg) => {
  const el = document.getElementById('aoLog');
  if (!el) return;
  el.textContent += `[${new Date().toLocaleTimeString('ko')}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
};

export function renderAdminOps() {
  const page = document.querySelector('.pt-page[data-page="admin"]');
  if (!page) return;
  const me = store.currentUser || {};
  if (me.role !== 'admin') {
    page.innerHTML = `<div style="padding: var(--sp-6); color: var(--text-muted); text-align: center;">관리자만 접근 가능합니다.</div>`;
    return;
  }
  const active = TABS.find(t => t.id === _activeTab);
  page.innerHTML = `
    <div class="ws4">
      <!-- 좌 (1): 도구 목록 -->
      <div class="ws4-card ws4-list" style="flex: 1 1 0;">
        <div class="ws4-head"><span>관리자</span></div>
        <div class="ws4-body no-pad">
          ${TABS.map(t => renderRoomItem({
            id: t.id,
            icon: t.icon,
            badge: '',
            tone: 'gray',
            name: t.label,
            time: '',
            msg: t.sub,
            meta: '',
            active: t.id === _activeTab,
          })).join('')}
        </div>
      </div>

      <!-- 가운데 (본문) -->
      <div class="ws4-card" style="flex: 2 1 0;">
        <div class="ws4-head"><span>${esc(active?.label || '')}</span></div>
        <div class="ws4-body" id="aoContent" style="padding: var(--sp-3); overflow: hidden; display: flex; flex-direction: column;"></div>
      </div>

      <!-- 우 (1): 로그 -->
      <div class="ws4-card" style="flex: 1 1 0;">
        <div class="ws4-head"><span>로그</span></div>
        <div class="ws4-body" id="aoLog" style="padding: var(--sp-3); font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-sub); white-space: pre-wrap; overflow-y: auto;"></div>
      </div>
    </div>
  `;

  page.querySelectorAll('.ws4-list .room-item').forEach(item => {
    item.addEventListener('click', () => {
      _activeTab = item.dataset.id;
      renderAdminOps();
    });
  });

  renderTab(_activeTab);
}

function renderTab(id) {
  const el = document.getElementById('aoContent');
  if (!el) return;
  if (id === 'jonghap') return renderJonghapTab(el);
  if (id === 'sync')    return renderSyncTab(el);
  if (id === 'notice')  return renderNoticeTab(el);
}

/* ──────── 종합표 만들기 ────────
 *  오플 + 공급사(보이는 탭) 시트의 42컬럼을 그대로 종합 양식으로 취합 (서버 /api/sync/jonghap).
 *  출고불가/숨김 제외(노출 차량만). [복사] → 클립보드 TSV → 직원이 종합탭에 붙여넣기.
 *  (매일 손으로 공급사 탭 → 종합 취합하던 작업 대체) */
function renderJonghapTab(el) {
  let data = { columns: [], rows: [], tabs: [] };

  const loading = () => {
    el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);"><i class="ph ph-spinner" style="animation:pd-zip-spin 1s linear infinite;"></i> 오플 + 공급사 시트 취합 중...</div>`;
  };
  const fetchData = async () => {
    const res = await fetch('/api/sync/jonghap', { method: 'POST' });
    const out = await res.json();
    if (!out.ok) throw new Error(out.message || '취합 실패');
    return { columns: out.columns || [], rows: out.rows || [], tabs: out.tabs || [] };
  };

  const render = () => {
    const { columns, rows, tabs } = data;
    const PREVIEW = 100;
    const shown = rows.slice(0, PREVIEW);
    const tabSummary = (tabs || []).filter(t => t.count > 0).map(t => `${t.tab} ${t.count}`).join(' · ');
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;height:100%;">
        <div class="ao-banner">
          <i class="ph ph-table"></i>
          <div>
            <b>노출 매물 ${rows.length}건</b>을 종합탭 양식(${columns.length}개 항목)으로 취합했습니다. <span class="ao-banner-sub">(출고불가·숨김 제외)</span><br>
            <span class="ao-banner-sub">[복사] 후 구글시트 <b>종합</b> 탭에 붙여넣기 하세요. (머리글 포함은 빈 시트 처음 채울 때만)</span>
          </div>
        </div>
        <div class="ao-actions">
          <button class="btn btn-sm btn-primary" id="jhCopyValues"><i class="ph ph-copy"></i> 값만 복사 (${rows.length}건)</button>
          <button class="btn btn-sm" id="jhCopyHeader"><i class="ph ph-copy"></i> 머리글 포함 복사</button>
          <button class="btn btn-sm" id="jhRefresh"><i class="ph ph-arrow-clockwise"></i> 새로고침</button>
          <span class="ao-status">미리보기 ${shown.length} / 전체 ${rows.length}건</span>
        </div>
        ${tabSummary ? `<div style="font-size:11px;color:var(--text-weak);">탭별: ${esc(tabSummary)}</div>` : ''}
        <div style="flex:1;overflow:auto;border:1px solid var(--border);border-radius:4px;">
          <table style="font-size:11px;border-collapse:collapse;white-space:nowrap;">
            <thead style="position:sticky;top:0;z-index:2;">
              <tr style="background-color:var(--bg-header);color:var(--text-sub);font-weight:600;">
                <th style="padding:4px 6px;text-align:right;color:var(--text-muted);">#</th>
                ${columns.map(c => `<th style="padding:4px 8px;text-align:left;border-left:1px solid var(--border-soft);">${esc(c)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${shown.map((r, i) => `<tr style="border-bottom:1px solid var(--border-soft);">
                <td style="padding:3px 6px;text-align:right;color:var(--text-muted);">${i + 1}</td>
                ${r.map(v => `<td style="padding:3px 8px;border-left:1px solid var(--border-soft);max-width:220px;overflow:hidden;text-overflow:ellipsis;" title="${esc(v)}">${esc(v) || '<span style="color:var(--text-muted);">·</span>'}</td>`).join('')}
              </tr>`).join('')}
            </tbody>
          </table>
          ${rows.length > PREVIEW ? `<div style="padding:8px;text-align:center;color:var(--text-muted);font-size:11px;">… 미리보기 ${PREVIEW}건만 표시. 복사는 전체 ${rows.length}건.</div>` : ''}
          ${rows.length === 0 ? '<div style="padding:24px;text-align:center;color:var(--text-muted);">취합된 매물이 없습니다.</div>' : ''}
        </div>
      </div>
    `;
    const copy = (withHeader) => {
      const tsv = rowsToTsv(data, withHeader);
      navigator.clipboard?.writeText(tsv).then(
        () => showToast(`복사됨 — ${data.rows.length}건${withHeader ? ' (머리글 포함)' : ''}. 종합탭에 붙여넣기 하세요`),
        () => showToast('복사 실패 — 브라우저 권한 확인', 'error'),
      );
    };
    el.querySelector('#jhCopyValues').addEventListener('click', () => copy(false));
    el.querySelector('#jhCopyHeader').addEventListener('click', () => copy(true));
    el.querySelector('#jhRefresh').addEventListener('click', () => load());
  };

  const load = async () => {
    loading();
    try { data = await fetchData(); render(); }
    catch (e) { el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--alert-red-text);">취합 실패: ${esc(e.message)}</div>`; }
  };
  load();
}

/* ──────── 공지 CRUD ──────── */
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
      if (!await customConfirm({ message: '이 공지를 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
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

/* ──────── 외부 상품 동기화 ────────
 *  오토플러스(파트너코드 RP023) 구글시트 → products 일괄 동기화.
 *  서버(api/sync/external-sheet.js)가 시트 읽고 products 객체 반환 → 미리보기 → [적용] 클라이언트가 Firebase 일괄 write.
 *  ※ 자동(매일 1회 cron) 은 api/sync/auto.js 가 서버측에서 동일 로직으로 처리.
 */
function renderSyncTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;height:100%;">

      <!-- 자동 동기화 안내 -->
      <div class="ao-banner">
        <i class="ph ph-arrows-clockwise"></i>
        <div>
          <b>자동 동기화 가동 중</b> · 매일 새벽 3시에 공급사 시트가 자동으로 반영됩니다.<br>
          <span class="ao-banner-sub">지금 바로 반영해야 할 때만 아래 수동 불러오기를 사용하세요.</span>
        </div>
      </div>

      <!-- 1단계: 시트 선택 -->
      <div class="ao-step">
        <div class="ao-step-title"><span class="ao-step-no">1</span> 불러올 시트 선택</div>
        <div class="ao-sources">
          <button class="ao-source" id="syncFetchAutoplusBtn" data-source="autoplus">
            <span class="ao-source-name"><i class="ph ph-table"></i> 오토플러스</span>
            <span class="ao-source-desc">오플 재고 리스트 (RP023)</span>
          </button>
          <button class="ao-source" id="syncFetchSupplyBtn" data-source="supply">
            <span class="ao-source-name"><i class="ph ph-table"></i> 공급사 통합</span>
            <span class="ao-source-desc">공급코드·정책코드 있는 탭 자동 탐지</span>
          </button>
          <button class="ao-source" id="syncFetchGeneralBtn" data-source="general">
            <span class="ao-source-name"><i class="ph ph-table"></i> 종합 탭</span>
            <span class="ao-source-desc">차고지에서 회사명 자동 추출 (보조)</span>
          </button>
        </div>
        <div class="ao-links">
          <a href="https://docs.google.com/spreadsheets/d/1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U/edit?gid=284963459" target="_blank">오플시트 열기 ↗</a>
          ·
          <a href="https://docs.google.com/spreadsheets/d/1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg/edit?gid=1422892422" target="_blank">종합시트 열기 ↗</a>
        </div>
      </div>

      <!-- 2단계: 검토 후 반영 -->
      <div class="ao-step">
        <div class="ao-step-title"><span class="ao-step-no">2</span> 검토 후 반영</div>
        <div class="ao-actions">
          <button class="btn btn-sm btn-primary" id="syncApplyBtn" disabled><i class="ph ph-check-circle"></i> ERP에 반영</button>
          <button class="btn btn-sm" id="syncShowRules"><i class="ph ph-info"></i> 불러오는 항목 안내</button>
          <span id="syncStatusMsg" class="ao-status"></span>
        </div>
        <div class="ao-hint">불러온 매물을 아래 표에서 확인한 뒤 [ERP에 반영]을 누르면 상품 목록에 적용됩니다. 차량 상태는 5종(즉시출고 / 출고가능 / 상품화중 / 출고협의 / 출고불가)으로 정리되고, 그 외 값은 자동으로 출고불가 처리됩니다.</div>
      </div>

      <div id="syncRulesBox" style="display:none;border:1px solid var(--border);border-radius:4px;padding:10px;background-color:var(--bg-stripe);font-size:11px;line-height:1.6;"></div>
      <div id="syncPreview" style="flex:1;overflow:auto;border:1px solid var(--border);border-radius:4px;display:none;"></div>
    </div>
  `;
  const fetchAutoplusBtn = el.querySelector('#syncFetchAutoplusBtn');
  const fetchGeneralBtn  = el.querySelector('#syncFetchGeneralBtn');
  const fetchSupplyBtn   = el.querySelector('#syncFetchSupplyBtn');
  const fetchBtns = [fetchAutoplusBtn, fetchGeneralBtn, fetchSupplyBtn];
  const applyBtn = el.querySelector('#syncApplyBtn');
  const statusMsg = el.querySelector('#syncStatusMsg');
  const preview = el.querySelector('#syncPreview');
  const rulesBox = el.querySelector('#syncRulesBox');
  const rulesBtn = el.querySelector('#syncShowRules');

  rulesBtn.addEventListener('click', () => {
    if (rulesBox.style.display === 'block') { rulesBox.style.display = 'none'; return; }
    rulesBox.style.display = 'block';
    rulesBox.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">시트의 어떤 항목이 어떻게 들어오나요?</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="border-bottom:1px solid var(--border);color:var(--text-sub);">
          <th style="text-align:left;padding:4px 6px;width:150px;">시트 항목</th>
          <th style="text-align:left;padding:4px 6px;width:130px;">ERP 항목</th>
          <th style="text-align:left;padding:4px 6px;">처리 방식</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:3px 6px;">차량번호</td><td style="padding:3px 6px;">차량번호</td><td style="padding:3px 6px;color:var(--text-sub);">한글 포함된 값만 인식 (머리글·빈 줄 제외)</td></tr>
          <tr><td style="padding:3px 6px;">(차량번호 칸의 사진 링크)</td><td style="padding:3px 6px;">대표 사진</td><td style="padding:3px 6px;color:var(--text-sub);">셀에 첨부된 구글드라이브 링크 자동 추출</td></tr>
          <tr><td style="padding:3px 6px;">차종 / 모델명</td><td style="padding:3px 6px;">제조사·모델·세부모델</td><td style="padding:3px 6px;color:var(--text-sub);">원문 보존 후 차종 마스터로 자동 매칭</td></tr>
          <tr><td style="padding:3px 6px;">색상 · 연료</td><td style="padding:3px 6px;">외장색 · 연료</td><td style="padding:3px 6px;color:var(--text-sub);">원문 그대로</td></tr>
          <tr><td style="padding:3px 6px;">주행거리</td><td style="padding:3px 6px;">주행거리</td><td style="padding:3px 6px;color:var(--text-sub);">숫자만 추출 (콤마·단위 제거)</td></tr>
          <tr><td style="padding:3px 6px;">최초등록일</td><td style="padding:3px 6px;">최초등록일 · 연식</td><td style="padding:3px 6px;color:var(--text-sub);">날짜 보존 + 앞 4자리로 연식 표기</td></tr>
          <tr><td style="padding:3px 6px;">현위치</td><td style="padding:3px 6px;">위치</td><td style="padding:3px 6px;color:var(--text-sub);">원문 그대로</td></tr>
          <tr><td style="padding:3px 6px;">판매상태</td><td style="padding:3px 6px;">차량상태</td><td style="padding:3px 6px;color:var(--text-sub);">5종으로 정리 (즉시출고/출고가능/상품화중/출고협의/출고불가) · 원문도 함께 보존</td></tr>
          <tr><td style="padding:3px 6px;">옵션 · 비고</td><td style="padding:3px 6px;">옵션 · 메모</td><td style="padding:3px 6px;color:var(--text-sub);">원문 그대로</td></tr>
          <tr><td style="padding:3px 6px;">12·24·36개월 임대료</td><td style="padding:3px 6px;">월 임대료 · 보증금</td><td style="padding:3px 6px;color:var(--text-sub);">월 임대료는 숫자만 추출 · 보증금은 국산 ×2 / 수입 ×3 으로 자동 산정</td></tr>
        </tbody>
      </table>
      <div style="margin-top:8px;font-weight:600;">반영 규칙</div>
      <div style="color:var(--text-sub);margin-top:2px;">
        <b>새 차량</b> → 위 항목 모두 등록<br>
        <b>이미 있는 차량</b> → 가격·상태·주행·메모·위치·사진만 갱신 (수기로 보정한 차종 정보는 보존)<br>
        <b>시트에서 빠진 차량</b> → <b>출고불가</b>로 표시 (시트에 다시 나타나면 자동 복원)
      </div>
    `;
  });

  const onFetchClick = async (e) => {
    const source = e.currentTarget.dataset.source;
    fetchBtns.forEach(b => b.disabled = true);
    applyBtn.disabled = true;
    _syncFetched = null;
    preview.style.display = 'none';
    const sourceLabel = source === 'autoplus' ? '오플시트' : source === 'supply' ? '공급시트' : '종합 탭';
    statusMsg.textContent = `${sourceLabel} 읽는 중...`;
    devLog(`[sync] ${source} 시트 fetch 시작`);
    try {
      const res = await fetch('/api/sync/external-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '시트 읽기 실패');

      // autoplus 만 catalog 기반 자동 분류 (raw_model_short/full 컬럼 있음).
      //   v3 source of truth = public/data/car-master/_index.json (catalog).
      //   vehicle_master Firebase 컬렉션은 더 이상 단독 사용 X — catalog 우선 + vehicle_master 보조.
      // general 은 시트 자체에 maker/model/sub_model/trim 컬럼 그대로 담고 있어 매칭 불필요.
      let matched = 0;
      const items = Object.values(data.products || {});
      if (data.schema === 'autoplus') {
        const { buildVehicleIndex, matchVehicle } = await import('../core/vehicle-matcher.js');
        const { loadIndex } = await import('../core/vehicle-matrix.js');
        const catalogIdx = await loadIndex();
        // catalog → carModel 호환 (maker / model=model_root / sub_model=title-maker접두사).
        //   title="현대 쏘나타 DN8" → sub_model="쏘나타 DN8" (raw_model_full 매칭 성공률 위함).
        //   "더 뉴 / 올 뉴" 같은 페리 접두사는 유지 (페리/pre 구분에 필요).
        const MARKETING_PREFIX = /^(?:디\s*올\s*뉴|올\s*뉴|더\s*뉴|신형|뉴|올뉴|더뉴|디올뉴)\s+/;
        const stripTitle = (title, maker) => {
          let t = String(title || '').trim();
          if (maker && t.startsWith(maker + ' ')) t = t.slice(maker.length + 1).trim();
          t = t.replace(MARKETING_PREFIX, '');
          return t;
        };
        const catalogModels = Object.values(catalogIdx || {}).map(c => ({
          maker: c.maker,
          model: c.model_root,
          sub_model: stripTitle(c.title, c.maker),
          year_start: c.year_start || '',
          year_end: c.year_end || '',
          title: c.title || '',
          status: c.status === 'archived' ? 'deleted' : 'active',
        })).filter(m => m.maker && m.model);
        // 안전 fallback — vehicle_master 도 있으면 합침
        const merged = [...catalogModels, ...((store.carModels || []).filter(m => m.maker && m.model))];
        const vmIndex = buildVehicleIndex(merged);
        devLog(`[sync] catalog 인덱스: ${catalogModels.length}개 + vehicle_master ${(store.carModels || []).length}개`);
        for (const p of items) {
          const m = matchVehicle(p.raw_model_short || '', p.raw_model_full || '', p.first_registration_date || '', vmIndex);
          if (m.maker)     p.maker = m.maker;
          if (m.model)     p.model = m.model;
          if (m.sub_model) p.sub_model = m.sub_model;
          if (m.trim_name) p.trim_name = m.trim_name;
          if (m.maker && m.model) matched++;
        }
      } else {
        for (const p of items) if (p.maker && p.model) matched++;
      }
      _syncFetched = data;
      const unmatched = items.length - matched;
      devLog(`[sync] ✓ ${data.synced}건 · 스킵 ${data.skipped}건 · 자동분류 ${matched}/${items.length}`);
      // 공급시트 자동탐지 — 처리한 탭 목록 표시
      if (data.schema === 'auto-supply' && Array.isArray(data.tabs_scanned)) {
        const tabSummary = data.tabs_scanned.map(t => `${t.tab}(${t.synced})`).join(', ');
        devLog(`[sync] 탐지 탭: ${tabSummary}`);
      }
      const schemaLabel = data.schema === 'auto-supply' ? '공급시트' : data.schema === 'general' ? '종합 탭' : '오플시트';
      statusMsg.textContent = `${schemaLabel} — ${items.length}건 · 자동분류 ${matched} · 미매칭 ${unmatched} — 확인 후 [ERP에 반영]`;

      // 미리보기 — 좌(시트 추출 raw) ↔ 우(상품찾기에 들어갈 컬럼 그대로) 가로스크롤
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
      fetchBtns.forEach(b => b.disabled = false);
    }
  };
  fetchAutoplusBtn.addEventListener('click', onFetchClick);
  fetchGeneralBtn.addEventListener('click', onFetchClick);
  fetchSupplyBtn.addEventListener('click', onFetchClick);

  applyBtn.addEventListener('click', async () => {
    if (!_syncFetched) return;
    applyBtn.disabled = true;
    fetchBtns.forEach(b => b.disabled = true);
    statusMsg.textContent = 'ERP에 반영 중...';
    try {
      const products = _syncFetched.products || {};
      const incomingUids = new Set(Object.keys(products));
      // 기존 external_sheet 매물 조회 — autoplus 면 RP023 단일, general 이면 schema 일치 전체
      const schema = _syncFetched.schema || 'autoplus';
      const existing = (store.products || []).filter(p => {
        if (p.source !== 'external_sheet' || p._deleted) return false;
        if (schema === 'autoplus') return p.provider_company_code === _syncFetched.provider_code;
        if (schema === 'general')  return p.source_schema === 'general';
        if (schema === 'auto-supply') {
          // 공급시트 동기화 — 같은 schema 의 기존 매물 + 시트에 등장한 partner_code 들에 한함
          if (p.source_schema !== 'general') return false;
          const tabPartners = new Set(Object.values(_syncFetched.products || {}).map(x => x.partner_code).filter(Boolean));
          return tabPartners.has(p.partner_code);
        }
        return false;
      });
      const { ref, update } = await import('firebase/database');
      const { db } = await import('../firebase/config.js');
      const updates = {};
      let added = 0, updated = 0;
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
          if (p.photo_link) updates[`products/${found._key}/photo_link`] = p.photo_link;   // 시트에 사진 링크 있을 때만 (빈값으로 기존 사진 덮어쓰기 방지)
          updates[`products/${found._key}/updated_at`] = p.updated_at;
          // 차종 분류 (maker/model/sub_model/trim) — 비어있을 때만 자동 채움 (수기 보정 보존)
          if (!found.maker     && p.maker)     updates[`products/${found._key}/maker`]     = p.maker;
          if (!found.model     && p.model)     updates[`products/${found._key}/model`]     = p.model;
          if (!found.sub_model && p.sub_model) updates[`products/${found._key}/sub_model`] = p.sub_model;
          if (!found.trim_name && p.trim_name) updates[`products/${found._key}/trim_name`] = p.trim_name;
          // 시트의 정책코드/공급코드 — 시트값 명시되면 항상 우선 (사용자 마스터 데이터)
          if (p.policy_code)            updates[`products/${found._key}/policy_code`]            = p.policy_code;
          if (p.provider_company_code)  updates[`products/${found._key}/provider_company_code`]  = p.provider_company_code;
          if (p.partner_code)           updates[`products/${found._key}/partner_code`]           = p.partner_code;
          updated++;
        } else {
          updates[`products/${uid}`] = p;
          added++;
        }
      }
      // 시트에서 빠진 — 삭제 X, '출고불가' 로 마킹 (재등장 시 시트값 따라 자동 복원).
      let droppedToBlocked = 0;
      for (const x of existing) {
        if (!incomingUids.has(x.product_uid) && !incomingUids.has(x._key)) {
          updates[`products/${x._key}/vehicle_status`] = '출고불가';
          updates[`products/${x._key}/status`] = 'unavailable';
          updates[`products/${x._key}/status_label`] = '시트에서 제거됨';
          updates[`products/${x._key}/updated_at`] = Date.now();
          droppedToBlocked++;
        }
      }
      const dropped = droppedToBlocked;
      // 청크 단위 multi-update (Firebase 한 번에 너무 많은 키 쏘면 거부)
      const keys = Object.keys(updates);
      const CHUNK = 400;
      for (let i = 0; i < keys.length; i += CHUNK) {
        const slice = {};
        for (const k of keys.slice(i, i + CHUNK)) slice[k] = updates[k];
        await update(ref(db), slice);
        devLog(`[sync] 배치 ${Math.min(i + CHUNK, keys.length)}/${keys.length}`);
      }
      devLog(`[sync] ✓ 적용 완료 — 신규 ${added} · 업데이트 ${updated} · 출고불가 ${dropped}`);
      statusMsg.textContent = `완료 — 신규 ${added}, 업데이트 ${updated}, 출고불가 ${dropped}`;
      showToast(`동기화 완료 (신규 ${added} · 업데이트 ${updated} · 출고불가 ${dropped})`);
      _syncFetched = null;
    } catch (e) {
      devLog(`[sync] ✗ ${e.message}`);
      statusMsg.textContent = `오류: ${e.message}`;
      showToast(`동기화 실패: ${e.message}`, 'error');
      applyBtn.disabled = false;
    } finally {
      fetchBtns.forEach(b => b.disabled = false);
    }
  });
}
