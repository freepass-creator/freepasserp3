import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    proxy: {
      // 드라이브 폴더·외부 사이트 이미지 추출은 freepasserp Flask(7000)가 담당
      '/api/extract-photos': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
      '/api/drive-folder-images': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:7001',
        changeOrigin: true,
      },
    },
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
      },
    },
  },
  appType: 'mpa',
  plugins: [{
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
