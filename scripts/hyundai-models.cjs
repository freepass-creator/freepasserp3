/**
 * 현대 현행 차종 슬러그 매핑
 * (encar master의 production_end="현재" 27대 기반 + 슬러그 매뉴얼 매핑)
 *
 * 검증: 각 슬러그의 /price 페이지가 200 응답이면 OK
 * 슬러그 명명 규칙은 hyundai.com 자체 패턴
 */

module.exports = [
  // catalog_id, slug, title, encar_keys (매핑용)
  ['hyundai_palisade_lx3',     'the-all-new-palisade',  '현대 디 올 뉴 팰리세이드 (LX3)',         ['encar_001_058_194']],
  ['hyundai_grandeur_gn7',     'grandeur',              '현대 그랜저 (GN7)',                       ['encar_001_004_178','encar_001_004_179']],
  ['hyundai_sonata_dn8_edge',  'sonata-the-edge',       '현대 쏘나타 디 엣지 (DN8)',               ['encar_001_018_185']],
  // 186 (디 엣지 하이브리드)는 페이스리프트 후 제조사 페이지에서 단종 — wikicar OCR로 별도 처리 (hyundai_sonata_dn8_edge_hybrid)
  ['hyundai_avante_cn7',       'avante',                '현대 아반떼 (CN7) 페이스리프트',          ['encar_001_019_182','encar_001_019_183']],
  ['hyundai_avante_n',         'avante-n',              '현대 아반떼 N',                            ['encar_001_019_166']],
  ['hyundai_kona_sx2',         'kona',                  '현대 코나 (SX2)',                          ['encar_001_055_180','encar_001_055_181','encar_001_055_184']],
  ['hyundai_tucson_nx4',       'tucson',                '현대 투싼 (NX4)',                          ['encar_001_032_188','encar_001_032_189']],
  ['hyundai_santa_fe_mx5',     'santafe',               '현대 싼타페 (MX5)',                        ['encar_001_017_187']],
  ['hyundai_staria',           'the-new-staria',        '현대 더 뉴 스타리아',                      ['encar_001_060_171','encar_001_060_198']],
  ['hyundai_staria_lounge',    'the-new-staria-lounge', '현대 스타리아 라운지',                     []],
  ['hyundai_casper',           'casper',                '현대 캐스퍼',                              ['encar_001_062_193']],
  ['hyundai_casper_electric',  'inster',                '현대 인스터 (캐스퍼 일렉트릭)',            ['encar_001_062_192']],
  ['hyundai_venue',            'venue',                 '현대 베뉴',                                ['encar_001_059_159']],
  ['hyundai_ioniq5',           'ioniq5',                '현대 더 뉴 아이오닉5',                     ['encar_001_061_172','encar_001_061_190']],
  ['hyundai_ioniq5_n',         'ioniq5-n',              '현대 아이오닉5 N',                          []],
  ['hyundai_ioniq6',           'the-new-ioniq6',        '현대 더 뉴 아이오닉6',                     ['encar_001_063_176','encar_001_063_197']],
  ['hyundai_ioniq9',           'ioniq9',                '현대 아이오닉9',                            ['encar_001_066_195']],
  ['hyundai_nexo_nh2',         'the-all-new-nexo',      '현대 디 올 뉴 넥쏘 (NH2)',                 ['encar_001_056_196']],
  ['hyundai_st1',              'st1',                   '현대 ST1',                                  ['encar_001_065_191']]
];
