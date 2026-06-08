/**
 * 차종마스터 5단계 트리 — catalog(_index.json) 의 trim 문자열을 분해해서 조립.
 *
 *   제조사(maker) → 모델(model_root) → 세부모델(catalog) → 파워트레인(variant) → 트림(trim)
 *   ※ 화면 표기는 '파워트레인', 내부 데이터 키는 `variant` 유지(웰릭스 신차견적기 variant와 동일물).
 *
 * trim 문자열 형태: "{트림} {연료} {배기량} [T] [인승] [구동]"
 *   "인스퍼레이션 가솔린 1.6"      → 트림 "인스퍼레이션" / 파워트레인 "가솔린 1.6"
 *   "프레스티지 디젤 2.2 9인승"     → 트림 "프레스티지"   / 파워트레인 "디젤 2.2 9인승"
 *   "가솔린 2.5 T AWD"(제네시스)   → 트림 "(기본)"       / 파워트레인 "가솔린 2.5 T AWD"
 *   "라이트 스탠다드 EV"           → 트림 "라이트"       / 파워트레인 "스탠다드 EV"
 *
 * 분해 규칙: 토큰을 뒤에서부터 보아 '스펙 토큰'(연료·배기량·터보·인승·구동·배터리)이
 *   연속되는 최대 꼬리 = 파워트레인, 그 앞 나머지 = 트림. (적용·매칭 없이 구성만)
 */

/* 스펙 토큰 판별 — 모델구분에 속하는 토큰인가 */
const FUEL = new Set(['가솔린', '휘발유', '디젤', '경유', 'LPG', 'LPi', 'LPI', '하이브리드', 'HEV', '전기', 'EV', '수소', 'PHEV', 'FCEV']);
// 연료 표기 통일 — 국어(경유/휘발유) → 표준(디젤/가솔린)
const FUEL_NORM = { '경유': '디젤', '휘발유': '가솔린' };
const normFuel = (t) => FUEL_NORM[t] || t;
const BATTERY = new Set(['스탠다드', '스탠더드', '롱레인지', '롱 레인지']);
const DRIVE = new Set(['AWD', '4WD', '2WD', 'RWD', 'FWD', 'e-4WD', '2륜', '4륜', '4MATIC', 'xDrive']);
const TURBO = new Set(['T', '터보', 'T-GDI', 'GDI', 'e-VGT', 'TDI', 'T8', 'T6', 'T5']);
// 트림에 섞이면 안 되는 노이즈 토큰 — 등록구분·세대마커·마케팅 (트림에서 제거)
const NOISE_TRIM = new Set(['더', '올', '디', '뉴', '신형', '렌터카', '렌트', '렌트카', '자가용', '영업용', '리스', '법인', '런칭', 'the', 'The']);

function isSpecToken(tok) {
  if (!tok) return false;
  if (FUEL.has(tok) || BATTERY.has(tok) || DRIVE.has(tok) || TURBO.has(tok)) return true;
  if (/^\d\.\d$/.test(tok)) return true;        // 배기량 1.6 / 2.2 / 2.5
  if (/^\d{3,4}cc$/i.test(tok)) return true;    // 1600cc
  if (/^\d+인승$/.test(tok)) return true;       // 9인승
  if (/^\d\.\dT$/i.test(tok)) return true;      // 2.0T
  return false;
}

/* 스펙 토큰 분류 → 표준 순서 슬롯. 연료 → 배기량 → 구동 → 인승 규격. */
function classifySpec(tok) {
  if (FUEL.has(tok)) return 'fuel';
  if (BATTERY.has(tok)) return 'battery';      // EV 배터리 (스탠다드/롱레인지) — 배기량 슬롯
  if (TURBO.has(tok)) return 'turbo';
  if (DRIVE.has(tok)) return 'drive';
  if (/^\d+인승$/.test(tok)) return 'seats';
  if (/^\d\.\dT$/i.test(tok)) return 'disp';   // 2.0T (배기량+터보 결합)
  if (/^\d\.\d$/.test(tok) || /^\d{3,4}cc$/i.test(tok)) return 'disp';
  return 'etc';
}

/* trim 문자열 → { variant(모델구분), trim(트림) }.
 *  - 트림 = 앞쪽 비-스펙 토큰
 *  - 모델구분 = 스펙 토큰을 표준 순서로 재조립: 연료 → 배기량/배터리 → 터보 → 구동 → 인승 */
export function parseTrim(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return { variant: '', trim: '(기본)' };
  const toks = s.split(' ');
  // 뒤에서부터 스펙 토큰이 이어지는 최대 꼬리 찾기
  let cut = toks.length;
  for (let i = toks.length - 1; i >= 0; i--) {
    if (isSpecToken(toks[i])) cut = i;
    else break;
  }
  const trimToksRaw = toks.slice(0, cut);
  const specToks = toks.slice(cut);

  // 연료 토큰은 트림 앞/중간에 있어도 파워트레인으로 이동, 노이즈 토큰(렌터카/더/뉴/연식MY 등)은 제거.
  //  예: "경유 프레스티지 2.2 2WD" → 트림 "프레스티지" / 파워트레인 "디젤 2.2 2WD"
  const frontFuel = [];
  const trimToks = [];
  for (const t of trimToksRaw) {
    if (FUEL.has(t)) frontFuel.push(t);
    else if (!NOISE_TRIM.has(t) && !/^\d{2,4}\s*MY$/i.test(t)) trimToks.push(t);
  }

  // 스펙 토큰을 슬롯별 분류 후 표준 순서로 재조립
  const slots = { fuel: [], disp: [], battery: [], turbo: [], drive: [], seats: [], etc: [] };
  for (const t of specToks) slots[classifySpec(t)].push(t);
  slots.fuel = [...frontFuel, ...slots.fuel].map(normFuel);   // 경유→디젤, 휘발유→가솔린
  const ordered = [
    ...slots.fuel,
    ...slots.disp,
    ...slots.battery,
    ...slots.turbo,
    ...slots.drive,
    ...slots.seats,
    ...slots.etc,
  ];

  return {
    variant: ordered.join(' '),
    trim: trimToks.length ? trimToks.join(' ') : '(기본)',
  };
}

/* _index.json (catalog 맵) → 5단계 트리.
 *  반환: [{ maker, models:[{ model, subModels:[{ id, title, year, variants:[{ variant, trims:[] }] }] }] }]
 *  정렬: 제조사·모델·세부모델 한글순. */
export function buildMasterTree(index) {
  const cats = Object.values(index || {});
  // maker → model_root → [catalog]
  const makers = new Map();
  for (const c of cats) {
    if (!c || !c.maker) continue;
    if (!makers.has(c.maker)) makers.set(c.maker, new Map());
    const models = makers.get(c.maker);
    const mk = c.model_root || c.title || c.id;
    if (!models.has(mk)) models.set(mk, []);
    models.get(mk).push(c);
  }

  const yearLabel = (c) => {
    const ys = (c.year_start || '').slice(0, 4);
    const ye = c.year_end === '현재' ? '현재' : (c.year_end || '').slice(0, 4);
    if (ys && ye) return `${ys}~${ye}`;
    if (ys) return `${ys}~`;
    return '';
  };

  const subModelOf = (c) => {
    // 세부모델 = catalog title 에서 maker 접두사 제거
    let t = String(c.title || c.id || '').trim();
    if (c.maker && t.startsWith(c.maker + ' ')) t = t.slice(c.maker.length + 1).trim();
    return t;
  };

  const tree = [];
  for (const [maker, models] of [...makers].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
    const modelList = [];
    for (const [model, catalogs] of [...models].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
      const subModels = catalogs
        .sort((a, b) => (b.year_start || '').localeCompare(a.year_start || ''))
        .map(c => {
          // 모델구분 → 트림[] 집계
          const variantMap = new Map();
          for (const raw of (c.trims || [])) {
            const { variant, trim } = parseTrim(raw);
            const key = variant || '(미상)';
            if (!variantMap.has(key)) variantMap.set(key, []);
            const arr = variantMap.get(key);
            if (!arr.includes(trim)) arr.push(trim);
          }
          const variants = [...variantMap].map(([variant, trims]) => ({ variant, trims }));
          return { id: c.id, title: c.title, subModel: subModelOf(c), year: yearLabel(c), trimCount: (c.trims || []).length, variants };
        });
      modelList.push({ model, subModelCount: subModels.length, subModels });
    }
    tree.push({ maker, modelCount: modelList.length, models: modelList });
  }
  return tree;
}

/* 트리 통계 — 요약 표시용 */
export function masterTreeStats(tree) {
  let makers = tree.length, models = 0, subModels = 0, variants = 0, trims = 0;
  for (const mk of tree) for (const m of mk.models) {
    models++;
    for (const sm of m.subModels) {
      subModels++;
      for (const v of sm.variants) { variants++; trims += v.trims.length; }
    }
  }
  return { makers, models, subModels, variants, trims };
}
