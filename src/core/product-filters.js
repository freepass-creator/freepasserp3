/**
 * product-filters.js — 상품 검색 필터 정의 (web/mobile 공통)
 *
 * FILTERS: 순서·조건 정의 (19개 카테고리)
 * matchFilter: 제품 p 가 그룹 g 의 chip 와 매칭되는지
 * buildDynamicChips: dynamic 필터(제조사/모델/연식 등) 칩을 products 에서 집계
 */
import { needsReview } from './product-badges.js';

export const TOP_N = {
  maker: 8, model: 12, submodel: 12, year: 10,
  color: 10, int_color: 10, vehicle_class: 11, provider: 10, policy: 10,
};

export const FILTERS = {
  rent: {
    label: '대여료', icon: 'ph ph-currency-krw', chips: [
      { id: 'r_d50', label: '50만↓',  match: v => v > 0       && v <= 500000  },
      { id: 'r50',   label: '50만~',  match: v => v > 500000  && v <= 600000  },
      { id: 'r60',   label: '60만~',  match: v => v > 600000  && v <= 700000  },
      { id: 'r70',   label: '70만~',  match: v => v > 700000  && v <= 800000  },
      { id: 'r80',   label: '80만~',  match: v => v > 800000  && v <= 900000  },
      { id: 'r90',   label: '90만~',  match: v => v > 900000  && v <= 1000000 },
      { id: 'r100',  label: '100만~', match: v => v > 1000000 && v <= 1500000 },
      { id: 'r150',  label: '150만~', match: v => v > 1500000 && v <= 2000000 },
      { id: 'r200',  label: '200만↑', match: v => v > 2000000 },
    ],
  },
  deposit: {
    label: '보증금', icon: 'ph ph-coins', chips: [
      { id: 'd_d100', label: '100만↓', match: v => v > 0       && v <= 1000000 },
      { id: 'd100',   label: '100만~', match: v => v > 1000000 && v <= 2000000 },
      { id: 'd200',   label: '200만~', match: v => v > 2000000 && v <= 3000000 },
      { id: 'd300',   label: '300만~', match: v => v > 3000000 && v <= 5000000 },
      { id: 'd500',   label: '500만↑', match: v => v > 5000000 },
    ],
  },
  period: {
    label: '기간', icon: 'ph ph-calendar-blank',
    chips: ['1','12','24','36','48','60'].map(m => ({
      id: `p${m}`, label: `${m}개월`, match: (_, p) => Number(p?.[m]?.rent || 0) > 0,
    })),
  },
  maker:    { label: '제조사',  icon: 'ph ph-factory',      chips: [], dynamic: true, field: 'maker' },
  model:    { label: '모델명',  icon: 'ph ph-car-simple',   chips: [], dynamic: true, field: 'model' },
  submodel: { label: '세부모델', icon: 'ph ph-car-profile',  chips: [], dynamic: true, field: 'sub_model' },
  year:     { label: '연식',    icon: 'ph ph-calendar',     chips: [], dynamic: true, field: 'year' },
  mileage: {
    label: '주행거리', icon: 'ph ph-gauge', chips: [
      { id: 'km1',  label: '1만km↓',   match: v => v > 0 && v <= 10000 },
      { id: 'km3',  label: '1~3만',    match: v => v > 10000 && v <= 30000 },
      { id: 'km5',  label: '3~5만',    match: v => v > 30000 && v <= 50000 },
      { id: 'km10', label: '5~10만',   match: v => v > 50000 && v <= 100000 },
      { id: 'km15', label: '10~15만',  match: v => v > 100000 && v <= 150000 },
      { id: 'km99', label: '15만↑',    match: v => v > 150000 },
    ],
  },
  fuel: {
    label: '연료', icon: 'ph ph-gas-pump', chips: [
      { id: 'gas',    label: '가솔린',    match: v => v === '가솔린' || v === 'gasoline' },
      { id: 'diesel', label: '디젤',      match: v => v === '디젤' || v === 'diesel' },
      { id: 'hybrid', label: '하이브리드', match: v => (v||'').includes('하이브리드') || (v||'').includes('hybrid') },
      { id: 'ev',     label: '전기',      match: v => v === '전기' || v === 'electric' },
    ],
  },
  color:     { label: '외부색상', icon: 'ph ph-palette', chips: [], dynamic: true, field: 'ext_color' },
  int_color: { label: '내부색상', icon: 'ph ph-palette', chips: [], dynamic: true, field: 'int_color' },
  vehicle_status: {
    label: '출고상태', icon: 'ph ph-truck',
    chips: ['즉시출고','출고가능','상품화중','출고협의','출고불가'].map(s => ({
      id: `vs_${s}`, label: s, match: v => v === s,
    })),
  },
  product_type: {
    label: '상품구분', icon: 'ph ph-tag',
    chips: ['중고렌트','신차렌트','중고구독','신차구독'].map(s => ({
      id: `pt_${s}`, label: s, match: v => v === s,
    })),
  },
  vehicle_class: { label: '차종구분', icon: 'ph ph-car', chips: [], dynamic: true, field: 'vehicle_class' },
  review: {
    label: '심사여부', icon: 'ph ph-clipboard-text',
    chips: [
      { id: 'rv_no',  label: '무심사',   match: (_, p) => !needsReview(p) },
      { id: 'rv_yes', label: '심사필요', match: (_, p) => needsReview(p) },
    ],
  },
  age_lowering:   { label: '운전연령하향',      icon: 'ph ph-arrow-down',     chips: [], dynamic: true, field: '_policy.driver_age_lowering' },
  credit_grade:   { label: '심사기준',          icon: 'ph ph-chart-bar',      chips: [], dynamic: true, field: '_policy.credit_grade' },
  annual_mileage: { label: '연간약정주행거리',  icon: 'ph ph-road-horizon',   chips: [], dynamic: true, field: '_policy.annual_mileage' },
  provider:       { label: '공급코드',          icon: 'ph ph-buildings',      chips: [], dynamic: true, field: 'provider_company_code' },
};

export function getField(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

/** 제품 p 가 그룹 g 의 chip 와 매칭되는지 */
export function matchFilter(p, g, chip) {
  const f = FILTERS[g];
  if (!f) return true;
  if (g === 'rent')           return Object.values(p.price || {}).some(pr => chip.match(Number(pr.rent) || 0));
  if (g === 'deposit')        return Object.values(p.price || {}).some(pr => chip.match(Number(pr.deposit) || 0));
  if (g === 'period')         return chip.match(null, p.price);
  if (g === 'mileage')        return chip.match(Number(p.mileage) || 0);
  if (g === 'fuel')           return chip.match(p.fuel_type);
  if (g === 'vehicle_status') return chip.match(p.vehicle_status);
  if (g === 'product_type')   return chip.match(p.product_type);
  if (g === 'review')         return chip.match(null, p);
  if (f.dynamic && f.field)   return chip.match(getField(p, f.field));
  return true;
}

/** dynamic 필터 칩을 products 에서 집계해 FILTERS 에 채워넣는다.
 *  passFn(p, key): 해당 key 를 제외한 활성필터를 통과하는지 (없으면 전체) */
export function buildDynamicChips(products, passFn = null) {
  Object.entries(FILTERS).forEach(([key, f]) => {
    if (!f.dynamic) return;
    const scope = passFn ? products.filter(p => passFn(p, key)) : products;
    const counts = {};
    scope.forEach(p => {
      const v = getField(p, f.field);
      if (v !== undefined && v !== null && v !== '') {
        counts[String(v)] = (counts[String(v)] || 0) + 1;
      }
    });
    const sorted = key === 'year'
      ? Object.entries(counts).sort((a, b) => Number(b[0]) - Number(a[0]))
      : Object.entries(counts).sort((a, b) => b[1] - a[1]);

    const mkChip = ([v, cnt]) => ({
      id: `${key}_${v}`,
      label: `${v}(${cnt})`,
      match: x => String(x) === v,
    });
    const limit = TOP_N[key] || 10;
    f.popular = sorted.slice(0, limit).map(mkChip);
    f.others  = sorted.slice(limit).map(mkChip);
    f.chips   = [...f.popular, ...f.others];
  });
}
