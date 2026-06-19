import { ref, get } from 'firebase/database';
import { db } from '../firebase/config.js';

const HIDE_KEY = 'fp_banner_hide_date';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export async function initBannerPopup(role) {
  if (role !== 'admin' && role !== 'agent') return;

  const hideVal = localStorage.getItem(HIDE_KEY);
  const today = todayStr();
  if (hideVal === today) return;

  let banner;
  try {
    const snap = await get(ref(db, 'home_notices/__banner__'));
    banner = snap.val();
  } catch { return; }

  if (!banner?.active || !banner?.image_url) return;

  const wrap = document.getElementById('searchBannerWrap');
  if (!wrap) return;

  const bar = document.createElement('div');
  bar.id = 'searchBannerBar';

  const imgWrap = document.createElement(banner.link_url ? 'a' : 'div');
  if (banner.link_url) {
    imgWrap.href = banner.link_url;
    imgWrap.target = '_blank';
    imgWrap.rel = 'noopener noreferrer';
  }
  const img = document.createElement('img');
  img.src = banner.image_url;
  img.alt = '공지';
  imgWrap.appendChild(img);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'search-banner-btns';

  const btnSkip = document.createElement('button');
  btnSkip.className = 'search-banner-btn';
  btnSkip.textContent = '오늘 하루 안보기';

  const btnClose = document.createElement('button');
  btnClose.className = 'search-banner-btn';
  btnClose.textContent = '✕ 닫기';

  const close = () => bar.remove();

  btnSkip.addEventListener('click', () => {
    localStorage.setItem(HIDE_KEY, todayStr());
    close();
  });
  btnClose.addEventListener('click', close);

  btnGroup.append(btnSkip, btnClose);
  bar.append(imgWrap, btnGroup);
  wrap.appendChild(bar);
}
