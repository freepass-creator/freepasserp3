#!/usr/bin/env node
/**
 * 카니발 하이리무진 KA4 catalog trim 보강.
 *  현재: 4개 trim (인승/배기량 누락, 가격 부정확)
 *  목표: 9개 trim (등급 × 동력원 × 인승) 정확하게
 *
 * 라인업 (2026년형 기준 + 페리 전 디젤):
 *  - 노블레스 가솔린 3.5 9인승 (9인승 전용)
 *  - 노블레스 하이브리드 1.6T 9인승
 *  - 시그니처 가솔린 3.5 4/7/9인승
 *  - 시그니처 하이브리드 1.6T 4/7/9인승
 *  - 시그니처 디젤 2.2 9인승 (페리 전, 2024년형 단종)
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FP = path.join(__dirname, '..', 'public', 'data', 'car-master', 'kia_carnival_ka4_hi_limousine.json');

const d = JSON.parse(fs.readFileSync(FP, 'utf8'));

// 기존 trim 의 basic / select_groups 정보 보존하면서 새 키로 매핑
const oldTrims = d.trims || {};
const NOBLESSE_BASIC = oldTrims['노블레스 가솔린']?.basic || [];
const NOBLESSE_SG    = oldTrims['노블레스 가솔린']?.select_groups || [];
const SIG_BASIC      = oldTrims['시그니처 하이브리드 9인승']?.basic || [];
const SIG_SG         = oldTrims['시그니처 하이브리드 9인승']?.select_groups || [];

// 새 trim 사전
const newTrims = {
  // 노블레스 (9인승 전용)
  '노블레스 가솔린 3.5 9인승':       { price: { base: 63270000 }, basic: [...NOBLESSE_BASIC], select_groups: [...NOBLESSE_SG] },
  '노블레스 하이브리드 1.6T 9인승':  { price: { base: 67820000 }, basic: [...NOBLESSE_BASIC], select_groups: [...NOBLESSE_SG] },
  // 시그니처 가솔린 4/7/9인승
  '시그니처 가솔린 3.5 9인승':       { price: { base: 66670000 }, basic: [...SIG_BASIC], select_groups: [...SIG_SG] },
  '시그니처 가솔린 3.5 7인승':       { price: { base: 68910000 }, basic: [...SIG_BASIC], select_groups: [...SIG_SG] },
  '시그니처 가솔린 3.5 4인승':       { price: { base: 93300000 }, basic: [...SIG_BASIC], select_groups: [...SIG_SG] },
  // 시그니처 하이브리드 4/7/9인승
  '시그니처 하이브리드 1.6T 9인승':  { price: { base: 71220000 }, basic: [...SIG_BASIC], select_groups: [...SIG_SG] },
  '시그니처 하이브리드 1.6T 7인승':  { price: { base: 73340000 }, basic: [...SIG_BASIC], select_groups: [...SIG_SG] },
  '시그니처 하이브리드 1.6T 4인승':  { price: { base: 97800000 }, basic: [...SIG_BASIC], select_groups: [...SIG_SG] },
  // 페리 전 디젤 (2024년형 이전 단종)
  '시그니처 디젤 2.2 9인승':         { price: { base: 66850000 }, basic: [...SIG_BASIC], select_groups: [...SIG_SG], discontinued: '2025-09' },
};

d.trims = newTrims;

console.log('=== 카니발 하이리무진 KA4 trim 보강 ===');
console.log(`  기존 ${Object.keys(oldTrims).length}개 → 신규 ${Object.keys(newTrims).length}개`);
for (const [k, t] of Object.entries(newTrims)) {
  const flag = t.discontinued ? ` [단종 ${t.discontinued}]` : '';
  console.log(`  • ${k} — ${(t.price.base/10000).toLocaleString()}만원${flag}`);
}

if (APPLY) {
  fs.writeFileSync(FP, JSON.stringify(d, null, 2));
  console.log('\n✓ 적용 완료');
} else {
  console.log('\n(dry-run — --apply 추가)');
}
