#!/usr/bin/env node
/**
 * stub catalog 의 PKG_* 패키지를 트림 tier 별로 차등 재배치.
 *  - 모든 트림에 8개 동일 패키지 박는 fill-popular-packages.cjs 와 정반대 작업
 *  - 트림 tier 분류 (base / mid / top) 후 각 tier 에 어울리는 패키지만 select_groups 에 두고 나머지 제거
 *  - options 사전은 유지 (가용 옵션 목록 의미)
 *
 *  사용:
 *    node scripts/redistribute-pkg-by-trim.cjs              # dry-run (트림×tier 매핑만 확인)
 *    node scripts/redistribute-pkg-by-trim.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

// tier 별 패키지 코드
const TIER_PKGS = {
  base: ['PKG_CONVENIENCE', 'PKG_COMFORT'],
  mid:  ['PKG_CONVENIENCE', 'PKG_COMFORT', 'PKG_PARKING', 'PKG_BUILTIN_CAM', 'PKG_ADAS'],
  top:  ['PKG_CONVENIENCE', 'PKG_COMFORT', 'PKG_PARKING', 'PKG_BUILTIN_CAM', 'PKG_ADAS', 'PKG_EXTERIOR', 'PKG_SUNROOF', 'PKG_HUD'],
};

// 트림 이름 → tier (한국 OEM 일반 hierarchy 기반)
// rank 클수록 상위 (위계 순서). 동일 catalog 내 max/min 으로 base/mid/top 매핑.
const RANK_RULES = [
  // top tier 키워드 (4)
  { rank: 4, re: /(캘리그래피|시그니처|노블레스\s*스페셜|마스터즈|헤리티지|익스트림|리미티드|프리미에르|에스프리|GT[-\s]?라인|GT\b|마스터\s*R|플래티넘\s*III|RS\b|ACTIV)/i },
  // upper-mid (3)
  { rank: 3, re: /(노블레스|익스클루시브|프레스티지|슈프림|인스퍼레이션|플래티넘\s*II|Premier\b|프리미어|RE\s*시그니처|TX|X5\b)/i },
  // mid (2)
  { rank: 2, re: /(프리미엄|모던|디스커버리|기어\s*에디션|플래티넘\s*I\b|LT\b|RE\b|LX\b|V5\b|Z71)/i },
  // base (1)
  { rank: 1, re: /(스마트|트렌디|럭셔리|프로페셔널|스탠다드|기본|Standard|LS\b|LE\b|PE\b|EX\b|L5\b|TCe\s*260\s*LE|1\.6\s*GTe\s*SE|패신저|카고|샤시캡)/i },
];

function trimRank(name) {
  const n = (name || '').trim();
  if (!n) return 2;
  for (const r of RANK_RULES) if (r.re.test(n)) return r.rank;
  return 2;  // 매칭 안되면 mid
}

// catalog 의 모든 트림 rank 모아 tier 매핑 — rank 분포에 따라 base/mid/top 구간 결정
function classifyTrims(trims) {
  const entries = Object.entries(trims).map(([id, t]) => ({
    id,
    name: t.trim_name || t.name || id,
    rank: trimRank(t.trim_name || t.name || id),
  }));
  if (!entries.length) return [];
  const ranks = entries.map(e => e.rank);
  const minR = Math.min(...ranks);
  const maxR = Math.max(...ranks);
  // 단일 트림 또는 동일 rank → 모두 mid
  if (minR === maxR) return entries.map(e => ({ ...e, tier: 'mid' }));
  // rank 차 1 → 하위 base, 상위 mid
  if (maxR - minR === 1) return entries.map(e => ({ ...e, tier: e.rank === minR ? 'mid' : 'top' }));
  // rank 차 2+ → 최저 base, 최고 top, 그 사이 mid
  return entries.map(e => ({
    ...e,
    tier: e.rank === minR ? 'base' : (e.rank === maxR ? 'top' : 'mid'),
  }));
}

const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let touched = 0;
let totalTrimsTouched = 0;

for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const opts = d.options || {};
  // PKG_* 사전 항목 보유 catalog 만 대상 (= stub 가 fill 되어있는 상태)
  const hasPkgDict = Object.keys(opts).some(k => k.startsWith('PKG_'));
  if (!hasPkgDict) continue;
  const trims = d.trims || {};
  if (!Object.keys(trims).length) continue;

  const classified = classifyTrims(trims);
  let trimsTouched = 0;
  const tierLog = [];

  for (const c of classified) {
    const t = trims[c.id];
    if (!Array.isArray(t.select_groups)) continue;
    const allowed = new Set(TIER_PKGS[c.tier]);

    const before = t.select_groups.length;
    t.select_groups = t.select_groups.filter(g => {
      if (Array.isArray(g)) return true;
      const codes = g.codes || [];
      const pkgCodes = codes.filter(x => x.startsWith('PKG_'));
      if (!pkgCodes.length) return true;  // PKG_* 아닌 그룹은 그대로
      return pkgCodes.every(x => allowed.has(x));
    });

    // 부족한 PKG 추가
    for (const code of allowed) {
      const exists = t.select_groups.some(g => !Array.isArray(g) && (g.codes || []).includes(code));
      if (exists) continue;
      const optEntry = opts[code];
      if (!optEntry) continue;
      // 가격 — fill-popular-packages 에서 쓰던 디폴트 매핑 그대로 (옵션 사전엔 가격이 없음)
      const PRICE_DEFAULT = {
        PKG_ADAS: 1000000, PKG_CONVENIENCE: 600000, PKG_COMFORT: 700000,
        PKG_PARKING: 800000, PKG_EXTERIOR: 1200000, PKG_BUILTIN_CAM: 850000,
        PKG_SUNROOF: 1200000, PKG_HUD: 1300000,
      };
      t.select_groups.push({ codes: [code], price: PRICE_DEFAULT[code] || 800000, name: optEntry.name });
    }

    if (t.select_groups.length !== before) trimsTouched++;
    tierLog.push(`${c.name}[${c.tier}]`);
  }

  if (trimsTouched === 0) continue;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title}`);
  console.log(`    ${tierLog.join(' / ')}`);
  touched++;
  totalTrimsTouched += trimsTouched;
}

console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 트림 ${totalTrimsTouched}개 재배치`);
