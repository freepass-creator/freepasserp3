---
name: freepass-v2 디자인 통일 기준
description: 입력·타이포·뱃지·색상·섹션 전역 규약. 페이지별 prefix 남발 금지, 재사용 원칙.
type: feedback
originSessionId: df1d6c67-5473-41b0-868e-3cee453edf6e
---
freepass-v2 전역 디자인 시스템 기준 (2026-04-19 감사 후 정립).

**Why:** 페이지마다 독립 구현하다 보니 `.pd-section` · `.contract-section` · `.cat-section` · `.vehicle-section` · `.ac-section` 같은 동일 구조 5개, 뱃지 구현 3종, 입력칸 정의 2곳 충돌 등 중복·불일치 누적. "쨍한" 글자 두께, 하드코드 색 등 UX 산만.

**How to apply:**

## 1. 타이포그래피 (쨍하지 않게)
- `--fw-heavy(700)`은 hero 타이틀에만 극히 제한적으로
- 일반 제목은 `--fw-semibold(600)` — 이게 표준 굵은 단계
- 카드 제목·필드 값은 `--fw-medium(500)` — 얇지만 눈에 띔
- 본문·보조는 `--fw-normal(400)`
- **하드코드 font-weight 금지** — 반드시 `var(--fw-*)` 사용
- 제목은 canonical 클래스 재사용: `.title-lg` · `.title-md` · `.title-sm` · `.title-xs` (index.html `<style>`)

## 2. 섹션
- canonical: `.section` + `.section-title` + `.section-body` (index.html `<style>` 정의)
- 페이지별 prefix(`pd-`·`contract-`·`cat-`·`vehicle-`·`ac-`) 신규 금지
- 기존 prefix는 레거시 호환 위해 유지하되 canonical로 점진 마이그레이션

## 3. 입력칸 3모드 시각 구분
- **항상 보이는 입력** (검색창·필터) → `.input` 기본 (테두리·배경 유지)
- **인라인 자동저장** (상품등록·계약·정책 등) → `.input-flat` 또는 자체 스타일
  - ① **보기(view)**: `border: 1px solid var(--c-border-soft)` — 얇은 회색 라인, 투명 배경
  - ② **수정(focus)**: `border-color: var(--c-accent)` + `var(--c-surface)` 배경 — 수정 중 시그널
  - ③ **신규(draft)**: 부모에 `.is-draft` 클래스 → 자식 입력칸이 `accent-soft` 배경 + dashed accent 라인
    - focus 시에는 흰 배경으로 올라가며 solid 라인 (편집 중 강조)
- select에도 동일 (cursor:pointer 자동)
- **중요**: 보기모드에서도 얇은 라인 보여야 함 — 완전 투명 테두리 금지

## 4. 뱃지
- 기본은 outlined (`.badge` + `.badge-ok/warn/err/info/accent/muted`)
- 필터 카운트·알림수·강조 필요 시만 `.badge.is-filled` 변형
- 신규 filled 뱃지(`.srch-filter-badge`, `.room-item-badge` 등) 신규 금지 — `.badge.is-filled`로 통일
- legacy 이름 뱃지(`.badge-rose/cyan/lime/...`)는 전부 muted로 alias — 새 색 추가하지 말 것

## 5. 색상·overlay
- 모든 색상은 `var(--c-*)` 토큰 사용 — 하드코드 `#fff`·`rgba()` 금지
- overlay 전용 토큰 (`tokens.css`):
  - `--c-overlay-xdark` (0.92) — 전체화면 이미지 뷰어
  - `--c-overlay-dark` (0.60) — 모달 backdrop
  - `--c-overlay-med` (0.50) — 갤러리 nav
  - `--c-overlay-soft` (0.40) — 모바일 drawer backdrop
  - `--c-overlay-chip` (0.55) — 사진 위 칩/버튼
  - `--c-overlay-thin` (0.35) — avatar 위 글자
- 흰 글자 필요하면 `var(--c-text-inv)`

## 6. 버튼
- `.btn` + `-xs/-sm/-lg` 크기 variant
- `.btn-primary` / `.btn-outline` / `.btn-danger` 색상 variant
- 신규 inline style 버튼 만들지 말 것

## 7. 리스트 행
- `.list-row` 기본 구조 사용 (index.html `<style>`)
- 파생 `.srch-item`·`.room-item`·`.m-card` 는 이걸 상속
- 새 리스트 타입 만들 때도 `.list-row` 먼저 재사용

## 8. 모달·팝업
- **네이티브 `<dialog>` 사용** — createElement + inline CSS 지양
- `showModal()` + `::backdrop` + AbortController로 이벤트 정리
- 닫기: `.close` 버튼 + backdrop 클릭 + Escape (네이티브 처리)

## 9. 패널 헤드
- canonical: `.ws4-head` (4패널 워크스페이스) — 페이지별 panel head 신규 금지
- 2패널(`.pg2-head`)은 특수 케이스로만 유지

## 10. 역할별 UX
- 페이지 접근: `guard(roles, loader)` 라우터 레벨 (app.js)
- 페이지 내부 컨트롤 표시: `store.currentUser?.role` 직접 체크
- `filterByRole()` (store.js)이 데이터 단에서 필터링 담당

## 새 기능 추가 시 체크리스트
- [ ] 이미 있는 canonical 클래스 먼저 찾아봤나? (`.section`, `.title-*`, `.badge`, `.input-flat`, `.list-row`)
- [ ] 새 CSS 파일 만들기 전에 기존 컴포넌트 확장으로 가능한지?
- [ ] `page-prefix-section-title` 같은 중복 패턴 만들고 있진 않은지?
- [ ] font-weight·color 값이 토큰인지?
- [ ] 역할 체크 필요하면 guard/filterByRole 재사용했는지?
