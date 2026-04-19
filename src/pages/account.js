/**
 * 계정 정보 — 프로필 / 내 정보 / 서류 / 계정 관리
 * 필드 blur 시 자동 저장 + 인라인 "저장됨" 피드백
 */
import { store } from '../core/store.js';
import { updateRecord } from '../firebase/db.js';
import { logout, resetPassword } from '../firebase/auth.js';
import { auth } from '../firebase/config.js';
import { uploadImage, uploadFile } from '../firebase/storage-helper.js';
import { showToast } from '../core/toast.js';

const FIELDS = [
  { key: 'name',            label: '이름',       placeholder: '이름' },
  { key: 'company_name',    label: '소속',       placeholder: '회사명' },
  { key: 'position',        label: '직급',       placeholder: '예: 대리' },
  { key: 'phone',           label: '연락처',     placeholder: '010-0000-0000' },
  { key: 'email',           label: '이메일',     placeholder: 'email@example.com', readonly: true },
  { key: 'bio',             label: '한마디',     placeholder: '소개 한줄' },
  { key: 'business_number', label: '사업자번호', placeholder: '000-00-00000' },
];

export function mount() {
  const main = document.getElementById('mainContent');
  const user = store.currentUser || {};
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();

  main.innerHTML = `
    <div class="ac-page">

      <!-- 프로필 헤더 (간소화) -->
      <header class="ac-header">
        <div id="acAvatar" class="ac-avatar" title="프로필 사진 변경">
          ${user.avatar_url ? `<img src="${user.avatar_url}">` : initial}
          <span class="ac-avatar-overlay"><i class="ph ph-camera"></i></span>
        </div>
        <div class="ac-header-body">
          <div class="ac-header-name">${user.name || '이름 없음'}</div>
          <div class="ac-header-meta">${[user.company_name, user.position].filter(Boolean).join(' · ') || '-'}</div>
        </div>
      </header>

      <!-- 내 정보 -->
      <section class="ac-section">
        <div class="ac-section-title">내 정보</div>
        <div class="ac-rows">
          ${FIELDS.map(f => `
            <div class="ac-row">
              <label class="ac-row-label">${f.label}</label>
              <div class="ac-row-control">
                <input class="ac-input" data-field="${f.key}" value="${user[f.key] || ''}" placeholder="${f.placeholder}" ${f.readonly ? 'readonly' : ''}>
                <span class="ac-state" data-state="${f.key}"></span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- 서류 -->
      <section class="ac-section">
        <div class="ac-section-title">서류</div>
        <div class="ac-rows">
          ${docRow('사업자등록증', user.ci_url, 'ci')}
          ${docRow('명함', user.card_url, 'card')}
        </div>
      </section>

      <!-- 계정 관리 -->
      <section class="ac-section">
        <div class="ac-section-title">계정 관리</div>
        <div class="ac-rows">
          <button class="ac-action" id="acResetPw">
            <span class="ac-action-body">
              <i class="ph ph-key"></i>
              <span>비밀번호 변경</span>
            </span>
            <span class="ac-action-hint">메일로 재설정 링크 발송</span>
          </button>
          <button class="ac-action is-danger" id="acDelete">
            <span class="ac-action-body">
              <i class="ph ph-trash"></i>
              <span>계정 삭제</span>
            </span>
            <span class="ac-action-hint">되돌릴 수 없습니다</span>
          </button>
          <button class="ac-action is-danger" id="acLogout">
            <span class="ac-action-body">
              <i class="ph ph-sign-out"></i>
              <span>로그아웃</span>
            </span>
          </button>
        </div>
      </section>

    </div>
  `;

  // ── Avatar ──
  document.getElementById('acAvatar')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      const { url } = await uploadImage(`user-avatars/${user.uid}/${Date.now()}.webp`, file);
      await updateRecord(`users/${user.uid}`, { avatar_url: url });
      store.currentUser = { ...store.currentUser, avatar_url: url };
      mount();
    });
    input.click();
  });

  // ── Focus/blur 상태 피드백 + 자동 저장 ──
  main.querySelectorAll('.ac-input').forEach(inp => {
    if (inp.readOnly) return;
    const field = inp.dataset.field;
    const stateEl = main.querySelector(`[data-state="${field}"]`);
    let original = inp.value;

    inp.addEventListener('focus', () => {
      original = inp.value;
      setState(stateEl, 'editing');
    });
    inp.addEventListener('blur', async () => {
      const val = inp.value.trim();
      if (val === original) {
        setState(stateEl, null);
        return;
      }
      try {
        await updateRecord(`users/${user.uid}`, { [field]: val });
        store.currentUser = { ...store.currentUser, [field]: val };
        original = val;
        setState(stateEl, 'saved');
        clearTimeout(stateEl._t);
        stateEl._t = setTimeout(() => setState(stateEl, null), 1500);
      } catch (e) {
        setState(stateEl, 'error');
        showToast('저장 실패', 'error');
      }
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });

  // ── Docs ──
  main.querySelectorAll('[data-doc-upload]').forEach(btn => {
    btn.addEventListener('click', () => uploadDoc(btn.dataset.docUpload));
  });

  // ── Actions ──
  document.getElementById('acResetPw')?.addEventListener('click', async () => {
    if (!user.email) return;
    await resetPassword(user.email);
    showToast('비밀번호 재설정 메일 전송됨');
  });

  document.getElementById('acDelete')?.addEventListener('click', async () => {
    const entered = prompt('계정을 삭제하려면 이메일을 입력하세요:');
    if (entered !== user.email) { showToast('이메일 불일치', 'error'); return; }
    try {
      await auth.currentUser.delete();
      await updateRecord(`users/${user.uid}`, { status: 'deleted', deleted_at: Date.now() });
      showToast('계정 삭제됨');
    } catch (e) {
      showToast('삭제 실패: 재로그인 후 시도하세요', 'error');
    }
  });

  document.getElementById('acLogout')?.addEventListener('click', () => logout());
}

function docRow(label, url, type) {
  return `
    <div class="ac-row">
      <label class="ac-row-label">${label}</label>
      <div class="ac-row-control ac-row-doc">
        ${url
          ? `<a href="${url}" target="_blank" class="ac-doc-link"><i class="ph ph-file"></i> 업로드됨</a>`
          : `<span class="ac-doc-empty">미등록</span>`
        }
        <button class="ac-doc-btn" data-doc-upload="${type}" title="업로드"><i class="ph ph-upload-simple"></i></button>
      </div>
    </div>
  `;
}

function setState(el, state) {
  if (!el) return;
  el.classList.remove('is-editing', 'is-saved', 'is-error');
  if (state === 'editing') {
    el.innerHTML = '<i class="ph ph-pencil-simple"></i> 수정 중';
    el.classList.add('is-editing');
  } else if (state === 'saved') {
    el.innerHTML = '<i class="ph ph-check"></i> 저장됨';
    el.classList.add('is-saved');
  } else if (state === 'error') {
    el.innerHTML = '<i class="ph ph-warning"></i> 저장 실패';
    el.classList.add('is-error');
  } else {
    el.innerHTML = '';
  }
}

async function uploadDoc(type) {
  const user = store.currentUser;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*,.pdf';
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    const path = `user-docs/${user.uid}/${type}_${Date.now()}_${file.name}`;
    const { url } = await uploadFile(path, file);
    const field = type === 'ci' ? 'ci_url' : 'card_url';
    await updateRecord(`users/${user.uid}`, { [field]: url });
    store.currentUser = { ...store.currentUser, [field]: url };
    showToast(`${type === 'ci' ? '사업자등록증' : '명함'} 업로드 완료`);
    mount();
  });
  input.click();
}

export function unmount() {}
