#!/usr/bin/env node
/**
 * 매트릭스 통합 진단 — 가격 + 옵션 + 무결성 한 번에
 *   사용: npm run check:matrix
 *   출력: 콘솔 한 줄 요약 + 4개 보고서 파일 (개별 audit 와 동일)
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPTS = [
  { name: '카탈로그 완성도',     file: 'analyze-catalog-coverage.cjs',    out: 'catalog-coverage-report.md' },
  { name: '생산년도 검증',       file: 'validate-production-years.cjs',   out: 'year-validation-report.md' },
  { name: '트림 가격 정합성',    file: 'audit-trim-prices.cjs',           out: 'trim-price-audit.md' },
  { name: '트림 옵션 풍부도',    file: 'audit-trim-options.cjs',          out: 'trim-options-audit.md' },
];

console.log('━━━ 매트릭스 통합 진단 ━━━\n');
let allPass = true;
for (const s of SCRIPTS) {
  const fp = path.join(__dirname, s.file);
  const r = spawnSync('node', [fp], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.log(`✗ ${s.name}: 오류 (${r.stderr.split('\n')[0]})`);
    allPass = false;
    continue;
  }
  // 마지막 줄 추출 (요약)
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  const summary = lines.slice(-3).join(' ').replace(/\s+/g, ' ');
  console.log(`✓ ${s.name.padEnd(20)} ${summary}`);
}
console.log();

// 결합 헬스 점수
const trimAudit = fs.readFileSync(path.join(__dirname, '..', 'docs', 'trim-price-audit.md'), 'utf8');
const optAudit  = fs.readFileSync(path.join(__dirname, '..', 'docs', 'trim-options-audit.md'), 'utf8');
const tA = trimAudit.match(/\*\*A\*\*[^:]*:\s*(\d+)/)?.[1] || 0;
const tB = trimAudit.match(/\*\*B\*\*[^:]*:\s*(\d+)/)?.[1] || 0;
const tC = trimAudit.match(/\*\*C\*\*[^:]*:\s*(\d+)/)?.[1] || 0;
const tD = trimAudit.match(/\*\*D\*\*[^:]*:\s*(\d+)/)?.[1] || 0;
// 옵션 audit 의 stdout 통계는 stdout 만 노출됨 — 보고서엔 충실 카운트만 있음
// stdout 재실행으로 추출
const optR = spawnSync('node', [path.join(__dirname, 'audit-trim-options.cjs')], { encoding: 'utf8' });
const optOut = optR.stdout || '';
const oFull  = optOut.match(/🔴[^\d]*(\d+)/)?.[1] || '0';
const oPart  = optOut.match(/🟡[^\d]*(\d+)/)?.[1] || '0';
const oOk    = optOut.match(/🟢[^\d]*(\d+)/)?.[1] || '0';

console.log('━━━ 매트릭스 헬스 ━━━');
console.log(`  가격 결함:   A ${tA} / B ${tB} / C ${tC} / D ${tD}`);
console.log(`  옵션 상태:   stub ${oFull} / partial ${oPart} / 충실 ${oOk}`);
console.log();
console.log(allPass ? '✓ 통합 진단 통과' : '⚠ 일부 단계 실패');
