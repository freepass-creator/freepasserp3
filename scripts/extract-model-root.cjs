#!/usr/bin/env node
/**
 * catalog json 파일 401개에 model_root 자동 추출 → 기록.
 *  model_root = 메이커 prefix + 페리(prefix/suffix) + chassis code 제거 후 남는 base 모델명
 *  예: "기아 더 뉴 K3 BD" → "K3"
 *      "현대 디 올 뉴 팰리세이드 LX3" → "팰리세이드"
 *      "BMW 5시리즈 G60" → "5시리즈"
 *      "기아 쏘렌토 더 마스터 UM" → "쏘렌토"
 *
 *  catalog json 에 model_root 가 이미 있으면 보존 (수동 override).
 *
 *  사용:
 *    node scripts/extract-model-root.cjs        # dry-run
 *    node scripts/extract-model-root.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

// 페리 prefix — title 앞쪽
const PERI_PREFIXES = [
  '디 올 뉴 세컨드', '디 올 뉴',
  '디 뉴', '디올뉴', '올 뉴', '올뉴',
  '더 뉴', '더뉴', '뉴',
  '베리 뉴', '더 SUV', '더 넥스트', '일렉트리파이드',
];

// 페리 suffix — title 뒷쪽 (chassis 앞)
const PERI_SUFFIXES = [
  '더 마스터', '더 볼드', '더 SUV', '더 비기닝',
  '프리미어', '마이스터', '디 에디션', '디에디션',
  '하이리무진', '리무진', '쿠페', '쇼팅브레이크', '슈팅브레이크',
  '페이스리프트', '페리', '페리 전', '페리전', 'pre', 'PRE',
  '하이브리드', '플러그인 하이브리드', 'PHEV', 'EV', '일렉트릭', '전기',
  '일렉트리파이드', 'e-트론', 'e트론',
  'N', 'GT', '뉴 라이즈', '디 엣지',
];

// chassis code 패턴 — 영문/숫자 혼합 코드
//   매칭: BD/YP/TAM/LX3/KA4/W213/8Y/B9/F5/C8/4K
const CHASSIS_RE = /^([A-Z]{2,4}\d{0,3}[A-Z]?|[A-Z]\d{1,3}[A-Z]?|\d[A-Z]\d?)$/i;

// 모델 영문명 (chassis 아님)
const MODEL_ENGLISH_NAMES = new Set([
  'BOLT','CRUZE','SPARK','TAHOE','TRAX','TRAILBLAZER','COLORADO','EQUINOX','IMPALA','CAMARO','MALIBU',
  'VENUE','KONA','TUCSON','CASPER','AVANTE','STARIA',
  'RAY','MORNING','STINGER','TASMAN','BONGO','SELTOS','NIRO','SORENTO','SPORTAGE','CARNIVAL','MOHAVE',
  'MUSSO','TIVOLI','TORRES','ACTYON','KORANDO','REXTON',
  'CHEROKEE','WRANGLER','COMPASS','GLADIATOR',
]);

const files = fs.readdirSync(CATALOG_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'));

const results = [];
let kept = 0;

for (const f of files) {
  const filePath = path.join(CATALOG_DIR, f);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const cid = data.catalog_id || f.replace('.json', '');
  const title = data.title || '';
  const maker = data.maker || '';

  if (data.model_root) {
    kept++;
    continue;
  }

  let s = title;
  // 메이커 prefix 제거
  if (maker && s.startsWith(maker + ' ')) s = s.slice(maker.length + 1);
  s = s.trim();

  // 페리 prefix 제거 (가장 긴 매칭 우선)
  for (const p of PERI_PREFIXES) {
    if (s.startsWith(p + ' ')) { s = s.slice(p.length + 1).trim(); break; }
  }

  // chassis 제거 → suffix 제거 → chassis 재제거 (suffix 안쪽에 chassis 가 박혀있는 케이스 대응)
  const stripChassis = (str) => {
    const t = str.split(/\s+/);
    while (t.length > 1) {
      const last = t[t.length - 1].replace(/[,.]+$/, '').toUpperCase();
      if (CHASSIS_RE.test(last) && !MODEL_ENGLISH_NAMES.has(last)) t.pop();
      else break;
    }
    return t.join(' ').trim();
  };
  const stripSuffix = (str) => {
    let r = str;
    let changed = true;
    while (changed) {
      changed = false;
      for (const ps of PERI_SUFFIXES) {
        const re = new RegExp(' ' + ps.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
        const after = r.replace(re, '').trim();
        if (after !== r) { r = after; changed = true; }
      }
    }
    return r;
  };
  s = stripChassis(s);
  s = stripSuffix(s);
  s = stripChassis(s);
  s = stripSuffix(s);

  const root = s;
  results.push({ cid, title, maker, root });
}

console.log(`총 ${results.length}건 추출 (이미 있음: ${kept}건)`);
console.log('');

// 메이커별 그룹 출력
const byMaker = {};
for (const r of results) {
  if (!byMaker[r.maker]) byMaker[r.maker] = [];
  byMaker[r.maker].push(r);
}
const makers = Object.keys(byMaker).sort();
for (const mk of makers) {
  console.log(`## ${mk} (${byMaker[mk].length})`);
  // root 그룹화
  const grp = {};
  for (const r of byMaker[mk]) {
    grp[r.root] = (grp[r.root] || 0) + 1;
  }
  for (const root of Object.keys(grp).sort()) {
    console.log(`  ${root} (${grp[root]})`);
  }
  console.log('');
}

if (!APPLY) {
  console.log('[dry-run] --apply 추가하면 실제 catalog json 에 model_root 기록');
  process.exit(0);
}

let applied = 0;
for (const r of results) {
  const filePath = path.join(CATALOG_DIR, `${r.cid}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  // model_root 를 catalog_id 다음에 삽입
  const out = {};
  for (const k of Object.keys(data)) {
    out[k] = data[k];
    if (k === 'catalog_id') out.model_root = r.root;
  }
  if (!out.model_root) out.model_root = r.root;
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2));
  applied++;
}
console.log(`✓ ${applied}건 적용`);
