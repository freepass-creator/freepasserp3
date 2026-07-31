/**
 * 빌드마다 고유값을 public/build-version.txt 에 기록 — 클라이언트가 주기적으로 폴링해
 * 배포 후 열려있던 탭이 구버전 JS 를 계속 실행하는 문제를 자동 감지·새로고침하는 데 사용.
 * (public/ 은 그대로 dist/ 로 복사되므로 해시 없는 고정 경로로 접근 가능.)
 */
const fs = require('fs');
const path = require('path');

// /data/ 는 vercel.json 의 SPA catch-all rewrite 에서 제외된 경로라 index.html 로 안 바뀌고
//  실제 정적 파일 그대로 응답됨 (버전 폴링이 매번 index.html 을 받아버리는 것 방지).
const version = String(Date.now());
fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', 'build-version.txt'), version);
console.log(`[build-version] ${version}`);
