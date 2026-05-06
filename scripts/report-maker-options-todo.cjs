#!/usr/bin/env node
/**
 * _maker-options.json 의 FP 매핑 안 된 옵션을 빈도순 todo 보고서로 출력.
 *  매핑 1개 추가하면 used_in 만큼 매물에 영향 → ROI 높은 순서.
 *
 *  출력: docs/maker-options-todo.md
 *  메이커별로 상위 100건 + 추정 카테고리 표시 (수동 매핑 보조)
 */
const fs = require('fs');
const path = require('path');

const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'car-master', '_maker-options.json'), 'utf8'));

const POPULAR = ['현대', '기아', '제네시스', 'KGM', '쉐보레'];

const lines = [];
lines.push('# 메이커 옵션 → FP 표준옵션 매핑 TODO\n');
lines.push(`*generated: ${new Date().toISOString().slice(0, 10)} — 빈도(used_in) 내림차순*\n`);
lines.push('워크플로우:');
lines.push('  1. 매핑 안 된 옵션의 빈도(used_in) 보고 ROI 높은 순서로 처리');
lines.push('  2. `src/core/fp-keyword-rules.js` 에 키워드 → FP ID 매핑 추가');
lines.push('  3. `node scripts/extract-maker-options.cjs` 다시 실행 → 매핑 결과 갱신');
lines.push('  4. 매칭률 audit: `node scripts/audit-fp-mapping.cjs`\n');

let totalMissing = 0, totalCovered = 0;
for (const maker of POPULAR) {
  if (!map[maker]) continue;
  const all = Object.entries(map[maker]);
  const missing = all.filter(([_, v]) => !v.fp_ids.length);
  const covered = all.filter(([_, v]) => v.fp_ids.length);
  totalMissing += missing.length;
  totalCovered += covered.length;
  const sumMissingUsed = missing.reduce((a, [_, v]) => a + v.used_in, 0);

  lines.push(`\n## ${maker}\n`);
  lines.push(`- 총 옵션: **${all.length}** (FP 매핑 ${covered.length} / 미매핑 ${missing.length})`);
  lines.push(`- 미매핑 옵션의 누적 catalog 사용량: **${sumMissingUsed}** 회 (영향 잠재력)`);

  // 미매핑 빈도 top 80
  const sorted = missing.sort((a, b) => b[1].used_in - a[1].used_in);
  lines.push('\n| used_in | 옵션명 | category 힌트 |');
  lines.push('|---|---|---|');
  for (const [name, v] of sorted.slice(0, 80)) {
    const cat = (v.categories || []).join(', ');
    const escName = name.replace(/\|/g, '\\|');
    lines.push(`| ${v.used_in} | ${escName} | ${cat} |`);
  }
  if (sorted.length > 80) lines.push(`\n*... +${sorted.length - 80}건*`);
}

lines.push(`\n## 전체 요약 (인기 5메이커)\n`);
lines.push(`- 매핑 완료: **${totalCovered}**`);
lines.push(`- 매핑 미완료: **${totalMissing}**`);
lines.push(`- 매핑률: **${(totalCovered / (totalCovered + totalMissing) * 100).toFixed(1)}%**`);

const outPath = path.join(__dirname, '..', 'docs', 'maker-options-todo.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ ${path.relative(process.cwd(), outPath)} 생성`);
console.log(`  매핑 완료 ${totalCovered} / 미완료 ${totalMissing} (${(totalCovered / (totalCovered + totalMissing) * 100).toFixed(1)}%)`);
