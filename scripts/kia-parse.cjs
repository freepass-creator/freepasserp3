/**
 * 기아 price 페이지 파서
 *
 * 구조 (현대와 다름):
 *   <table class="price_list__table">  ← 트림 1개당 1 table
 *     <caption><span>트림/가격, 기본품목,선택품목으로 구성된 [트림명] 표</span></caption>
 *     <tbody>
 *       <tr>
 *         <td>  ← 트림/가격 셀
 *           <h3 class="price_list__item-title">트림명</h3>
 *           <p class="trim_price">..가격..</p>
 *         </td>
 *         <td>  ← 기본품목 셀
 *           <div class="item_wrap">
 *             <p class="item_tit">카테고리명</p>
 *             <p class="item_con"><a data-modal-id="KRDL243009">옵션명</a>, ...</p>
 *           </div>
 *           ...
 *         </td>
 *         <td>  ← 선택품목 셀 (구조 비슷, 가격 추가될 수도)
 *           ...
 *         </td>
 *       </tr>
 *     </tbody>
 *   </table>
 *
 * 옵션 코드: data-modal-id="KRDL243009" (기아 자체 코드)
 * 한글명: <a> 태그 텍스트
 */

function _extractOpts(html) {
  // <a class="..." data-modal-id="..." ...>옵션명</a>
  const re = /<a\b[^>]*\bdata-modal-id="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ code: m[1], name: m[2].trim() });
  return out;
}

function _splitTrimTables(html) {
  return html.match(/<table\s+class="price_list__table"[\s\S]*?<\/table>/g) || [];
}

function _extractTrimName(table) {
  const m1 = table.match(/<h3\s+class="price_list__item-title"[^>]*>([^<]+)<\/h3>/);
  if (m1) return m1[1].trim();
  const m2 = table.match(/구성된\s+([^표<]+?)\s*표/);
  return m2 ? m2[1].trim() : null;
}

function _extractTrimPrice(table) {
  // <p class="trim_price">세제혜택 적용 전 판매가격<strong>33,930,000</strong></p>
  // <p class="trim_price">세제혜택 후 판매가격<strong>32,930,000</strong></p>
  // <p class="trim_price">세제혜택 적용 전 판매가격<br/>(개별소비세 3.5%)<strong>33,410,000</strong></p>
  const price = {};
  const re = /<p[^>]*class="trim_price"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(table)) !== null) {
    const inner = m[1];
    const amt = inner.match(/<strong>([\d,]+)<\/strong>/);
    if (!amt) continue;
    const val = parseInt(amt[1].replace(/,/g, ''));
    const text = inner.replace(/<[^>]+>/g, ' ').trim();
    let key = 'base';
    const isBefore = /적용\s*전/.test(text);
    const isAfter = /후/.test(text) && !isBefore;
    const is35 = /3\.5/.test(text);
    if (is35) key = isBefore ? 'tax_3_5_before' : 'tax_3_5_after';
    else key = isBefore ? 'tax_5_before' : (isAfter ? 'tax_5_after' : 'base');
    price[key] = val;
  }
  return price;
}

// tbody 안 td 3개로 분리 — 트림/가격 / 기본품목 / 선택품목
function _splitCells(table) {
  const tbodyM = table.match(/<tbody[\s\S]*?<\/tbody>/);
  if (!tbodyM) return null;
  const tds = [...tbodyM[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
  return tds;
}

function _extractItemWraps(cellHtml) {
  // <div class="item_wrap"><p class="item_tit">카테고리</p><p class="item_con">…</p></div>
  const out = [];
  const re = /<div\s+class="item_wrap"[\s\S]*?<p[^>]*class="item_tit"[^>]*>([^<]+)<\/p>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(cellHtml)) !== null) {
    out.push({ category: m[1].trim(), inner: m[2] });
  }
  return out;
}

function parseKiaPriceContent(html, meta) {
  const tables = _splitTrimTables(html);
  const optionMaster = {}; // code → { name, category, is_package }
  const trims = {};

  tables.forEach(table => {
    const trimName = _extractTrimName(table);
    if (!trimName) return;
    const cells = _splitCells(table);
    if (!cells || cells.length < 2) return;

    // cells[0] = 트림/가격, cells[1] = 기본품목, cells[2] = 선택품목
    const [_priceCell, basicCell, selectCell] = cells;

    const basicCodes = [];
    _extractItemWraps(basicCell || '').forEach(({ category, inner }) => {
      _extractOpts(inner).forEach(({ code, name }) => {
        if (!optionMaster[code]) {
          optionMaster[code] = { name, category, is_package: false };
        }
        basicCodes.push(code);
      });
    });

    // 선택품목: <ul class="accor_con__list"><li><a data-modal-id="…">옵션명</a><p class="item-price">가격</p></li></ul>
    const selectCodes = [];
    const selectGroups = [];
    if (selectCell) {
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
      let lim;
      while ((lim = liRe.exec(selectCell)) !== null) {
        const li = lim[1];
        const opts = _extractOpts(li);
        if (opts.length === 0) continue;
        const priceM = li.match(/<p[^>]*class="item-price"[^>]*>([^<]+)<\/p>/);
        let price = null;
        if (priceM) {
          const t = priceM[1].replace(/[,원\s]/g, '');
          if (/^\d+$/.test(t)) price = parseInt(t);
        }
        opts.forEach(({ code, name }) => {
          if (!optionMaster[code]) {
            const isPkg = /P\d+$/.test(code);
            optionMaster[code] = { name, category: '선택사양', is_package: isPkg };
          }
          selectCodes.push(code);
        });
        selectGroups.push({ codes: opts.map(o => o.code), price });
      }
    }

    // 같은 트림명이 여러 변형(HEV/가솔린/LPi 등)에서 등장하면 suffix 추가
    let key = trimName;
    let dup = 1;
    while (trims[key]) {
      dup++;
      key = `${trimName} (${dup})`;
    }
    trims[key] = {
      slug: key.replace(/\s+/g, '_'),
      price: _extractTrimPrice(table),
      basic: [...new Set(basicCodes)],
      select: [...new Set(selectCodes)],
      select_groups: selectGroups
    };
  });

  // 카테고리별 그룹
  const categories = {};
  Object.entries(optionMaster).forEach(([code, info]) => {
    categories[info.category] = categories[info.category] || [];
    categories[info.category].push(code);
  });

  return {
    catalog_id: meta.catalog_id,
    title: meta.title,
    maker: '기아',
    source: 'kia_official',
    source_urls: meta.source_url ? [meta.source_url] : [],
    fetched_at: new Date().toISOString().slice(0, 10),
    categories,
    options: optionMaster,
    trims
  };
}

module.exports = { parseKiaPriceContent };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('usage: node kia-parse.cjs <html-file> <meta-json>');
    process.exit(1);
  }
  const html = fs.readFileSync(args[0], 'utf8');
  const meta = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const result = parseKiaPriceContent(html, meta);
  const outDir = 'public/data/car-master';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${meta.catalog_id}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log('wrote:', out);
  console.log('  trims:', Object.keys(result.trims).length);
  console.log('  options:', Object.keys(result.options).length);
  console.log('  categories:', Object.keys(result.categories).length);
  Object.entries(result.trims).forEach(([n, t]) => {
    console.log(`  ${n}: basic=${t.basic.length} select=${t.select.length}`);
  });
}
