/**
 * 온보딩 유도 — PWA 설치 + 알림 권한 안내 (모바일, 로그인 직후 1회)
 *
 * 기존 app.js 가 로그인 후 설명 없이 Notification.requestPermission() 만 호출하던
 * UX 를 교체. 사용자가 왜 허용해야 하는지 설명하고 버튼으로 동의받음.
 *
 * 정책:
 * - 모바일 (폰 UA) 에서만 자동 노출
 * - 설치도 완료됐고 알림도 허용된 상태면 스킵
 * - "나중에" 누르면 7일간 숨김
 * - iOS 는 beforeinstallprompt 미지원 → 수동 안내, 알림은 PWA 설치(홈 화면 추가) 후만 가능
 */
import { isMobile, openBottomSheet } from './mobile-shell.js';
import { isStandalone, isIOS, promptInstall, onInstallStateChange } from './pwa-install.js';
import { showToast } from './toast.js';

const LS_DISMISS_KEY = 'fp.onboardDismissedAt';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function notifState() {
  if (typeof Notification === 'undefined') return 'unavailable';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

function needsShow() {
  if (!isMobile()) return false;
  const installed = isStandalone();
  const notif = notifState();
  // 완전히 세팅된 상태면 노출 불필요
  if (installed && notif === 'granted') return false;
  // 영구 거부된 권한 + 이미 설치됨 → 더 할 수 있는 게 없음
  if (installed && notif === 'denied') return false;
  const dismissedAt = Number(localStorage.getItem(LS_DISMISS_KEY) || 0);
  if (dismissedAt && Date.now() - dismissedAt < COOLDOWN_MS) return false;
  return true;
}

/** 로그인 직후 호출 — 지연 후 조건 만족 시 시트 노출 */
export function checkOnboard() {
  if (!needsShow()) return;
  // 로그인 직후 바로 띄우면 UI 채 뜨기도 전에 가려지는 경우 있음
  setTimeout(() => {
    if (needsShow()) showOnboardSheet();
  }, 1500);
}

/** 수동 트리거 — 설정 등에서 "다시 안내" 용 (향후 연결) */
export function showOnboardSheet() {
  const installed = isStandalone();
  const ios = isIOS();
  const notif = notifState();
  const notifNeeded = notif !== 'granted' && notif !== 'unavailable';
  // iOS 는 PWA 설치 후에만 Notification API 접근 가능
  const canAskNotif = !ios || installed;

  const installItem = installed ? '' : (ios ? `
    <div class="onb-item">
      <div class="onb-item-ico"><i class="ph ph-device-mobile"></i></div>
      <div class="onb-item-body">
        <div class="onb-item-title">홈 화면에 추가</div>
        <div class="onb-item-desc">Safari 하단 <i class="ph ph-export"></i> 공유 → <b>홈 화면에 추가</b>를 누르면 앱처럼 사용할 수 있어요.</div>
      </div>
    </div>
  ` : `
    <div class="onb-item">
      <div class="onb-item-ico"><i class="ph ph-download-simple"></i></div>
      <div class="onb-item-body">
        <div class="onb-item-title">앱 설치</div>
        <div class="onb-item-desc">홈 화면에서 바로 접속. 주소창 없이 더 빠르게 사용할 수 있어요.</div>
      </div>
      <button class="btn btn-primary" id="onbInstall" style="flex-shrink:0;">설치</button>
    </div>
  `);

  const notifItem = !notifNeeded ? '' : (canAskNotif ? `
    <div class="onb-item">
      <div class="onb-item-ico"><i class="ph ph-bell"></i></div>
      <div class="onb-item-body">
        <div class="onb-item-title">알림 받기</div>
        <div class="onb-item-desc">새 메시지·계약 진행·정산 알림을 실시간으로 받습니다.</div>
      </div>
      <button class="btn btn-primary" id="onbNotif" style="flex-shrink:0;">허용</button>
    </div>
  ` : `
    <div class="onb-item is-muted">
      <div class="onb-item-ico"><i class="ph ph-bell"></i></div>
      <div class="onb-item-body">
        <div class="onb-item-title">알림 받기</div>
        <div class="onb-item-desc">홈 화면에 추가한 뒤 앱으로 실행하면 알림을 받을 수 있어요.</div>
      </div>
    </div>
  `);

  if (!installItem && !notifItem) return;

  const body = `
    <div class="onb-lead">freepass를 더 편하게 쓰려면</div>
    <div class="onb-list">
      ${installItem}
      ${notifItem}
    </div>
  `;

  const footer = `
    <button class="btn btn-outline" id="onbLater" style="width:100%;">나중에</button>
  `;

  const { close } = openBottomSheet(body, {
    title: '앱 설정',
    footer,
    onMount: () => {
      document.getElementById('onbLater')?.addEventListener('click', () => {
        localStorage.setItem(LS_DISMISS_KEY, String(Date.now()));
        close();
      });

      const installBtn = document.getElementById('onbInstall');
      installBtn?.addEventListener('click', async () => {
        installBtn.disabled = true;
        const res = await promptInstall();
        installBtn.disabled = false;
        if (res?.outcome === 'accepted') {
          showToast('설치되었습니다', 'success');
          close();
        } else if (res?.outcome === 'unavailable') {
          showToast('브라우저 메뉴에서 "홈 화면에 추가"를 선택해주세요', 'info', 4000);
        }
      });

      const notifBtn = document.getElementById('onbNotif');
      notifBtn?.addEventListener('click', async () => {
        notifBtn.disabled = true;
        const { requestNotificationPermission } = await import('../firebase/messaging.js');
        const token = await requestNotificationPermission();
        notifBtn.disabled = false;
        if (token) {
          showToast('알림이 허용되었습니다', 'success');
          close();
        } else if (Notification.permission === 'denied') {
          showToast('알림이 차단되었습니다. 브라우저 설정에서 변경할 수 있어요', 'info', 4000);
          close();
        }
      });
    },
  });

  // 설치 완료 이벤트(beforeinstallprompt 소멸) 감지 시 설치 섹션 숨김 or 시트 닫기
  const off = onInstallStateChange(() => {
    if (isStandalone()) {
      off();
      close();
    }
  });
}
