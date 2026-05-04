/**
 * 역할 상수 — 전역 사용 (문자열 하드코딩 방지)
 */
export const ROLES = Object.freeze({
  AGENT: 'agent',
  AGENT_ADMIN: 'agent_admin',
  AGENT_MANAGER: 'agent_manager',  // 영업관리자 (소속 영업자 계약/정산만 보기, 대화는 X)
  PROVIDER: 'provider',
  ADMIN: 'admin',
});

/** 영업자 or 영업관리자 */
export function isAgentSide(role) {
  return role === ROLES.AGENT || role === ROLES.AGENT_ADMIN;
}

/** 당사자 (읽음/알림 대상) */
export function isParty(role) {
  return role === ROLES.AGENT || role === ROLES.AGENT_ADMIN || role === ROLES.PROVIDER;
}

/**
 * 역할별 필터링 — 계약/정산/방 공통
 * @param {Array} list
 * @param {Object} me - currentUser
 * @param {Object} fieldMap - { agentUid, agentCode, providerUid, providerCompanyCode, partnerCode, agentChannelCode }
 * @returns {Array}
 */
export function filterByRole(list, me, fieldMap = {}) {
  if (!me?.role) return list;
  const {
    agentUid = 'agent_uid',
    agentCode = 'agent_code',
    providerUid = 'provider_uid',
    providerCompanyCode = 'provider_company_code',
    partnerCode = 'partner_code',
    agentChannelCode = 'agent_channel_code',
  } = fieldMap;

  const myChannel = me.agent_channel_code || me.channel_code || '';
  const myCompanyCode = me.company_code || '';
  const myUserCode = me.user_code || '';

  switch (me.role) {
    case ROLES.AGENT:
      return list.filter(r => r[agentUid] === me.uid || r[agentCode] === myUserCode);
    case ROLES.AGENT_ADMIN:
    case ROLES.AGENT_MANAGER:
      return list.filter(r => r[agentChannelCode] === myChannel);
    case ROLES.PROVIDER:
      return list.filter(r =>
        r[providerUid] === me.uid ||
        r[providerCompanyCode] === myCompanyCode ||
        r[partnerCode] === myCompanyCode
      );
    case ROLES.ADMIN:
    default:
      return list;
  }
}
