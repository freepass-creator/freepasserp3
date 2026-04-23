/**
 * Vercel Serverless Function — Drive 폴더 사진 추출 (v1 Flask /api/extract-photos 포팅)
 * GET /api/extract-photos?url={driveUrl}&size={px}
 * → { ok: true, urls: [...], count: N, source: 'drive' }
 *
 * Env: DRIVE_API_KEY
 *
 * NOTE: HTML 스크래핑 (moderentcar 등)은 이 버전에 미포함 — Drive만 지원.
 * 외부 사이트 이미지는 Firebase Storage 에 업로드해서 쓰는 것 권장.
 */

function extractDriveFolderId(value) {
  if (!value) return '';
  const s = String(value).trim();
  let m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/\/drive\/.*?\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'Method not allowed' });
    return;
  }

  const url = String(req.query.url || '').trim();
  if (!url) {
    res.status(400).json({ ok: false, message: 'url 파라미터가 필요합니다.' });
    return;
  }

  const sizeRaw = parseInt(req.query.size || '1920', 10);
  const size = Math.max(200, Math.min(4000, Number.isFinite(sizeRaw) ? sizeRaw : 1920));

  const apiKey = process.env.DRIVE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, message: 'DRIVE_API_KEY not configured' });
    return;
  }

  // Drive 폴더만 지원 (HTML 스크래핑 미포함)
  const folderId = extractDriveFolderId(url);
  if (!folderId || !url.includes('drive.google.com')) {
    res.status(200).json({ ok: true, urls: [], count: 0, source: 'unsupported' });
    return;
  }

  try {
    const query = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
    const apiUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${apiKey}&fields=files(id,name,mimeType)&pageSize=200&orderBy=name`;

    const r = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) {
      const msg = r.status === 403
        ? 'Drive API HTTP 403 — Drive API 미활성 또는 폴더 비공개'
        : `Drive API HTTP ${r.status}`;
      res.status(502).json({ ok: false, message: msg });
      return;
    }
    const data = await r.json();
    const files = Array.isArray(data.files) ? data.files : [];
    const urls = files
      .filter(f => f && f.id)
      .map(f => `https://lh3.googleusercontent.com/d/${f.id}=w${size}`);

    // edge/CDN 캐시 — 1시간
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    res.status(200).json({ ok: true, urls, count: urls.length, source: 'drive' });
  } catch (e) {
    res.status(502).json({ ok: false, message: `폴더 조회 실패: ${e.message}` });
  }
}
