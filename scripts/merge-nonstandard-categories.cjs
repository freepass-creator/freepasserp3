#!/usr/bin/env node
/**
 * 비표준 카테고리 codes 를 표준 카테고리로 합치고 비표준 카테고리 제거.
 *  - 첨단 운전자 보조(ADAS) / ADAS / 첨단 운전자 보조 (ADAS) → 지능형 안전 기술
 *  - 외장 → 외관
 *  - 파워트레인 → 파워트레인/성능
 *  - 편의/주차 → 편의
 *  - 트림 이름이 카테고리로 들어간 경우 (베스트 셀렉션 Ⅰ 같은) → 제거
 *
 *  사용:
 *    node scripts/merge-nonstandard-categories.cjs --apply
 */
const fs = require('fs');
const path = require('path');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'data', 'car-master');
const APPLY = process.argv.includes('--apply');

const STD_CATS = ['파워트레인/성능', '안전', '지능형 안전 기술', '외관', '내장', '시트', '편의', '인포테인먼트', '선택사양'];

// alias → 표준 카테고리
const ALIASES = {
  'ADAS': '지능형 안전 기술',
  '첨단 운전자 보조(ADAS)': '지능형 안전 기술',
  '첨단 운전자 보조 (ADAS)': '지능형 안전 기술',
  '주행 보조': '지능형 안전 기술',
  '운전자 보조': '지능형 안전 기술',
  '외장': '외관',
  '파워트레인': '파워트레인/성능',
  '동력 성능': '파워트레인/성능',
  '편의/주차': '편의',
  '편의주차': '편의',
  '주차': '편의',
};

let touched = 0, totalMerged = 0, totalDropped = 0;
const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files) {
  const fp = path.join(CATALOG_DIR, f);
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const cats = d.categories || {};
  let changed = false;
  const toDrop = [];
  for (const [k, codes] of Object.entries(cats)) {
    if (STD_CATS.includes(k)) continue;
    // alias 매핑된 카테고리는 표준에 합치고 제거
    const alias = ALIASES[k];
    if (alias && cats[alias]) {
      const set = new Set(cats[alias]);
      for (const c of codes || []) set.add(c);
      cats[alias] = [...set];
      // 옵션 사전의 category 도 alias 로 갱신
      for (const c of codes || []) {
        if (d.options?.[c]) d.options[c].category = alias;
      }
      toDrop.push(k);
      totalMerged += (codes || []).length;
      changed = true;
    } else {
      // 트림 이름이거나 알 수 없는 카테고리 → 코드들이 표준 어디에도 없으면 그냥 두고
      // 표준에 이미 있는 코드들이면 비표준만 제거
      const inStd = (codes || []).filter(c => {
        for (const std of STD_CATS) {
          if (cats[std]?.includes(c)) return true;
        }
        return false;
      });
      if (inStd.length === (codes || []).length && (codes || []).length > 0) {
        // 모든 코드가 이미 표준에 있음 → 이 비표준 카테고리는 제거
        toDrop.push(k);
        totalDropped += codes.length;
        changed = true;
      }
    }
  }
  for (const k of toDrop) delete cats[k];
  if (!changed) continue;
  if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`${APPLY ? '✓' : '+'} ${d.title} — 비표준 ${toDrop.length}개 정리: ${toDrop.join(', ')}`);
  touched++;
}
console.log(`\n${APPLY ? '적용' : 'dry-run'}: ${touched}개 catalog · 합산 ${totalMerged} · 중복 제거 ${totalDropped}`);
