/**
 * Central Store — Proxy-based reactive state
 * Single source of truth for all data
 *
 * **인덱스 (O(1) lookup)**:
 *   매물·계약·파트너 등 자주 lookup 하는 컬렉션은 자동으로 Map 인덱스를 빌드.
 *   `.find(p => p._key === k)` (O(N)) 대신 `findProduct(k)` (O(1)) 사용.
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

/* ──────── O(1) lookup 인덱스 ────────
 * 컬렉션이 set 될 때마다 자동 갱신. _<key>By<Field> 형태로 보관.
 * 같은 product 가 _key / product_uid 두 키로 둘 다 lookup 가능. */
const indexes = {
  productByKey: new Map(),
  productByUid: new Map(),
  contractByCode: new Map(),
  contractByKey: new Map(),
  partnerByCode: new Map(),
  partnerByKey: new Map(),
  settlementByCode: new Map(),
  userByUid: new Map(),
  policyByCode: new Map(),
  roomByKey: new Map(),
};

const INDEX_BUILDERS = {
  products: (arr) => {
    indexes.productByKey.clear();
    indexes.productByUid.clear();
    for (const p of arr || []) {
      if (p?._key) indexes.productByKey.set(p._key, p);
      if (p?.product_uid) indexes.productByUid.set(p.product_uid, p);
    }
  },
  contracts: (arr) => {
    indexes.contractByCode.clear();
    indexes.contractByKey.clear();
    for (const c of arr || []) {
      if (c?.contract_code) indexes.contractByCode.set(c.contract_code, c);
      if (c?._key) indexes.contractByKey.set(c._key, c);
    }
  },
  partners: (arr) => {
    indexes.partnerByCode.clear();
    indexes.partnerByKey.clear();
    for (const p of arr || []) {
      if (p?.partner_code) indexes.partnerByCode.set(p.partner_code, p);
      if (p?._key) indexes.partnerByKey.set(p._key, p);
    }
  },
  settlements: (arr) => {
    indexes.settlementByCode.clear();
    for (const s of arr || []) {
      if (s?.contract_code) indexes.settlementByCode.set(s.contract_code, s);
    }
  },
  users: (arr) => {
    indexes.userByUid.clear();
    for (const u of arr || []) {
      if (u?.uid) indexes.userByUid.set(u.uid, u);
    }
  },
  policies: (arr) => {
    indexes.policyByCode.clear();
    for (const p of arr || []) {
      if (p?.policy_code) indexes.policyByCode.set(p.policy_code, p);
    }
  },
  rooms: (arr) => {
    indexes.roomByKey.clear();
    for (const r of arr || []) {
      if (r?._key) indexes.roomByKey.set(r._key, r);
    }
  },
};

export const store = new Proxy(state, {
  set(target, key, value) {
    const old = target[key];
    target[key] = value;
    if (old !== value) {
      // 컬렉션 인덱스 자동 갱신 (listener 호출 전 — listener 가 finder 사용 가능하도록)
      if (INDEX_BUILDERS[key]) INDEX_BUILDERS[key](value);
      const cbs = listeners.get(key);
      if (cbs) cbs.forEach(cb => cb(value, old));
    }
    return true;
  }
});

/* ──────── O(1) finder helpers ──────── */
export const findProduct       = (key) => indexes.productByKey.get(key) || null;
export const findProductByUid  = (uid) => indexes.productByUid.get(uid) || null;
export const findContract      = (code) => indexes.contractByCode.get(code) || null;
export const findContractByKey = (key) => indexes.contractByKey.get(key) || null;
export const findPartner       = (code) => indexes.partnerByCode.get(code) || null;
export const findPartnerByKey  = (key) => indexes.partnerByKey.get(key) || null;
export const findSettlement    = (code) => indexes.settlementByCode.get(code) || null;
export const findUser          = (uid) => indexes.userByUid.get(uid) || null;
export const findPolicy        = (code) => indexes.policyByCode.get(code) || null;
export const findRoom          = (key) => indexes.roomByKey.get(key) || null;

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
