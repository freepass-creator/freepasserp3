#!/usr/bin/env node
/**
 * 카탈로그 트림의 basic 옵션을 누적(cumulative)으로 정규화.
 *
 * OCR 데이터가 incremental(증분) 형태로 들어와서
 * 상급 트림이 하급 트림보다 옵션 수가 적은 케이스를 보정.
 *
 * 알고리즘:
 *  1. 트림을 powertrain 그룹으로 묶음 (괄호 안 표기 기준)
 *  2. 같은 그룹 내에서 가격 오름차순 정렬
 *  3. 각 트림 basic = 이전 트림 basic ∪ 현재 trim basic
 *  4. 트림이 아닌 항목 (선택 품목/기본 모델/추천차량/CUSTOMIZING)은 제외
 */
const fs = require('fs');
const path = require('path');

const CAR_MASTER_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

// 트림이 아닌 항목 — 누적에서 제외
const SKIP_TRIM_PATTERNS = [
  /^선택\s*품목/, /^선택사양/, /^기본\s*모델/, /^추천차량/,
  /^CUSTOMIZING$/i, /^Customizing$/, /^선택$/, /^옵션$/,
];

function shouldSkip(trimName, basic) {
  if (!trimName) return true;
  if (basic.length === 0) return true;
  for (const re of SKIP_TRIM_PATTERNS) {
    if (re.test(trimName.trim())) return true;
  }
  return false;
}

// 가격을 비교 가능한 숫자로 변환 — tax_5 > tax_3_5 > base > 0
function priceNum(price) {
  if (price == null) return 0;
  if (typeof price === 'number') return price;
  if (typeof price !== 'object') return 0;
  return price.tax_5 || price.tax_3_5 || price.base || 0;
}

// 그룹 키: 트림명의 괄호 안 표기 (없으면 'default')
function groupKey(trimName) {
  const m = trimName.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : 'default';
}

function processCatalog(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const trims = data.trims || {};
  const trimNames = Object.keys(trims);
  if (trimNames.length < 2) return { changed: false };

  // 그룹별 분류 + skip 체크
  const groups = new Map(); // groupKey -> [{name, trim}]
  const skipped = [];
  for (const name of trimNames) {
    const t = trims[name];
    const basic = Array.isArray(t.basic) ? t.basic : [];
    if (shouldSkip(name, basic)) {
      skipped.push(name);
      continue;
    }
    const gk = groupKey(name);
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push({ name, trim: t });
  }

  // 각 그룹 내 가격 오름차순 정렬 + 누적 union
  let changed = false;
  const log = [];
  for (const [gk, items] of groups.entries()) {
    if (items.length < 2) continue;
    items.sort((a, b) => priceNum(a.trim.price) - priceNum(b.trim.price));

    let cum = new Set();
    for (const it of items) {
      const before = it.trim.basic.length;
      const cur = new Set(it.trim.basic);
      // union
      for (const code of cum) cur.add(code);
      const newBasic = [...cur];
      if (newBasic.length !== before) {
        it.trim.basic = newBasic;
        changed = true;
        log.push(`  [${gk}] ${it.name}: ${before} → ${newBasic.length}`);
      }
      cum = cur; // next trim accumulates from this
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
  return { changed, log, skipped };
}

function main() {
  const files = fs.readdirSync(CAR_MASTER_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  let totalChanged = 0;
  for (const f of files) {
    const fp = path.join(CAR_MASTER_DIR, f);
    const { changed, log, skipped } = processCatalog(fp);
    if (changed) {
      totalChanged++;
      console.log(`■ ${f}`);
      for (const line of log) console.log(line);
      if (skipped && skipped.length) console.log(`  (제외: ${skipped.join(', ')})`);
      console.log();
    }
  }
  console.log(`\n[cumulate-trim-basic] ${totalChanged}/${files.length} 카탈로그 정규화 완료`);
}

main();
