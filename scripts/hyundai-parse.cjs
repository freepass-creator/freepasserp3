/**
 * Hyundai price.content fragment parser (옵션 전용 — 가격 미사용)
 *
 * 출력: 차종별 옵션 카탈로그 JSON (트림 × 기본/선택)
 *
 * 구조:
 *   - <tr data-trim="exclusive"> ... </tr>: 트림 1개
 *     - <ul data-opts="basic"><li><p class="name">카테고리</p><p class="content"><span data-car-spc-cd="FX01001">한글명</span></p></li></ul>
 *     - <ul data-opts="select"><li><p class="item-name"><span ...>옵션</span></p></li></ul>
 *   - 패키지 코드: FX01P01 (영문 P 포함)
 */

function _extractSpcCodes(html) {
  // class='spec_opts' (single quote) 또는 "spec_opts" (double) 둘 다 매칭
  const re = /<span\s+class=['"]spec_opts['"]\s+data-car-spc-cd="([^"]+)">([^<]+)<\/span>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ code: m[1], name: m[2].trim() });
  return out;
}

function _splitTrimBlocks(html) {
  const blocks = {};
  const re = /<tr\s+data-trim="([^"]+)"[\s\S]*?(?=<tr\s+data-trim="|<\/tbody>)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === '트림명') continue;
    blocks[m[1]] = m[0];
  }
  return blocks;
}

// 트림 영문명 → 한글명 매핑 (kr 누락 시 fallback)
const EN_TO_KR = {
  'Premium': '프리미엄',
  'Premium Plus': '프리미엄 플러스',
  'Premium Choice': '프리미엄 초이스',
  'Exclusive': '익스클루시브',
  'Exclusive Plus': '익스클루시브 플러스',
  'Inspiration': '인스퍼레이션',
  'Inspiration Plus': '인스퍼레이션 플러스',
  'Calligraphy': '캘리그래피',
  'Calligraphy Premium': '캘리그래피 프리미엄',
  'Calligraphy Premium Choice': '캘리그래피 프리미엄 초이스',
  'Honors': '아너스',
  'Black Exterior': '블랙 익스테리어',
  'Black Ink': '블랙 잉크',
  'S': '에스',
  'Smart': '스마트',
  'Smart Choice': '스마트 초이스',
  'Modern': '모던',
  'Modern Choice': '모던 초이스',
  'Business 1': '비즈니스1',
  'Business 2': '비즈니스2'
  // 'N Line'은 styling 라벨이라 trim 레벨 변환에서 제외 — 슬러그(premium 등)로 폴백 + suffix "(N라인)"이 별도 부착
};

// slug → kr (kr/en 모두 비어있을 때의 마지막 폴백)
const SLUG_TO_KR = {
  'premium': '프리미엄',
  'premium-plus': '프리미엄 플러스',
  'exclusive': '익스클루시브',
  'exclusive-plus': '익스클루시브 플러스',
  'inspiration': '인스퍼레이션',
  'calligraphy': '캘리그래피',
  'honors': '아너스',
  's': '에스',
  'smart': '스마트',
  'modern': '모던'
};

function _extractTrimName(block, slug) {
  // 트림 이름은 첫 <p class="title"> 안에 있음. price 영역의 kr/en 과 섞이지 않게 분리.
  const titleM = block.match(/<p\s+class="title"[^>]*>([\s\S]*?)<\/p>/);
  const titleHtml = titleM ? titleM[1] : block;

  // kr — paren 유무 모두 허용 ("(프리미엄)" / "익스클루시브 플러스")
  const km = titleHtml.match(/<span\s+class="kr"[^>]*>\(?([^()<]+?)\)?<\/span>/);
  if (km && km[1]) {
    const t = km[1].trim();
    if (t && !/^\d/.test(t) && !/적용|개별소비세/.test(t)) {
      return { name_kr: t, name_en: null };
    }
  }
  // en → kr dict (등록된 trim 레벨만)
  const enm = titleHtml.match(/<span\s+class="en"[^>]*>([^<]+)<\/span>/);
  const en = enm ? enm[1].trim() : null;
  if (en && EN_TO_KR[en]) {
    return { name_kr: EN_TO_KR[en], name_en: en };
  }
  // slug → kr (마지막 폴백)
  if (slug && SLUG_TO_KR[slug]) {
    return { name_kr: SLUG_TO_KR[slug], name_en: en };
  }
  return { name_kr: slug || null, name_en: en };
}

function _extractTrimPrice(block) {
  // table-price-title 영역 안의 가격만
  const headerM = block.match(/<div\s+class="table-price-title"[\s\S]*?<\/div>/);
  const header = headerM ? headerM[0] : block;
  const price = {};
  // 1) 개별소비세 5%/3.5% 분기
  const taxed = [...header.matchAll(/<span\s+class="kr">개별소비세\s+([\d.]+)%\s+적용\s+시[\s\S]*?<span\s+class="price">([\d,]+)<\/span>/g)];
  if (taxed.length) {
    taxed.forEach(p => {
      const tax = p[1].replace('.', '_');
      price[`tax_${tax}`] = parseInt(p[2].replace(/,/g, ''));
    });
  } else {
    const single = header.match(/<span\s+class="price">([\d,]+)<\/span>/);
    if (single) price.base = parseInt(single[1].replace(/,/g, ''));
  }
  return price;
}

function _extractBasic(block) {
  const ulRe = /<ul\b[^>]*\bdata-opts="basic"[^>]*>[\s\S]*?<\/ul>/g;
  const uls = block.match(ulRe) || [];
  const codes = [];
  const codeCategoryMap = {};
  uls.forEach(ul => {
    const liRe = /<li>[\s\S]*?<p[^>]*class="name"[^>]*>([^<]+)<\/p>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = liRe.exec(ul)) !== null) {
      const category = m[1].trim();
      const liInner = m[2];
      _extractSpcCodes(liInner).forEach(({ code, name }) => {
        codes.push({ code, name });
        codeCategoryMap[code] = category;
      });
    }
    _extractSpcCodes(ul).forEach(({ code, name }) => {
      if (!codeCategoryMap[code]) {
        codes.push({ code, name });
        codeCategoryMap[code] = '기타';
      }
    });
  });
  return { codes, codeCategoryMap };
}

function _extractSelect(block) {
  const ulRe = /<ul\b[^>]*\bdata-opts="select"[^>]*>[\s\S]*?<\/ul>/g;
  const uls = block.match(ulRe) || [];
  const groups = []; // [{codes:[code,...], price?}, ...] 같은 li 단위
  const codes = [];
  uls.forEach(ul => {
    const liRe = /<li>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = liRe.exec(ul)) !== null) {
      const li = m[1];
      const items = _extractSpcCodes(li);
      if (items.length === 0) continue;
      // 가격 — <span class="item-price">2,400,000</span>
      const priceM = li.match(/<span\s+class="item-price"[^>]*>([^<]+)<\/span>/);
      let price = null;
      if (priceM) {
        const t = priceM[1].replace(/[,원\s]/g, '');
        if (/^\d+$/.test(t)) price = parseInt(t);
      }
      groups.push({ codes: items.map(i => i.code), price });
      items.forEach(i => codes.push(i));
    }
  });
  return { groups, codes };
}

function parseHyundaiPriceContent(html, meta) {
  const trimBlocks = _splitTrimBlocks(html);
  const optionMaster = {}; // code → { name, category, is_package }
  const trims = {};

  Object.keys(trimBlocks).forEach(slug => {
    const block = trimBlocks[slug];
    const tname = _extractTrimName(block, slug);
    const basic = _extractBasic(block);
    const select = _extractSelect(block);

    [...basic.codes, ...select.codes].forEach(({ code, name }) => {
      if (!optionMaster[code]) {
        optionMaster[code] = {
          name,
          category: basic.codeCategoryMap[code] || '선택사양',
          is_package: /P\d+$/.test(code)
        };
      }
    });

    const trimName = tname.name_kr || slug;
    trims[trimName] = {
      slug,
      name_en: tname.name_en,
      price: _extractTrimPrice(block),
      basic: [...new Set(basic.codes.map(c => c.code))],
      select: [...new Set(select.codes.map(c => c.code))],
      select_groups: select.groups
    };
  });

  const categories = {};
  Object.entries(optionMaster).forEach(([code, info]) => {
    categories[info.category] = categories[info.category] || [];
    categories[info.category].push(code);
  });

  return {
    encar_key: meta.encar_key,
    title: meta.title,
    maker: meta.maker || '현대',
    source: 'hyundai_official',
    source_url: meta.source_url,
    variant: meta.variant,
    fetched_at: new Date().toISOString().slice(0, 10),
    categories,
    options: optionMaster,
    trims
  };
}

module.exports = { parseHyundaiPriceContent };

if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('usage: node hyundai-parse.cjs <html-file> <meta-json>');
    process.exit(1);
  }
  const html = fs.readFileSync(args[0], 'utf8');
  const meta = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const result = parseHyundaiPriceContent(html, meta);
  const out = `public/data/car-options-catalog/${meta.encar_key}.json`;
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log('wrote:', out);
  console.log('  trims:', Object.keys(result.trims).length);
  console.log('  options:', Object.keys(result.options).length);
  console.log('  categories:', Object.keys(result.categories).length);
  Object.entries(result.trims).forEach(([n, t]) => {
    console.log(`  ${n}: basic=${t.basic.length} select=${t.select.length} groups=${t.select_groups.length}`);
  });
}
