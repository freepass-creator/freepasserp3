#!/usr/bin/env node
/**
 * 카탈로그 트림 가격 정합성 감사 (audit)
 *
 *   A. 파워트레인 분기 누락 의심 — 트림 가격이 모두 동일 base 인데 파워트레인 키워드가 없음
 *   B. 가격 역전 — grade 순서와 가격 오름차순이 어긋남 (예: 프레스티지 > 노블레스)
 *   C. 위키카 가격표 풍부 vs catalog 가격 단순 — OCR 보강 잠재 케이스
 *   D. 동일 trim 가격 중복 — 가솔린·디젤·HEV 합쳐 적었을 가능성
 *
 * 출력: docs/trim-price-audit.md
 * 사용법: node scripts/audit-trim-prices.cjs
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const WIKI_DIR    = path.join(__dirname, '..', 'public', 'data', 'wikicar');
const OUTPUT      = path.join(__dirname, '..', 'docs', 'trim-price-audit.md');

// 파워트레인 키워드 — 트림명에 있으면 분기 명시된 것으로 간주
const PT_KEYWORDS = [
  'HEV','PHEV','EV','하이브리드','플러그인','전기',
  '가솔린','디젤','LPG','LPI','터보',
  'T-GDI','GDI','MPI','CRDI','TDI',
  '1.0','1.2','1.4','1.5','1.6','1.7','1.8','2.0','2.2','2.4','2.5',
  '3.0','3.3','3.5','3.6','3.8','4.0','4.4','5.0',
  // 대표 엔진 코드 (현/기/중)
  'Smartstream','스마트스트림','람다','쎄타','감마','카파','뉴Rho','R엔진','U엔진',
  'AWD','4WD','2WD','FWD',
  // EV 표기
  'Long Range','Standard Range','롱레인지','스탠다드','Performance','Air','Earth','GT',
];

// grade 순서 (한국차 일반 등급 체계 — 높을수록 prestigious)
// 우리가 추측하는 등급 순서. 정확한 순서는 모델별 다를 수 있어 참고용.
// '블랙'/'블랙 익스테리어'/'블랙 잉크' 는 옵션 패키지라 grade 비교에서 제외.
// '에이치-픽' / 'H-Pick' 도 옵션 변형 trim 으로 처리 (grade 매칭 X).
const GRADE_ORDER = [
  '스마트','모던','프리미엄','익스클루시브','프레스티지',
  '노블레스','시그니처','캘리그래피',
  // 외국식
  'Trend','Active','Premium','Inspiration','Luxury','Sport',
];

const MIN_PRICE_DIFF_PCT = 3; // 동일가 의심 임계값 (3% 이내면 사실상 동일가)

function loadCatalogs() {
  return fs.readdirSync(CATALOG_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
        return { file: f, data };
      } catch (e) { return { file: f, error: e.message }; }
    });
}

function getBasePrice(trimObj) {
  if (!trimObj || typeof trimObj !== 'object') return 0;
  if (typeof trimObj.price === 'number') return trimObj.price;
  if (trimObj.price && typeof trimObj.price === 'object') {
    if (typeof trimObj.price.base === 'number') return trimObj.price.base;
    // 첫 숫자 값
    for (const v of Object.values(trimObj.price)) {
      if (typeof v === 'number' && v > 0) return v;
    }
  }
  return 0;
}

function hasPowertrainKw(name) {
  return PT_KEYWORDS.some(kw => name.includes(kw));
}

function gradeIndex(name) {
  // 옵션 패키지가 붙은 trim 은 grade 비교에서 제외
  // (grade 가 아니라 옵션이라 같은 grade 안에서 가격 차이만 발생)
  if (/N ?라인|N-Line|N\s*Line|에이치-픽|H-Pick/.test(name)) return -1;
  // 가장 먼저 등장하는 grade 키워드 위치를 인덱스로 (낮을수록 entry-level)
  for (let i = 0; i < GRADE_ORDER.length; i++) {
    if (name.includes(GRADE_ORDER[i])) return i;
  }
  return -1;
}

function wikicarPageCount(catalogId) {
  const dir = path.join(WIKI_DIR, catalogId);
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).filter(f => /^p\d+\.jpe?g$/i.test(f)).length;
  } catch { return 0; }
}

function audit({ file, data, error }) {
  if (error) return { file, error };

  const id = data.catalog_id || file.replace(/\.json$/, '');
  const trims = data.trims || {};
  const entries = Object.entries(trims);
  const issues = [];

  // 가격 추출 + 파워트레인 키워드 체크
  const trimList = entries.map(([name, t]) => ({
    name,
    price: getBasePrice(t),
    hasPt: hasPowertrainKw(name),
    grade: gradeIndex(name),
  }));

  const priced = trimList.filter(t => t.price > 0);
  const distinctPrices = new Set(priced.map(t => t.price));

  // === A. 파워트레인 분기 누락 의심 ===
  //   - 트림 2개 이상
  //   - 어떤 트림에도 파워트레인 키워드 없음
  //   - 위키카 페이지가 5장 이상 (가격표 분리 시그널 — 강한 임계로)
  //   - EV 전용 catalog (단일 동력원) 는 면제
  //   - 가격 모두 채움 + 위키카 4장 이하 = 단일 동력원 추정 → 면제
  const ptCount = trimList.filter(t => t.hasPt).length;
  const wikiPages = wikicarPageCount(id);
  const isEvOnly = /^(kia_ev\d|hyundai_ioniq|hyundai_nexo|hyundai_st1|kgm_torres_evx|kia_ray_ev|kia_niro_ev|kia_pv5|hyundai_casper_electric)/.test(id)
                || /일렉트리파이드|EV 전용/.test(data.title || '');
  const isAllPriced = priced.length === entries.length && entries.length >= 2;
  const isLikelySingle = isAllPriced && wikiPages <= 4;
  if (entries.length >= 2 && ptCount === 0 && wikiPages >= 5 && !isEvOnly && !isLikelySingle) {
    issues.push({
      type: 'A',
      severity: 'high',
      msg: `파워트레인 키워드 0개 + 위키카 ${wikiPages}장 — 가솔린/디젤/HEV 분기 누락 의심`,
    });
  }

  // === D. 동일 가격 중복 ===
  //   - 가격 보유 트림 3개 이상
  //   - 고유 가격 수 / 트림 수 < 0.6
  if (priced.length >= 3 && (distinctPrices.size / priced.length) < 0.6) {
    issues.push({
      type: 'D',
      severity: 'medium',
      msg: `${priced.length}개 트림 중 고유 가격 ${distinctPrices.size}개 (${Math.round(distinctPrices.size/priced.length*100)}%) — 동력원별 가격이 합쳐졌을 가능성`,
    });
  }

  // === B. 가격 역전 (grade vs price) ===
  //   - 같은 동력원 그룹 안에서만 비교 (가솔린·LPG·디젤·HEV 분리)
  //   - 영업용/장애인용/렌트 같은 special suffix 도 별도 그룹 (가격 정상적으로 낮음)
  //   - 그룹별 grade 인덱스 알려진 트림 3개 이상 → 그룹 안에서 grade 단조증가 검사
  const ptBucket = (name) => {
    if (/하이브리드|HEV|PHEV/.test(name)) return 'hev';
    if (/LPG|LPI/.test(name)) return 'lpg';
    if (/디젤/.test(name)) return 'diesel';
    if (/일렉트릭|EV|전기/.test(name)) return 'ev';
    return 'gas';
  };
  const specialBucket = (name) => {
    if (/영업용|렌터카전용|렌트|장애인/.test(name)) return 'special';
    return 'normal';
  };
  const buckets = {};
  priced.forEach(t => {
    if (t.grade < 0) return;
    const k = `${ptBucket(t.name)}/${specialBucket(t.name)}`;
    (buckets[k] = buckets[k] || []).push(t);
  });

  const inversions = [];
  Object.values(buckets).forEach(group => {
    if (group.length < 3) return;
    const sorted = group.slice().sort((a,b) => a.grade - b.grade);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].grade === sorted[i-1].grade) continue; // 같은 grade 끼리는 건너뜀
      if (sorted[i].price < sorted[i-1].price) {
        inversions.push(`"${sorted[i-1].name}"(${sorted[i-1].price.toLocaleString()}) > "${sorted[i].name}"(${sorted[i].price.toLocaleString()})`);
      }
    }
  });
  if (inversions.length) {
    issues.push({
      type: 'B',
      severity: 'high',
      msg: `등급 오름차순인데 가격 역전 ${inversions.length}쌍 — ${inversions.slice(0,2).join(' / ')}`,
    });
  }

  // === C. 위키카 가격표 풍부 vs catalog 가격 단순 ===
  //   - 위키카 페이지 7장 이상 (강한 임계 — 다중 동력원 분리 가능성)
  //   - catalog trim 3개 이하
  //   - select_groups 가 풍부하면 (옵션 패키지 다양 = 위키카 페이지 多 정당화) 면제
  const sgCount = trimList.reduce((s, t) => {
    const tt = trims[t.name];
    return s + (tt?.select_groups?.length || 0);
  }, 0);
  const hasRichOptions = sgCount >= 10 || isAllPriced;
  if (wikiPages >= 7 && entries.length <= 3 && entries.length > 0 && !hasRichOptions && !isEvOnly) {
    issues.push({
      type: 'C',
      severity: 'medium',
      msg: `위키카 ${wikiPages}장 vs catalog ${entries.length}트림 — OCR 보강 잠재`,
    });
  }

  return {
    file,
    catalog_id: id,
    title: data.title || '',
    maker: data.maker || '',
    trim_count: entries.length,
    priced_count: priced.length,
    distinct_prices: distinctPrices.size,
    pt_kw_count: ptCount,
    wiki_pages: wikiPages,
    issues,
    trims: trimList,
  };
}

function severityRank(s) {
  return s === 'high' ? 2 : s === 'medium' ? 1 : 0;
}

function generateReport(results) {
  const failed = results.filter(r => r.issues && r.issues.length);

  // 정렬: 심각도 max desc, 트림 수 desc
  failed.sort((a, b) => {
    const sa = Math.max(...a.issues.map(i => severityRank(i.severity)));
    const sb = Math.max(...b.issues.map(i => severityRank(i.severity)));
    if (sb !== sa) return sb - sa;
    return b.trim_count - a.trim_count;
  });

  const byType = { A: [], B: [], C: [], D: [] };
  failed.forEach(r => r.issues.forEach(i => byType[i.type].push({ ...r, _issue: i })));

  const lines = [];
  lines.push('# 트림 가격 정합성 감사 보고서');
  lines.push('');
  lines.push(`> 생성: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  lines.push('');
  lines.push('## 요약');
  lines.push('');
  lines.push(`- 총 카탈로그: ${results.length}개`);
  lines.push(`- 결함 카탈로그: ${failed.length}개 (${(failed.length/results.length*100).toFixed(1)}%)`);
  lines.push(`- 분류:`);
  lines.push(`  - **A** 파워트레인 분기 누락: ${byType.A.length}개`);
  lines.push(`  - **B** 가격 역전 (등급 vs 가격): ${byType.B.length}개`);
  lines.push(`  - **C** 위키카 가격표 풍부 vs catalog 단순: ${byType.C.length}개`);
  lines.push(`  - **D** 동일 가격 중복: ${byType.D.length}개`);
  lines.push('');

  // ── A 섹션 ──
  if (byType.A.length) {
    lines.push('## A. 파워트레인 분기 누락 의심');
    lines.push('');
    lines.push('> 트림명에 가솔린/디젤/HEV/엔진 표기가 없고 위키카 페이지는 풍부 — 동력원별 가격이 합쳐졌을 가능성.');
    lines.push('');
    lines.push('| catalog | title | 트림 | 고유가 | wiki | 트림 목록 |');
    lines.push('|---|---|---:|---:|---:|---|');
    byType.A.forEach(r => {
      const trimSummary = r.trims.map(t => `${t.name}(${t.price ? (t.price/10000)+'만' : '?'})`).join(' / ');
      lines.push(`| ${r.catalog_id} | ${r.title} | ${r.trim_count} | ${r.distinct_prices} | ${r.wiki_pages} | ${trimSummary} |`);
    });
    lines.push('');
  }

  // ── B 섹션 ──
  if (byType.B.length) {
    lines.push('## B. 가격 역전 (등급 순서 vs 가격)');
    lines.push('');
    lines.push('> 등급명상 entry-level 이 더 비싸거나 prestigious 가 더 쌈 — 데이터 입력 오류 의심.');
    lines.push('');
    lines.push('| catalog | title | 역전 |');
    lines.push('|---|---|---|');
    byType.B.forEach(r => lines.push(`| ${r.catalog_id} | ${r.title} | ${r._issue.msg} |`));
    lines.push('');
  }

  // ── C 섹션 ──
  if (byType.C.length) {
    lines.push('## C. 위키카 가격표 풍부 vs catalog 단순');
    lines.push('');
    lines.push('> 위키카 OCR 이미지가 5장 이상인데 catalog 트림은 4개 이하 — 보강 여지.');
    lines.push('');
    lines.push('| catalog | title | wiki | trims | 메이커 |');
    lines.push('|---|---|---:|---:|---|');
    byType.C.forEach(r => lines.push(`| ${r.catalog_id} | ${r.title} | ${r.wiki_pages} | ${r.trim_count} | ${r.maker} |`));
    lines.push('');
  }

  // ── D 섹션 ──
  if (byType.D.length) {
    lines.push('## D. 동일 가격 중복');
    lines.push('');
    lines.push('> 트림 수 대비 고유 가격 종류가 60% 미만 — 같은 가격이 다수 트림에 걸침 (분기 합쳐진 흔적).');
    lines.push('');
    lines.push('| catalog | title | 트림 | 고유가 | 비율 |');
    lines.push('|---|---|---:|---:|---:|');
    byType.D.forEach(r => {
      const pct = (r.distinct_prices/r.priced_count*100).toFixed(0);
      lines.push(`| ${r.catalog_id} | ${r.title} | ${r.priced_count} | ${r.distinct_prices} | ${pct}% |`);
    });
    lines.push('');
  }

  // ── 부록: 정상 catalog 샘플 ──
  const ok = results.filter(r => r.issues && r.issues.length === 0 && r.priced_count >= 3);
  lines.push('## 정상 catalog (참고)');
  lines.push('');
  lines.push(`결함 없는 catalog (가격 3개+ 트림 보유): ${ok.length}개`);
  lines.push('');

  return lines.join('\n');
}

function main() {
  const catalogs = loadCatalogs();
  const results = catalogs.map(audit);
  const errors = results.filter(r => r.error);
  if (errors.length) {
    console.warn(`⚠ JSON 파싱 실패 ${errors.length}개:`);
    errors.forEach(e => console.warn(`  ${e.file}: ${e.error}`));
  }

  const report = generateReport(results.filter(r => !r.error));
  fs.writeFileSync(OUTPUT, report, 'utf8');

  const failed = results.filter(r => r.issues && r.issues.length);
  console.log(`✓ 감사 완료: ${results.length}개 catalog 분석`);
  console.log(`  결함 ${failed.length}개`);
  console.log(`  → ${path.relative(process.cwd(), OUTPUT)}`);
}

main();
