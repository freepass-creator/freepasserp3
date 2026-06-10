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
import admin from 'firebase-admin';

const DATABASE_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

let _appPromise = null;
function getAdmin() {
  if (_appPromise) return _appPromise;
  _appPromise = (async () => {
    if (admin.apps.length) return admin.app();
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || '';
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var not set');
    const trimmed = raw.trim();
    const decoded = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
    const creds = JSON.parse(decoded);
    return admin.initializeApp({ credential: admin.credential.cert(creds), databaseURL: DATABASE_URL });
  })();
  return _appPromise;
}

/* 상품 id → OG 메타 (제목=차량번호+차량명 / 요약=연식·주행·연료·최저월대여료 / 대표사진).
 *  서버에서 직접 조회 → 공유 링크에 t·d·img 안 박아도 됨(짧은 링크). 실패 시 null → URL 파라미터 fallback. */
async function fetchProductMeta(id) {
  if (!id) return null;
  try {
    const app = await getAdmin();
    const db = admin.database(app);
    const p = (await db.ref(`products/${id}`).once('value')).val();
    if (!p) return null;
    const trim = p.trim_name || p.trim || '';
    const title = [p.car_number, p.sub_model || p.model, trim].filter(Boolean).join(' ');
    const km = p.mileage ? Number(p.mileage).toLocaleString() + 'km' : '';
    let rentFrom = 0;
    for (const v of Object.values(p.price || {})) {
      const r = Number(v?.rent || 0);
      if (r >= 100000 && (!rentFrom || r < rentFrom)) rentFrom = r;
    }
    const rentTxt = rentFrom ? `월 ${Math.round(rentFrom / 10000)}만~` : '';
    const desc = [p.year, km, p.fuel_type, rentTxt].filter(Boolean).join(' · ');
    const photo = (Array.isArray(p.image_urls) && p.image_urls[0]) || p.image_url || p.photo_link || '';
    return { title, desc, photo };
  } catch (e) {
    console.warn('[catalog-share] product fetch fail:', e?.message || e);
    return null;
  }
}

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
    const id = String(req.query.id || req.query.pid || '').trim();
    // 서버에서 상품 직접 조회 (짧은 링크). 실패/구버전이면 URL 파라미터(t/d/img) fallback.
    const meta = await fetchProductMeta(id);
    const title = meta?.title || String(req.query.t || '').trim();
    const desc  = meta?.desc  || String(req.query.d || '').trim();
    const img   = meta?.photo || String(req.query.img || '').trim();

    let html = loadTemplate();

    // og:title / title / og:description 교체 — "상품 안내" 대신 차량번호+차량명 / 요약(연식·주행·연료·월대여료)
    if (title) {
      const t = escAttr(title);
      const d = escAttr(desc || title);
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
