/**
 * wikicar 모델 슬러그 매핑
 * (우리 catalog_id ↔ wikicar slug)
 *
 * 우선순위:
 *  1. 현대/기아 누락 6대 (제조사 사이트 안 됨)
 *  2. 제네시스 8대 (사이트 SPA)
 *  3. 쉐보레/르노/KGM 현행 ~12대
 *  4. 추가 인기 단종 모델
 */
module.exports = [
  // [catalog_id, wikicar_slug, title, maker, encar_keys]

  // === 현대 누락분 (제조사 안 됨) ===
  ['hyundai_casper',           'casper',          '현대 캐스퍼',                   '현대',     ['encar_001_062_174','encar_001_062_193']],

  // === 기아 누락분 ===
  ['kia_k3',                   'k3',              '기아 K3',                      '기아',     ['encar_002_060_157']],
  ['kia_mohave',               'mohave',          '기아 모하비',                   '기아',     ['encar_002_015_148']],
  ['kia_stinger',              'stinger',         '기아 스팅어',                   '기아',     ['encar_002_062_155']],

  // === 제네시스 (SPA - wikicar 필수) ===
  ['genesis_g70',              'genesis_g70',     '제네시스 G70',                  '제네시스', ['encar_007_003_007','encar_007_003_013']],
  ['genesis_g80_rg3',          'genesis_g80',     '제네시스 G80 (RG3)',            '제네시스', ['encar_007_002_006']],
  ['genesis_g80_e',            'g80_e',           '제네시스 일렉트리파이드 G80',    '제네시스', ['encar_007_002_009']],
  ['genesis_g90_rs4',          'genesis_g90',     '제네시스 G90 (RS4)',            '제네시스', ['encar_007_004_011']],
  ['genesis_gv60',             'gv60',            '제네시스 GV60',                 '제네시스', ['encar_007_007_010']],
  ['genesis_gv70',             'gv70',            '제네시스 GV70',                 '제네시스', ['encar_007_006_008']],
  ['genesis_gv70_e',           'gv70_e',          '제네시스 일렉트리파이드 GV70',   '제네시스', ['encar_007_006_012']],
  ['genesis_gv80',             'gv80',            '제네시스 GV80',                 '제네시스', ['encar_007_005_005','encar_007_005_014']],

  // === 쉐보레 현행 ===
  ['chevrolet_trax_crossover', 'trax',            '쉐보레 트랙스 크로스오버',      '쉐보레',   ['encar_003_048_108']],
  ['chevrolet_trailblazer',    'trailblazer',     '쉐보레 트레일블레이저',         '쉐보레',   ['encar_003_055_109']],
  ['chevrolet_traverse',       'traverse',        '쉐보레 트래버스',               '쉐보레',   ['encar_003_054_101']],
  ['chevrolet_tahoe',          'tahoe',           '쉐보레 타호',                   '쉐보레',   ['encar_003_057_106']],
  ['chevrolet_colorado',       'colorado',        '쉐보레 콜로라도',               '쉐보레',   ['encar_003_053_110']],

  // === 르노 현행/인기 ===
  ['renault_grand_koleos',     'koleos',          '르노 그랑 콜레오스',            '르노',     ['encar_005_019_077']],
  ['renault_qm6',              'qm6',             '르노 더 뉴 QM6',                '르노',     ['encar_005_011_071']],
  ['renault_sm6',              'sm6',             '르노 더 뉴 SM6',                '르노',     ['encar_005_010_074']],
  ['renault_xm3',              'xm3',             '르노 XM3',                      '르노',     ['encar_005_015_072']],

  // === KGM (쌍용) 현행 ===
  ['kgm_torres',               'torres',          'KGM 토레스',                   'KGM',      []],
  ['kgm_actyon',               'actyon',          'KGM 액티언',                   'KGM',      []],
  ['kgm_musso',                'musso',           'KGM 무쏘',                     'KGM',      []],
  ['kgm_rexton',               'new_rexton',      'KGM 더 뉴 렉스턴',             'KGM',      []],
  ['kgm_rexton_sports',        'rexton_sports',   'KGM 렉스턴 스포츠',            'KGM',      []],
  ['kgm_korando',              'korando_c200',    'KGM 코란도',                   'KGM',      []],
  ['kgm_tivoli',               'tivoli_armour',   'KGM 티볼리',                   'KGM',      []]
];
