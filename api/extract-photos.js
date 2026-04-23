/**
 * Vercel Serverless Function — 외부 사진 URL 추출 (v1 Flask /api/extract-photos 포팅)
 * GET /api/extract-photos?url={url}&size={px}
 * → { ok: true, urls: [...], count: N, source: 'drive' | 'scrape' }
 *
 * Env: DRIVE_API_KEY
 *
 * 지원:
 * - drive.google.com 폴더 → Drive API
 * - moderentcar.co.kr (+ SCRAPABLE_HOSTS 확장) → HTML 스크래핑
 */
import { extractDriveFolderId } from '../src/core/drive-photos.js';

// 같은 함수 인스턴스(warm)에서 동시 요청 dedup — edge 캐시 miss 시 Drive 호출 집중 방지
const _inflight = new Map();

// 스크래핑 허용 호스트 — drive-photos.js 의 SCRAPABLE_HOSTS 와 맞출 것 (SSRF 방지)
const SCRAPABLE_HOSTS = ['moderentcar.co.kr'];

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
  // drive.google.com/thumbnail 형식 — lh3.googleusercontent.com 대비 모바일 브라우저 호환성 우수.
  // 일부 모바일(특히 Samsung Internet) 의 cross-site tracking prevention 이 lh3 호스트 차단.
  return files
    .filter(f => f && f.id)
    .map(f => `https://drive.google.com/thumbnail?id=${f.id}&sz=w${size}`);
}

function isScrapableHost(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    return SCRAPABLE_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

async function readBodyCapped(resp, maxBytes) {
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  return Buffer.concat(chunks, Math.min(total, maxBytes));
}

async function scrapePageImages(pageUrl) {
  const host = new URL(pageUrl).hostname.toLowerCase();

  const resp = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    const err = new Error(`페이지 로드 실패 HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }

  const buf = await readBodyCapped(resp, 8 * 1024 * 1024);
  const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);

  const out = [];
  const seen = new Set();
  const add = (raw) => {
    let u = String(raw || '').trim();
    if (!u) return;
    // Vercel 은 https 고정 — mixed content 방지
    if (u.startsWith('http://')) u = 'https://' + u.slice(7);
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };

  if (host.includes('moderentcar.co.kr')) {
    // moren-images S3 원본만 (/thumb/ 제외, /data/files/ 경로만 — 로고/아이콘 제외)
    const re = /["'](https?:\/\/moren-images\.s3[^"'\s]+?\.(?:jpg|jpeg|png|webp))["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = m[1];
      if (u.includes('/thumb/')) continue;
      if (!u.includes('/data/files/')) continue;
      add(u);
    }
  } else {
    // 범용 휴리스틱 — 큰 이미지만 (data-src 우선, 로고/아이콘 제외)
    const attrs = ['data-src', 'data-original', 'data-lazy', 'src'];
    const bad = ['logo', 'icon', 'favicon', 'sprite', 'banner', 'btn_', '/adm/', '/assets/ico'];
    for (const attr of attrs) {
      const re = new RegExp(`${attr}=["'](https?:\\/\\/[^"'\\s]+?\\.(?:jpg|jpeg|png|webp))["']`, 'gi');
      let m;
      while ((m = re.exec(html)) !== null) {
        const u = m[1];
        const low = u.toLowerCase();
        if (bad.some(b => low.includes(b))) continue;
        add(u);
      }
    }
  }

  return out;
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

  // Drive 폴더 분기
  if (folderId && url.includes('drive.google.com')) {
    const cacheKey = `drive:${folderId}:${size}`;
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
      res.status(502).json({ ok: false, message: e.message || '폴더 조회 실패' });
    }
    return;
  }

  // HTML 스크래핑 분기 (화이트리스트 호스트만)
  if (isScrapableHost(url)) {
    const cacheKey = `scrape:${url}`;
    try {
      let promise = _inflight.get(cacheKey);
      if (!promise) {
        promise = scrapePageImages(url);
        _inflight.set(cacheKey, promise);
        promise.finally(() => _inflight.delete(cacheKey));
      }
      const urls = await promise;
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      res.status(200).json({ ok: true, urls, count: urls.length, source: 'scrape' });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        res.status(504).json({ ok: false, message: '페이지 응답 지연' });
        return;
      }
      res.status(502).json({ ok: false, message: e.message || '스크래핑 실패' });
    }
    return;
  }

  res.status(200).json({ ok: true, urls: [], count: 0, source: 'unsupported' });
}
