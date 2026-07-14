/**
 * 영업자 체험(둘러보기) 모드 — 샘플 데이터 SSOT
 *
 * ⚠ 실제 Firebase 와 완전히 분리된 가짜 데이터. 여기 값은 절대 실데이터/실코드가 아님.
 *   demo.js 의 인메모리 DB 로 로드되어 watchCollection 대신 화면에 흐른다.
 *   생계형 차종(카니발·포터·모닝 등) 위주 — freepass 상품정책과 톤 일치.
 *
 * 레코드 형태는 pages/search.js·product.js 가 읽는 필드 기준.
 */

const SP = 'DEMO-SP';          // 데모 공급사 코드
const CH = 'DEMO';             // 데모 영업채널 코드

/* ── 상품(차량) ── */
const PRODUCTS = {
  'demo-p1': {
    product_code: 'DEMO-0001', product_type: '무보증',
    maker: '기아', model: '카니발', sub_model: '4세대 카니발', trim_name: '노블레스',
    year: 2023, car_number: '12가 3456', mileage: 34000,
    fuel_type: '디젤', ext_color: '그래비티 블루', int_color: '베이지',
    price: 690000, deposit_free: true, credit_grade: '무관',
    vehicle_status: '광고중', status: 'available',
    provider_company_code: SP, partner_code: SP,
    policy_code: 'DEMO-POL-N', policy_name: '무보증 표준',
    options: '스마트키 · 후방카메라 · 내비게이션 · 통풍시트',
    image_urls: [],
  },
  'demo-p2': {
    product_code: 'DEMO-0002', product_type: '무보증',
    maker: '현대', model: '포터2', sub_model: '포터2 초장축', trim_name: '슈퍼캡',
    year: 2022, car_number: '80바 1179', mileage: 51000,
    fuel_type: '디젤', ext_color: '화이트', int_color: '그레이',
    price: 430000, deposit_free: true, credit_grade: '무관',
    vehicle_status: '광고중', status: 'available',
    provider_company_code: SP, partner_code: SP,
    policy_code: 'DEMO-POL-N', policy_name: '무보증 표준',
    options: '수동에어컨 · 파워윈도우 · 열선시트',
    image_urls: [],
  },
  'demo-p3': {
    product_code: 'DEMO-0003', product_type: '일반',
    maker: '기아', model: '모닝', sub_model: '올 뉴 모닝', trim_name: '프레스티지',
    year: 2024, car_number: '245허 8890', mileage: 12000,
    fuel_type: '가솔린', ext_color: '실키 실버', int_color: '블랙',
    price: 320000, deposit_free: false, credit_grade: '무관',
    vehicle_status: '광고중', status: 'available',
    provider_company_code: SP, partner_code: SP,
    policy_code: 'DEMO-POL-G', policy_name: '일반 표준',
    options: '후방센서 · 크루즈컨트롤 · 애플카플레이',
    image_urls: [],
  },
  'demo-p4': {
    product_code: 'DEMO-0004', product_type: '무심사',
    maker: '기아', model: '스포티지', sub_model: '스포티지 NQ5', trim_name: '트렌디',
    year: 2023, car_number: '35조 4412', mileage: 28000,
    fuel_type: '가솔린', ext_color: '오로라 블랙', int_color: '블랙',
    price: 560000, deposit_free: false, credit_grade: '무관(무심사)',
    vehicle_status: '광고중', status: 'available',
    provider_company_code: SP, partner_code: SP,
    policy_code: 'DEMO-POL-U', policy_name: '무심사 (GPS)',
    options: '파노라마선루프 · 어라운드뷰 · 스마트크루즈',
    image_urls: [],
  },
  'demo-p5': {
    product_code: 'DEMO-0005', product_type: '일반',
    maker: '현대', model: '아반떼', sub_model: '아반떼 CN7', trim_name: '스마트',
    year: 2022, car_number: '61루 2003', mileage: 46000,
    fuel_type: '가솔린', ext_color: '팬텀 블랙', int_color: '그레이',
    price: 390000, deposit_free: false, credit_grade: '무관',
    vehicle_status: '예약중', status: 'available',
    provider_company_code: SP, partner_code: SP,
    policy_code: 'DEMO-POL-G', policy_name: '일반 표준',
    options: '스마트키 · 후방카메라 · 열선핸들',
    image_urls: [],
  },
  'demo-p6': {
    product_code: 'DEMO-0006', product_type: '무보증',
    maker: '기아', model: '봉고3', sub_model: '봉고3 1톤', trim_name: '킹캡',
    year: 2021, car_number: '90머 7725', mileage: 63000,
    fuel_type: '디젤', ext_color: '화이트', int_color: '그레이',
    price: 410000, deposit_free: true, credit_grade: '무관',
    vehicle_status: '광고중', status: 'available',
    provider_company_code: SP, partner_code: SP,
    policy_code: 'DEMO-POL-N', policy_name: '무보증 표준',
    options: '적재함 · 열선시트 · 후방센서',
    image_urls: [],
  },
};

/* ── 정책(상품조건) — 상품의 policy_code 와 매칭 ── */
const POLICIES = {
  'demo-pol-n': {
    policy_code: 'DEMO-POL-N', policy_name: '무보증 표준', product_type: '무보증',
    provider_company_code: SP, deposit_free: true,
    deposit_months: 0, commission_rate: 120, contract_terms: '12/24/36개월',
    description: '보증금 없이 시작 · 후불 수수료 · 3·6개월 유지 시 환수',
  },
  'demo-pol-g': {
    policy_code: 'DEMO-POL-G', policy_name: '일반 표준', product_type: '일반',
    provider_company_code: SP, deposit_free: false,
    deposit_months: 2, commission_rate: 120, contract_terms: '12/24/36개월',
    description: '보증금 월 2회분 · 표준 조건',
  },
  'demo-pol-u': {
    policy_code: 'DEMO-POL-U', policy_name: '무심사 (GPS)', product_type: '무심사',
    provider_company_code: SP, deposit_free: false,
    deposit_months: 2, commission_rate: 120, contract_terms: '12/24개월',
    description: '무심사 · GPS 의무 장착 · 생계형 차종 한정',
  },
};

/* ── 파트너(공급사) ── */
const PARTNERS = {
  'demo-sp': {
    partner_code: SP, partner_name: '샘플모빌리티(주)', company_name: '샘플모빌리티(주)',
    partner_type: 'provider', tel: '0000-0000', region: '수도권',
  },
};

/* ── 샘플 대화방 1개 (업무소통 체험용) ── */
const ROOMS = {
  'demo-room1': {
    agent_uid: 'demo-agent', agent_channel_code: CH, agent_code: 'DEMO',
    provider_company_code: SP,
    product_key: 'demo-p1', product_code: 'DEMO-0001',
    title: '카니발 노블레스 · 계약 문의', last_message: '네, 계약 진행 도와드릴게요!',
    last_message_at: Date.now() - 1000 * 60 * 12,
    unread_for_agent: 0, unread_for_provider: 0,
    created_at: Date.now() - 1000 * 60 * 60 * 3,
    messages: {
      m1: { sender_role: 'agent', sender_name: '체험 영업자', text: '카니발 노블레스 무보증으로 가능할까요?', ts: Date.now() - 1000 * 60 * 60 * 3 },
      m2: { sender_role: 'provider', sender_name: '샘플모빌리티', text: '네 가능합니다. 보증금 없이 월 69만원, 36개월 조건이에요.', ts: Date.now() - 1000 * 60 * 60 * 2 },
      m3: { sender_role: 'agent', sender_name: '체험 영업자', text: '고객 서류 준비되면 계약 넣겠습니다.', ts: Date.now() - 1000 * 60 * 20 },
      m4: { sender_role: 'provider', sender_name: '샘플모빌리티', text: '네, 계약 진행 도와드릴게요!', ts: Date.now() - 1000 * 60 * 12 },
    },
  },
};

/**
 * 인메모리 데모 DB 시드 — demo.js 가 호출.
 * Firebase snapshot.val() 형태(= { key: record }) 와 동일 구조로 반환.
 */
export function buildDemoDB() {
  return {
    products: structuredClone(PRODUCTS),
    policies: structuredClone(POLICIES),
    partners: structuredClone(PARTNERS),
    rooms: structuredClone(ROOMS),
    contracts: {},
    settlements: {},
    admin_settlements: {},
    users: {},
    customers: {},
  };
}
