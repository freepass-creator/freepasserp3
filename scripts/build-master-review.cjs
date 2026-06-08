#!/usr/bin/env node
/**
 * 차종마스터 검수 표 생성 — public/data/car-master/*.json 을 읽어 5단계 구조로 펼친 HTML 표.
 *   제조사 → 모델 → 세부모델(연식) → 파워트레인 → 트림
 *
 * "우리 기준" 표를 한눈에 보고 검수(엔카 대조: 잘못된 트림/세대 오입력 등)하기 위함.
 * 드롭다운(차종마스터 캐스케이드)의 소스 = 이 catalog. 표에서 고칠 곳 찾으면 per-model json 수정 → rebuild-catalog-index.
 *
 * 출력: master-review.html (레포 루트). 로컬에서 열어 확인.
 * 실행: node scripts/build-master-review.cjs
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');

/* ── parseTrim — vehicle-master-tree.js 와 동일 로직 (파워트레인/트림 분해) ── */
const FUEL = new Set(['가솔린', '휘발유', '디젤', '경유', 'LPG', 'LPi', 'LPI', '하이브리드', 'HEV', '전기', 'EV', '수소', 'PHEV', 'FCEV']);
const FUEL_NORM = { '경유': '디젤', '휘발유': '가솔린', '전기': 'EV' };
const normFuel = (t) => FUEL_NORM[t] || t;
const BATTERY = new Set(['스탠다드', '스탠더드', '롱레인지', '롱 레인지']);
const DRIVE = new Set(['AWD', '4WD', '2WD', 'RWD', 'FWD', 'e-4WD', '2륜', '4륜', '4MATIC', 'xDrive']);
const TURBO = new Set(['T', '터보', 'T-GDI', 'GDI', 'e-VGT', 'TDI', 'T8', 'T6', 'T5']);
const NOISE_TRIM = new Set(['더', '올', '디', '뉴', '신형', '렌터카', '렌트', '렌트카', '자가용', '영업용', '리스', '법인', '런칭', 'the', 'The']);
function isSpecToken(t) {
  if (!t) return false;
  if (FUEL.has(t) || BATTERY.has(t) || DRIVE.has(t) || TURBO.has(t)) return true;
  if (/^\d\.\d$/.test(t)) return true;
  if (/^\d{3,4}cc$/i.test(t)) return true;
  if (/^\d+인승$/.test(t)) return true;
  if (/^\d\.\dT$/i.test(t)) return true;
  return false;
}
function classifySpec(t) {
  if (FUEL.has(t)) return 'fuel';
  if (BATTERY.has(t)) return 'battery';
  if (TURBO.has(t)) return 'turbo';
  if (DRIVE.has(t)) return 'drive';
  if (/^\d+인승$/.test(t)) return 'seats';
  if (/^\d\.\dT$/i.test(t)) return 'disp';
  if (/^\d\.\d$/.test(t) || /^\d{3,4}cc$/i.test(t)) return 'disp';
  return 'etc';
}
function parseTrim(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return { variant: '', trim: '(기본)' };
  const toks = s.split(' ');
  // 스펙 토큰 위치 무관 파워트레인, 노이즈 제거, 나머지 트림. "2.0T"→2.0+T(규격통일).
  const hasEV = toks.some((t) => t === '전기' || t === 'EV');
  const slots = { fuel: [], disp: [], battery: [], turbo: [], drive: [], seats: [], etc: [] };
  const trimToks = [];
  for (const tok of toks) {
    const mt = tok.match(/^(\d\.\d)T$/i);
    if (mt) { slots.disp.push(mt[1]); slots.turbo.push('T'); continue; }
    if (FUEL.has(tok)) { slots.fuel.push(tok); continue; }
    if (tok === '롱레인지' || tok === '롱') { slots.battery.push('롱레인지'); continue; }
    if (tok === '레인지') continue;
    if (tok === '스탠다드' || tok === '스탠더드') { (hasEV ? slots.battery : trimToks).push(tok); continue; }
    if (isSpecToken(tok)) { slots[classifySpec(tok)].push(tok); continue; }
    if (NOISE_TRIM.has(tok) || /^\d{2,4}\s*MY$/i.test(tok)) continue;
    trimToks.push(tok);
  }
  slots.fuel = slots.fuel.map(normFuel);
  const variant = [...slots.fuel, ...slots.disp, ...slots.battery, ...(slots.turbo.length ? ['T'] : []), ...slots.drive, ...slots.seats, ...slots.etc].join(' ');
  return { variant, trim: trimToks.length ? trimToks.join(' ') : '(기본)' };
}

const DOMESTIC = new Set(['현대', '기아', '제네시스', '쉐보레', '르노', '르노삼성', '삼성', 'KGM', 'KG모빌리티', '쌍용', '대우']);

/* ── catalog 로드 ── */
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const cats = [];
for (const f of files) {
  const c = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const trims = c.trims ? Object.keys(c.trims) : [];
  cats.push({
    id: c.catalog_id || f.replace('.json', ''),
    maker: c.maker || '',
    model: c.model_root || c.title || '',
    title: c.title || '',
    year_start: c.year_start || '', year_end: c.year_end || '',
    trims,
    fuelInTitle: /HEV|하이브리드|전기|EV\b/.test(c.title || ''),
  });
}

/* maker → model → [catalog] */
const byMaker = new Map();
for (const c of cats) {
  if (!c.maker) continue;
  if (!byMaker.has(c.maker)) byMaker.set(c.maker, new Map());
  const mm = byMaker.get(c.maker);
  if (!mm.has(c.model)) mm.set(c.model, []);
  mm.get(c.model).push(c);
}

const yLabel = (c) => {
  const ys = (c.year_start || '').slice(0, 7), ye = c.year_end === '현재' ? '현재' : (c.year_end || '').slice(0, 7);
  return ys ? `${ys}~${ye}` : '';
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* 세부모델(catalog) 한 개 → 파워트레인별 트림 묶음 */
function variantRows(c) {
  const vm = new Map();
  for (const raw of c.trims) {
    const { variant, trim } = parseTrim(raw);
    const k = variant || '(미상)';
    if (!vm.has(k)) vm.set(k, []);
    if (!vm.get(k).includes(trim)) vm.get(k).push(trim);
  }
  return [...vm];
}

let totMakers = 0, totModels = 0, totSub = 0, totVar = 0, totTrim = 0, totHyb = 0;

function makerSection(maker, models) {
  totMakers++;
  // 모델: 세부모델 많은 순
  const modelList = [...models].sort((a, b) => b[1].length - a[1].length);
  let rows = '';
  for (const [model, catalogs] of modelList) {
    totModels++;
    // 세부모델: 신규 연식순
    const subs = [...catalogs].sort((a, b) => (b.year_start || '').localeCompare(a.year_start || ''));
    subs.forEach((c, si) => {
      totSub++;
      const vrows = variantRows(c);
      const hyb = c.fuelInTitle;
      if (hyb) totHyb++;
      vrows.forEach((vr, vi) => {
        totVar++;
        const [variant, trims] = vr;
        totTrim += trims.length;
        rows += `<tr class="${hyb ? 'hyb' : ''}">`;
        if (si === 0 && vi === 0) rows += `<td class="mdl" rowspan="${subs.reduce((s, x) => s + Math.max(1, variantRows(x).length), 0)}">${esc(model)}</td>`;
        if (vi === 0) rows += `<td class="sub" rowspan="${Math.max(1, vrows.length)}">${esc(c.title.replace(maker + ' ', ''))}<div class="yr">${esc(yLabel(c))}${hyb ? ' <span class="flag">⚠ 연료 세부모델→병합대상</span>' : ''}</div><div class="cid">${esc(c.id)}</div></td>`;
        rows += `<td class="pt">${esc(variant) || '<span class=dim>(미상)</span>'}</td>`;
        rows += `<td class="tr">${trims.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</td>`;
        rows += `</tr>`;
      });
      if (!vrows.length) {
        if (si === 0) rows += '';
        rows += `<tr class="${hyb ? 'hyb' : ''}"><td class="sub">${esc(c.title.replace(maker + ' ', ''))}<div class="yr">${esc(yLabel(c))}</div></td><td colspan=2 class=dim>트림 없음</td></tr>`;
      }
    });
  }
  return `<details open><summary>${esc(maker)} <span class="cnt">모델 ${models.size} · 세부모델 ${[...models.values()].reduce((s, a) => s + a.length, 0)}</span></summary>
    <table><thead><tr><th>모델</th><th>세부모델 (연식)</th><th>파워트레인</th><th>트림</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

const makersSorted = [...byMaker].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
const dom = makersSorted.filter(([m]) => DOMESTIC.has(m));
const imp = makersSorted.filter(([m]) => !DOMESTIC.has(m));
const body = (label, list) => `<h2>${label} <span class="cnt">${list.length}개 제조사</span></h2>` + list.map(([m, mm]) => makerSection(m, mm)).join('');
const html = `<!doctype html><html lang=ko><head><meta charset=utf-8><title>차종마스터 검수표</title>
<style>
body{font-family:Pretendard,system-ui,sans-serif;margin:0;padding:16px;background:#f5f6f8;color:#1a1a2e;font-size:13px}
h1{font-size:18px;margin:0 0 4px}.sum{color:#667;margin:0 0 16px;font-size:12px}
h2{font-size:15px;margin:20px 0 8px;padding:6px 10px;background:#0F1B35;color:#fff;border-radius:4px}
details{background:#fff;border:1px solid #dde;border-radius:6px;margin:6px 0;overflow:hidden}
summary{cursor:pointer;padding:8px 12px;font-weight:700;font-size:14px;background:#eef1f6}
.cnt{font-weight:400;color:#889;font-size:11px;margin-left:6px}
table{border-collapse:collapse;width:100%;font-size:12px}
th{background:#f0f2f6;text-align:left;padding:5px 8px;border:1px solid #e3e6ee;position:sticky;top:0}
td{padding:4px 8px;border:1px solid #eef0f5;vertical-align:top}
td.mdl{font-weight:700;background:#fafbff;white-space:nowrap}
td.sub{background:#fcfcfe;white-space:nowrap}
.yr{color:#7a8;font-size:11px}.cid{color:#aab;font-size:10px;font-family:monospace}
td.pt{white-space:nowrap;font-weight:600;color:#244}
.chip{display:inline-block;padding:1px 6px;margin:1px;background:#eef;border:1px solid #dde;border-radius:3px;font-size:11px}
.dim{color:#aab}.hyb td.sub{background:#fff7ed}.flag{color:#c2410c;font-size:10px}
.legend{font-size:11px;color:#778;margin:8px 0}
</style></head><body>
<h1>차종마스터 검수표 <span class=cnt>(우리 기준 → 드롭다운 소스)</span></h1>
<p class="legend">⚠ 표시 = 하이브리드/연료가 세부모델 제목에 박힌 catalog (기본세대로 병합 대상). · 파워트레인 = 연료·배기량·터보·구동·인승 자동분해. · 세부모델 = 신규 연식순, 모델 = 세부모델 많은순.</p>
<p class="sum" id="sum"></p>
${body('🇰🇷 국산', dom)}
${body('🌐 수입', imp)}
<script>document.getElementById('sum').textContent='제조사 ${totMakers} · 모델 ${totModels} · 세부모델 ${totSub} · 파워트레인 ${totVar} · 트림 ${totTrim} · ⚠연료세부모델 ${totHyb}';</script>
</body></html>`;

const OUT = path.join(__dirname, '..', 'master-review.html');
fs.writeFileSync(OUT, html, 'utf8');
console.log('생성:', OUT);
console.log(`제조사 ${totMakers} · 모델 ${totModels} · 세부모델 ${totSub} · 파워트레인 ${totVar} · 트림 ${totTrim} · ⚠연료세부모델(병합대상) ${totHyb}`);
