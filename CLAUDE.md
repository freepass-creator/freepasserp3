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
- 역할 guard는 라우터 레벨(app.js) + UI 표시는 `store.currentUser?.role` 직접 체크
- 하드코드 색상 금지 (`var(--c-*)` 사용)
- 신규 모델 입력은 products가 아니라 `car_models`에 stub 등록 (product-manage.js의 `registerCarModelStub` 패턴)
- font-weight는 토큰만 (`var(--fw-*)`)

---

# 📌 최근 세션 작업 내역 (반복 / 이어서 해줘 가이드)

> **"이어서 해줘"** 라고 하면 이 섹션을 먼저 읽고 컨벤션 / 진행 상태 / 미완료 항목 파악할 것.
> 마지막 갱신: 2026-05-04

## 모바일 페이지 (NEW — 위 "모바일 전용 파일 만들지 말 것" 규칙은 이 섹션 한정 예외)

위 가이드와 다르게, **데스크톱 ERP 와 분리된 모바일 4탭 SPA** 가 이미 구축되어 있음.

### 환경별 분기
- 모바일 UA 또는 `?mobile=1` → `body.is-mobile` 추가, `#mobileApp` 표시, `tokens.css + mobile.css` 동적 로드
- 데스크톱 → 위 두 CSS 로드 안 됨 (글씨 크기 / 레이아웃 영향 0 보장)
- 분기점: [src/app.js:11-21](src/app.js#L11-L21) `if (isMobileUA()) { await Promise.all([import('./styles/tokens.css'), import('./styles/mobile.css')]); }`

### 모바일 4탭 (mobile-search / mobile-workspace / mobile-contract / mobile-settings)
- 데스크톱과 같은 Firebase 컬렉션 (`products`, `rooms`, `contracts`, `settlements` 등) 공유 — 한쪽에서 만든 데이터 다른 쪽에서 즉시 보임
- 모바일 계약 생성: `openContractStartSheet({ room?, product? })` (mobile-workspace.js export, 채팅·상품 양쪽에서 호출). 데스크톱 `pickOrCreateCustomer + createContractFromRoomLocal` 와 **필드/사이드이펙트 100% 동등**, UI 만 모바일 시트
- 모바일 계약 목록: filterByRole **제거됨** (`getVisible() = store.contracts`) — 영업자/공급사/관리자 모두 모든 계약 노출 → 메모 협업 위해. 영업자별 그룹 섹션 헤더 (본인 그룹 최상단 accent 강조)
- 계약 메모는 3슬롯 (`memo_agent` / `memo_provider` / `memo_admin`) — 본인 슬롯만 textarea 편집, 모두 다 읽기

### 디자인 토큰 (`src/styles/tokens.css` + `_base.css`)
- 라운드 **이분화**: `--m-radius-sharp: 4px` (카드/섹션/입력) / `--m-radius-pill: 999px` (칩/태그/원형 버튼). 중간값 (8/10/12px) **금지**
- 좌우 edge: `--m-edge: 16px` (검색헤더 / 카드 / 디테일 모두 정렬)
- 폰트: Pretendard Variable (CDN, 정적 fallback). 모바일 강제 `body.is-mobile * { font-family: var(--font-mobile) !important }`
- 아이콘: 데스크톱 PhosphorLight, 모바일 `body.is-mobile .ph { font-family: 'Phosphor' !important }` (regular weight)

### 모바일 CSS 분리 구조 (`src/styles/mobile/_*.css`)
- `_base.css` (237 LOC) — 토큰, 폰트, role 클래스
- `_panels.css` (511 LOC) — 상단바, 시트, 채팅, **검색바/필터**
- `_settings.css` (468 LOC) — 토글, collapsing 헤더, 업로드
- `_lists.css` (439 LOC) — 카드 공용, 빈 상태, 영업자별 그룹
- `_views.css` (457 LOC) — 풀스크린 view, 상품 세부 (cat-/srch- self-contained), 계약시작 시트, 하단 액션바, FAB, ct-step
- entry: `mobile.css` 23 LOC (@import 만)

## 데스크톱 — 최근 변경

### `app.js` 분리 (2316 → 1965 LOC)
- `src/core/delete-actions.js` — `canDelete` + 6 delete 함수 (역할별 권한 체크)
- `src/core/draft-tracking.js` — 신규 record 자동 정리 (필수 필드 미입력 → 페이지 이탈 시 _deleted 마킹)
- `src/admin/admin-chat.js` — 관리자↔비admin 1:1 소통

### 권한 체크 (delete-actions.js `canDelete`)
| 역할 | product/policy | settlement | room | contract | partner |
|---|---|---|---|---|---|
| admin | ✓ all | ✓ all | ✓ all | ✓ all | ✓ all |
| provider | 본인 회사 | 본인 회사 | 본인 회사 | 본인 회사 | ✗ |
| agent | ✗ | ✗ | 본인 uid | 본인 uid | ✗ |
| agent_admin | ✗ | ✗ | 본인 채널 | 본인 채널 | ✗ |

### Confirm 다이얼로그 통일
- Windows native `confirm()` 사용 X (그라이언트 분리 위해)
- 자체 모듈: `src/core/confirm.js` — `customConfirm({ message, danger?, okLabel? }) → Promise<boolean>`
- 패턴: `if (!await customConfirm({ message: '...', danger: true, okLabel: '삭제' })) return;`
- delete-actions / app.js 19 곳 적용 완료. 다른 페이지 ~30 곳 (`pages/admin/*`, `pages/contract.js` 등) 미완 — 점진 교체

### Save Status 인디케이터
- `src/firebase/db.js` writers (`setRecord/updateRecord/pushRecord`) 의 3번째 인자 `{ silent: true }` → `trackSave` 건너뜀 → 우측 하단 인디케이터 안 표시
- 명시적 토스트 (예: 삭제됨) 와 **중복 알림 회피** 시 사용
- 기본 (옵션 없음) 은 인디케이터 표시 (자동 저장 등 전형 케이스)
- 모바일은 `body.is-mobile #saveStatus { display: none }` 으로 항상 숨김

### Firebase 감사 로그 (audit-log.js)
- `src/firebase/audit-log.js` — `logAudit({ action, path, fields, data })` + `actorStamp(action)`
- `db.js` writers 가 모든 write 자동 hook → Firebase RTDB `/audit_logs/{auto_id}` push
- 옵션 `{ skipAudit: true }` 로 opt-out 가능 (성능 critical 케이스)
- 감사 대상 컬렉션 (화이트리스트 9종): `products / contracts / policies / partners / users / settlements / rooms / customers / vehicle_master`
- 노이즈 필터 자동: `read_at_*` / `read_by/*` / `last_message*` / `unread` / `updated_at-only` 변경은 감사 안 함
- 로그 스키마: `{ action, collection, record_key, actor_uid, actor_role, actor_name, fields[], values{}, ts }`
- **Firebase Rules 추가 필요** — `/audit_logs` 는 admin read / 본인 uid write 로 위변조 방지

### Draft Tracking — 필수 필드 검증
- `trackDraft(coll, key, fieldOrFields)` — **단일 또는 복수** 필수 필드 (배열) 지원
- admin 재고 신규등록: `['car_number', 'provider_company_code']` 둘 다 필수
- provider: `'car_number'` 만 (회사 자동 채워짐)
- [저장] 클릭 시 `isDraftSaveBlocked()` 검증 → 미입력 시 `missingRequiredFields()` 토스트 + 저장 차단 + 편집모드 유지
- 페이지 이탈 (`hashchange / popstate / beforeunload`) 시 `discardIncompleteDrafts()` 호출 → 미입력 record `_deleted: true` 마킹

### Select Chevron 보존
- `select` 요소의 `:focus / [readonly] / :disabled` 상태에서 background **shorthand** 사용 시 `background-image` 가 함께 리셋되어 chevron SVG 사라짐
- **수정**: `background-color:` 만 명시 ([index.html:391-401](index.html#L391-L401))
- 새 select 룰 추가 시 동일 주의

### 데스크톱 디테일 패널 닫기 버튼
- `ensureDetailCloseButtons()` ([app.js:885+](src/app.js)) 가 모든 `.ws4-detail .ws4-head` 우측에 X 버튼 자동 주입
- 클릭 시 `.is-collapsed` 토글 → 폭 0 으로 숨김
- 검색 페이지 자체 `#detailClose` 는 보존 (자체 collapse 로직)

### 토스트 위치
- 우측 하단 `bottom: 80px` (이전 24px 에서 액션바 위로 올림) — 액션바와 겹침 회피

## 컨벤션 (이거 어기지 말 것)

1. **라운드값 sharp(4px) 또는 pill(999px) 둘 중 하나만**. 중간값 (5/8/10/12/14/16) 금지
2. **CSS background shorthand 금지** (select chevron 등 SVG bg-image 보존). `background-color:` 명시
3. **모바일 → 데스크톱 cross-contamination 없게 유지** — `body.is-mobile` scope 강제, `if (isMobileUA())` 조건부 CSS 로드
4. **삭제 액션은 silent 옵션 + customConfirm danger** 패턴 (토스트 1번만)
5. **신규 record 는 trackDraft 로 추적** — 필수 필드 정의 후 자동 정리에 맡김
6. **canDelete 통과 후만** Firebase update — 클라이언트 최소 가드 + Firebase rules 가 진짜 보안

## 미완료 / 다음 라운드 후보

### A. confirm() 추가 교체 (~30곳)
- `pages/admin/users-partners.js` 등에 native confirm 남아있음
- 패턴: `if (!confirm('...')) return` → `if (!await customConfirm({...})) return` (함수 async 화)

### B. agent_admin 권한 정책 결정 필요
- 정산 — bulkCreateSettlements 는 agent_admin 가능 / settlement.js renderSettlementDetail canEdit 은 admin/provider 만 → 일관성 필요
- 사이드바 메뉴 — agent_admin 이 봐야 할 메뉴 매트릭스 (현재 product/policy 만 hide)
- 모바일 4탭 — 현재 모든 역할 동일. agent_admin 의 소통 탭 (대화 안 봐야) / provider 의 정산 가시성 등 결정

### C. 차종 매트릭스 ↔ 재고 dropdown 통합
- 재고 dropdown: `store.carModels` (Firebase `vehicle_master`)
- 매트릭스: `/data/car-master/_index.json` (정적, 63개)
- 두 소스 통합 필요. A안: 카탈로그 → vehicle_master 일회성 sync (dev-tool)

### D. 데스크톱 페이지에 신규등록 추가 안 한 곳
- 사용자 페이지 — admin 직접 추가 UI 없음 (self-signup 만)
- 계약 페이지 — **의도적 부재** (workspace 차량 → 계약 생성만), 추가 X

### E. 기능 점검 (audit 결과 일부 미적용)
- agent 차량 등록 권한 — 현재 admin/provider 만, agent 차단. 필요 시 정책 재결정
- _pendingDrafts.policies 의 isDraftValid 가 policy_name 만 체크 — admin 의 provider_company_code 빈 값 가능성 (점검)

## "이어서 해줘" — 어떻게 시작할지

1. 위 **컨벤션** 섹션 읽고 어기지 말 것
2. 위 **미완료** 섹션에서 사용자 의도 확인 후 우선순위 잡기
3. 큰 작업은 plan mode 또는 사용자 확인 받고 진행
4. 코드 변경 후 항상 `cd /c/dev/freepasserp3 && npm run build` 통과 확인
5. CSS / 모바일 관련 변경 시 반드시 데스크톱 영향 0 검증 (글씨 크기 변동 등)
6. 새 confirm 다이얼로그는 customConfirm 사용 (native confirm 추가 금지)
7. 새 select 룰은 background-color: 만, shorthand 금지
8. 새 모바일 컴포넌트는 sharp 4px 또는 pill 999px (중간값 금지)
9. 새 record 생성 흐름은 trackDraft 등록
10. 작업 마무리 후 이 CLAUDE.md 의 **미완료** 섹션 갱신 (체크 표시 / 신규 항목 추가)
