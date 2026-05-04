#!/usr/bin/env node
/**
 * scan-test-page-duplicates.cjs 가 찾은 8건의 dropdown 중복을 catalog 매핑으로 해소.
 *  케이스별 처리:
 *   1. catalog 미매핑 row 를 신규/기존 catalog 에 매핑 (페리 전 별도 catalog)
 *   2. 같은 catalog 에 미래 세대 row 가 잘못 매핑된 케이스 → 신규 catalog 분리
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'public', 'data', 'car-master');
const IDX = path.join(BASE, '_index.json');

const idx = JSON.parse(fs.readFileSync(IDX, 'utf-8'));

// 신규 catalog stub 생성 헬퍼
function ensureStub(cid, title, maker, encarKeys, trims) {
  const cp = path.join(BASE, cid + '.json');
  if (!fs.existsSync(cp)) {
    const trimsDict = Object.fromEntries(trims.map(t => [t, {
      slug: t.toLowerCase().replace(/[\s-]/g, '_'), price: {}, basic: [], select: [], select_groups: []
    }]));
    fs.writeFileSync(cp, JSON.stringify({
      catalog_id: cid, title, maker, source: 'stub', source_urls: [],
      fetched_at: '2026-05-04', note: '페리 전/세대 분리 stub',
      options: {}, categories: {}, trims: trimsDict,
    }, null, 2), 'utf-8');
  }
  if (!idx[cid]) {
    idx[cid] = {
      id: cid, title, maker,
      source: { manufacturer: null, wikicar: null, encar: encarKeys },
      verified: { manufacturer: false, wikicar: false, encar: true },
      trims, fetched_at: '2026-05-04', note: '페리 전/세대 분리 stub',
    };
  }
}

// 부모 catalog 에서 encar 제거
function removeFromParent(parentId, encarKey) {
  const p = idx[parentId];
  if (!p) return;
  p.source.encar = (p.source.encar || []).filter(k => k !== encarKey);
}

// 1) K3 YD 페리 (encar_002_060_120 = 더 뉴 K3 2015)
ensureStub('kia_k3_yd_facelift', '기아 더 뉴 K3 (YD)', '기아',
  ['encar_002_060_120'], ['디럭스', '럭셔리', '프레스티지', '노블레스']);

// 2) 레이 TAM 페리 1차 (encar_002_058_134 = 더 뉴 레이 2017)
ensureStub('kia_ray_tam_facelift1', '기아 더 뉴 레이 (TAM 페리1)', '기아',
  ['encar_002_058_134'], ['디럭스', '럭셔리', '프레스티지', '에코']);

// 3) 콜로라도 페리 전 (encar_003_053_100 = 콜로라도 2019)
ensureStub('chevrolet_colorado_pre', '쉐보레 콜로라도', '쉐보레',
  ['encar_003_053_100'], ['익스트림', 'Z71', 'LT']);

// 4) 트레일블레이저 페리 전 (encar_003_055_102 = 트레일블레이저 2019)
ensureStub('chevrolet_trailblazer_pre', '쉐보레 트레일블레이저', '쉐보레',
  ['encar_003_055_102'], ['LS', 'LT', 'Premier', 'RS', 'ACTIV']);

// 5) XC40 1세대 (encar_017_023_027 = XC40 2018, 가솔린/디젤)
ensureStub('volvo_xc40_pre', '볼보 XC40 (1세대)', '볼보',
  ['encar_017_023_027'], ['Momentum', 'Inscription', 'R-Design']);

// 6) XC60 1세대 (encar_017_016_017 = XC60 2012)
ensureStub('volvo_xc60_gen1', '볼보 XC60 (1세대)', '볼보',
  ['encar_017_016_017'], ['Momentum', 'Summum', 'R-Design']);

// 7) 셀토스 SP3 (encar_002_064_186 = 셀토스 2세대 2026)
ensureStub('kia_seltos_sp3', '기아 셀토스 (SP3, 2세대)', '기아',
  ['encar_002_064_186'], ['트렌디', '프레스티지', '시그니처']);
removeFromParent('kia_seltos', 'encar_002_064_186');

// 8) 렉스턴 스포츠 페리 전 (encar_004_003_113 = 렉스턴 스포츠 2018)
ensureStub('kgm_rexton_sports_pre', 'KGM 렉스턴 스포츠 (페리 전)', 'KGM',
  ['encar_004_003_113'], ['프로페셔널', '슈프림', '헤리티지']);
removeFromParent('kgm_rexton_sports', 'encar_004_003_113');

// 9) 렉스턴 스포츠 페리 (encar_004_003_118 = 더 뉴 렉스턴 스포츠 2019)
ensureStub('kgm_rexton_sports_facelift', 'KGM 더 뉴 렉스턴 스포츠', 'KGM',
  ['encar_004_003_118'], ['프로페셔널', '프리미어', '슈프림', '헤리티지', '익스트림']);
removeFromParent('kgm_rexton_sports', 'encar_004_003_118');

fs.writeFileSync(IDX, JSON.stringify(idx, null, 2), 'utf-8');
console.log(`테스트 페이지 dropdown 중복 fix 완료. 전체 카탈로그: ${Object.keys(idx).length}개`);
