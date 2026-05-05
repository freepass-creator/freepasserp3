#!/usr/bin/env node
/**
 * 수입 catalog 의 옵션 보강
 *   FP 95 표준 옵션 (fp-options-master.js) 을 universal categories/options 로 적용
 *   trim 별 basic = grade 비례 분배
 *
 *   수입 표준 — 옵션 풍부도 한국차 대비:
 *     base:    65% (베이스도 옵션 多)
 *     mid:     85%
 *     top:     98%
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// FP 95 표준 옵션 마스터 (fp-options-master.js 와 동일)
const FP_OPT_MASTER = {
  '외관': [
    ['SUNROOF','썬루프(일반)'],['SUNROOF_PANO','파노라마 썬루프'],
    ['HEAD_LED','LED 헤드램프'],['POSITION_LED','LED 포지션램프'],
    ['DRL','주간 주행등'],['MIRROR_FOLD','전동접이 사이드미러'],['MIRROR_ADJ','전동조절 사이드미러'],
    ['ALUMINUM_WHEEL','알루미늄휠'],['FOG_LED','안개등 (LED)'],['REAR_LED_COMBI','LED 리어 콤비네이션 램프'],
  ],
  '내장': [
    ['CRUISE','크루즈컨트롤'],['STR_REMOTE','스티어링 휠 리모컨'],['AUTO_LIGHT','오토 라이트 컨트롤'],
    ['POWER_STR','파워 스티어링'],['HEAT_STR','열선 스티어링휠'],
    ['ECM_MIRROR','ECM룸미러'],['REAR_MIRROR','후방 룸미러'],
  ],
  '안전': [
    ['AIRBAG_DR','에어백(운전석)'],['AIRBAG_PS','에어백(동승석)'],['AIRBAG_SIDE','에어백(사이드)'],
    ['CAM_REAR','후방 카메라'],['SENSOR_REAR','후방 감지센서'],['CAM_FRONT','전방 카메라'],['SENSOR_FRONT','전방 감지센서'],
    ['AVMS','어라운드 뷰 (AVMS)'],['EPB','전자식 파킹 브레이크'],
    ['ABS','ABS'],['BAS','제동 도움 장치(BAS)'],['AEB','자동 긴급 제동 시스템 (AEB)'],
    ['VDC','차체자세제어 (VDC/VSM/ESC/ESP)'],['TCS','미끄럼방지 (TCS)'],['ESS','급제동 경보 (ESS)'],
    ['TPMS','타이어 공기압감지 (TPMS)'],['HDA','고속도로 주행 지원시스템 (HDA)'],
    ['LDWS','차선이탈 경보 (LDWS)'],['LKAS','차선 유지 보조 (LKAS)'],
    ['DAW','운전자 주의 경고 (DAW)'],['FCWS','전방 추돌 경보 (FCWS)'],
    ['HUD','헤드업 디스플레이 (HUD)'],['RCTA','후측방 경보시스템 (RCTA)'],
  ],
  '시트': [
    ['POWER_SEAT_DR','전동시트(운전석)'],['POWER_SEAT_PS','전동시트(동승석)'],
    ['MEMORY_SEAT_DR','메모리시트(운전석)'],
    ['HEAT_SEAT_FRONT','열선시트(앞좌석)'],['HEAT_SEAT_REAR','열선시트(뒷좌석)'],
    ['VENT_SEAT_DR','통풍시트(운전석)'],['VENT_SEAT_PS','통풍시트(동승석)'],
    ['SEAT_LEATHER','가죽시트'],
  ],
  '편의': [
    ['NAVIGATION','내비게이션'],['BUTTON_START','버튼 시동'],['SMART_KEY','스마트키'],
    ['REMOTE_LOCK','무선 도어 잠금장치'],['REMOTE_START','원격시동'],
    ['AUTO_AC','자동 에어컨'],['AUTO_AC_REAR','자동 에어컨 (뒷좌석)'],
    ['SMART_TRUNK','스마트 트렁크/테일게이트'],['POWER_TRUNK','파워트렁크'],['POWER_WINDOW','파워윈도우'],
    ['WPC','무선충전 시스템(WPC)'],
  ],
  '인포테인먼트': [
    ['BLUETOOTH','블루투스'],['USB','USB 단자'],
    ['MIRRORING','유선 미러링'],['MIRRORING_WIRELESS','무선 미러링'],
    ['VOICE_RECOG','음성인식 시스템'],
  ],
};

// 수입 메이커
const IMPORT_MAKERS = ['BMW','벤츠','아우디','테슬라','볼보','폭스바겐','미니','포르쉐','랜드로버','지프'];

// trim grade 비례 (수입은 옵션 풍부 — 한국차 대비 base 도 옵션 多)
const TIER_RATIO = { 외관: [0.7, 0.9, 1.0], 내장: [0.7, 0.9, 1.0], 안전: [0.85, 0.95, 1.0],
                     시트: [0.5, 0.85, 1.0], 편의: [0.55, 0.85, 1.0], 인포테인먼트: [0.65, 0.9, 1.0] };

// trim 명에서 tier 추출 (수입 trim 은 grade 키워드 부족 — 가격대 추정 어려움)
//   M Sport / S / AMG / 콰트로 / Performance / 퍼포먼스 → top
//   d / TDI / 디젤 / Recharge / e (PHEV) → mid
//   기본 (base) → mid (수입은 base 도 옵션 많음)
function getTier(trimName) {
  if (/(M\s*Sport|AMG|S\d|RS\d|Performance|퍼포먼스|M\d{2,3}i|JCW|R$|GT[SI]?|플래드|터보)/i.test(trimName)) return 2; // top
  if (/(콰트로|quattro|4MATIC|xDrive\d{2}|sDrive\d{2}|롱레인지|Recharge|d|TDI|디젤|e$)/i.test(trimName)) return 1; // mid
  return 1; // 수입 base = mid (옵션 풍부)
}

let touched = 0, totalAdded = 0;
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!IMPORT_MAKERS.includes(d.maker)) continue;
  if (!d.trims || !Object.keys(d.trims).length) continue;
  // 이미 옵션 풍부하면 skip
  const hasOptions = (d.categories && Object.keys(d.categories).length > 0)
                  || Object.values(d.trims).some(t => (t.basic||[]).length > 0);
  if (hasOptions) continue;

  // categories + options 정의 (FP 95)
  const catList = {};
  const optDict = {};
  for (const [catName, items] of Object.entries(FP_OPT_MASTER)) {
    catList[catName] = items.map(([id]) => id);
    for (const [id, name] of items) {
      optDict[id] = { name, category: catName, is_package: false };
    }
  }
  d.categories = catList;
  d.options = optDict;

  // trim basic 분배
  let added = 0;
  for (const [trimName, t] of Object.entries(d.trims)) {
    const tier = getTier(trimName);
    t.basic = t.basic || [];
    for (const [catName, ids] of Object.entries(catList)) {
      const ratio = (TIER_RATIO[catName] || [0.5, 0.8, 1.0])[tier];
      const take = Math.round(ids.length * ratio);
      for (const id of ids.slice(0, take)) {
        if (!t.basic.includes(id)) { t.basic.push(id); added++; }
      }
    }
  }
  fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n', 'utf8');
  touched++;
  totalAdded += added;
}

console.log(`✓ ${touched} 수입 catalog 옵션 보강 (총 ${totalAdded} basic 옵션 분배)`);
