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

/** 역할 표시 라벨 (전역 단일 소스 — 파일마다 중복 정의 금지) */
const ROLE_LABELS = Object.freeze({
  admin: '관리자',
  provider: '공급사',
  agent: '영업자',
  agent_admin: '영업관리자',
  agent_manager: '영업관리자',
});
export function roleLabel(role) {
  return ROLE_LABELS[role] || role || '';
}

/** 영업자 or 영업관리자 */
export function isAgentSide(role) {
  return role === ROLES.AGENT || role === ROLES.AGENT_ADMIN;
}

/** 당사자 (읽음/알림 대상) */
export function isParty(role) {
  return role === ROLES.AGENT || role === ROLES.AGENT_ADMIN || role === ROLES.PROVIDER;
}

/**
 * 역할별 서버측 쿼리 스코프 — watchCollection({ scope }) 용.
 * 자기 것만 '다운로드'(filterByRole 은 화면 필터, 이건 서버 쿼리). admin=null(전체).
 *  계약·정산 모두 agent_uid / provider_company_code / agent_channel_code 보유 (생성 시 세팅).
 * @returns {{field:string, value:string}|null}
 */
export function roleScope(me) {
  if (!me?.role || me.role === ROLES.ADMIN) return null;   // 전체
  const NONE = '\x00none';   // 값 없으면 아무것도 안 매칭 (미배정 사용자는 빈 목록)
  if (me.role === ROLES.AGENT) {
    // 팀 매니저: 소속 채널 전체 계약 조회 (뷰어 모드)
    if (me.is_team_manager && (me.team_channel_code || me.agent_channel_code || me.company_code))
      return { field: 'agent_channel_code', value: me.team_channel_code || me.agent_channel_code || me.company_code };
    return { field: 'agent_uid', value: me.uid || NONE };
  }
  if (me.role === ROLES.AGENT_ADMIN || me.role === ROLES.AGENT_MANAGER)
    return { field: 'agent_channel_code', value: me.agent_channel_code || me.company_code || NONE };
  if (me.role === ROLES.PROVIDER)
    return { field: 'provider_company_code', value: me.company_code || NONE };
  return { field: 'agent_uid', value: me.uid || NONE };   // 알수없는 역할 = 보수적
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
      // 팀 매니저: 소속 채널 전체 계약 (뷰어 모드)
      if (me.is_team_manager && me.team_channel_code)
        return list.filter(r => r[agentChannelCode] === me.team_channel_code);
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
