/**
 * 계약서 작성 — A4 미리보기 (iframe) + 입력 폼 실시간 바인딩 + PDF
 */
import { store } from '../core/store.js';
import { fetchRecord } from '../firebase/db.js';
import { showToast } from '../core/toast.js';

let state = {};
let $iframe = null;
let zoom = 1;

const FORM_SECTIONS = [
  {
    title: '계약자', icon: 'ph ph-user', fields: [
      { key: 'customer_name', label: '성명', placeholder: '홍길동' },
      { key: 'customer_id', label: '주민번호', placeholder: '000000-0000000' },
      { key: 'driver_or_biz_no', label: '면허번호' },
      { key: 'customer_phone', label: '전화번호', placeholder: '010-0000-0000', type: 'tel' },
      { key: 'customer_email', label: '이메일', type: 'email' },
      { key: 'residence_type', label: '거주형태', options: ['자가', '전세', '월세', '기타'] },
      { key: 'customer_address', label: '주소', full: true },
      { key: 'emergency_name', label: '비상연락 성명' },
      { key: 'emergency_relation', label: '관계', placeholder: '부·모·배우자' },
      { key: 'emergency_phone', label: '비상연락 전화', full: true },
    ]
  },
  {
    title: '차량정보', icon: 'ph ph-car-simple', fields: [
      { key: 'car_number', label: '차량번호' },
      { key: 'car_name', label: '차종' },
      { key: 'car_color', label: '색상' },
      { key: 'car_vin', label: '차대번호' },
      { key: 'car_year', label: '연식' },
      { key: 'car_mileage', label: '주행거리' },
    ]
  },
  {
    title: '계약조건', icon: 'ph ph-file-text', fields: [
      { key: 'contract_period', label: '계약기간' },
      { key: 'monthly_rent', label: '월 대여료' },
      { key: 'deposit_amount', label: '보증금' },
      { key: 'contract_start', label: '시작일', type: 'date' },
      { key: 'contract_end', label: '종료일', type: 'date' },
      { key: 'delivery_location', label: '인수장소', full: true },
      { key: 'return_location', label: '반납장소', full: true },
    ]
  },
  {
    title: '보험/특약', icon: 'ph ph-shield-check', fields: [
      { key: 'insurance_type', label: '보험종류' },
      { key: 'insurance_self', label: '자기부담금' },
      { key: 'special_terms', label: '특약사항', full: true, textarea: true },
    ]
  },
];

export function mount(contractCode) {
  const sub = document.getElementById('subBody');
  const subTitle = document.getElementById('subTitle');
  const main = document.getElementById('mainContent');
  if (subTitle) subTitle.textContent = '계약서';
  sub.innerHTML = '';

  state = {};

  main.innerHTML = `
    <div class="cs-root">
      <div class="cs-body">
        <!-- 좌측: A4 미리보기 -->
        <section class="cs-stage">
          <div class="cs-toolbar">
            <div class="cs-toolbar-info">
              <span class="badge badge-info">A4</span>
              <span style="font-size:var(--fs-xs);color:var(--c-text-muted);">210 × 297mm</span>
            </div>
            <div class="cs-zoom">
              <button class="btn btn-sm" data-zoom="-">−</button>
              <span id="csZoomVal" style="font-size:var(--fs-xs);min-width:40px;text-align:center;">100%</span>
              <button class="btn btn-sm" data-zoom="+">+</button>
            </div>
          </div>
          <div class="cs-iframe-wrap" id="csIframeWrap">
            <iframe id="csIframe"
                    src="/contract-template/contract-individual.html"
                    class="cs-iframe"
                    scrolling="no"
                    title="계약서 미리보기"></iframe>
          </div>
        </section>

        <!-- 우측: 입력 폼 -->
        <aside class="cs-form-panel">
          <div class="cs-form-head">
            <div>
              <div style="font-weight:var(--fw-bold);font-size:var(--fs-md);">계약 정보 입력</div>
              <div style="font-size:var(--fs-xs);color:var(--c-text-muted);margin-top:2px;">입력하면 좌측에 실시간 반영</div>
            </div>
            <button class="btn btn-sm" id="csReset">초기화</button>
          </div>
          <div class="cs-form-actions">
            <button class="btn btn-outline btn-sm" id="csPdf" style="flex:1;">
              <i class="ph ph-download-simple"></i> PDF
            </button>
            <button class="btn btn-primary btn-sm" id="csSend" style="flex:1;">
              <i class="ph ph-paper-plane-tilt"></i> 발송
            </button>
          </div>
          <div class="cs-form-body" id="csFormBody">
            ${FORM_SECTIONS.map(sec => `
              <details class="cs-section" open>
                <summary class="cs-section-sum">
                  <i class="${sec.icon}"></i>
                  <span>${sec.title}</span>
                </summary>
                <div class="cs-section-grid">
                  ${sec.fields.map(f => {
                    if (f.options) {
                      return `<label class="cs-field ${f.full ? 'cs-field-full' : ''}">
                        <span>${f.label}</span>
                        <select data-bind="${f.key}">
                          <option value="">선택</option>
                          ${f.options.map(o => `<option>${o}</option>`).join('')}
                        </select>
                      </label>`;
                    }
                    if (f.textarea) {
                      return `<label class="cs-field cs-field-full">
                        <span>${f.label}</span>
                        <textarea data-bind="${f.key}" rows="3" placeholder="${f.placeholder || ''}"></textarea>
                      </label>`;
                    }
                    return `<label class="cs-field ${f.full ? 'cs-field-full' : ''}">
                      <span>${f.label}</span>
                      <input type="${f.type || 'text'}" data-bind="${f.key}" placeholder="${f.placeholder || ''}">
                    </label>`;
                  }).join('')}
                </div>
              </details>
            `).join('')}
          </div>
        </aside>
      </div>
    </div>
  `;

  // iframe
  $iframe = document.getElementById('csIframe');
  $iframe.addEventListener('load', () => {
    rehydrate();
    resizeIframe();
    // Pre-fill from contract data
    if (contractCode) prefillFromContract(contractCode);
  });

  // Real-time binding
  document.getElementById('csFormBody').addEventListener('input', (e) => {
    const el = e.target.closest('[data-bind]');
    if (!el) return;
    const key = el.dataset.bind;
    state[key] = el.value;
    applyField(key, el.value);
  });

  // Zoom
  main.querySelectorAll('[data-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      zoom = Math.max(0.5, Math.min(1.5, zoom + (btn.dataset.zoom === '+' ? 0.1 : -0.1)));
      document.getElementById('csZoomVal').textContent = `${Math.round(zoom * 100)}%`;
      $iframe.style.transform = `scale(${zoom})`;
      $iframe.style.transformOrigin = 'top left';
    });
  });

  // Reset
  document.getElementById('csReset')?.addEventListener('click', () => {
    state = {};
    document.querySelectorAll('[data-bind]').forEach(el => {
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
    });
    rehydrate();
    showToast('초기화됨');
  });

  // PDF
  document.getElementById('csPdf')?.addEventListener('click', () => {
    const doc = $iframe?.contentDocument;
    if (!doc) return;
    const win = $iframe.contentWindow;
    win.print();
  });

  // Send (placeholder)
  document.getElementById('csSend')?.addEventListener('click', () => {
    showToast('발송 기능 준비 중');
  });
}

function applyField(key, value) {
  const doc = $iframe?.contentDocument;
  if (!doc) return;
  doc.querySelectorAll(`[data-field="${key}"]`).forEach(node => {
    node.textContent = value || node.dataset.defaultText || '';
  });
}

function rehydrate() {
  const doc = $iframe?.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('[data-field]').forEach(node => {
    if (!('defaultText' in node.dataset)) {
      node.dataset.defaultText = node.textContent.trim();
    }
  });
  Object.entries(state).forEach(([k, v]) => applyField(k, v));
}

function resizeIframe() {
  try {
    const doc = $iframe?.contentDocument;
    if (!doc) return;
    $iframe.style.height = '0';
    const h = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0, 1200);
    $iframe.style.height = `${h}px`;
  } catch (e) {
    $iframe.style.height = '2970px';
  }
}

async function prefillFromContract(code) {
  const contract = await fetchRecord(`contracts/${code}`);
  if (!contract) return;

  const map = {
    customer_name: contract.customer_name,
    customer_phone: contract.customer_phone,
    car_number: contract.car_number_snapshot,
    car_name: `${contract.vehicle_name_snapshot || ''} ${contract.sub_model_snapshot || ''}`.trim(),
    contract_period: contract.rent_month_snapshot ? `${contract.rent_month_snapshot}개월` : '',
    monthly_rent: contract.rent_amount_snapshot ? `${Number(contract.rent_amount_snapshot).toLocaleString()}원` : '',
    deposit_amount: contract.deposit_amount_snapshot ? `${Number(contract.deposit_amount_snapshot).toLocaleString()}원` : '',
    contract_start: contract.contract_date || '',
  };

  Object.entries(map).forEach(([key, val]) => {
    if (!val) return;
    state[key] = val;
    applyField(key, val);
    const input = document.querySelector(`[data-bind="${key}"]`);
    if (input) input.value = val;
  });
}

export function unmount() {
  $iframe = null;
  state = {};
  zoom = 1;
}
