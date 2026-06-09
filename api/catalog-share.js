/**
 * 카탈로그 공유링크 OG 메타 동적 주입 — Vercel Serverless Function
 *
 * 흐름:
 *   1. 영업자가 상품 공유 클릭 → URL: /catalog.html?id=X&t=차량명&img=대표사진URL
 *   2. 카톡 크롤러가 이 URL 접속
 *   3. vercel.json rewrite (has query "id") → 이 함수로 라우팅
 *   4. dist/catalog.html 읽어 og:title / og:image 동적 교체 후 반환
 *   5. 카톡은 og:image 로 차량 사진, og:title 로 차량명 표시
 *
 * 일반 사용자가 같은 URL 접속해도 동일 HTML(메타만 다름) 받음 → SPA 정상 동작
 */

import fs from 'node:fs';
import path from 'node:path';

let _cachedTemplate = null;
function loadTemplate() {
  if (_cachedTemplate) return _cachedTemplate;
  // Vercel: includeFiles 설정으로 함수 번들에 catalog.html 포함됨
  // 빌드 결과는 dist/catalog.html (원본 catalog.html 이 Vite build 시 그대로 복사됨)
  const candidates = [
    path.join(process.cwd(), 'dist', 'catalog.html'),
    path.join(process.cwd(), 'catalog.html'),
  ];
  for (const p of candidates) {
    try {
      _cachedTemplate = fs.readFileSync(p, 'utf8');
      return _cachedTemplate;
    } catch {}
  }
  throw new Error('catalog.html template not found');
}

function escAttr(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 외부 이미지 → 우리 도메인 /api/img 프록시. 카톡은 https 직접 접근 가능한 URL 필요
function proxiedImageUrl(host, raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    // 이미 우리 도메인이면 그대로
    if (u.hostname === host) return url;
    return `https://${host}/api/img?url=${encodeURIComponent(url)}`;
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const title = String(req.query.t || '').trim();
    const img = String(req.query.img || '').trim();

    let html = loadTemplate();

    // og:title / title / og:description 교체 (title=차량번호+차량명 이 있을 때만).
    //   설명도 "장기렌트 상품 안내" 대신 차량번호·차량명(+d 요약)으로 — 카톡 미리보기에 차량 같이 노출.
    if (title) {
      const t = escAttr(title);
      const desc = String(req.query.d || '').trim();
      const d = escAttr(desc ? `${title} · ${desc}` : title);
      html = html
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${t}</title>`)
        .replace(/<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${t}">`)
        .replace(/<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${d}">`);
    }

    // og:image 주입 (없으면 추가)
    if (img) {
      const imgUrl = proxiedImageUrl(host, img);
      if (imgUrl) {
        const safe = escAttr(imgUrl);
        const tag = `<meta property="og:image" content="${safe}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`;
        if (/<meta\s+property="og:image"[^>]*>/i.test(html)) {
          html = html.replace(/<meta\s+property="og:image"[^>]*>/i, tag);
        } else {
          // og:type 아래에 삽입
          html = html.replace(
            /(<meta\s+property="og:type"[^>]*>)/i,
            `$1\n${tag}`
          );
        }
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // 카톡 크롤러 캐싱 — og:image 결과는 자주 안 바뀜
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.status(200).send(html);
  } catch (e) {
    console.error('[catalog-share]', e);
    res.status(500).send('share error');
  }
}
