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
const SCRAPABLE_HOSTS = ['moderentcar.co.kr', 'autoplus.co.kr'];

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
    .map(f => `https://drive.google.com/thumbnail?id=${f.id}&sz=w${size}`);
}

/**
 * API 우회 — 공개 Drive 폴더의 embeddedfolderview HTML 을 스크래핑해
 * 파일 ID 만 뽑아낸다. API 키·활성화 불필요. 폴더가 "링크 있는 모든 사용자" 공개일 때 동작.
 */
async function scrapeDriveFolderHtml(folderId, size) {
  const tryUrls = [
    `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`,
    `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
    `https://drive.google.com/drive/folders/${folderId}`,
  ];
  for (const u of tryUrls) {
    try {
      const r = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'ko-KR,ko;q=0.9' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      if (!r.ok) continue;
      const html = await r.text();
      // 다양한 패턴에서 file ID 추출 — /file/d/ID, [\"FILE_ID\", 안의 33자 base64-id, thumbnail?id=
      const ids = new Set();
      const patterns = [
        /\/file\/d\/([a-zA-Z0-9_-]{20,})/g,
        /thumbnail\?id=([a-zA-Z0-9_-]{20,})/g,
        /"([a-zA-Z0-9_-]{28,44})",\["\d+",/g,  // 폴더 페이지 JSON 데이터 패턴
      ];
      for (const re of patterns) {
        let m;
        while ((m = re.exec(html)) !== null) {
          if (m[1] && m[1] !== folderId) ids.add(m[1]);
        }
      }
      if (ids.size > 0) {
        return [...ids].map(id => `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`);
      }
    } catch (e) { /* 다음 URL 시도 */ }
  }
  return [];
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
    // 범용 휴리스틱 — img attr (data-* / src) + style 의 background-image
    const attrs = ['data-src', 'data-original', 'data-lazy', 'data-bg', 'data-image', 'src'];
    // 명백한 로고/아이콘만 제외 (banner 는 제외 — 차량 사진이 banner 로 표기되는 경우 있음)
    const bad = ['logo', 'favicon', 'sprite', 'btn_', '/adm/', '/assets/ico', '/icon/'];
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
    // background-image: url(...) 추출
    const bgRe = /background(?:-image)?\s*:\s*url\(["']?(https?:\/\/[^"'\)]+?\.(?:jpg|jpeg|png|webp))["']?\)/gi;
    let bm;
    while ((bm = bgRe.exec(html)) !== null) {
      const u = bm[1];
      const low = u.toLowerCase();
      if (bad.some(b => low.includes(b))) continue;
      add(u);
    }
    // <a href="...jpg/png"> 도 (autoplus 갤러리가 이런 패턴 자주 사용)
    const aRe = /href=["'](https?:\/\/[^"'\s]+?\.(?:jpg|jpeg|png|webp))["']/gi;
    let am;
    while ((am = aRe.exec(html)) !== null) {
      const u = am[1];
      const low = u.toLowerCase();
      if (bad.some(b => low.includes(b))) continue;
      add(u);
    }
  }

  return out;
}

export default async function handler(req, res) {
  // 외부 홈피(하허호무심사 등)가 cross-origin 으로 사진 해석을 호출할 수 있게 CORS 허용.
  // 반환값은 (이미 폴더 링크를 가진) 이미지 URL 목록뿐이라 공개해도 무방.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

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

  const folderId = extractDriveFolderId(url);

  // Drive 폴더 분기 — API 호출 후 실패 시 HTML 스크래핑 fallback
  if (folderId && url.includes('drive.google.com')) {
    const apiKey = process.env.DRIVE_API_KEY || 'AIzaSyA0q_6yo9YRkpNeNaawH1AFPZx1IMgj-dY';
    const cacheKey = `drive:${folderId}:${size}`;

    try {
      let promise = _inflight.get(cacheKey);
      if (!promise) {
        promise = (async () => {
          // 1차: Drive API (키 동작 시 가장 정확)
          if (apiKey) {
            try {
              const apiUrls = await fetchDriveImages(folderId, size, apiKey);
              if (apiUrls.length) return { urls: apiUrls, source: 'drive-api' };
            } catch (e) {
              // 403/401/404 등 — 스크래핑으로 fallback
            }
          }
          // 2차: 공개 폴더 HTML 스크래핑 (API 키 무관)
          const scrapedUrls = await scrapeDriveFolderHtml(folderId, size);
          return { urls: scrapedUrls, source: 'drive-scrape' };
        })();
        _inflight.set(cacheKey, promise);
        promise.finally(() => _inflight.delete(cacheKey)).catch(() => {});
      }
      const { urls, source } = await promise;
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      res.status(200).json({ ok: true, urls, count: urls.length, source });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        res.status(504).json({ ok: false, message: 'Drive 응답 지연' });
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
        promise.finally(() => _inflight.delete(cacheKey)).catch(() => {});
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
