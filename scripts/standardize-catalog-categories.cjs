#!/usr/bin/env node
/**
 * 한국 OEM catalog 의 categories 를 표준 8섹션으로 통일.
 *  - 옵션 사전의 각 옵션을 키워드 기반으로 8섹션 중 하나로 분류
 *  - catalog.categories[표준섹션] = [그 섹션에 속한 코드 배열]
 *  - 옵션 자체에 category 필드도 갱신
 *  - 표준 섹션: 파워트레인/성능, 안전, 지능형 안전 기술, 외관, 내장, 시트, 편의, 인포테인먼트
 *  - 패키지(PKG_*) / 선택사양 분류는 그대로 유지
 *
 *  사용:
 *    node scripts/standardize-catalog-categories.cjs           # dry-run
 *    node scripts/standardize-catalog-categories.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');
const STD_CATS = ['파워트레인/성능', '안전', '지능형 안전 기술', '외관', '내장', '시트', '편의', '인포테인먼트'];

// 옵션명 → 카테고리 매핑 룰 (우선순위 위에서 아래)
const RULES = [
  // 지능형 안전 기술 (먼저 매칭, ADAS 패키지 우선)
  { cat: '지능형 안전 기술', re: /(스마트.?크루즈|어댑티브.?크루즈|고속도로.?주행|HDA|차로.?유지|차선.?유지|LKAS|차로.?이탈|차선.?이탈|LDWS|전방.?충돌|FCWS|AEB|자동.?긴급.?제동|후측방.?충돌|RCTA|후방.?교차|하이빔.?보조|HBA|운전자.?주의|DAW|안전.?하차|SEW|후석.?승객.?알림|ROA|지능형.?속도|ISLA|어라운드.?뷰|서라운드.?뷰|AVMS|360도.?뷰|후측방.?모니터|BVM|HoD|HOD|스티어링.?휠.?그립|주차.?조향.?보조|SPAS|원격.?스마트.?주차|전방.?차량.?출발.?알림|드라이브.?와이즈|스마트센스|어시스트|어시스턴스|copilot|safety.?sense|honda.?sensing|propilot|travel.?assist|pilot.?assist)/i },
  // 파워트레인/성능
  { cat: '파워트레인/성능', re: /(엔진|engine|변속기|자동.?변속|수동.?변속|DCT|CVT|6AT|7AT|8AT|9AT|10AT|t-gdi|TGDi|GDi|MDPS|R-MDPS|EMDPS|EPS|파워.?스티어링|스티어링.?시스템|MDPS|ISG|공회전.?제한|회생제동|REGEN|주행.?모드|드라이브.?모드|에코.?모드|스포츠.?모드|중립.?주행|통합.?주행|전동식.?파워|전자식.?변속|변속.?다이얼|변속.?칼럼|변속.?레버|패들.?쉬프트|패들.?시프트|paddle|서스펜션|suspension|쇼크.?옵저버|TPMS|타이어.?공기압|HTRAC|h-trac|AWD|4WD|4매틱|xdrive|quattro|4motion|봄베|연료탱크|배터리.?히팅|V2L|충전.?시스템|급속.?충전|completion)/i },
  // 안전 (ADAS 아닌 수동 안전)
  { cat: '안전', re: /(에어백|airbag|ABS|VDC|VSM|ESC|ESP|TCS|미끄럼방지|차체자세|시트.?벨트|벨트.?프리텐셔너|벨트.?리마인더|충돌방지.?자동.?제동|다중.?충돌|소화기|타이어.?임시수리|타이어.?응급.?처치|유아용.?시트|ISOFIX|차일드.?락|HAC|경사로.?밀림|DBC|경사로.?저속|EBD|급제동.?경보|ESS|BAS)/i },
  // 외관
  { cat: '외관', re: /(헤드램프|헤드라이트|headlamp|HEAD.?LED|HID|LED.?헤드|LED.?리어|LED.?콤비|LED.?테일|테일램프|리어.?램프|리어.?콤비|콤비네이션.?램프|방향지시등|턴.?시그널|LED.?방향|포지션.?램프|포지션.?라이트|DRL|주간.?주행등|안개등|fog|포그|fog.?램프|휠|타이어|aluminum.?wheel|알로이.?휠|크롬.?휠|블랙.?휠|18인치|19인치|20인치|17인치|16인치|아웃사이드.?미러|사이드.?미러|outside.?mirror|전동접이|전동.?폴딩|폴딩.?미러|미러.?열선|도어.?핸들|outside.?handle|아웃사이드.?도어.?핸들|크롬.?라디에이터|라디에이터.?그릴|그릴|샤크.?핀|안테나|antenna|와이퍼|wiper|레인.?와이퍼|리어.?와이퍼|에어로.?와이퍼|스포일러|spoiler|루프.?랙|roof.?rack|루프|선루프|썬루프|sunroof|파노라마|차량.?보호.?필름|언더커버|범퍼|bumper|머플러|배기|exhaust|패키지.?트레이|EV.?엠블럼)/i },
  // 시트
  { cat: '시트', re: /(시트|seat|가죽시트|leather|패브릭|fabric|방석|시트.?백|레그.?레스트|시트.?쿠션|시트.?벨트|seat.?belt|seat-belt|벨트(?!.?리마인더)|시트.?포지션|메모리.?시트|memory.?seat|파워.?시트|power.?seat|전동.?시트|electric.?seat|통풍.?시트|vent.?seat|쿨링.?시트|열선.?시트|heat.?seat|seat.?heat|시트.?히터|seat.?heater|니.?팟|knee.?pad|숄더.?파트|헤드레스트|headrest|틸팅.?헤드|2열|3열|뒷좌석|동승석|운전석.?시트|콤포트.?시트|comfort.?seat|마사지.?시트|렉서스.?시트|볼스터|bolster|이지.?엑세스|easy.?access|이지.?억세스|워크.?인.?디바이스|walk.?in|워크인|시트.?백.?포켓|레그쉴드|레그.?룸)/i },
  // 인포테인먼트 (먼저 매칭, 내장 보다 specific)
  { cat: '인포테인먼트', re: /(내비|navigation|오디오|audio|스피커|speaker|6스피커|8스피커|14스피커|16스피커|블루투스|bluetooth|USB|핸즈프리|hands.?free|MP3|CD|DMB|라디오|radio|디스플레이.?오디오|미러링|mirroring|carplay|애플.?카플레이|안드로이드.?오토|androidauto|폰.?프로젝션|phone.?projection|smart.?stream.?audio|UVO|kakao|블루링크|bluelink|커넥티드|connected|connect|텔레매틱스|telematics|OTA|소프트웨어.?업데이트|음성인식|voice.?recog|HUD|헤드업|head.?up|krell|bose|보스|b&o|b&w|뱅앤올룹슨|meridian|메리디안|하만카돈|harman|kardon|렉시콘|lexicon|프리미엄.?사운드|premium.?sound|AUX|iPod|sirius|active.?road.?noise|active.?noise|active.?sound)/i },
  // 내장
  { cat: '내장', re: /(클러스터|cluster|TFT|LCD.?클러스터|LCD.?디스플레이|디지털.?클러스터|컬러.?LCD|3D.?클러스터|풀.?컬러|컬러.?LCD|컬럼|타입|컬러.?LCD|디스플레이|display|룸미러|room.?mirror|ECM|MTS|전자식.?룸미러|디지털.?사이드.?미러|스티어링.?휠(?!.?리모컨)|패들|틸트.?스티어링|텔레스코픽|tilt|telescopic|틸팅.?스티어링|핸들|wheel(?!.?lock)|wheel.?lock|콘솔|console|센터.?콘솔|페달|pedal|메탈.?페달|도어.?트림|door.?trim|도어.?스커프|door.?scuff|도어.?라이팅|door.?lighting|도어.?포켓|door.?pocket|도어.?핸들.?라이팅|글로브.?박스|glove.?box|콘솔.?암레스트|암레스트|armrest|크롬|chrome|우드.?트림|wood.?trim|블랙.?인테리어|black.?interior|선바이저|sun.?visor|선바이져|차일드.?락|차임|chime|디포그|defog|오토.?디포그|미세먼지|공기청정.?모드|after.?blow|애프터.?블로우|매트|mat|fl.?매트|러기지|luggage|짐.?공간|cargo|러기지.?보드|러기지.?그물|화물.?공간|시트.?백.?포켓|콘솔.?라이팅|컬러.?앰비언트|앰비언트|ambient|무드램프|mood.?lamp|mood.?lighting|실내등|interior.?lamp|interior.?light|맵램프|map.?lamp|룸램프|room.?lamp|러기지.?램프|로우.?라이트|footwell|footlight|풀.?컬러|color.?fader|fader|음성.?안내)/i },
  // 편의 (마지막 catch-all)
  { cat: '편의', re: /(스마트키|smart.?key|버튼.?시동|button.?start|engine.?start|start.?stop|디지털.?키|digital.?key|원격.?시동|remote.?start|원격.?스마트|remote.?smart|풀.?오토.?에어컨|자동.?에어컨|auto.?ac|매뉴얼.?에어컨|manual.?ac|3존|독립.?제어|에어컨|에어컨.?필터|에어컨.?콜드|cold.?storage|레인.?센서|rain.?sensor|레인.?감지|오토.?라이트|auto.?light|auto.?light.?control|파워.?윈도우|power.?window|윈도우(?!.?잠금)|EPB|전자식.?파킹|오토.?홀드|auto.?hold|풋.?파킹|foot.?parking|스마트.?트렁크|smart.?trunk|파워.?트렁크|power.?trunk|전동.?트렁크|electric.?trunk|전동.?테일게이트|power.?tailgate|tailgate|트렁크|trunk|커튼|curtain|sunshade|선쉐이드|HiPass|hipass|하이패스|하이.?패스|EV.?하이패스|무선.?충전|wpc|wireless.?charging|무선.?폰.?충전|월컴|welcome|컴포트|comfort|크루즈컨트롤(?!.?스마트)|cruise.?control(?!.?스마트)|패들.?시프트.?파킹|주차.?거리.?경고|주차.?거리|parking.?distance|park.?distance|후방.?모니터|rear.?monitor|후진.?가이드|reverse.?guide|reverse.?camera|후방.?카메라|전방.?카메라|front.?camera|cam.?front|360.?camera|전방.?감지|전방.?주차.?거리|후방.?감지|workin|워크인|디바이스(?!.?사이드)|2열.?오디오|2열.?공조|3존.?에어컨|3존.?공조|운전석.?자동.?쾌적|운전석.?쾌적|EV.?충전.?도어|충전.?도어|충전구|충전구.?로크|미세먼지.?센서|모기지.?센서|차량.?알림|usb.?c|USB.?A|USB.?단자|220V.?인버터|110V.?인버터|인버터|inverter|220V|110V|aux.?시트|footwell.?light|글래스|글라스|이중접합|차음.?글라스|자외선.?차단|UV.?차단|뒷좌석.?수동|뒷좌석.?전동|뒷면.?전동|2열.?전동|2열.?수동|선쉐이드|커튼|sun.?shade|sunshade|전자식.?차일드|차일드|child.?lock|child.?safety|파워.?슬라이딩|파워.?도어|sliding.?door|파워.?슬라이드|어웨이|walk.?away|컬러.?공조|컬러.?인스트.?공조|컬러.?앰비언트|컬러.?인스트|workin|풀.?컬러.?공조|10\.25.*컬러.?공조|10.?25|풀.?컬러.?LCD|글로벌.?컴포트|패키지|package|기본.?품목|기본.?사양|기본.?포함|선택.?품목|선택.?사양)/i },
];

// 옵션 텍스트 시작 prefix (예 "내장:", "편의/주차:") → 표준 카테고리
const PREFIX_MAP = [
  [/^\s*외관\s*[:：]/, '외관'],
  [/^\s*외장\s*[:：]/, '외관'],
  [/^\s*내장\s*[:：]/, '내장'],
  [/^\s*인테리어\s*[:：]/, '내장'],
  [/^\s*시트\s*[:：]/, '시트'],
  [/^\s*편의\s*\/\s*주차\s*[:：]/, '편의'],
  [/^\s*편의주차\s*[:：]/, '편의'],
  [/^\s*편의\s*[:：]/, '편의'],
  [/^\s*주차\s*[:：]/, '편의'],
  [/^\s*인포테인먼트\s*[:：]/, '인포테인먼트'],
  [/^\s*멀티미디어\s*[:：]/, '인포테인먼트'],
  [/^\s*오디오\s*[:：]/, '인포테인먼트'],
  [/^\s*안전\s*[:：]/, '안전'],
  [/^\s*지능형\s*안전\s*기술\s*[:：]/, '지능형 안전 기술'],
  [/^\s*첨단\s*운전자\s*보조[^:：]*[:：]/, '지능형 안전 기술'],
  [/^\s*ADAS\s*[:：]/, '지능형 안전 기술'],
  [/^\s*파워트레인[^:：]*[:：]/, '파워트레인/성능'],
  [/^\s*동력성능\s*[:：]/, '파워트레인/성능'],
  [/^\s*성능\s*[:：]/, '파워트레인/성능'],
];

function classify(name) {
  if (!name) return null;
  // prefix 우선 매칭
  for (const [re, cat] of PREFIX_MAP) {
    if (re.test(name)) return cat;
  }
  // 그 다음 키워드 룰
  for (const r of RULES) {
    if (r.re.test(name)) return r.cat;
  }
  return null;
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0, totalReclassified = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (d.maker !== '현대' && d.maker !== '기아' && d.maker !== '제네시스') continue;
  const opts = d.options || {};
  if (!Object.keys(opts).length) continue;

  // 옵션 → 카테고리 매핑
  const newCats = {};
  for (const std of STD_CATS) newCats[std] = [];
  // 패키지/선택사양 분리 (PKG_* 또는 is_package 또는 catalog 가 갖는 다른 분류)
  const otherCats = {};

  let reclassified = 0;
  for (const [code, info] of Object.entries(opts)) {
    if (code.startsWith('PKG_') || info.is_package) {
      otherCats['선택사양'] = otherCats['선택사양'] || [];
      otherCats['선택사양'].push(code);
      info.category = '선택사양';
      continue;
    }
    const name = info.name || '';
    const oldCat = info.category || '';
    let cat = classify(name);
    if (!cat) {
      // 분류 실패 — 기존 카테고리 보존, 없으면 편의 default
      cat = STD_CATS.includes(oldCat) ? oldCat : '편의';
    }
    if (oldCat !== cat) reclassified++;
    info.category = cat;
    newCats[cat].push(code);
  }

  // 기존 catalog.categories 의 비표준 키 보존 (선택사양 등)
  const existingCats = d.categories || {};
  for (const [k, v] of Object.entries(existingCats)) {
    if (STD_CATS.includes(k)) continue;
    if (k === '선택사양') continue;  // 위에서 별도 처리
    otherCats[k] = v;
  }

  d.categories = { ...newCats, ...otherCats };
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  if (reclassified > 0) {
    console.log(`${APPLY ? '✓' : '+'} ${d.title} — ${reclassified}개 재분류 (${Object.keys(opts).length}옵션)`);
    touched++;
    totalReclassified += reclassified;
  }
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 옵션 ${totalReclassified}개 재분류`);
