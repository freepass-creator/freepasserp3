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

  if (!banner?.active || !banner?.image_url) return;

  const overlay = document.createElement('div');
  overlay.id = 'catBannerOverlay';
  const box = document.createElement('div');
  box.id = 'catBannerBox';

  const imgWrap = document.createElement(banner.link_url ? 'a' : 'div');
  if (banner.link_url) { imgWrap.href = banner.link_url; imgWrap.target = '_blank'; imgWrap.rel = 'noopener noreferrer'; }
  const img = document.createElement('img');
  img.src = banner.image_url; img.alt = '공지';
  imgWrap.appendChild(img);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'cat-banner-btns';
  const btnSkip = document.createElement('button');
  btnSkip.className = 'cat-banner-btn'; btnSkip.textContent = '오늘 하루 안보기';
  const btnClose = document.createElement('button');
  btnClose.className = 'cat-banner-btn'; btnClose.textContent = '✕ 닫기';

  const close = () => overlay.remove();
  btnSkip.addEventListener('click', () => { localStorage.setItem(HIDE_KEY, today); close(); });
  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  btnGroup.append(btnSkip, btnClose);
  box.append(imgWrap, btnGroup);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
