import { describe, it, expect } from 'vitest';
import { inferCarModel } from '../car-model-infer.js';

/* OCR 차명 + 등록일 → vehicle_master generation 추론 검증 */

const masters = [
  // 그랜저 — 3세대 (HG, 2011~2016) / 4세대 (IG, 2016-11~2019-10) / 5세대 (GN7, 2022-12~현재)
  { maker: '현대', model: '그랜저', sub_model: 'HG', production_start: '2011-01', production_end: '2016-10', vehicle_class: '준대형' },
  { maker: '현대', model: '그랜저', sub_model: 'IG', production_start: '2016-11', production_end: '2019-10', vehicle_class: '준대형' },
  { maker: '현대', model: '그랜저', sub_model: 'GN7', production_start: '2022-12', production_end: '현재', vehicle_class: '준대형' },
  // K5 — DL3 (2019-12~현재 단일 세대)
  { maker: '기아', model: 'K5', sub_model: 'DL3', production_start: '2019-12', production_end: '현재', vehicle_class: '중형' },
  // 코나 — OS (2017-07~2022-12)
  { maker: '현대', model: '코나', sub_model: 'OS', production_start: '2017-07', production_end: '2022-12', vehicle_class: 'SUV' },
];

describe('inferCarModel — 정확 매칭', () => {
  it('"그랜저" + 2018-05 → IG (생산기간 내, 거리 0)', () => {
    const r = inferCarModel('그랜저', '2018', '2018.05.10', masters);
    expect(r.sub_model).toBe('IG');
    expect(r.maker).toBe('현대');
    expect(r.model).toBe('그랜저');
    expect(r.vehicle_class).toBe('준대형');
  });

  it('"그랜저" + 2014-03 → HG (IG는 시작 전이라 제외)', () => {
    const r = inferCarModel('그랜저', '2014', '2014.03.05', masters);
    expect(r.sub_model).toBe('HG');
  });

  it('"그랜저" + 2020-03 → IG (생산 종료 후 재고 등록, 거리 5개월)', () => {
    const r = inferCarModel('그랜저', '2020', '2020.03.15', masters);
    expect(r.sub_model).toBe('IG');
  });

  it('"그랜저" + 2023-06 → GN7 (생산기간 내)', () => {
    const r = inferCarModel('그랜저', '2023', '2023.06.20', masters);
    expect(r.sub_model).toBe('GN7');
  });

  it('"K5" + 2021-08 → DL3', () => {
    const r = inferCarModel('K5', '2021', '2021.08.10', masters);
    expect(r.sub_model).toBe('DL3');
    expect(r.maker).toBe('기아');
  });
});

describe('inferCarModel — generation 경계 처리', () => {
  it('IG 시작 직후 (2016-11) — IG 매칭', () => {
    const r = inferCarModel('그랜저', '2016', '2016.11.05', masters);
    expect(r.sub_model).toBe('IG');
  });

  it('HG 종료 직후 (2016-10) — HG 매칭 (IG는 시작 전)', () => {
    const r = inferCarModel('그랜저', '2016', '2016.10.20', masters);
    expect(r.sub_model).toBe('HG');
  });
});

describe('inferCarModel — substring fallback', () => {
  it('"그랜저 3.0" — substring 매칭으로 그랜저', () => {
    const r = inferCarModel('그랜저 3.0', '2018', '2018.06.01', masters);
    expect(r.model).toBe('그랜저');
    expect(r.sub_model).toBe('IG');
  });

  it('대소문자/공백 무시 — "k5" → K5', () => {
    const r = inferCarModel('k5', '2021', '2021.05.01', masters);
    expect(r.model).toBe('K5');
  });
});

describe('inferCarModel — 매칭 실패', () => {
  it('마스터에 없는 차명 → null', () => {
    expect(inferCarModel('아반떼', '2020', '2020.01.01', masters)).toBeNull();
  });

  it('등록일·연식 없으면 → null', () => {
    expect(inferCarModel('그랜저', '', '', masters)).toBeNull();
  });

  it('차명 없으면 → null', () => {
    expect(inferCarModel('', '2020', '2020.01.01', masters)).toBeNull();
  });

  it('빈 마스터 → null', () => {
    expect(inferCarModel('그랜저', '2020', '2020.01.01', [])).toBeNull();
  });

  it('아카이브된 모델은 후보에서 제외', () => {
    const archived = masters.map(m => ({ ...m, archived: true }));
    expect(inferCarModel('그랜저', '2020', '2020.01.01', archived)).toBeNull();
  });
});

describe('inferCarModel — production_end "현재" 처리', () => {
  it('production_end="현재" 인 generation 도 정상 매칭', () => {
    const r = inferCarModel('K5', '2024', '2024.05.01', masters);
    expect(r.sub_model).toBe('DL3');
  });
});

describe('inferCarModel — year_start fallback', () => {
  it('production_start 없고 year_start만 있어도 동작', () => {
    const legacy = [
      { maker: '현대', model: '쏘나타', sub_model: 'YF', year_start: 2009, year_end: 2014 },
      { maker: '현대', model: '쏘나타', sub_model: 'LF', year_start: 2014, year_end: 2019 },
    ];
    const r = inferCarModel('쏘나타', '2017', '2017.06.01', legacy);
    expect(r.sub_model).toBe('LF');
  });
});
