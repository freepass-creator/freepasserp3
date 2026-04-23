/**
 * Vercel Serverless Function — Drive 폴더 사진 추출 (v1 Flask /api/extract-photos 포팅)
 * GET /api/extract-photos?url={driveUrl}&size={px}
 * → { ok: true, urls: [...], count: N, source: 'drive' }
 *
 * Env: DRIVE_API_KEY
 *
 * NOTE: HTML 스크래핑 (moderentcar 등) 미포함 — Drive만 지원.
 * 외부 사이트 이미지는 Firebase Storage 에 업로드해서 쓰는 것 권장.
 */
import { extractDriveFolderId } from '../src/core/drive-photos.js';

// 같은 함수 인스턴스(warm)에서 동시 요청 dedup — edge 캐시 miss 시 Drive 호출 집중 방지
const _inflight = new Map();

async function fetchDriveImages(folderId, size, apiKey) {
  const query = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
  const apiUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${apiKey}&fields=files(id,name,mimeType)&pageSize=200&orderBy=name`;
  const r = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) {
    const err = new Error(r.status === 403
      ? 'Drive API 403 — Drive API 미활성 또는 폴더 비공개'
      : `Drive API ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const files = Array.isArray(data.files) ? data.files : [];
  return files
    .filter(f => f && f.id)
    .map(f => `https://lh3.googleusercontent.com/d/${f.id}=w${size}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: '허용되지 않은 메서드입니다' });
    return;
  }

  const url = String(req.query.url || '').trim();
  if (!url) {
    res.status(400).json({ ok: false, message: 'url 파라미터가 필요합니다' });
    return;
  }

  const sizeRaw = parseInt(req.query.size || '1920', 10);
  const size = Math.max(200, Math.min(4000, Number.isFinite(sizeRaw) ? sizeRaw : 1920));

  const apiKey = process.env.DRIVE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, message: 'DRIVE_API_KEY 미설정' });
    return;
  }

  const folderId = extractDriveFolderId(url);
  if (!folderId || !url.includes('drive.google.com')) {
    res.status(200).json({ ok: true, urls: [], count: 0, source: 'unsupported' });
    return;
  }

  const cacheKey = `${folderId}:${size}`;
  try {
    let promise = _inflight.get(cacheKey);
    if (!promise) {
      promise = fetchDriveImages(folderId, size, apiKey);
      _inflight.set(cacheKey, promise);
      promise.finally(() => _inflight.delete(cacheKey));
    }
    const urls = await promise;
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    res.status(200).json({ ok: true, urls, count: urls.length, source: 'drive' });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      res.status(504).json({ ok: false, message: 'Drive API 응답 지연' });
      return;
    }
    res.status(e.status === 403 ? 502 : 502).json({
      ok: false,
      message: e.message || '폴더 조회 실패',
    });
  }
}
