/**
 * 배포 후 이미 열려있던 탭이 구버전 JS 를 계속 실행하는 문제 자동 해결.
 *
 * 배경: JS/CSS 청크는 파일명에 콘텐츠 해시가 붙어 예전 파일도 서버에 그대로 남아있는 경우가
 *  많아 "청크 로드 실패"가 안 터짐 — 즉 기존 unhandledrejection 핸들러(app.js)로는 못 잡음.
 *  SPA 특성상 페이지 재진입(새로고침) 없이 하루 종일 탭을 켜두는 사용 패턴이 많아, 배포돼도
 *  본인이 수동 새로고침하기 전까진 영원히 예전 코드로 동작 — "계약 생성이 계속 안 된다"처럼
 *  이미 고친 버그가 안 고쳐진 것처럼 보이는 원인이었음.
 *
 * 해결: 고정 경로(build-version.txt, prebuild 마다 갱신)를 주기적으로 폴링 — 최초 로드 시
 *  기록해둔 값과 달라지면 자동 새로고침. 탭이 백그라운드에 있다 다시 보일 때(visibilitychange)
 *  도 즉시 체크 — 사용자가 방금 탭으로 돌아온 시점이라 새로고침해도 입력 중이던 내용을 날릴
 *  위험이 적음.
 */
const VERSION_URL = '/data/build-version.txt';
const POLL_MS = 5 * 60 * 1000;

let baseline = null;
let checking = false;

async function check() {
  if (checking) return;
  checking = true;
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const v = (await res.text()).trim();
    if (!v) return;
    if (baseline === null) { baseline = v; return; }
    if (v !== baseline) window.location.reload();
  } catch (_) {
    // 오프라인 등 — 조용히 무시, 다음 폴링에 재시도
  } finally {
    checking = false;
  }
}

export function startVersionWatch() {
  check();
  setInterval(check, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
