/**
 * 대시보드 — 공지사항 + 오늘의 할 일 + 8섹션 분석
 */
import { store } from '../core/store.js';
import { watchCollection } from '../firebase/db.js';
import { watchNotices } from '../firebase/notices.js';
import { navigate } from '../core/router.js';
import { fmtMoney } from '../core/format.js';
import { SETTLEMENT_STATUS as SS, getSettlementStatus } from '../core/settlement-status.js';

let unsubs = [];

export function mount() {
  unsubs.forEach(u => u?.());
  unsubs = [];

  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="dash-page" id="dashPage"><div class="dash-loading">로딩 중...</div></div>`;

  const collections = ['products', 'contracts', 'settlements', 'rooms', 'users', 'partners'];
  const loadedSet = new Set();
  collections.forEach(col => {
    unsubs.push(watchCollection(col, (data) => {
      store[col] = data;
      loadedSet.add(col);
      if (loadedSet.size >= collections.length) renderDash();
    }));
  });

  unsubs.push(watchNotices((data) => {
    store.notices = data;
    if (loadedSet.size >= collections.length) renderDash();
  }));
}

function renderDash() {
  const el = document.getElementById('dashPage');
  if (!el) return;

  const contracts = store.contracts || [];
  const settlements = store.settlements || [];
  const products = store.products || [];
  const rooms = store.rooms || [];
  const users = store.users || [];
  const partners = store.partners || [];
  const notices = (store.notices || []).filter(n => !n._deleted);
  const role = store.currentUser?.role;

  const now = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();
  const weekMs = todayMs - 7 * 86400000;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const monthMs = monthStart.getTime();

  const unreadRooms = rooms.filter(r => {
    if (role === 'agent') return r.unread_for_agent > 0;
    if (role === 'provider') return r.unread_for_provider > 0;
    return false;
  }).length;

  const staleContracts = contracts.filter(c =>
    !['계약완료','계약취소'].includes(c.contract_status) &&
    Math.floor((now - (c.updated_at||c.created_at||0)) / 86400000) >= 3
  ).length;

  const pendingSettlements = settlements.filter(s => getSettlementStatus(s) === SS.PENDING).length;
  const pendingUsers = users.filter(u => u.status === 'pending').length;

  const ct = (list, since) => list.filter(c => (c.created_at||0) >= since).length;
  const done = (since) => contracts.filter(c => c.contract_status === '계약완료' && (c.updated_at||0) >= since).length;
  const monthFee = settlements.filter(s => getSettlementStatus(s) === SS.DONE && (s.updated_at||0) >= monthMs).reduce((sum,s) => sum + (Number(s.fee_amount)||0), 0);

  const availProducts = products.filter(p => p.vehicle_status === '출고가능' || p.status === 'available').length;
  const topMaker = topN(products.map(p=>p.maker).filter(Boolean), 1)[0];
  const topFuel = topN(products.map(p=>p.fuel_type).filter(Boolean), 1)[0];

  const statusDist = {};
  contracts.forEach(c => { statusDist[c.contract_status] = (statusDist[c.contract_status]||0) + 1; });

  el.innerHTML = `
    ${notices.length ? `<div class="dash-section">
      <div class="dash-section-title">공지사항</div>
      ${notices.slice(0,3).map(n => `<div style="padding:var(--sp-2) 0;border-bottom:1px solid var(--c-border);font-size:var(--fs-sm);">
        <div style="font-weight:var(--fw-medium);">${n.title||''}</div>
        <div style="font-size:var(--fs-xs);color:var(--c-text-sub);margin-top:2px;">${n.content||''}</div>
        ${n.image_url ? `<img src="${n.image_url}" style="max-width:100%;margin-top:var(--sp-2);border-radius:var(--ctrl-r);">` : ''}
      </div>`).join('')}
    </div>` : ''}

    <div class="dash-section">
      <div class="dash-section-title">오늘의 할 일</div>
      <div class="dash-todo-list">
        ${todo('ph ph-chat-circle',`안 읽은 대화 ${unreadRooms}건`,unreadRooms,'/','var(--c-accent)')}
        ${todo('ph ph-warning',`3일+ 정체 계약 ${staleContracts}건`,staleContracts,'/contract','var(--c-err)')}
        ${todo('ph ph-coins',`미확인 정산 ${pendingSettlements}건`,pendingSettlements,'/settle','var(--c-warn)')}
        ${role==='admin'?todo('ph ph-user-plus',`승인 대기 ${pendingUsers}건`,pendingUsers,'/admin/users','var(--c-info)'):''}
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">계약</div>
      <div class="dash-kpi-grid">
        ${kpi('오늘',ct(contracts,todayMs)+'건','ph ph-calendar-blank','var(--c-info)')}
        ${kpi('이번주',ct(contracts,weekMs)+'건','ph ph-calendar','var(--c-info)')}
        ${kpi('이번달',ct(contracts,monthMs)+'건','ph ph-calendar-check','var(--c-info)')}
        ${kpi('출고',done(monthMs)+'건','ph ph-car-simple','var(--c-ok)')}
      </div>
      <div class="dash-status-bar" style="margin-top:var(--sp-2);">
        ${['계약대기','계약요청','계약발송','계약완료','계약취소'].map(s => {
          const colors={'계약대기':'var(--c-warn)','계약요청':'var(--c-info)','계약발송':'var(--c-accent)','계약완료':'var(--c-ok)','계약취소':'var(--c-err)'};
          const cnt=statusDist[s]||0; const pct=contracts.length?Math.round(cnt/contracts.length*100):0;
          return `<div class="dash-status-item"><div class="dash-status-fill" style="width:${pct}%;background:${colors[s]};"></div><span class="dash-status-label">${s.replace('계약','')} ${cnt}</span></div>`;
        }).join('')}
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">정산</div>
      <div class="dash-kpi-grid">
        ${kpi('대기',pendingSettlements+'건','ph ph-hourglass','var(--c-warn)')}
        ${kpi('이번달',monthFee?fmtMoney(monthFee):'0원','ph ph-coins','var(--c-accent)')}
        ${kpi('전체',settlements.length+'건','ph ph-stack','var(--c-text-sub)')}
        ${kpi('완료율',settlements.length?Math.round(settlements.filter(s=>getSettlementStatus(s)===SS.DONE).length/settlements.length*100)+'%':'-','ph ph-percent','var(--c-ok)')}
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">상품</div>
      <div class="dash-kpi-grid">
        ${kpi('전체',products.length+'대','ph ph-car-simple','var(--c-text-sub)')}
        ${kpi('출고가능',availProducts+'대','ph ph-check-circle','var(--c-ok)')}
        ${kpi('TOP 제조사',topMaker?`${topMaker[0]}(${topMaker[1]})`:'-','ph ph-factory','var(--c-info)')}
        ${kpi('주요 연료',topFuel?`${topFuel[0]}(${topFuel[1]})`:'-','ph ph-gas-pump','var(--c-warn)')}
      </div>
    </div>

    ${role==='admin'?`
    <div class="dash-section">
      <div class="dash-section-title">파트너</div>
      <div class="dash-kpi-grid">
        ${kpi('공급사',partners.filter(p=>p.partner_type==='provider').length+'곳','ph ph-buildings','var(--c-info)')}
        ${kpi('영업채널',partners.filter(p=>p.partner_type==='sales_channel').length+'곳','ph ph-storefront','var(--c-accent)')}
        ${kpi('활성',partners.filter(p=>p.status==='active').length+'곳','ph ph-check','var(--c-ok)')}
        ${kpi('전체',partners.length+'곳','ph ph-stack','var(--c-text-sub)')}
      </div>
    </div>
    <div class="dash-section">
      <div class="dash-section-title">회원</div>
      <div class="dash-kpi-grid">
        ${kpi('관리자',users.filter(u=>u.role==='admin').length+'명','ph ph-crown','var(--c-accent)')}
        ${kpi('공급사',users.filter(u=>u.role==='provider').length+'명','ph ph-buildings','var(--c-info)')}
        ${kpi('영업자',users.filter(u=>u.role==='agent').length+'명','ph ph-user','var(--c-ok)')}
        ${kpi('대기',pendingUsers+'명','ph ph-hourglass','var(--c-warn)')}
      </div>
    </div>
    `:''}
  `;

  el.querySelectorAll('.dash-todo[data-path]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.path));
  });
}

function todo(icon,text,count,path,color) {
  if(!count) return `<div class="dash-todo dash-todo-clear"><i class="${icon}"></i><span>${text.replace(/\d+/,'0')}</span><span class="dash-todo-badge" style="background:var(--c-ok-bg);color:var(--c-ok);">✓</span></div>`;
  return `<div class="dash-todo" data-path="${path}"><i class="${icon}" style="color:${color};"></i><span>${text}</span><span class="dash-todo-badge" style="background:${color}20;color:${color};">${count}</span><i class="ph ph-caret-right dash-todo-arrow"></i></div>`;
}
function kpi(l,v,icon,color) { return `<div class="dash-kpi"><div class="dash-kpi-icon" style="background:${color}15;color:${color};"><i class="${icon}"></i></div><div class="dash-kpi-body"><div class="dash-kpi-value">${v}</div><div class="dash-kpi-label">${l}</div></div></div>`; }
function topN(arr,n) { const c={}; arr.forEach(v=>{c[v]=(c[v]||0)+1;}); return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,n); }

export function unmount() { unsubs.forEach(u=>u?.()); unsubs=[]; }
