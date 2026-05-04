#!/usr/bin/env node
/**
 * 한국 구형 인기차 stub 카탈로그 — 페리 전/세대 별로 분리.
 * 영업자 매물 등록 시 옛 모델도 매트릭스 매칭되게.
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'public', 'data', 'car-master');
const IDX_PATH = path.join(BASE, '_index.json');

const STUBS = [
  // 그랜저 — 일반 IG 페리 (현재 IG_163 catalog는 하이브리드만)
  { id: 'hyundai_grandeur_ig', maker: '현대', title: '현대 더 뉴 그랜저 IG',
    encar: ['encar_001_004_162'],
    trims: ['프리미엄', '익스클루시브', '캘리그래피', '르블랑'] },
  // 그랜저 IG 페리 전 (일반)
  { id: 'hyundai_grandeur_ig_pre', maker: '현대', title: '현대 그랜저 IG',
    encar: ['encar_001_004_141'],
    trims: ['프리미엄', '익스클루시브', '캘리그래피'] },
  // 그랜저 IG 페리 전 하이브리드
  { id: 'hyundai_grandeur_ig_hybrid_pre', maker: '현대', title: '현대 그랜저 IG 하이브리드',
    encar: ['encar_001_004_143'],
    trims: ['프리미엄', '익스클루시브'] },
  // 그랜저 HG (2011-2017)
  { id: 'hyundai_grandeur_hg', maker: '현대', title: '현대 그랜저 HG',
    encar: ['encar_001_004_106', 'encar_001_004_125'],
    trims: ['Modern', 'Premium', 'Luxury', 'Le Blanc', 'Calligraphy'] },

  // 쏘나타 LF
  { id: 'hyundai_sonata_lf', maker: '현대', title: '현대 LF 쏘나타',
    encar: ['encar_001_018_126', 'encar_001_018_128'],
    trims: ['스마트', '스타일', '프리미엄', '프리미엄 스페셜'] },
  // 쏘나타 뉴 라이즈 (LF 페리)
  { id: 'hyundai_sonata_newrise', maker: '현대', title: '현대 쏘나타 뉴 라이즈',
    encar: ['encar_001_018_142', 'encar_001_018_144'],
    trims: ['스마트', '모던', '프리미엄', '인스퍼레이션'] },

  // 아반떼 AD 페리 전 + 더 뉴
  { id: 'hyundai_avante_ad', maker: '현대', title: '현대 아반떼 AD',
    encar: ['encar_001_019_136'],
    trims: ['스마트', '모던', '프리미엄', '익스트림', '스포츠'] },
  { id: 'hyundai_avante_ad_facelift', maker: '현대', title: '현대 더 뉴 아반떼 AD',
    encar: ['encar_001_019_154'],
    trims: ['스마트', '모던', '프리미엄', '인스퍼레이션', '스포츠'] },

  // 코나 OS (1세대)
  { id: 'hyundai_kona_os', maker: '현대', title: '현대 코나 OS',
    encar: ['encar_001_055_146', 'encar_001_055_161', 'encar_001_055_152'],
    trims: ['스마트', '모던', '프리미엄', '하이브리드', '일렉트릭'] },
  { id: 'hyundai_kona_os_facelift', maker: '현대', title: '현대 더 뉴 코나',
    encar: ['encar_001_055_167', 'encar_001_055_168'],
    trims: ['스마트', '모던', '프리미엄', 'N 라인'] },

  // 투싼 TL
  { id: 'hyundai_tucson_tl', maker: '현대', title: '현대 올 뉴 투싼',
    encar: ['encar_001_032_133'],
    trims: ['스마트', '모던', '프리미엄', '인스퍼레이션'] },

  // 팰리세이드 LX2 페리 전 + 페리
  { id: 'hyundai_palisade_lx2', maker: '현대', title: '현대 팰리세이드 LX2',
    encar: ['encar_001_058_155'],
    trims: ['익스클루시브 7인승', '익스클루시브 8인승', '프레스티지 7인승', '프레스티지 8인승', '캘리그래피'] },
  { id: 'hyundai_palisade_lx2_facelift', maker: '현대', title: '현대 더 뉴 팰리세이드 LX2',
    encar: ['encar_001_058_175'],
    trims: ['익스클루시브 7인승', '익스클루시브 8인승', '프레스티지 7인승', '프레스티지 8인승', '캘리그래피', 'VIP'] },

  // K5 JF
  { id: 'kia_k5_jf', maker: '기아', title: '기아 K5 JF',
    encar: ['encar_002_001_118', 'encar_002_001_121'],
    trims: ['트렌디', '럭셔리', '프레스티지', '노블레스', 'GT 라인'] },
  { id: 'kia_k5_jf_facelift', maker: '기아', title: '기아 더 뉴 K5 JF',
    encar: ['encar_002_001_135', 'encar_002_001_139'],
    trims: ['트렌디', '럭셔리', '프레스티지', '노블레스', 'SX'] },

  // K7
  { id: 'kia_k7_yg', maker: '기아', title: '기아 올 뉴 K7',
    encar: ['encar_002_002_122', 'encar_002_002_129'],
    trims: ['프레스티지', '노블레스', '노블레스 스페셜', 'GDI'] },
  { id: 'kia_k7_premier', maker: '기아', title: '기아 K7 프리미어',
    encar: ['encar_002_002_145', 'encar_002_002_146'],
    trims: ['프레스티지', '노블레스', '노블레스 라이트', '시그니처'] },

  // K3 BD
  { id: 'kia_k3_bd', maker: '기아', title: '기아 올 뉴 K3',
    encar: ['encar_002_060_136'],
    trims: ['디럭스', '트렌디', '럭셔리', '프레스티지', 'GT 라인'] },
  { id: 'kia_k3_bd_facelift', maker: '기아', title: '기아 더 뉴 K3',
    encar: ['encar_002_060_157'],
    trims: ['디럭스', '트렌디', '럭셔리', '프레스티지', 'GT'] },

  // 카니발 YP
  { id: 'kia_carnival_yp', maker: '기아', title: '기아 올 뉴 카니발',
    encar: ['encar_002_036_113'],
    trims: ['디럭스', '럭셔리', '프레스티지', '노블레스', '리무진'] },
  { id: 'kia_carnival_yp_facelift', maker: '기아', title: '기아 더 뉴 카니발',
    encar: ['encar_002_036_137'],
    trims: ['트렌디', '럭셔리', '프레스티지', '노블레스', '하이리무진'] },

  // 쏘렌토 UM
  { id: 'kia_sorento_um', maker: '기아', title: '기아 올 뉴 쏘렌토',
    encar: ['encar_002_027_114'],
    trims: ['트렌디', '럭셔리', '프레스티지', '노블레스'] },
  { id: 'kia_sorento_um_facelift', maker: '기아', title: '기아 더 뉴 쏘렌토',
    encar: ['encar_002_027_133'],
    trims: ['트렌디', '럭셔리', '프레스티지', '노블레스', 'SX'] },

  // 스포티지 QL
  { id: 'kia_sportage_ql', maker: '기아', title: '기아 스포티지 4세대',
    encar: ['encar_002_025_119'],
    trims: ['트렌디', '럭셔리', '프레스티지', '노블레스'] },
  { id: 'kia_sportage_ql_facelift', maker: '기아', title: '기아 스포티지 더 볼드',
    encar: ['encar_002_025_141'],
    trims: ['트렌디', '럭셔리', '프레스티지', '노블레스'] },

  // 셀토스 SP2 (기존 kia_seltos 는 페리 후)
  { id: 'kia_seltos_sp2', maker: '기아', title: '기아 셀토스 SP2',
    encar: ['encar_002_064_147'],
    trims: ['트렌디', '프레스티지', '시그니처'] },

  // 니로 DE (1세대)
  { id: 'kia_niro_de', maker: '기아', title: '기아 더 뉴 니로 DE',
    encar: ['encar_002_061_144', 'encar_002_061_140'],
    trims: ['트렌디', '럭셔리', '프레스티지', '노블레스'] },
];

const idx = JSON.parse(fs.readFileSync(IDX_PATH, 'utf-8'));
let created = 0, skipped = 0;

for (const stub of STUBS) {
  const cp = path.join(BASE, stub.id + '.json');
  if (fs.existsSync(cp)) { skipped++; continue; }
  const trimsDict = {};
  for (const t of stub.trims) {
    trimsDict[t] = {
      slug: t.toLowerCase().replace(/[\s-]/g, '_'),
      price: {},
      basic: [],
      select: [],
      select_groups: [],
    };
  }
  const catalog = {
    catalog_id: stub.id,
    title: stub.title,
    maker: stub.maker,
    source: 'stub',
    source_urls: [],
    fetched_at: '2026-05-04',
    note: '구형 한국차 stub — 트림명만. 옵션/가격 추후 OCR.',
    options: {},
    categories: {},
    trims: trimsDict,
  };
  fs.writeFileSync(cp, JSON.stringify(catalog, null, 2), 'utf-8');
  idx[stub.id] = {
    id: stub.id,
    title: stub.title,
    maker: stub.maker,
    source: { manufacturer: null, wikicar: null, encar: stub.encar },
    verified: { manufacturer: false, wikicar: false, encar: true },
    trims: stub.trims,
    fetched_at: '2026-05-04',
    note: '구형 한국차 stub',
  };
  created++;
}

fs.writeFileSync(IDX_PATH, JSON.stringify(idx, null, 2), 'utf-8');
console.log(`구형 한국차 stub: 신규 ${created}개 / 스킵 ${skipped}개`);
console.log(`전체 카탈로그: ${Object.keys(idx).length}개`);
