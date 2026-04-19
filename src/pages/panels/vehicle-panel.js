/**
 * Vehicle Detail Panel — 스펙 | 대여료 | 부가정보 3분할
 */
import { fetchRecord } from '../../firebase/db.js';

export async function renderVehiclePanel(container, productUid) {
  if (!productUid) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--c-text-muted);">
        <div style="text-align: center;">
          <i class="ph ph-car-simple" style="font-size: 40px; display: block; margin-bottom: var(--sp-3);"></i>
          <p style="font-size: var(--fs-sm);">연결된 차량이 없습니다</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `<div style="padding: var(--sp-4); color: var(--c-text-muted); font-size: var(--fs-sm);">로딩 중...</div>`;

  // Fetch product data
  const product = await fetchRecord(`products/${productUid}`);
  if (!product) {
    container.innerHTML = `<div style="padding: var(--sp-4); color: var(--c-text-muted);">차량 정보를 찾을 수 없습니다</div>`;
    return;
  }

  const price = product.price || {};
  const p12 = price['12'] || {};
  const p24 = price['24'] || {};
  const p36 = price['36'] || {};

  // Images
  const images = product.image_urls || product.images || [];
  const imageList = Array.isArray(images) ? images : Object.values(images);

  container.innerHTML = `
    <div class="vehicle-detail">
      <div class="vehicle-header">
        <div class="vehicle-header-title">${product.year || ''} ${product.model || ''} ${product.sub_model || ''}</div>
        <div class="vehicle-header-sub">${product.car_number || ''} · ${product.maker || ''} · ${product.trim || ''}</div>
      </div>

      <div class="vehicle-sections">
        ${imageList.length > 0 ? `
        <!-- 사진 -->
        <div class="vehicle-gallery">
          <div class="vehicle-gallery-main">
            <img src="${imageList[0]}" alt="" id="vehicleMainImg">
          </div>
          ${imageList.length > 1 ? `
          <div class="vehicle-gallery-thumbs">
            ${imageList.slice(0, 6).map((url, i) => `
              <img src="${url}" alt="" class="vehicle-thumb ${i === 0 ? 'is-active' : ''}" data-idx="${i}">
            `).join('')}
            ${imageList.length > 6 ? `<span class="vehicle-thumb-more">+${imageList.length - 6}</span>` : ''}
          </div>
          ` : ''}
        </div>
        ` : ''}

        <!-- 스펙 -->
        <div class="vehicle-section">
          <div class="vehicle-section-title">스펙</div>
          <div class="vehicle-section-grid">
            ${specRow('연식', product.year)}
            ${specRow('제조사', product.maker)}
            ${specRow('모델', product.model)}
            ${specRow('세부모델', product.sub_model)}
            ${specRow('트림', product.trim)}
            ${specRow('연료', product.fuel_type)}
            ${specRow('주행거리', product.mileage ? `${Number(product.mileage).toLocaleString()}km` : '-')}
            ${specRow('외장색', product.ext_color || product.exterior_color)}
            ${specRow('내장색', product.int_color || product.interior_color)}
            ${specRow('최초등록', product.first_registration_date)}
            ${specRow('위치', product.location)}
            ${specRow('상품유형', product.product_type)}
          </div>
          ${product.options ? `<div class="vehicle-options">${product.options}</div>` : ''}
        </div>

        <!-- 대여료 -->
        <div class="vehicle-section">
          <div class="vehicle-section-title">대여료</div>
          <table class="vehicle-price-table">
            <thead>
              <tr><th></th><th>12개월</th><th>24개월</th><th>36개월</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="vehicle-price-label">월납입</td>
                <td class="vehicle-price-highlight">${fmtMoney(p12.rent)}</td>
                <td class="vehicle-price-highlight">${fmtMoney(p24.rent)}</td>
                <td class="vehicle-price-highlight">${fmtMoney(p36.rent)}</td>
              </tr>
              <tr>
                <td class="vehicle-price-label">보증금</td>
                <td>${fmtMoney(p12.deposit)}</td>
                <td>${fmtMoney(p24.deposit)}</td>
                <td>${fmtMoney(p36.deposit)}</td>
              </tr>
              <tr>
                <td class="vehicle-price-label">수수료</td>
                <td>${fmtMoney(p12.fee || p12.commission)}</td>
                <td>${fmtMoney(p24.fee || p24.commission)}</td>
                <td>${fmtMoney(p36.fee || p36.commission)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 부가정보 -->
        <div class="vehicle-section">
          <div class="vehicle-section-title">부가정보</div>
          <div class="vehicle-section-grid">
            ${specRow('공급사', product.provider_company_code)}
            ${specRow('정책', product.policy_name)}
            ${specRow('상품코드', product.product_code)}
            ${specRow('상태', product.vehicle_status)}
            ${specRow('등록일', product.first_registration_date)}
          </div>
          ${product.partner_memo ? `<div class="vehicle-memo">${product.partner_memo}</div>` : ''}
        </div>
      </div>

      <div class="vehicle-actions">
        <button class="btn btn-primary btn-sm">계약 진행</button>
        <button class="btn btn-outline btn-sm">제안서 추가</button>
      </div>
    </div>
  `;

  // Thumbnail click → swap main image
  container.querySelectorAll('.vehicle-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const mainImg = container.querySelector('#vehicleMainImg');
      if (mainImg) mainImg.src = thumb.src;
      container.querySelectorAll('.vehicle-thumb').forEach(t => t.classList.remove('is-active'));
      thumb.classList.add('is-active');
    });
  });
}

function specRow(label, value) {
  return `
    <div class="vehicle-row">
      <span class="vehicle-row-label">${label}</span>
      <span class="vehicle-row-value">${value || '-'}</span>
    </div>
  `;
}

function fmtMoney(v) {
  if (!v) return '-';
  const n = Number(v);
  if (isNaN(n)) return v;
  if (n >= 10000) return `${Math.round(n / 10000)}만`;
  return n.toLocaleString();
}
