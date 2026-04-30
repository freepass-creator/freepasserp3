/**
 * 현대 차종 전수 일괄 크롤
 * — hyundai-models.cjs 의 슬러그 리스트 모두 처리
 * — _index.json 누적 갱신 + encar_keys 매핑 보존
 */
const fs = require('fs');
const path = require('path');
const models = require('./hyundai-models.cjs');
const { crawlOne } = require('./hyundai-crawl.cjs');

const INDEX_FILE = 'public/data/car-master/_index.json';

(async () => {
  const summary = { ok: [], fail: [] };
  for (const [catalogId, slug, title, encarKeys] of models) {
    try {
      const result = await crawlOne(catalogId, slug, title);
      if (result) {
        summary.ok.push(catalogId);
        // encar_keys 매핑 보존
        const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        if (idx[catalogId]) {
          idx[catalogId].source.encar = encarKeys || [];
          idx[catalogId].verified.encar = (encarKeys || []).length > 0;
          fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
        }
      } else {
        summary.fail.push(catalogId);
      }
    } catch (e) {
      console.error(`✗ ${catalogId}: ${e.message}`);
      summary.fail.push(catalogId);
    }
  }
  console.log('\n========== SUMMARY ==========');
  console.log(`✓ ${summary.ok.length}/${models.length}:`, summary.ok.join(', '));
  if (summary.fail.length) console.log(`✗ ${summary.fail.length}:`, summary.fail.join(', '));
})();
