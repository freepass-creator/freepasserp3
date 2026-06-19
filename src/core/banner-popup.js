import { ref, get } from 'firebase/database';
import { db } from '../firebase/config.js';

const HIDE_KEY = 'fp_banner_hide_date';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export async function initBannerPopup(role) {
  console.log('[banner] initBannerPopup called, role=', role);

  if (role !== 'admin' && role !== 'agent') {
    console.log('[banner] role check fail — not admin/agent');
    return;
  }

  const hideVal = localStorage.getItem(HIDE_KEY);
  const today = todayStr();
  if (hideVal === today) {
    console.log('[banner] localStorage hide_date matched today:', hideVal);
    return;
  }

  let banner;
  try {
    const snap = await get(ref(db, 'home_notices/__banner__'));
    banner = snap.val();
    console.log('[banner] Firebase data:', banner);
  } catch (e) {
    console.error('[banner] Firebase fetch error:', e);
    return;
  }

  if (!banner?.active) {
    console.log('[banner] banner.active is falsy:', banner?.active);
    return;
  }
  if (!banner?.image_url) {
    console.log('[banner] banner.image_url is empty');
    return;
  }

  const wrap = document.getElementById('searchBannerWrap');
  if (!wrap) {
    console.log('[banner] #searchBannerWrap not found in DOM');
    return;
  }

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
  console.log('[banner] banner rendered OK');
}
