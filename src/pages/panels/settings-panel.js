/**
 * 영업자 명함 설정 (프로필 편집)
 * Settings에서도 사용, 워크스페이스 프로필 버튼에서도 접근
 */
import { store } from '../../core/store.js';
import { updateRecord } from '../../firebase/db.js';
import { uploadImage } from '../../firebase/storage-helper.js';
import { showToast } from '../../core/toast.js';
import { requestNotificationPermission } from '../../firebase/messaging.js';
import { logout } from '../../firebase/auth.js';

export function renderSettings(container) {
  const user = store.currentUser || {};

  container.innerHTML = `
    <div style="max-width: 480px; margin: 0 auto; padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-4);">

      <div style="text-align: center; font-size: var(--fs-lg); font-weight: var(--fw-bold); margin-bottom: var(--sp-2);">내 정보</div>

      <!-- 명함 미리보기 -->
      <div style="background: var(--c-bg-sub); border-radius: var(--ctrl-r); padding: var(--sp-4); display: flex; align-items: center; gap: var(--sp-4);">
        <div id="avatarWrap" style="width:56px;height:56px;border-radius:50%;background:var(--c-accent-soft);display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--c-accent);cursor:pointer;overflow:hidden;flex-shrink:0;" title="사진 변경">
          ${user.avatar_url ? `<img src="${user.avatar_url}" style="width:100%;height:100%;object-fit:cover;">` : '👤'}
        </div>
        <div>
          <div style="font-weight:var(--fw-bold);">${user.name || '이름 없음'}</div>
          <div style="font-size:var(--fs-xs);color:var(--c-text-sub);">${user.company_name || ''} ${user.position || ''}</div>
          <div style="font-size:var(--fs-xs);color:var(--c-text-muted);">${user.email || ''}</div>
        </div>
      </div>

      <!-- 명함 필드 -->
      <div class="contract-section">
        <div class="contract-section-title">명함 정보</div>
        <div style="padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2);">
          ${settingField('이름', 'name', user.name)}
          ${settingField('소속', 'company_name', user.company_name)}
          ${settingField('직급', 'position', user.position)}
          ${settingField('연락처', 'phone', user.phone)}
          ${settingField('이메일', 'email', user.email)}
          ${settingField('한마디', 'bio', user.bio, '최저가 보장합니다!')}
        </div>
      </div>

      <!-- 알림 -->
      <div class="contract-section">
        <div class="contract-section-title">알림 설정</div>
        <div style="padding: var(--sp-3);">
          <button class="btn btn-outline btn-sm" id="pushPermBtn">
            <i class="ph ph-bell"></i> 푸시 알림 허용
          </button>
        </div>
      </div>

      <!-- 계정 -->
      <div style="display: flex; gap: var(--sp-2);">
        <button class="btn btn-outline btn-sm" id="logoutBtn" style="flex:1;color:var(--c-err);">
          <i class="ph ph-sign-out"></i> 로그아웃
        </button>
      </div>
    </div>
  `;

  // Avatar upload
  const avatarWrap = container.querySelector('#avatarWrap');
  avatarWrap?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const path = `user-avatars/${user.uid}/${Date.now()}.webp`;
      const { url } = await uploadImage(path, file);
      await updateRecord(`users/${user.uid}`, { avatar_url: url });
      store.currentUser = { ...store.currentUser, avatar_url: url };
      showToast('프로필 사진 변경됨');
      avatarWrap.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
    });
    input.click();
  });

  // Auto-save fields
  container.querySelectorAll('.setting-input').forEach(input => {
    input.addEventListener('blur', async () => {
      const field = input.dataset.field;
      const val = input.value.trim();
      if (val !== (user[field] || '')) {
        await updateRecord(`users/${user.uid}`, { [field]: val });
        store.currentUser = { ...store.currentUser, [field]: val };
        showToast('저장됨');
      }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });

  // Push permission
  container.querySelector('#pushPermBtn')?.addEventListener('click', async () => {
    const token = await requestNotificationPermission();
    showToast(token ? '알림 허용됨' : '알림 거부됨');
  });

  // Logout
  container.querySelector('#logoutBtn')?.addEventListener('click', () => logout());
}

function settingField(label, field, value, placeholder = '') {
  return `
    <div style="display: flex; align-items: center; gap: var(--sp-3);">
      <span style="width: 56px; font-size: var(--fs-xs); color: var(--c-text-muted); flex-shrink: 0;">${label}</span>
      <input class="input setting-input" data-field="${field}" value="${value || ''}" placeholder="${placeholder}" style="height: 32px; font-size: var(--fs-sm);">
    </div>
  `;
}
