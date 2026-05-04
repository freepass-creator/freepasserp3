/**
 * delete-actions.js — 6개 컬렉션 삭제 + 역할별 권한 체크
 *
 * app.js 에서 분리 (2316 LOC → 작은 책임 단위로 쪼갬). canDelete 가 단일 진실의 원천.
 *
 * 권한:
 *  - admin: 전체 가능
 *  - provider: 본인 회사 record (product/policy/settlement/room/contract) 만
 *  - agent: 본인 record (contract/room) 만
 *  - agent_admin: 본인 채널 (contract/room) 만
 *  - partner: admin 만
 */
import { store } from './store.js';
import { updateRecord } from '../firebase/db.js';
import { showToast } from './toast.js';
import { customConfirm } from './confirm.js';

export function canDelete(rec, kind) {
  const me = store.currentUser || {};
  if (!me.role) return false;
  if (me.role === 'admin') return true;
  const myCo = me.company_code || me.partner_code || '';
  const myCh = me.agent_channel_code || me.channel_code || '';
  switch (kind) {
    case 'product':
    case 'policy':
      return me.role === 'provider' && (rec.provider_company_code === myCo || rec.partner_code === myCo);
    case 'settlement':
      return me.role === 'provider' && rec.provider_company_code === myCo;
    case 'room':
      return (me.role === 'agent' && rec.agent_uid === me.uid)
          || (me.role === 'agent_admin' && rec.agent_channel_code === myCh)
          || (me.role === 'provider' && rec.provider_company_code === myCo);
    case 'contract':
      return (me.role === 'agent' && rec.agent_uid === me.uid)
          || (me.role === 'agent_admin' && rec.agent_channel_code === myCh)
          || (me.role === 'provider' && rec.provider_company_code === myCo);
    case 'partner':
    default:
      return false;
  }
}

export async function deleteProduct(p) {
  if (!p) return;
  if (!canDelete(p, 'product')) { showToast('삭제 권한이 없습니다', 'error'); return; }
  if (!await customConfirm({ message: `${p.car_number || '이 차량'}을 삭제하시겠습니까?`, danger: true, okLabel: '삭제' })) return;
  try {
    await updateRecord(`products/${p._key}`, { _deleted: true, updated_at: Date.now() }, { silent: true });
    showToast('삭제됨');
  } catch (e) {
    showToast('삭제 실패', 'error');
  }
}

export async function deletePolicy(id) {
  if (!id) return;
  const pol = (store.policies || []).find(x => x._key === id);
  if (!pol) return;
  if (!canDelete(pol, 'policy')) { showToast('삭제 권한이 없습니다', 'error'); return; }
  if (!await customConfirm({ message: `${pol.policy_name || '정책'} 을 삭제하시겠습니까?`, danger: true, okLabel: '삭제' })) return;
  try {
    await updateRecord(`policies/${id}`, { _deleted: true, updated_at: Date.now() }, { silent: true });
    showToast('삭제됨');
  } catch (e) {
    showToast('삭제 실패', 'error');
  }
}

export async function deletePartner(id) {
  if (!id) return;
  const pt = (store.partners || []).find(x => x._key === id);
  if (!pt) return;
  if (!canDelete(pt, 'partner')) { showToast('삭제 권한이 없습니다 (관리자 전용)', 'error'); return; }
  if (!await customConfirm({ message: `${pt.partner_name || '파트너'} 를 삭제하시겠습니까?`, danger: true, okLabel: '삭제' })) return;
  try {
    await updateRecord(`partners/${id}`, { _deleted: true, updated_at: Date.now() }, { silent: true });
    showToast('삭제됨');
  } catch (e) {
    showToast('삭제 실패', 'error');
  }
}

export async function deleteRoom(id) {
  if (!id) return;
  const r = (store.rooms || []).find(x => x._key === id);
  if (!r) return;
  if (!canDelete(r, 'room')) { showToast('삭제 권한이 없습니다', 'error'); return; }
  if (!await customConfirm({ message: `${r.car_number || '이 대화'} 를 삭제하시겠습니까?`, danger: true, okLabel: '삭제' })) return;
  try {
    await updateRecord(`rooms/${id}`, { _deleted: true, updated_at: Date.now() }, { silent: true });
    showToast('삭제됨');
  } catch (e) { showToast('삭제 실패', 'error'); }
}

export async function deleteContract(id) {
  if (!id) return;
  const c = (store.contracts || []).find(x => x._key === id || x.contract_code === id);
  if (!c) return;
  if (!canDelete(c, 'contract')) { showToast('삭제 권한이 없습니다', 'error'); return; }
  if (!await customConfirm({ message: `${c.contract_code || '이 계약'} 을 삭제하시겠습니까?`, danger: true, okLabel: '삭제' })) return;
  try {
    await updateRecord(`contracts/${c._key}`, { _deleted: true, updated_at: Date.now() }, { silent: true });
    showToast('삭제됨');
  } catch (e) { showToast('삭제 실패', 'error'); }
}

export async function deleteSettlement(id) {
  if (!id) return;
  const s = (store.settlements || []).find(x => x._key === id);
  if (!s) return;
  if (!canDelete(s, 'settlement')) { showToast('삭제 권한이 없습니다', 'error'); return; }
  if (!await customConfirm({ message: '이 정산을 삭제하시겠습니까?', danger: true, okLabel: '삭제' })) return;
  try {
    await updateRecord(`settlements/${id}`, { _deleted: true, updated_at: Date.now() }, { silent: true });
    showToast('삭제됨');
  } catch (e) { showToast('삭제 실패', 'error'); }
}
