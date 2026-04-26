/**
 * Central Store — Proxy-based reactive state
 * Single source of truth for all data
 */
const listeners = new Map(); // key → Set<callback>

const state = {
  // Auth
  currentUser: null,
  authReady: false,

  // Data (populated by Firebase watchers)
  products: [],
  contracts: [],
  settlements: [],
  rooms: [],
  users: [],
  partners: [],
  policies: [],
  carModels: [],        // 차종 마스터 (jpkerp-next와 공유, RTDB car_models)
  vehicleMaster: {},
  colorMaster: {},
  codeItems: [],

  // UI state
  currentPage: '',
  activeRoomId: null,
  sidebarCollapsed: false,
  theme: (typeof localStorage !== 'undefined' ? localStorage.getItem('fp.theme') : null) || 'light',
};

export const store = new Proxy(state, {
  set(target, key, value) {
    const old = target[key];
    target[key] = value;
    if (old !== value) {
      const cbs = listeners.get(key);
      if (cbs) cbs.forEach(cb => cb(value, old));
    }
    return true;
  }
});

export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  // Immediately fire with current value
  callback(state[key], undefined);
  // Return unsubscribe function
  return () => listeners.get(key)?.delete(callback);
}

export function getState(key) {
  return state[key];
}

/**
 * Role-based data filter — collection-name 기반 (메뉴 배지 집계용).
 * 페이지 목록 필터는 core/roles.js 의 filterByRole(list, me) 사용.
 */
export function filterCollectionByRole(data, collection) {
  const user = state.currentUser;
  if (!user || user.role === 'admin') return data;

  if (user.role === 'provider') {
    const code = user.company_code;
    if (collection === 'products') return data.filter(p => p.provider_company_code === code);
    if (collection === 'contracts') return data.filter(c => c.provider_company_code === code);
    if (collection === 'settlements') return data.filter(s => s.partner_code === code);
    if (collection === 'rooms') return data.filter(r => r.provider_company_code === code);
    if (collection === 'policies') return data.filter(p => p.provider_company_code === code);
  }

  if (user.role === 'agent') {
    const uid = user.uid;
    const code = user.user_code;
    if (collection === 'contracts') return data.filter(c => c.agent_uid === uid || c.agent_code === code);
    if (collection === 'settlements') return data.filter(s => s.agent_uid === uid || s.agent_code === code);
    if (collection === 'rooms') return data.filter(r => r.agent_uid === uid);
  }

  return data;
}
