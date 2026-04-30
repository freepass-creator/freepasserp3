import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';

// .env 수동 로드 — 서버리스 함수가 process.env 로 접근하므로 필요
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(process.cwd(), '.env.local'));

// dev 에서 서버리스 함수가 던지는 unhandled rejection 으로 프로세스가 죽지 않게 방어
if (!process.env.__LOCAL_SERVERLESS_UNHANDLED_GUARD__) {
  process.env.__LOCAL_SERVERLESS_UNHANDLED_GUARD__ = '1';
  process.on('unhandledRejection', (reason) => {
    console.warn('[local-serverless] unhandledRejection (무시됨):', reason?.message || reason);
  });
}

// dev 에서 api/*.js (Vercel Serverless) 를 로컬 vite 로 직접 서빙 —
// Flask(7000) 의존성 제거. 요청 /api/foo → api/foo.js 동적 import 후 default handler 호출.
function localServerless() {
  return {
    name: 'local-serverless',
    // configureServer 안에서 바로 register 하면 vite 내부 미들웨어(static serve)보다 먼저 실행됨
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const pathname = req.url.split('?')[0];
        const apiName = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
        if (!apiName || apiName.includes('..')) return next();
        const apiFile = resolve(process.cwd(), 'api', apiName + '.js');
        if (!existsSync(apiFile)) return next();
        try {
          const mod = await import(pathToFileURL(apiFile).href + `?t=${Date.now()}`);
          const handler = mod.default;
          if (typeof handler !== 'function') return next();
          // Vercel 스타일 req.query 주입
          const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          req.query = Object.fromEntries(urlObj.searchParams);
          // Express 스타일 res.status()/.json()/.send() polyfill (Vercel 호환)
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(obj));
            return res;
          };
          const origSend = res.send;
          res.send = (body) => {
            if (body == null) return res.end();
            if (typeof body === 'string') return res.end(body);
            if (Buffer.isBuffer(body)) return res.end(body);
            if (typeof body === 'object') {
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify(body));
            }
            return res.end(String(body));
          };
          await handler(req, res);
        } catch (err) {
          console.error(`[local-serverless] ${apiName} 실패:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, message: err.message || 'serverless error' }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        catalog: resolve(__dirname, 'catalog.html'),
        proposal: resolve(__dirname, 'proposal.html'),
        sign: resolve(__dirname, 'sign.html'),
        'vehicle-options-test': resolve(__dirname, 'vehicle-options-test.html'),
        'vehicle-options-catalog-test': resolve(__dirname, 'vehicle-options-catalog-test.html'),
      },
      output: {
        // 초기 번들 경량화 — 큰 벤더/라이브러리 분리
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) return 'firebase';
          if (id.includes('node_modules/exceljs')) return 'exceljs';
          if (id.includes('node_modules/jszip')) return 'jszip';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
  appType: 'mpa',
  plugins: [localServerless(), {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // SPA fallback — 정적 파일이 아닌 모든 경로를 index.html로
        //  (모바일 전용 m.html·/m/*는 v2에서 제거됨 — 반응형 CSS로 통일)
        const isStaticOrApi = req.url?.startsWith('/api') ||
          req.url?.startsWith('/src') ||
          req.url?.startsWith('/node_modules') ||
          req.url?.startsWith('/@') ||
          req.url?.includes('.') ||
          req.url?.startsWith('/contract-template') ||
          req.url?.startsWith('/public');
        if (!isStaticOrApi) {
          req.url = '/index.html';
        }
        next();
      });
    },
  }],
});
