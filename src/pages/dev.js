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
import { esc, emptyState } from './../core/ui-helpers.js';

let devUnsubs = [];
let _activeDev = 'tools';

const DEV_TABS = [
  { id: 'vehicle', icon: 'car-profile',     label: '차종 마스터', sub: '제조사·모델·세부모델' },
  { id: 'notice',  icon: 'megaphone',       label: '공지',        sub: '대시보드 공지 CRUD' },
  { id: 'color',   icon: 'palette',         label: '색상 옵션',   sub: '외장·내장 색상' },
  { id: 'data',    icon: 'database',        label: 'RTDB 현황',   sub: '컬렉션 viewer' },
  { id: 'upload',  icon: 'upload-simple',   label: '일괄 업로드', sub: 'CSV / Excel' },
  { id: 'sync',    icon: 'google-drive-logo', label: '시트 동기화', sub: 'Google Sheets' },
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
  page.innerHTML = `
    <div class="ws4">
      <!-- 좌 (1): 도구 목록 -->
      <div class="ws4-card ws4-list" style="flex: 1 1 0;">
        <div class="ws4-head"><i class="ph ph-code"></i> <span>개발도구</span></div>
        <div class="ws4-body" style="padding: var(--sp-2);">
          ${DEV_TABS.map(t => `
            <button class="settings-tab ${t.id === _activeDev ? 'is-active' : ''}" data-dev="${t.id}">
              <i class="ph ph-${t.icon}"></i>
              <span class="settings-tab-text">
                <span class="settings-tab-label">${t.label}</span>
                <span class="settings-tab-sub">${t.sub}</span>
              </span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- 가운데 (2): 본문 -->
      <div class="ws4-card" style="flex: 2 1 0;">
        <div class="ws4-head">
          <i class="ph ph-${active?.icon}"></i>
          <span>${esc(active?.label || '')}</span>
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 11px;">${esc(active?.sub || '')}</span>
        </div>
        <div class="ws4-body" id="devContent" style="padding: var(--sp-3); overflow-y: auto;"></div>
      </div>

      <!-- 우 (1): 로그 -->
      <div class="ws4-card" style="flex: 1 1 0;">
        <div class="ws4-head"><i class="ph ph-terminal"></i> <span>로그</span></div>
        <div class="ws4-body" id="devLog" style="padding: var(--sp-3); font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-sub); white-space: pre-wrap; overflow-y: auto;"></div>
      </div>
    </div>
  `;

  page.querySelectorAll('[data-dev]').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeDev = btn.dataset.dev;
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
  if (id === 'tools')   return renderToolsTab(el);
  if (id === 'stock')   return renderStockTab(el);
  if (id === 'notice')  return renderNoticeTab(el);
  if (id === 'vehicle') return renderVehicleTab(el);
  if (id === 'color')   return renderColorTab(el);
  if (id === 'upload')  return renderUploadTab(el);
  if (id === 'sync')    return renderSyncTab(el);
  if (id === 'data')    return renderDataTab(el);
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
          <button class="btn" id="devCacheClear"><i class="ph ph-trash"></i> 캐시 초기화 (localStorage)</button>
          <button class="btn" id="devStoreView"><i class="ph ph-database"></i> Store 상태 보기</button>
          <button class="btn" id="devReload"><i class="ph ph-arrow-clockwise"></i> 강제 새로고침</button>
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">일회성 마이그레이션</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn" id="devMigrateTermPolicy"><i class="ph ph-swap"></i> policies: term_* → policy_*</button>
          <button class="btn" id="devMigrateModelName"><i class="ph ph-swap"></i> model_name → model</button>
          <button class="btn" id="devMigratePartnerType"><i class="ph ph-swap"></i> partner_type 영어 → 한글</button>
          <button class="btn" id="devMigrateUserCode"><i class="ph ph-identification-badge"></i> user_code 일괄부여</button>
          <button class="btn" id="devMigrateCreditGrade"><i class="ph ph-swap"></i> credit_grade: 저신용 → 신용무관</button>
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
    devLog(`✓ policies 스캔 ${scanned}건 · rename ${moved}건`);
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
        <button class="btn" id="stkAll">전체 선택</button>
        <button class="btn" id="stkNone">해제</button>
        <button class="btn" style="background:#dc2626;color:#fff;margin-left:auto;" id="stkDel"><i class="ph ph-trash"></i> 선택 삭제</button>
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
    el.querySelector('#stkCount').textContent = `${list.length}대 · 선택 ${checked.size}`;
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
    }).join('') + (list.length > 500 ? `<div style="padding:8px;text-align:center;color:var(--text-muted);font-size:11px;">상위 500건 · 필터로 좁히세요</div>` : '');
    el.querySelectorAll('#stkList input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) checked.add(cb.dataset.k); else checked.delete(cb.dataset.k);
        el.querySelector('#stkCount').textContent = `${list.length}대 · 선택 ${checked.size}`;
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
          <button class="btn btn-primary" id="ncSave"><i class="ph ph-megaphone"></i> 등록</button>
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
          <button class="btn" style="background:#dc2626;color:#fff;height:24px;padding:0 8px;" data-del="${esc(n._key)}"><i class="ph ph-x"></i></button>
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
          <button class="btn btn-primary" id="extAdd"><i class="ph ph-plus"></i> 추가</button>
        </div>
        <div id="extList" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">내장색</div>
        <div style="display:flex;gap:4px;margin-bottom:6px;">
          <input class="input" id="intIn" placeholder="색상명" style="flex:1;">
          <button class="btn btn-primary" id="intAdd"><i class="ph ph-plus"></i> 추가</button>
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
      ? ext.map(c => `<span class="chip" style="cursor:default;">${esc(c)}<button style="background:none;border:none;margin-left:4px;cursor:pointer;color:#dc2626;" data-exd="${esc(c)}">×</button></span>`).join('')
      : '<span style="color:var(--text-muted);font-size:11px;">없음</span>';
    el.querySelector('#intList').innerHTML = intC.length
      ? intC.map(c => `<span class="chip" style="cursor:default;">${esc(c)}<button style="background:none;border:none;margin-left:4px;cursor:pointer;color:#dc2626;" data-ind="${esc(c)}">×</button></span>`).join('')
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
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">차량번호 컬럼 필수 · 헤더 첫 행</div>
        <input type="file" id="upFile" accept=".csv,.tsv" style="font-size:11px;margin-bottom:6px;">
        <button class="btn btn-primary" id="upBtn"><i class="ph ph-upload-simple"></i> 업로드</button>
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

/* ──────── 6. 시트 동기화 ──────── */
function renderSyncTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">외부 시트 동기화</div>
        <input class="input" id="syncUrl" placeholder="구글시트 공유 URL" style="margin-bottom:6px;">
        <button class="btn btn-primary" id="syncBtn"><i class="ph ph-google-drive-logo"></i> 가져오기</button>
      </div>
    </div>
  `;
  el.querySelector('#syncBtn').addEventListener('click', async () => {
    const url = el.querySelector('#syncUrl').value.trim();
    if (!url) return showToast('URL 필요', 'error');
    devLog('동기화 요청...');
    try {
      const res = await fetch('/api/vehicle-master/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url: url })
      });
      const data = await res.json();
      if (data.ok) { devLog(`✓ ${data.text?.split('\n').length || 0}행`); showToast('완료'); }
      else { devLog(`✗ ${data.message}`); showToast(data.message || '실패', 'error'); }
    } catch (e) { devLog(`✗ ${e.message}`); showToast('오류', 'error'); }
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

/* ──────── 8. 차종 마스터 ──────── */
function renderVehicleTab(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:12px;color:var(--text-muted);">
        차종 마스터는 vehicle_master 테이블을 사용합니다. 추가/수정은 향후 별도 페이지로 분리 예정 — 현재는 RTDB 현황 탭에서 vehicle_master 조회 가능.
      </div>
      <button class="btn" id="vmView"><i class="ph ph-eye"></i> vehicle_master 조회</button>
      <div id="vmList" style="font-size:11px;color:var(--text-sub);white-space:pre-wrap;font-family:monospace;max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:8px;"></div>
    </div>
  `;
  el.querySelector('#vmView').addEventListener('click', async () => {
    const data = await fetchCollection('vehicle_master');
    el.querySelector('#vmList').textContent = JSON.stringify(data.slice(0, 50), null, 2);
    devLog(`vehicle_master ${data.length}건 (상위 50건 표시)`);
  });
}
