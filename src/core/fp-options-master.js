/**
 * fp-options-master.js — FP 95 표준옵션 마스터 (id → 한글 명칭)
 *
 * vehicle-options-catalog-test.html 의 OPTIONS 와 동일. 한 곳에서 관리.
 * kind: 'opt' (직원 선택) / 'unc' (모호 자동체크) / undefined (트림 종속)
 */

export const FP_OPT_MASTER = {
  exterior: { label:'외관', items: [
    ['SUNROOF','썬루프(일반)','opt'],['SUNROOF_PANO','파노라마 썬루프','opt'],['SUNROOF_SAFETY','세이프티 썬루프','opt'],
    ['HEAD_LED','LED 헤드램프'],['HEAD_HID','제논 헤드램프(HID)','unc'],['POSITION_LED','LED 포지션램프'],
    ['DRL','주간 주행등'],['HEAD_ESCORT','에스코트 헤드램프','unc'],
    ['MIRROR_FOLD','전동접이 사이드미러'],['MIRROR_ADJ','전동조절 사이드미러','unc'],
    ['ROOF_RACK','루프랙','unc'],['ALUMINUM_WHEEL','알루미늄휠'],
    ['FOG_LED','안개등 (LED)'],['REAR_LED_COMBI','LED 리어 콤비네이션 램프'],
  ]},
  interior: { label:'내장', items: [
    ['CRUISE','크루즈컨트롤'],['STR_REMOTE','스티어링 휠 리모컨'],
    ['AUTO_LIGHT','오토 라이트 컨트롤'],['POWER_STR','파워 스티어링'],
    ['HANDS_FREE','핸즈프리'],['HEAT_STR','열선 스티어링휠','unc'],
    ['POWER_SEAT_DR','전동시트(운전석)'],['POWER_SEAT_PS','전동시트(동승석)','unc'],
    ['MEMORY_SEAT_DR','메모리시트(운전석)','unc'],['MEMORY_SEAT_PS','메모리시트(동승석)','opt'],
    ['HEAT_SEAT_FRONT','열선시트(앞좌석)'],['HEAT_SEAT_REAR','열선시트(뒷좌석)','unc'],
    ['VENT_SEAT_DR','통풍시트(운전석)','unc'],['VENT_SEAT_PS','통풍시트(동승석)','unc'],
    ['SEAT_LEATHER','가죽시트'],['SEAT_FABRIC','직물 시트'],['SEAT_MIX','직물+가죽 시트'],
    ['ECM_MIRROR','ECM룸미러'],
    ['ECM_HIPASS_RV','ECM룸미러(하이패스+리어뷰내장)','unc'],
    ['ECM_HIPASS_MTS','ECM룸미러(하이패스+MTS내장)','unc'],
    ['HIPASS_MIRROR','하이패스 룸미러'],['REAR_MIRROR','후방 룸미러'],
    ['MTS_E_MIRROR','전자식 룸미러(MTS)','opt'],
  ]},
  safety: { label:'안전', items: [
    ['AIRBAG_DR','에어백(운전석)'],['AIRBAG_PS','에어백(동승석)'],
    ['AIRBAG_SIDE','에어백(사이드)'],['AIRBAG_KNEE','에어백(무릎보호)','unc'],
    ['CAM_REAR','후방 카메라'],['SENSOR_REAR','후방 감지센서'],
    ['CAM_FRONT','전방 카메라','unc'],['SENSOR_FRONT','전방 감지센서','unc'],
    ['AVMS','어라운드 뷰 (AVMS)','unc'],['SPAS','주차 조향 보조 시스템 (SPAS)','unc'],
    ['FOOT_PARKING','풋파킹 브레이크'],['EPB','전자식 파킹 브레이크'],
    ['ABS','ABS'],['BAS','제동 도움 장치(BAS)'],
    ['AEB','자동 긴급 제동 시스템 (AEB)','unc'],['VDC','차체자세제어 (VDC/VSM/ESC/ESP)'],
    ['TCS','미끄럼방지 (TCS)'],['ESS','급제동 경보 (ESS)'],
    ['TPMS','타이어 공기압감지 (TPMS)'],['HDA','고속도로 주행 지원시스템 (HDA)','unc'],
    ['LDWS','차선이탈 경보 (LDWS)','unc'],['LKAS','차선 유지 보조 (LKAS)','unc'],
    ['DAW','운전자 주의 경고 (DAW)','unc'],['FCWS','전방 추돌 경보 (FCWS)','unc'],
    ['DBC','경사로 저속주행 (DBC)','unc'],['ECS','전자제어 서스펜션 (ECS/ALS)','opt'],
    ['HUD','헤드업 디스플레이 (HUD)','opt'],['RCTA','후측방 경보시스템 (RCTA)','unc'],
    ['HAC','경사로 밀림방지 (HAC)'],
  ]},
  convenience: { label:'편의', items: [
    ['NAVIGATION','내비게이션'],['HIPASS','하이패스','unc'],
    ['BLACKBOX','블랙박스 (사후장착)','opt'],['BUILTIN_CAM','빌트인캠 (정품)','unc'],
    ['BUTTON_START','버튼 시동'],['SMART_KEY','스마트키'],
    ['REMOTE_LOCK','무선 도어 잠금장치'],['REMOTE_START','원격시동','unc'],
    ['AUTO_AC','자동 에어컨'],['AUTO_AC_REAR','자동 에어컨 (뒷좌석)','unc'],['MANUAL_AC','매뉴얼 에어컨'],
    ['SLIDING_DOOR','파워 슬라이딩 도어','unc'],['SMART_TRUNK','스마트 트렁크/테일게이트','unc'],
    ['POWER_TRUNK','파워트렁크','unc'],['POWER_WINDOW','파워윈도우'],
    ['CURTAIN_M','커튼(수동식)','unc'],['CURTAIN_E','커튼(전동식)','opt'],
    ['ECO_GUIDE','경제운전 안내(액티브)','unc'],['WPC','무선충전 시스템(WPC)','unc'],
  ]},
  media: { label:'미디어', items: [
    ['CD_PLAYER','CD플레이어','opt'],['MP3','MP3'],['REAR_TV','뒷자석 TV','opt'],
    ['BLUETOOTH','블루투스'],['AUX','AUX 단자','opt'],['USB','USB 단자'],
    ['MIRRORING','유선 미러링','unc'],['MIRRORING_WIRELESS','무선 카플레이/안드로이드오토','unc'],
    ['WELCOME','웰컴 시스템','opt'],['VOICE_RECOG','음성인식 시스템','unc'],
  ]},
};

// id → 한글 이름 lookup map (자주 사용)
export const FP_NAME_BY_ID = (() => {
  const m = {};
  for (const cat of Object.values(FP_OPT_MASTER)) {
    for (const [id, name] of cat.items) m[id] = name;
  }
  return m;
})();

// id → kind ('opt' / 'unc' / undefined)
export const FP_KIND_BY_ID = (() => {
  const m = {};
  for (const cat of Object.values(FP_OPT_MASTER)) {
    for (const item of cat.items) m[item[0]] = item[2];
  }
  return m;
})();

/** ID 배열을 한글 이름 배열로 변환 (모르는 ID는 그대로) */
export function fpIdsToNames(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map(id => FP_NAME_BY_ID[id] || id);
}
