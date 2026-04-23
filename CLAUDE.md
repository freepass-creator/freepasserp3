# freepass-v2 — 진행 컨텍스트

영업자·공급사 간 장기 렌트카 거래 ERP. Vite + vanilla JS + Firebase RTDB, 채팅중심 워크스페이스 + 조건매칭 + 제안서 + 전자계약 플로우.

**최근 활동**: 2026-04-19 ~ 20 집중 개발. MVP 단계 도달, 외부 서비스 연동·Rules 배포만 남음.

---

## 4가지 역할

- **영업자(agent)**: 검색·문의(대화방)·계약 클로징
- **공급사(provider)**: 차량·정책 등록, 문의 응대
- **관리자(admin)**: 사용자·파트너 관리, **전자계약서 발송 전용**(관리자만), 차종마스터 관리
- **고객(customer)**: 공개 링크로 카탈로그(`catalog.html`)·제안서(`proposal.html`)·서명(`sign.html`) 접근, 로그인 불필요

## 완료된 업무 플로우

```
영업자 [검색] → [문의 생성 · ensureRoom] (공급사 알림톡 📲)
  → [소통 · 채팅 · 파일공유] → [계약서 작성]
  → [관리자에게 발송 요청 · sign_requested=true]
관리자 /admin/sign → [서명 링크 발송 · contract_sign/{token}] (고객에게 URL 전달)
고객 sign.html → [서명 제출]
  → contracts.contract_status '계약완료' 자동 전환
  → auto-status.js: product.vehicle_status = 출고불가 + 정산 자동 생성 + 양측 알림톡 📲
```

## 사용자 action (배포 전 필수)

1. **Firebase Rules 추가** (`project_freepass_v2_rules.md` 참조 — 이 파일엔 JSON 예시 있음)
   - `proposals`, `proposal_views`, `contract_sign`, `car_models`, `policies`
2. **Flask 환경변수 세팅**
   - `GOOGLE_VISION_API_KEY` — OCR 프록시(`/api/ocr`)
   - `ALIGO_API_KEY` · `ALIGO_USER_ID` · `ALIGO_SENDER_KEY` · `ALIGO_SENDER_TEL` · (선택)`ALIGO_ADMIN_KEY` — 알림톡
3. **`/admin/dev` Tools 탭 마이그레이션 버튼 2개 실행** (한 번씩만)
   - `policies: term_* → policy_*`
   - `model_name → model` (products · contracts · rooms · settlements)
4. **gsutil CORS 적용** (이미 완료, 재확인 필요 시):
   ```bash
   gsutil cors set cors.json gs://freepasserp3.firebasestorage.app
   ```
   cors.json: `[{"origin":["*"],"method":["GET"],"maxAgeSeconds":3600}]`
5. **jpkerp-next 쪽 작업 요청**(별도 세션)
   - `car_models` 스키마 canonical 적용: `vehicle_master` → `car_models` 경로, `sub` → `sub_model` + `trim_name` 분리
   - seed 195종 등록

## 디자인 시스템 canonical (이것만 지키면 통일)

### 입력칸 3모드 (controls.css 전역)
- **보기(view)**: `border: 1px solid var(--c-border-soft)` 얇은 회색 라인, 투명 배경
- **수정(focus)**: accent 라인 + 흰 배경 (수정 중 시그널)
- **신규(draft)**: 부모에 `.is-draft` → accent-soft 배경 + dashed accent (신규 등록 시그널)
- 적용 대상 선택자: `.contract-field-input / .ac-input[not readonly] / .pd-hero-carno / .pd-hero-select / .pd-textarea / .pd-price-input / .pd-price-memo / .input-flat`
- 페이지별 CSS는 **크기·정렬만** 덮어씀 (색·테두리 재정의 금지)

### 타이포 계층
- 굵기 4단: `--fw-normal(400)` · `--fw-medium(500)` · `--fw-semibold(600)` · `--fw-heavy(700)`
- heavy는 hero만. 일반 제목·숫자 강조는 semibold. "쨍"하지 않게
- `--fw-bold` 토큰은 제거됨 (semibold와 동일, 혼동 방지) — 신규 코드에서 쓰지 말 것
- Canonical 클래스: `.title-lg / .title-md / .title-sm / .title-xs` (controls.css)

### 섹션
- Canonical: `.section / .section-title / .section-body` (controls.css 정의)
- 페이지 prefix(`pd-` · `contract-` · `cat-` · `vehicle-` · `ac-`)는 **레거시** — 신규 작업에선 canonical 우선 사용
- **다음 세션 TODO**: 기존 prefix를 canonical로 점진 마이그레이션 + `.contract-section` 박스 제거 후 flat stacked로 통일 (product-manage 방식이 기준)

### 뱃지
- outlined 기본 `.badge` + `.badge-ok/warn/err/info/accent/muted`
- 강조 필요 시만 `.badge.is-filled`
- 레거시 색 alias(`.badge-rose/cyan/lime/...`) 전부 muted로 통합됨 — 새 색 추가 금지

### 색상·Overlay
- 하드코드 `#fff` · `rgba()` 금지 → `var(--c-*)` 사용
- 모달/갤러리 overlay 토큰: `--c-overlay-xdark/dark/med/soft/chip/thin`
- 흰 글자 필요 시 `var(--c-text-inv)`

### 리스트 행
- `.list-row` 기본 (controls.css) — `.srch-item / .room-item / .m-card` 모두 상속

### 모달
- 네이티브 `<dialog>` 사용, `showModal()` + `::backdrop` + AbortController

### 역할 가드
- 라우터 레벨: `guard(['admin','provider'], loader)` (app.js)
- 페이지 내부 UI 표시: `store.currentUser?.role` 직접 체크
- 데이터 필터: `filterByRole()` (store.js)

## 주요 데이터 스키마

### car_models (공유 마스터, jpkerp-next와 동일)
`maker · model · sub_model · trim_name · code? · year_start/end? · category? · origin? · powertrain? · fuel_type? · transmission? · seats? · drive_type? · displacement? · battery_kwh? · ev_range? · status? · created_at?`

### products
`maker · model · sub_model · trim_name · car_number · year · fuel_type · mileage · ext_color · int_color · vehicle_status · product_type · vehicle_class · seats · engine_cc · vin · usage · first_registration_date · vehicle_age_expiry_date · vehicle_price · location · provider_company_code · partner_code · policy_code · image_urls · photo_link · doc_images · options · partner_memo · price{month:{rent,deposit,fee,fee_memo}} · sign_token · sign_requested · ...`

### 차량상태 lifecycle (auto-status.js)
- `즉시출고` · `출고가능` · `상품화중` · `출고협의` · `출고불가`
- 계약대기/요청/발송 → `출고협의`
- 계약완료 → `출고불가`
- 계약취소 → `출고가능`

### 정산상태 (core/settlement-status.js — 단일 소스)
- `정산대기` · `정산완료` · `정산보류` · `환수대기` · `환수결정`

## 알려진 레거시·제거 예정

- `m.html` · `src/mobile/` 디렉토리는 **이미 제거됨** (반응형 CSS로 통일)
- `.pd-section` · `.contract-section` 등 페이지 prefix 클래스는 canonical `.form-section`·`.section`으로 마이그레이션 예정
- `.srch-filter-badge` · `.room-item-badge` → `.badge.is-filled` 치환 예정

## 사용자 작업 스타일 (이전 피드백 기반)

- 간결한 대답 선호, 긴 summary 불필요
- "통일" 요청 시 페이지 고유 기능(찾기 대여료 등)은 지켜야 할지 **먼저 확인**할 것
- 카톡 플러스친구 기능 안 씀 — 전화(tel:) 다이렉트만
- 제안서/카탈로그는 공급사 코드만 표시, 회사명 표시 X
- 신규 기능 추가 시 canonical 클래스 먼저 확인 (중복 prefix 만들지 말 것)
- 디자인은 B2B, "쨍하지 않게", outlined 기본

## 남은 큰 작업 (우선순위)

### HIGH
1. **폼 레이아웃 canonical로 통일** — `.contract-section`(박스형) 제거, product-manage 방식(flat stacked)으로 contract·policy·settlement·workspace·admin·account 전면 전환
2. **jpkerp-next 차종마스터 연동** — 스키마 적용·seed 완료되면 freepass-v2는 자동 수신
3. **Firebase Rules 배포** (외부 action)

### MEDIUM
4. `.srch-filter-badge` · `.room-item-badge` → `.badge.is-filled` 마이그레이션
5. 하드코드 `#fff` 남은 것 토큰(`--c-text-inv`) 치환
6. `.ws4-head` · `.pg2-head` · `.panel-head` 일원화

### LOW
7. 전자서명 법적 효력 필요 시 외부 API(DocuSign 등) 교체 (현 Canvas 방식은 MVP)
8. 계약 실제 동기화 → jpkerp-next Cloud Function

## 파일 구조 요점

- `src/app.js` — 라우터 + 메뉴 + 역할 guard
- `src/pages/` — 각 페이지 mount/unmount
- `src/core/` — 공용 헬퍼 (car-models · product-badges · product-photos · policy-utils · settlement-status · alimtalk · auto-status · router · store · breadcrumb · toast · format · resize · drive-photos · ocr · menu-badges · chat-notif · command-palette)
- `src/firebase/` — config · auth · db · storage-helper · collections · messaging · notices
- `src/styles/` — tokens · reset · layers · layout · controls · workspace · search · product-manage · contract · contract-send · dashboard · dark · mobile
- `sign.html` · `catalog.html` · `proposal.html` · `index.html` — 공개/메인 엔트리
- `app.py` — Flask API 프록시 (드라이브·OCR·알림톡·SMS·사진 ZIP)

## Claude 작업 가이드

- 새 기능 추가 전 canonical 클래스(`.section-title / .title-* / .input-flat / .badge / .list-row`) 있는지 확인
- 입력칸 추가는 전역 3모드 자동 적용되는 기존 클래스 재활용
- 페이지별 CSS는 크기·정렬만, 색·테두리 재정의 금지
- 모바일 전용 파일·렌더러 만들지 말 것 — 반응형 CSS로 해결
- 역할 guard는 라우터 레벨(app.js) + UI 표시는 `store.currentUser?.role` 직접 체크
- 하드코드 색상 금지 (`var(--c-*)` 사용)
- 신규 모델 입력은 products가 아니라 `car_models`에 stub 등록 (product-manage.js의 `registerCarModelStub` 패턴)
- font-weight는 토큰만 (`var(--fw-*)`)
