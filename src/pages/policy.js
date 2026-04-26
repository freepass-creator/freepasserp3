/**
 * pages/policy.js — 정책 관리 페이지 (v3 ERP)
 *
 * 의존:
 *   - core/store, firebase/db, core/ui-helpers
 *
 * Export:
 *   - POLICY_OPTS (드롭다운 후보)
 *   - renderPolicyList(policies)
 *   - renderPolicyDetail(pol)
 *   - bindPolicyCreate()
 */
import { store } from '../core/store.js';
import { pushRecord } from '../firebase/db.js';
import {
  esc, shortStatus, mapStatusDot,
  listBody, emptyState, renderRoomItem,
  ffi, ffs, setHeadSave, bindFormSave,
} from '../core/ui-helpers.js';

/* v2 정책 OPTS — 드롭다운 옵션 */
export const POLICY_OPTS = {
  screening_criteria: ['신용무관','신용필요'],
  credit_grade: ['7등급 이상','7등급 미만'],
  basic_driver_age: ['만 21세 이상','만 22세 이상','만 23세 이상','만 24세 이상','만 25세 이상','만 26세 이상','만 27세 이상','만 28세 이상','만 29세 이상','만 30세 이상'],
  driver_age_upper_limit: ['제한없음','만 60세 이하','만 65세 이하','만 70세 이하','만 75세 이하','만 80세 이하','협의'],
  driver_age_lowering: ['불가','협의','만25세','만24세','만23세','만22세','만21세'],
  personal_driver_scope: ['계약자 본인+직계가족','계약자 본인만','계약자 본인+추가운전자','협의'],
  business_driver_scope: ['계약사업자 임직원 및 관계자','대표자 본인만','대표자 본인+추가운전자','협의'],
  additional_driver_allowance_count: ['불가','1인','2인','3인','무제한'],
  additional_driver_cost: ['없음','월 1만원','월 2만원','월 3만원','월 5만원','협의'],
  age_lowering_cost: ['대여료의 5%','대여료의 7%','대여료의 10%','5만원','7만원','10만원','월15만원 추가'],
  annual_mileage: ['연간 1만Km 주행','연간 2만Km 주행','연간 3만Km 주행','연간 4만Km 주행','연간 5만Km 주행'],
  mileage_upcharge_per_10000km: ['없음','1만원','2만원','3만원','5만원','10만원','협의'],
  deposit_installment: ['불가능','협의','가능'],
  deposit_card_payment: ['가능','협의','불가'],
  rental_region: ['전국','수도권','제주도불가','협의'],
  injury_deductible: ['없음','10만원','20만원','30만원','50만원','100만원'],
  property_compensation_limit: ['2천만원','3천만원','5천만원','1억원','2억원','3억원','5억원','10억원'],
  property_deductible: ['없음','10만원','20만원','30만원','50만원','100만원'],
  self_body_accident: ['1,500만원','3,000만원','5,000만원','1억원'],
  self_body_deductible: ['없음','10만원','30만원','50만원','100만원'],
  uninsured_damage: ['없음','1억원','2억원','3억원'],
  uninsured_deductible: ['없음','10만원','30만원','50만원','100만원'],
  own_damage_compensation: ['차량가액','300만원','500만원','1000만원'],
  own_damage_repair_ratio: ['20%','30%','40%','50%'],
  own_damage_min_deductible: ['없음','30만원','50만원','100만원','200만원','300만원'],
  own_damage_max_deductible: ['없음','50만원','100만원','200만원','300만원','400만원','500만원'],
  maintenance_service: ['불포함','포함','협의'],
  annual_roadside_assistance: ['연간 1회','연간 2회','연간 3회','연간 4회','연간 5회','없음'],
  insurance_included: ['보험료 포함','보험료 별도','보험료 협의'],
};

export function renderPolicyList(policies) {
  const body = listBody('policy');
  if (!body) return;
  if (!policies.length) { body.innerHTML = emptyState('정책이 없습니다'); renderPolicyDetail(null); return; }
  const sorted = [...policies].sort((a, b) => String(a.policy_name || '').localeCompare(String(b.policy_name || ''), 'ko'));
  body.innerHTML = sorted.map((pol, i) => renderRoomItem({
    id: pol._key,
    icon: 'scroll',
    badge: pol.is_active === false ? '비활' : (pol.status === '중단' ? '중단' : '활성'),
    tone: pol.is_active === false ? 'gray' : (pol.status === '중단' ? 'red' : 'green'),
    name: pol.policy_name || pol.policy_code || pol._key.slice(0, 8),
    time: pol.policy_code || '',
    msg: [pol.provider_company_code || pol.provider_name, pol.credit_grade].filter(Boolean).join(' · ') || '-',
    meta: pol.is_active === false ? '비활성' : '활성',
    active: i === 0,
  })).join('');

  const head = document.querySelector('[data-page="policy"] .ws4-head span');
  if (head) head.textContent = `정책 목록 · ${policies.length}건`;
  renderPolicyDetail(sorted[0]);
}

/* 정책 상세 — 기본정보(편집) / 보험·운전자(편집) / 연결 상품(read-only) */
export function renderPolicyDetail(pol) {
  const page = document.querySelector('.pt-page[data-page="policy"]');
  if (!page) return;
  const cards = page.querySelectorAll('.ws4-card');
  // [목록(0), 정책기본정보(1), 보험운전자(2 = .ws4-detail), 연결상품(3)]
  const basicCard = cards[1];
  const insCard = cards[2];
  const linkedCard = cards[3];

  if (!pol) {
    [basicCard, insCard, linkedCard].forEach(c => c?.querySelector('.ws4-body, .ws4-body.no-pad')?.replaceChildren());
    if (basicCard) basicCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    if (insCard) insCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    if (linkedCard) linkedCard.querySelector('.ws4-body').innerHTML = emptyState('-');
    return;
  }

  const role = store.currentUser?.role;
  const canEdit = role === 'admin' || role === 'provider';
  const dis = canEdit ? '' : ' disabled';
  // 공급사 후보 — partners 컬렉션의 공급사 유형. v2 필드: partner_code (HCAP), partner_name (현대캐피탈)
  const providers = (store.partners || []).filter(p =>
    !p._deleted && (!p.partner_type || p.partner_type === '공급사' || p.partner_type === 'provider')
  ).map(p => ({
    code: p.partner_code || p.company_code || p._key,
    name: p.partner_name || p.company_name || p.partner_code || p._key,
  })).filter(p => p.code);

  const O = POLICY_OPTS;

  // 1. 정책 기본정보 + 대여조건
  if (basicCard) {
    setHeadSave(basicCard, '정책 기본정보', canEdit, 'basic');
    basicCard.querySelector('.ws4-body').innerHTML = `
      <div class="form-grid">
        ${ffi('정책명',     'policy_name',                    pol.policy_name || pol.term_name,   dis)}
        <div class="ff"><label>정책코드</label><input type="text" class="input" value="${esc(pol.policy_code || pol.term_code || '')}" readonly></div>
        <div class="ff"><label>공급코드</label><select class="input" data-f="provider_company_code"${dis}>
          <option value="">선택</option>
          ${providers.map(p => `<option value="${esc(p.code)}" ${p.code === pol.provider_company_code ? 'selected' : ''}>${esc(p.name)} (${esc(p.code)})</option>`).join('')}
          ${pol.provider_company_code && !providers.find(p => p.code === pol.provider_company_code) ? `<option value="${esc(pol.provider_company_code)}" selected>${esc(pol.provider_company_code)}</option>` : ''}
        </select></div>
        ${ffi('정책유형',   'policy_type',                    pol.policy_type,                    dis)}
        ${ffi('정책설명',   'term_description',               pol.term_description,               dis)}
        ${ffs('심사기준',   'screening_criteria',             pol.screening_criteria,             O.screening_criteria, dis)}
        ${ffs('신용등급',   'credit_grade',                   pol.credit_grade,                   O.credit_grade, dis)}
        ${ffs('약정주행',   'annual_mileage',                 pol.annual_mileage,                 O.annual_mileage, dis)}
        ${ffs('1만km추가',  'mileage_upcharge_per_10000km',   pol.mileage_upcharge_per_10000km,   O.mileage_upcharge_per_10000km, dis)}
        ${ffs('보증금분납', 'deposit_installment',            pol.deposit_installment,            O.deposit_installment, dis)}
        ${ffs('보증카드',   'deposit_card_payment',           pol.deposit_card_payment,           O.deposit_card_payment, dis)}
        ${ffi('결제방식',   'payment_method',                 pol.payment_method,                 dis)}
        ${ffi('위약금',     'penalty_condition',              pol.penalty_condition,              dis)}
        ${ffs('대여지역',   'rental_region',                  pol.rental_region,                  O.rental_region, dis)}
        ${ffi('탁송비',     'delivery_fee',                   pol.delivery_fee,                   dis)}
        ${ffi('수수료환수', 'commission_clawback_condition',  pol.commission_clawback_condition,  dis)}
      </div>
    `;
  }

  // 2. 보험·운전자
  if (insCard) {
    setHeadSave(insCard, '보험·운전자', canEdit, 'ins');
    insCard.querySelector('.ws4-body').innerHTML = `
      <div class="form-grid">
        ${ffi('대인배상',   'injury_compensation_limit',          pol.injury_compensation_limit, dis)}
        ${ffs('대인면책',   'injury_deductible',                  pol.injury_deductible,                                                 O.injury_deductible, dis)}
        ${ffs('대물배상',   'property_compensation_limit',        pol.property_compensation_limit,                                       O.property_compensation_limit, dis)}
        ${ffs('대물면책',   'property_deductible',                pol.property_deductible,                                               O.property_deductible, dis)}
        ${ffs('자손사고',   'self_body_accident',                 pol.self_body_accident || pol.personal_injury_compensation_limit,      O.self_body_accident, dis)}
        ${ffs('자손면책',   'self_body_deductible',               pol.self_body_deductible || pol.personal_injury_deductible,            O.self_body_deductible, dis)}
        ${ffs('무보험상해', 'uninsured_damage',                   pol.uninsured_damage || pol.uninsured_compensation_limit,              O.uninsured_damage, dis)}
        ${ffs('무보험면책', 'uninsured_deductible',               pol.uninsured_deductible,                                              O.uninsured_deductible, dis)}
        ${ffs('자차손해',   'own_damage_compensation',            pol.own_damage_compensation,                                           O.own_damage_compensation, dis)}
        ${ffs('자차수리율', 'own_damage_repair_ratio',            pol.own_damage_repair_ratio || pol.own_damage_compensation_rate,       O.own_damage_repair_ratio, dis)}
        ${ffs('자차최소',   'own_damage_min_deductible',          pol.own_damage_min_deductible,                                         O.own_damage_min_deductible, dis)}
        ${ffs('자차최대',   'own_damage_max_deductible',          pol.own_damage_max_deductible,                                         O.own_damage_max_deductible, dis)}
        ${ffs('보험료포함', 'insurance_included',                 pol.insurance_included,                                                O.insurance_included, dis)}
        ${ffs('정비서비스', 'maintenance_service',                pol.maintenance_service,                                               O.maintenance_service, dis)}
        ${ffs('긴급출동',   'annual_roadside_assistance',         pol.annual_roadside_assistance || pol.roadside_assistance,             O.annual_roadside_assistance, dis)}
        ${ffs('기본연령',   'basic_driver_age',                   pol.basic_driver_age,                                                  O.basic_driver_age, dis)}
        ${ffs('연령상한',   'driver_age_upper_limit',             pol.driver_age_upper_limit,                                            O.driver_age_upper_limit, dis)}
        ${ffs('연령하향',   'driver_age_lowering',                pol.driver_age_lowering,                                               O.driver_age_lowering, dis)}
        ${ffs('연령하향비', 'age_lowering_cost',                  pol.age_lowering_cost,                                                 O.age_lowering_cost, dis)}
        ${ffs('개인범위',   'personal_driver_scope',              pol.personal_driver_scope,                                             O.personal_driver_scope, dis)}
        ${ffs('사업자범위', 'business_driver_scope',              pol.business_driver_scope,                                             O.business_driver_scope, dis)}
        ${ffs('추가인원',   'additional_driver_allowance_count',  pol.additional_driver_allowance_count,                                 O.additional_driver_allowance_count, dis)}
        ${ffs('추가운전비', 'additional_driver_cost',             pol.additional_driver_cost,                                            O.additional_driver_cost, dis)}
      </div>
    `;
  }

  // 3. 연결 상품 (read-only)
  if (linkedCard) {
    const linked = (store.products || []).filter(p => p.policy_code === pol.policy_code);
    const body = linkedCard.querySelector('.ws4-body');
    if (!linked.length) {
      body.innerHTML = emptyState('연결된 상품이 없습니다');
    } else {
      body.innerHTML = `
        <table class="table">
          <thead><tr><th class="sticky-col">차량번호</th><th>모델</th><th class="num">36개월</th><th class="num">48개월</th><th class="center">상태</th></tr></thead>
          <tbody>${linked.map(p => {
            const p36 = p.price?.['36'] || {};
            const p48 = p.price?.['48'] || {};
            const r36 = p36.rent ? Math.round(p36.rent/10000) + '만/' + Math.round((p36.deposit||0)/10000) + '만' : '-';
            const r48 = p48.rent ? Math.round(p48.rent/10000) + '만/' + Math.round((p48.deposit||0)/10000) + '만' : '-';
            return `<tr><td class="sticky-col">${esc(p.car_number || '-')}</td><td>${esc([p.sub_model || p.model, p.trim_name].filter(Boolean).join(' '))}</td><td class="num">${r36}</td><td class="num">${r48}</td><td class="center"><span class="status-dot ${mapStatusDot(p.vehicle_status || '')}"></span>${esc(shortStatus(p.vehicle_status || ''))}</td></tr>`;
          }).join('')}</tbody>
        </table>
      `;
    }
  }

  if (canEdit) bindFormSave(page, 'policies', pol._key, pol);
}

/* 새 정책 — 페이지 헤드 "새 정책" 버튼 */
export function bindPolicyCreate() {
  const btn = document.querySelector('[data-page="policy"] .ws4-list .ws4-head .btn-primary');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const role = store.currentUser?.role;
    if (role !== 'admin' && role !== 'provider') return alert('권한이 없습니다');
    const name = prompt('새 정책명:');
    if (!name?.trim()) return;
    try {
      await pushRecord('policies', {
        policy_name: name.trim(),
        policy_code: 'POL-' + Date.now().toString(36).toUpperCase(),
        is_active: true,
        status: '활성',
        provider_company_code: store.currentUser?.company_name || '',
        created_at: Date.now(),
        created_by: store.currentUser?.uid || '',
      });
    } catch (e) {
      alert('생성 실패 — ' + (e.message || e));
    }
  });
}
