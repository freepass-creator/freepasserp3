import { ref, get } from 'firebase/database';
import { db } from '../firebase/config.js';

const HIDE_KEY = 'fp_banner_hide_date';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export async function initBannerPopup(role) {
  if (role !== 'admin' && role !== 'agent') return;

  const today = todayStr();
  if (localStorage.getItem(HIDE_KEY) === today) return;

  let banner;
  try {
    const snap = await get(ref(db, 'home_notices/__banner__'));
    banner = snap.val();
  } catch { return; }

  if (!banner?.active) return;
  // pages: [{image_url, link_url}, ...] — 신규 다중페이지 포맷. 없으면 예전 단일 image_url 포맷 폴백.
  const pages = (Array.isArray(banner.pages) && banner.pages.length)
    ? banner.pages.filter(p => p?.image_url)
    : (banner.image_url ? [{ image_url: banner.image_url, link_url: banner.link_url || '' }] : []);
  if (!pages.length) return;

  let idx = 0;

  const overlay = document.createElement('div');
  overlay.id = 'catBannerOverlay';
  const box = document.createElement('div');
  box.id = 'catBannerBox';

  const imgWrapHost = document.createElement('div');
  const pageDots = document.createElement('div');
  pageDots.className = 'cat-banner-dots';

  const btnGroup = document.createElement('div');
  btnGroup.className = 'cat-banner-btns';
  const btnSkip = document.createElement('button');
  btnSkip.className = 'cat-banner-btn'; btnSkip.textContent = '오늘 하루 안보기';
  const btnClose = document.createElement('button');
  btnClose.className = 'cat-banner-btn'; btnClose.textContent = '✕ 닫기';

  const close = () => overlay.remove();
  btnSkip.addEventListener('click', () => { localStorage.setItem(HIDE_KEY, today); close(); });
  overlay.addEventListener('click', e => { if (e.target === overlay && isLastPage()) close(); });

  const isLastPage = () => idx === pages.length - 1;

  function renderPage() {
    const page = pages[idx];
    // link_url 은 http(s) 만 허용 — javascript:/data: 등 스킴 차단(home_notices 를 저권한 사용자가 write 가능하므로 배너 주입 XSS 방지)
    const safeLink = /^https?:\/\//i.test(String(page.link_url || '').trim()) ? page.link_url.trim() : '';
    const imgWrap = document.createElement(safeLink ? 'a' : 'div');
    if (safeLink) { imgWrap.href = safeLink; imgWrap.target = '_blank'; imgWrap.rel = 'noopener noreferrer'; }
    const img = document.createElement('img');
    img.src = page.image_url; img.alt = `공지 ${idx + 1}`;
    imgWrap.appendChild(img);
    imgWrapHost.replaceChildren(imgWrap);

    if (pages.length > 1) {
      pageDots.replaceChildren();
      const prevBtn = document.createElement('button');
      prevBtn.className = 'cat-banner-nav'; prevBtn.textContent = '‹';
      prevBtn.disabled = idx === 0;
      prevBtn.addEventListener('click', () => { idx = Math.max(0, idx - 1); renderPage(); });

      const nextBtn = document.createElement('button');
      nextBtn.className = 'cat-banner-nav'; nextBtn.textContent = '›';
      nextBtn.disabled = isLastPage();
      nextBtn.addEventListener('click', () => { idx = Math.min(pages.length - 1, idx + 1); renderPage(); });

      const label = document.createElement('span');
      label.className = 'cat-banner-page-label';
      label.textContent = `${idx + 1} / ${pages.length}`;

      pageDots.append(prevBtn, label, nextBtn);
      pageDots.style.display = '';
    } else {
      pageDots.style.display = 'none';
    }

    // 페이지가 여러 장이면 마지막 페이지까지 보기 전엔 닫기/오늘하루안보기 숨김 —
    // 안 그러면 1페이지에서 닫기 눌러서 2페이지를 아예 못 보고 꺼지는 문제가 있었음.
    // 마지막 페이지에서는 '다음' 대신 닫기 버튼이 그 자리를 대신함.
    if (!isLastPage() && pages.length > 1) {
      btnSkip.style.display = 'none';
      btnClose.style.display = 'none';
    } else {
      btnSkip.style.display = '';
      btnClose.style.display = '';
    }
  }
  btnClose.addEventListener('click', close);
  renderPage();

  btnGroup.append(btnSkip, btnClose);
  box.append(imgWrapHost, pageDots, btnGroup);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
