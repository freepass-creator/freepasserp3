import { ref, get } from 'firebase/database';
import { db } from '../firebase/config.js';

const HIDE_KEY = 'fp_banner_hide_date';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export async function initBannerPopup(role) {
  if (role !== 'admin' && role !== 'agent') return;
  if (localStorage.getItem(HIDE_KEY) === todayStr()) return;

  let banner;
  try {
    const snap = await get(ref(db, 'home_notices/__banner__'));
    banner = snap.val();
  } catch (_) { return; }

  if (!banner?.active || !banner?.image_url) return;

  const overlay = document.createElement('div');
  overlay.id = 'bannerPopupOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.55);
    z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    background:#fff;border-radius:10px;overflow:hidden;
    width:100%;max-width:480px;
    box-shadow:0 8px 32px rgba(0,0,0,.28);
  `;

  const imgWrap = document.createElement(banner.link_url ? 'a' : 'div');
  imgWrap.style.cssText = 'display:block;width:100%;line-height:0;';
  if (banner.link_url) {
    imgWrap.href = banner.link_url;
    imgWrap.target = '_blank';
    imgWrap.rel = 'noopener noreferrer';
  }
  const img = document.createElement('img');
  img.src = banner.image_url;
  img.alt = '공지';
  img.style.cssText = 'width:100%;height:auto;display:block;max-height:60vh;object-fit:contain;';
  imgWrap.appendChild(img);

  const footer = document.createElement('div');
  footer.style.cssText = `
    display:flex;align-items:center;justify-content:flex-end;gap:8px;
    padding:10px 14px;border-top:1px solid #edeef0;
  `;

  const btnSkip = document.createElement('button');
  btnSkip.textContent = '오늘 하루 안보기';
  btnSkip.style.cssText = `
    padding:7px 14px;border:none;border-radius:6px;
    background:#f1f3f5;color:#495057;
    font-size:13px;font-family:inherit;font-weight:500;cursor:pointer;
  `;

  const btnClose = document.createElement('button');
  btnClose.textContent = '닫기';
  btnClose.style.cssText = `
    padding:7px 14px;border:none;border-radius:6px;
    background:#1B2A4A;color:#fff;
    font-size:13px;font-family:inherit;font-weight:500;cursor:pointer;
  `;

  const close = () => overlay.remove();

  btnSkip.addEventListener('click', () => {
    localStorage.setItem(HIDE_KEY, todayStr());
    close();
  });
  btnClose.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  footer.append(btnSkip, btnClose);
  box.append(imgWrap, footer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
