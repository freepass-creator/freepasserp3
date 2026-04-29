/**
 * 외부 이미지 프록시 — Vercel Serverless Function
 * GET /api/img?url={imageUrl}
 *
 * 용도: Drive·lh3·외부호스트 이미지를 우리 오리진으로 내려받아 서빙.
 * 모바일 브라우저의 cross-site tracking / referer 차단 / CORS 이슈 우회.
 *
 * 제약:
 * - Vercel Serverless 응답 최대 4.5MB (썸네일용)
 * - 동일한 URL 반복 호출은 CDN edge 캐시로 완화
 */

const ALLOWED_HOSTS = [
  'drive.google.com',
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
  'firebasestorage.googleapis.com',
  'firebasestorage.app',
  // 외부 사이트 스크래핑 — 핫링크 차단 우회
  'autoplus.co.kr',
  'img.autoplus.co.kr',
  'moderentcar.co.kr',
  'moren-images.s3.amazonaws.com',
  'moren-images.s3.ap-northeast-2.amazonaws.com',
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'GET only' });
    return;
  }

  const url = String(req.query.url || '').trim();
  if (!url) {
    res.status(400).json({ ok: false, message: 'url required' });
    return;
  }

  // SSRF 방지 — 화이트리스트 호스트만 허용
  let target;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error('scheme');
    const host = target.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
      res.status(400).json({ ok: false, message: 'host not allowed' });
      return;
    }
  } catch {
    res.status(400).json({ ok: false, message: 'invalid url' });
    return;
  }

  try {
    const upstream = await fetch(target.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) {
      res.status(415).json({ ok: false, message: 'not an image' });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', String(buf.length));
    // CDN edge 캐시 — 썸네일은 자주 안 바뀜
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600, stale-while-revalidate=604800');
    res.status(200).send(buf);
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      res.status(504).json({ ok: false, message: 'upstream timeout' });
      return;
    }
    res.status(502).json({ ok: false, message: e.message || 'fetch failed' });
  }
}
