/**
 * /api/sync/jonghap — 종합표 직접 생성 (오플 + 공급사 시트 → 종합 42컬럼 그대로).
 * 종합표 만들기 UI 가 호출. 출고불가/숨김 제외, 노출 차량만.
 */
import { buildJonghapTable } from './external-sheet.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const out = await buildJonghapTable();
    res.statusCode = 200;
    return res.end(JSON.stringify(out));
  } catch (e) {
    console.error('[jonghap] 실패:', e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, message: e.message || String(e) }));
  }
}
