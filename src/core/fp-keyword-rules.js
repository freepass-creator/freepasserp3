/**
 * fp-keyword-rules.js — 카탈로그 옵션명 → FP 95 표준옵션 ID 매핑 룰
 *
 * vehicle-options-catalog-test.html 와 동일한 룰셋. 한 곳에서 관리하기 위해 분리.
 * 긴 키 우선 매칭 (정렬은 호출측에서 1회 처리).
 */

export const FP_KEYWORD_RULES = [
  // 선루프
  { kw:'듀얼와이드선루프', ids:['SUNROOF_PANO'] },
  { kw:'와이드선루프', ids:['SUNROOF_PANO'] }, { kw:'와이드썬루프', ids:['SUNROOF_PANO'] },
  { kw:'파노라마선루프', ids:['SUNROOF_PANO'] }, { kw:'파노라마썬루프', ids:['SUNROOF_PANO'] },
  { kw:'세이프티선루프', ids:['SUNROOF_SAFETY'] }, { kw:'세이프티썬루프', ids:['SUNROOF_SAFETY'] },
  { kw:'듀얼선루프', ids:['SUNROOF_PANO'] },
  { kw:'선루프', ids:['SUNROOF'] }, { kw:'썬루프', ids:['SUNROOF'] },

  // HDA / 스마트크루즈
  { kw:'내비게이션기반스마트크루즈', ids:['HDA','NAVIGATION'] },
  { kw:'스마트크루즈컨트롤', ids:['HDA'] },
  { kw:'고속도로주행보조2', ids:['HDA'] }, { kw:'고속도로주행보조', ids:['HDA'] },
  { kw:'고속도로주행지원', ids:['HDA'] },

  // 내비게이션
  { kw:'증강현실내비게이션', ids:['NAVIGATION'] },
  { kw:'인포테인먼트내비', ids:['NAVIGATION'] },
  { kw:'터치스크린내비게이션', ids:['NAVIGATION'] },
  { kw:'내비게이션', ids:['NAVIGATION'] },

  // 어라운드뷰
  { kw:'서라운드뷰', ids:['AVMS'] },
  { kw:'어라운드뷰', ids:['AVMS'] },
  { kw:'avm', ids:['AVMS'] },

  // 통풍시트
  { kw:'운전석동승석통풍시트', ids:['VENT_SEAT_DR','VENT_SEAT_PS'] },
  { kw:'앞좌석통풍시트', ids:['VENT_SEAT_DR','VENT_SEAT_PS'] },
  { kw:'앞좌석통풍열선시트', ids:['VENT_SEAT_DR','VENT_SEAT_PS','HEAT_SEAT_FRONT'] },
  { kw:'12열통풍열선시트', ids:['VENT_SEAT_DR','HEAT_SEAT_FRONT','HEAT_SEAT_REAR'] },
  { kw:'1열열선통풍시트', ids:['VENT_SEAT_DR','HEAT_SEAT_FRONT'] },
  { kw:'1열통풍시트', ids:['VENT_SEAT_DR'] },
  { kw:'운전석통풍시트', ids:['VENT_SEAT_DR'] },
  { kw:'동승석통풍시트', ids:['VENT_SEAT_PS'] },
  { kw:'2열통풍시트', ids:[] },
  { kw:'뒷좌석통풍시트', ids:[] },
  { kw:'통풍시트', ids:['VENT_SEAT_DR'] },

  // 열선시트
  { kw:'전좌석열선시트', ids:['HEAT_SEAT_FRONT','HEAT_SEAT_REAR'] },
  { kw:'1열2열열선시트', ids:['HEAT_SEAT_FRONT','HEAT_SEAT_REAR'] },
  { kw:'12열열선시트', ids:['HEAT_SEAT_FRONT','HEAT_SEAT_REAR'] },
  { kw:'뒷좌석열선시트', ids:['HEAT_SEAT_REAR'] },
  { kw:'2열열선시트', ids:['HEAT_SEAT_REAR'] },
  { kw:'3열열선시트', ids:[] },
  { kw:'앞좌석열선시트', ids:['HEAT_SEAT_FRONT'] },
  { kw:'1열열선시트', ids:['HEAT_SEAT_FRONT'] },
  { kw:'운전석열선시트', ids:['HEAT_SEAT_FRONT'] },
  { kw:'열선시트', ids:['HEAT_SEAT_FRONT'] },

  // HUD
  { kw:'증강현실헤드업디스플레이', ids:['HUD'] },
  { kw:'arhud', ids:['HUD'] },
  { kw:'헤드업디스플레이', ids:['HUD'] },
  { kw:'hud', ids:['HUD'] },

  // 트렁크
  { kw:'스마트파워트렁크', ids:['POWER_TRUNK','SMART_TRUNK'] },
  { kw:'핸즈프리테일게이트', ids:['SMART_TRUNK'] },
  { kw:'스마트테일게이트', ids:['SMART_TRUNK'] },
  { kw:'스마트트렁크', ids:['SMART_TRUNK'] },
  { kw:'파워테일게이트', ids:['POWER_TRUNK'] },
  { kw:'파워트렁크', ids:['POWER_TRUNK'] },

  // 카플레이/안드로이드오토
  { kw:'무선애플카플레이무선안드로이드오토', ids:['MIRRORING_WIRELESS'] },
  { kw:'무선애플카플레이', ids:['MIRRORING_WIRELESS'] },
  { kw:'무선카플레이', ids:['MIRRORING_WIRELESS'] },
  { kw:'무선안드로이드오토', ids:['MIRRORING_WIRELESS'] },
  { kw:'애플카플레이', ids:['MIRRORING'] },
  { kw:'안드로이드오토', ids:['MIRRORING'] },
  { kw:'미러링', ids:['MIRRORING'] },

  // 빌트인캠
  { kw:'빌트인캠2plus', ids:['BUILTIN_CAM'] },
  { kw:'빌트인캠2', ids:['BUILTIN_CAM'] },
  { kw:'빌트인캠', ids:['BUILTIN_CAM'] },

  // 후측방
  { kw:'후측방충돌방지보조', ids:['RCTA'] },
  { kw:'후측방경보시스템', ids:['RCTA'] },
  { kw:'후측방경보', ids:['RCTA'] },
  { kw:'후측방충돌경고', ids:['RCTA'] },
  { kw:'후방교차충돌방지보조', ids:['RCTA'] },
  { kw:'rcta', ids:['RCTA'] },

  // 무선충전
  { kw:'스마트폰무선충전', ids:['WPC'] },
  { kw:'무선충전시스템', ids:['WPC'] },
  { kw:'무선충전', ids:['WPC'] },
  { kw:'wpc', ids:['WPC'] },

  // 메모리
  { kw:'운전석자세메모리시스템', ids:['MEMORY_SEAT_DR'] },
  { kw:'메모리시트운전석', ids:['MEMORY_SEAT_DR'] },
  { kw:'메모리시트동승석', ids:['MEMORY_SEAT_PS'] },
  { kw:'메모리시트', ids:['MEMORY_SEAT_DR'] },

  // 가죽시트
  { kw:'천연가죽시트', ids:['SEAT_LEATHER'] },
  { kw:'나파가죽시트', ids:['SEAT_LEATHER'] },
  { kw:'가죽시트', ids:['SEAT_LEATHER'] },

  // 스마트키
  { kw:'인텔리전트스마트키', ids:['SMART_KEY','BUTTON_START','REMOTE_START'] },
  { kw:'디지털키', ids:['SMART_KEY'] },
  { kw:'스마트키', ids:['SMART_KEY'] },

  // 원격시동
  { kw:'원격시동', ids:['REMOTE_START'] },

  // 음성인식
  { kw:'음성인식', ids:['VOICE_RECOG'] },

  // 안전
  { kw:'전방충돌방지보조', ids:['AEB','FCWS'] },
  { kw:'자동긴급제동시스템', ids:['AEB'] },
  { kw:'자동긴급제동', ids:['AEB'] },
  { kw:'다중충돌방지자동제동', ids:['AEB'] },
  { kw:'충돌방지자동제동', ids:['AEB'] },
  { kw:'차체자세제어장치', ids:['VDC'] },
  { kw:'차체자세제어', ids:['VDC'] },
  { kw:'esc', ids:['VDC'] }, { kw:'vdc', ids:['VDC'] }, { kw:'vsm', ids:['VDC'] },
  { kw:'미끄럼방지', ids:['TCS'] }, { kw:'tcs', ids:['TCS'] },
  { kw:'제동도움장치', ids:['BAS'] }, { kw:'bas', ids:['BAS'] },
  { kw:'급제동경보', ids:['ESS'] },
  { kw:'경사로밀림방지', ids:['HAC'] }, { kw:'hac', ids:['HAC'] },
  { kw:'경사로저속주행', ids:['DBC'] },
  { kw:'운전자주의경고', ids:['DAW'] },
  { kw:'전방추돌경보', ids:['FCWS'] },
  { kw:'차로이탈방지', ids:['LDWS'] },
  { kw:'차선이탈경보', ids:['LDWS'] },
  { kw:'차선이탈방지', ids:['LDWS'] },
  { kw:'차선유지보조', ids:['LKAS'] },
  { kw:'차로유지보조', ids:['LKAS'] },
  { kw:'주차조향보조시스템', ids:['SPAS'] },
  { kw:'타이어공기압감지', ids:['TPMS'] }, { kw:'tpms', ids:['TPMS'] },
  { kw:'타이어공기압경보', ids:['TPMS'] },
  { kw:'전자식파킹브레이크', ids:['EPB'] }, { kw:'epb', ids:['EPB'] },
  { kw:'오토홀드', ids:['EPB'] },
  { kw:'풋파킹브레이크', ids:['FOOT_PARKING'] },
  { kw:'에어백사이드', ids:['AIRBAG_SIDE'] },
  { kw:'에어백무릎보호', ids:['AIRBAG_KNEE'] },
  { kw:'무릎에어백', ids:['AIRBAG_KNEE'] },
  { kw:'에어백운전석', ids:['AIRBAG_DR'] },
  { kw:'에어백동승석', ids:['AIRBAG_PS'] },
  { kw:'운전석에어백', ids:['AIRBAG_DR'] },
  { kw:'동승석에어백', ids:['AIRBAG_PS'] },
  { kw:'사이드에어백', ids:['AIRBAG_SIDE'] },
  { kw:'후방카메라', ids:['CAM_REAR'] },
  { kw:'후방모니터', ids:['CAM_REAR'] },
  { kw:'전방카메라', ids:['CAM_FRONT'] },
  { kw:'후방감지센서', ids:['SENSOR_REAR'] },
  { kw:'전방감지센서', ids:['SENSOR_FRONT'] },
  { kw:'전방후방주차거리경고', ids:['SENSOR_FRONT','SENSOR_REAR'] },
  { kw:'후방주차거리경고', ids:['SENSOR_REAR'] },
  { kw:'전방주차거리경고', ids:['SENSOR_FRONT'] },
  { kw:'후방주차충돌방지보조', ids:['SENSOR_REAR'] },
  { kw:'주차충돌방지보조후방', ids:['SENSOR_REAR'] },
  { kw:'원격스마트주차보조', ids:['SPAS'] },
  { kw:'9에어백', ids:['AIRBAG_DR','AIRBAG_PS','AIRBAG_SIDE','AIRBAG_KNEE'] },
  { kw:'8에어백', ids:['AIRBAG_DR','AIRBAG_PS','AIRBAG_SIDE','AIRBAG_KNEE'] },
  { kw:'7에어백', ids:['AIRBAG_DR','AIRBAG_PS','AIRBAG_SIDE','AIRBAG_KNEE'] },
  { kw:'6에어백', ids:['AIRBAG_DR','AIRBAG_PS','AIRBAG_SIDE'] },
  { kw:'abs', ids:['ABS'] },

  // 외관
  { kw:'fullled헤드램프', ids:['HEAD_LED'] },
  { kw:'led헤드램프', ids:['HEAD_LED'] },
  { kw:'프로젝션타입', ids:['HEAD_LED'] },
  { kw:'제논헤드램프', ids:['HEAD_HID'] },
  { kw:'hid헤드램프', ids:['HEAD_HID'] },
  { kw:'led포지션램프', ids:['POSITION_LED'] },
  { kw:'주간주행등', ids:['DRL'] },
  { kw:'에스코트헤드램프', ids:['HEAD_ESCORT'] },
  { kw:'전동접이사이드미러', ids:['MIRROR_FOLD'] },
  { kw:'아웃사이드미러', ids:['MIRROR_FOLD'] },
  { kw:'전동조절사이드미러', ids:['MIRROR_ADJ'] },
  { kw:'루프랙', ids:['ROOF_RACK'] },
  { kw:'알루미늄휠', ids:['ALUMINUM_WHEEL'] },
  { kw:'알로이휠', ids:['ALUMINUM_WHEEL'] },
  { kw:'led안개등', ids:['FOG_LED'] },
  { kw:'안개등led', ids:['FOG_LED'] },
  { kw:'안개등', ids:['FOG_LED'] },
  { kw:'led리어콤비', ids:['REAR_LED_COMBI'] },

  // 내장
  { kw:'스티어링휠리모컨', ids:['STR_REMOTE'] },
  { kw:'스티어링휠오디오리모컨', ids:['STR_REMOTE'] },
  { kw:'오디오리모컨', ids:['STR_REMOTE'] },
  { kw:'오토라이트', ids:['AUTO_LIGHT'] },
  { kw:'파워스티어링', ids:['POWER_STR'] },
  { kw:'전동식파워스티어링', ids:['POWER_STR'] },
  { kw:'mdps', ids:['POWER_STR'] },
  { kw:'핸즈프리', ids:['HANDS_FREE'] },
  { kw:'열선스티어링휠', ids:['HEAT_STR'] },
  { kw:'스티어링휠열선', ids:['HEAT_STR'] },
  { kw:'운전석파워시트', ids:['POWER_SEAT_DR'] },
  { kw:'동승석파워시트', ids:['POWER_SEAT_PS'] },
  { kw:'전동시트운전석', ids:['POWER_SEAT_DR'] },
  { kw:'전동시트동승석', ids:['POWER_SEAT_PS'] },
  { kw:'운전석전동시트', ids:['POWER_SEAT_DR'] },
  { kw:'동승석전동시트', ids:['POWER_SEAT_PS'] },
  { kw:'8way전동시트', ids:['POWER_SEAT_DR'] },
  { kw:'10way전동시트', ids:['POWER_SEAT_DR'] },
  { kw:'ecm룸미러', ids:['ECM_MIRROR'] },
  { kw:'전자식룸미러', ids:['MTS_E_MIRROR'] },
  { kw:'하이패스룸미러', ids:['HIPASS_MIRROR'] },
  { kw:'후방룸미러', ids:['REAR_MIRROR'] },
  { kw:'직물가죽시트', ids:['SEAT_MIX'] },
  { kw:'직물시트', ids:['SEAT_FABRIC'] },

  // 편의
  { kw:'ehipass', ids:['HIPASS'] },
  { kw:'하이패스시스템', ids:['HIPASS'] },
  { kw:'하이패스', ids:['HIPASS'] },
  { kw:'버튼시동', ids:['BUTTON_START'] },
  { kw:'무선도어잠금', ids:['REMOTE_LOCK'] },
  { kw:'자동에어컨뒷좌석', ids:['AUTO_AC_REAR'] },
  { kw:'풀오토에어컨', ids:['AUTO_AC'] },
  { kw:'자동에어컨', ids:['AUTO_AC'] },
  { kw:'매뉴얼에어컨', ids:['MANUAL_AC'] },
  { kw:'파워슬라이딩도어', ids:['SLIDING_DOOR'] },
  { kw:'파워윈도우', ids:['POWER_WINDOW'] },
  { kw:'전동식커튼', ids:['CURTAIN_E'] },
  { kw:'커튼전동식', ids:['CURTAIN_E'] },
  { kw:'전동식도어커튼', ids:['CURTAIN_E'] },
  { kw:'수동식커튼', ids:['CURTAIN_M'] },
  { kw:'커튼수동식', ids:['CURTAIN_M'] },
  { kw:'수동식도어커튼', ids:['CURTAIN_M'] },
  { kw:'경제운전안내', ids:['ECO_GUIDE'] },
  { kw:'블랙박스', ids:['BLACKBOX'] },

  // 미디어
  { kw:'cd플레이어', ids:['CD_PLAYER'] },
  { kw:'mp3', ids:['MP3'] },
  { kw:'뒷자석tv', ids:['REAR_TV'] }, { kw:'뒷좌석tv', ids:['REAR_TV'] },
  { kw:'블루투스', ids:['BLUETOOTH'] },
  { kw:'aux단자', ids:['AUX'] },
  { kw:'usb단자', ids:['USB'] },
  { kw:'usb포트', ids:['USB'] },
  { kw:'웰컴시스템', ids:['WELCOME'] },
  { kw:'다이내믹웰컴라이트', ids:['WELCOME'] },
  { kw:'웰컴라이트', ids:['WELCOME'] },
  { kw:'전자제어서스펜션', ids:['ECS'] },
  { kw:'에어서스펜션', ids:['ECS'] },
];
// 긴 키 우선
FP_KEYWORD_RULES.sort((a, b) => b.kw.length - a.kw.length);

export function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[\(\)\[\]_\-\/\.,&\+°]/g, '')
    .replace(/\s+/g, '');
}

export function matchFpByName(name) {
  if (!name) return [];
  const n = normName(name);
  const matched = new Set();
  for (const { kw, ids } of FP_KEYWORD_RULES) {
    if (kw && n.includes(kw)) {
      ids.forEach(id => matched.add(id));
    }
  }
  return [...matched];
}
