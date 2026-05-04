# 매트릭스 작업 매뉴얼 (집/직장 어디서든 동일하게)

> freepasserp3 의 차종 옵션 매트릭스 시스템 작업 가이드.
> 카탈로그 추가/수정 → 빌드 → 매칭 → 적용 까지 한 곳에서.

---

## 1. 사전 준비 (집 PC 첫 셋업)

```bash
git clone https://github.com/freepass-creator/freepasserp.git freepasserp3
cd freepasserp3
npm install
```

> 이 repo 의 master 브랜치는 v3 입니다. v1/v2 와 혼동 주의.

`vehicle-options-catalog-test.html` 은 정적 페이지 — Vite 없이 브라우저로 직접 열어도 동작. 하지만 dev 서버 켜면 hot reload 됨:

```bash
npm run dev   # http://localhost:5173/  (자동으로 _bundle.js 생성)
```

---

## 2. 폴더/파일 구조 (작업 시 만지는 것들)

```
freepasserp3/
├── public/data/
│   ├── car-master/                    ← ★ 카탈로그 데이터 (150개)
│   │   ├── _index.json                ← 메타 (title/encar 매핑)
│   │   ├── _bundle.js                 ← 자동 생성, 절대 직접 수정 금지
│   │   ├── hyundai_palisade_lx3.json  ← 개별 카탈로그
│   │   └── ...
│   └── wikicar/                       ← OCR 원본 이미지 + HTML (86개 폴더)
│       └── {catalog_id}/
│           ├── meta.json
│           ├── page.html
│           └── p1.jpg, p2.jpg, ...    ← 가격표 이미지 (Read tool 로 직접 보기)
│
├── src/core/
│   ├── fp-keyword-rules.js            ← ★ FP 95 표준 매칭 룰 (~115 키워드)
│   ├── fp-options-master.js           ← FP 옵션 마스터 (id ↔ 한글명)
│   └── vehicle-matrix.js              ← 매칭 엔진
│
├── vehicle-options-catalog-test.html  ← 영업자 배포용 테스트 페이지
├── src/pages/dev.js                   ← admin 매트릭스 탭 (#dev → 차종 매트릭스)
│
└── scripts/
    ├── build-car-master-bundle.cjs    ← 번들 생성 (자동 실행됨)
    ├── cleanup-catalog-trims.cjs      ← 트림명 일괄 정리 (idempotent)
    ├── cumulate-trim-basic.cjs        ← OCR incremental → cumulative
    ├── fetch-wikicar.cjs              ← 위키카 페이지/이미지 다운로드
    ├── fetch-wikicar-extra.cjs        ← 추가 슬러그 다운로드
    └── autoname-select-groups.cjs     ← select_groups 자동 이름 보강
```

---

## 3. 카탈로그 JSON 스키마 (단일 catalog 파일)

```json
{
  "catalog_id": "hyundai_palisade_lx3",
  "title": "현대 디 올 뉴 팰리세이드 LX3",
  "maker": "현대",
  "source": "hyundai_official",
  "source_urls": ["https://...", "..."],
  "fetched_at": "2026-04-29",

  "categories": {
    "파워트레인/성능": ["FX01001", "FX01002", ...],
    "안전": ["FX01035", ...],
    "지능형 안전 기술": [...],
    "외관": [...],
    "내장": [...],
    "편의": [...],
    "시트": [...],
    "엔터테인먼트": [...]
  },

  "trims": {
    "익스클루시브 2.5 9인승": {
      "price": 47900000,
      "rent_36": 820000,
      "deposit_36": 3000000,
      "options": {
        "FX01001": true,
        "FX01035": true,
        ...
      }
    },
    "프레스티지 2.5 9인승": { ... },
    ...
  },

  "select_groups": [
    {
      "name": "파퓰러 패키지",
      "price": 1800000,
      "options": ["FX01010", "FX01015"],
      "trim_availability": ["익스클루시브 2.5 9인승", "프레스티지 2.5 9인승"],
      "group": "design",                     // ← 같은 group 끼리는 상호배타
      "excludes": ["프레스티지 패키지"]      // ← 명시적 배타 규칙
    },
    ...
  ]
}
```

**필수 필드**: `catalog_id`, `title`, `maker`, `trims`
**옵션 필드**: `categories` (UI 그룹화), `select_groups` (옵션 패키지)

---

## 4. 작업 워크플로우

### A. 신규 카탈로그 추가 (수입차/구형차 등)

**Case 1: 위키카에 페이지 있는 경우**
```bash
# 1) scripts/fetch-wikicar-extra.cjs 의 SLUGS 객체에 추가
#    예: { 'porsche_taycan': 'porsche-taycan' }
node scripts/fetch-wikicar-extra.cjs

# 2) public/data/wikicar/porsche_taycan/ 폴더 확인 (page.html, p1.jpg, p2.jpg, ...)

# 3) Read tool 로 p1.jpg / p2.jpg 보고 트림/가격 OCR
#    (Claude Code 가 이미지 직접 읽어서 데이터 추출)

# 4) public/data/car-master/porsche_taycan.json 작성

# 5) public/data/car-master/_index.json 에 entry 추가
```

**Case 2: 위키카 없는 수입차 (BMW/벤츠 등)**
- 제조사 공식 사이트 URL 을 source_urls 에 기록
- 가격표 이미지를 Read tool 로 직접 보고 트림/옵션 추출
- stub 으로 trims 만 먼저 채우고 옵션은 추후

### B. 트림명/표기 정리

```bash
# 모든 카탈로그의 트림명 일괄 정리 (괄호 제거 / 영→한 / 페이스리프트 prefix)
node scripts/cleanup-catalog-trims.cjs
```

**표준화 규칙** (스크립트가 자동 처리):
- 괄호 X — `프리미엄 (2.0)` → `프리미엄 2.0`
- 영→한 — `Premium`/`Modern`/`Inspiration`/`Calligraphy`/`Prestige`/`Noblesse`/`Signature` 등
- 영문 보존 — `X-Line`, `GT-Line`, `RS`, `ACTIV`, `S7`, `V5`, `T7`, `Z71`
- 인승 — `7인` → `7인승`
- 페이스리프트 — `더 뉴 X` / `디 올 뉴 X` prefix

### C. 매칭 룰 수정 (옵션명 → FP 표준 ID)

**파일 두 곳 동시 수정** (현재는 분리되어 있음):
1. `src/core/fp-keyword-rules.js` — Vite app 매트릭스 탭용
2. `vehicle-options-catalog-test.html` 의 `FP_KEYWORD_RULES` — 테스트 페이지용

**룰 형식**:
```js
{ kw: '파노라마선루프', ids: ['SUNROOF_PANO'] }
// 키워드는 공백 제거 매칭. 긴 키워드 먼저 우선 매칭.
```

### D. 옵션 의존성 추가 (배타 규칙)

catalog 의 `select_groups[i]` 에 추가:
```json
{ "group": "design" }              // 같은 group 안에서 1개만
{ "excludes": ["파퓰러 패키지"] }  // 명시적 배타
```

UI 가 시각적 disabled 표시 자동 처리.

### E. 빌드 & 적용

```bash
# 카탈로그 수정 후 → 번들 생성
node scripts/build-car-master-bundle.cjs
# 또는
npm run build:car-master

# Vite dev/build 시 자동 실행 (predev/prebuild 훅)
npm run dev      # 자동 빌드 + 서버 시작
npm run build    # 자동 빌드 + 정적 빌드
```

---

## 5. 페이지 구조 (실시간 작동 확인)

### 5-1. 영업자 테스트 페이지
```
http://localhost:5173/vehicle-options-catalog-test.html
```
- 메이커 선택 → 모델/세부모델 cascade
- 트림 선택 → FP 표준 옵션 매칭 결과 표시
- FL split 자동 분기 (G80 RG3 페리 전 등)

### 5-2. ERP 매트릭스 탭 (admin 전용)
```
http://localhost:5173/#dev → 차종 매트릭스 탭
```
- 메이커별 통계 (매칭률 / 적용률)
- 매물 일괄 분석 (5+5 before/after, Apply 버튼)
- 상태/제조사 필터

### 5-3. 매물 등록 페이지 매트릭스 banner
```
http://localhost:5173/#product → 차량 선택
```
- 자산정보 패널 상단에 실시간 매칭 banner
- 정정 적용 + 표준옵션 저장 버튼

---

## 6. 자주 쓰는 명령어 치트시트

```bash
# 카탈로그 수정 후 즉시 반영
npm run build:car-master

# 트림명 표준화 (idempotent — 여러 번 실행해도 안전)
node scripts/cleanup-catalog-trims.cjs

# 위키카 신규 페이지 추가
node scripts/fetch-wikicar-extra.cjs

# 중복 sub_model 검사
node scripts/scan-duplicate-submodels.cjs

# 개발 서버
npm run dev

# 정적 빌드
npm run build
```

---

## 7. 현재 진행 현황 (2026-05-04 기준)

**카탈로그**: 150개 (`public/data/car-master/*.json`)
- 한국차 메이저 메이커 거의 완성
- 페리 전/후 분리: G80 RG3, GV70, GV80, 아반떼 CN7, 스타리아, 아이오닉5/6, 캐스퍼, K8, EV6, XC40 등
- 수입차: BMW(4), 벤츠(3), 아우디(2), 포르쉐(2), 테슬라(4), 볼보(4), 폭스바겐(2), 미니(1), 랜드로버(2)

**위키카 OCR**: 86개 폴더 (페이지 + 이미지)

**완료**:
- ✅ 카탈로그 트림명/title 일괄 정리
- ✅ FP 95 매칭 룰 (~115 키워드)
- ✅ dev tool 매트릭스 탭 (5+5 before/after, Apply)
- ✅ G80 RG3 페리 전 별도 catalog + FL_SPLITS 라우팅
- ✅ 제네시스 8개 catalog 옵션 의존성 메타
- ✅ 그랜저 GN7/IG 가격
- ✅ 가격 OCR 보강 (모하비/니로/스타리아/EV6/EV9/EV3/K9/셀토스/모닝/Ray EV/스포티지 NQ5/산타페 MX5/팰리세이드 LX3/투싼 NX4/코나 SX2/아이오닉 5/6/9/N/ST1/넥쏘/쏘나타 디엣지)
- ✅ sub_model 중복 dedup 로직 + 동력원 keyword 복원

**진행 중 / 다음 작업**:
1. ⏳ **수입차 카탈로그 옵션 보강** — 수입차는 stub 만 있고 옵션 데이터 부족. 제조사 공식 PDF/사이트 OCR 필요.
2. ⏳ **옵션 의존성 UI 시각적 disabled 표시** — click handler 까지만 적용됨. 회색/strikethrough 표시 추가 필요.
3. ⏳ **카탈로그 select_groups 가격 보강** — 일부만 적용. 위키카 p2~p5 이미지 OCR 추가.
4. ⏳ **본 ERP 매트릭스 탭 통합 마무리** — 매물 등록/조회 페이지에서 직접 사용. product 페이지 banner 일부 적용됨.

---

## 8. 트러블슈팅

**Q. _bundle.js 가 옛날 데이터를 보여줘요**
```bash
rm public/data/car-master/_bundle.js
npm run build:car-master
```

**Q. 새 카탈로그가 _index.json 에 안 보여요**
- _index.json 에 entry 수동 추가 (build-car-master-bundle.cjs 가 자동 추가하지 않음)

**Q. 트림이 매칭 안 됨**
- `console.log` 로 어떤 catalogId 가 잡혔는지 확인
- catalog 의 trims key 와 정확히 일치하는지 (공백/괄호 차이)
- `scripts/cleanup-catalog-trims.cjs` 다시 실행

**Q. 옵션이 매칭 안 됨**
- `fp-keyword-rules.js` 에 키워드 추가
- 키워드는 공백 제거 매칭이라 `'파노라마 선루프'` 가 아니라 `'파노라마선루프'`

**Q. 위키카 이미지가 흐릿해서 안 읽혀요**
- p1.jpg 는 페이지 메인 (저해상도). p2.jpg 부터가 가격표 (고해상도) 인 경우 많음
- Read tool 로 p2.jpg, p3.jpg 순서대로 시도

---

## 9. 자주 사용하는 카탈로그 (참고)

`public/data/car-master/` 의 주요 파일:

**현대 SUV**: hyundai_palisade_lx3, hyundai_santafe_mx5, hyundai_tucson_nx4, hyundai_kona_sx2
**현대 세단**: hyundai_grandeur_gn7, hyundai_sonata_djidge, hyundai_avante_cn7
**현대 EV**: hyundai_ioniq5, hyundai_ioniq6, hyundai_ioniq9, hyundai_kona_electric_sx2

**기아 SUV**: kia_sorento_mq4, kia_sportage_nq5, kia_seltos_sp2, kia_carnival_ka4, kia_mohave_qm
**기아 세단**: kia_k5_dl3, kia_k7_yg, kia_k8_gl3, kia_k9_rj
**기아 EV**: kia_ev6, kia_ev9, kia_ev3, kia_ray_ev, kia_niro_sg2

**제네시스**: genesis_g70, genesis_g80_e, genesis_g90_rs4, genesis_gv60, genesis_gv70, genesis_gv70_e, genesis_gv80, genesis_gv80_coupe (+ pre 버전)

**수입차**: bmw_3_g20, bmw_5_g60, bmw_x3_g01, bmw_x5_g05, mercedes_c_w206, mercedes_e_w214, mercedes_s_w223, audi_a6_c8, audi_q5_fy, porsche_cayenne, porsche_macan, tesla_model_3, tesla_model_y, tesla_model_s, tesla_model_x, volvo_xc40, volvo_xc60, volvo_s60, vw_golf_8, vw_tiguan, mini_cooper, landrover_defender, landrover_range_sport

---

## 10. Git 워크플로우 (집 PC 작업 후 푸시)

```bash
# 작업 전 — 항상 pull
git pull origin master

# 작업 후 (예: 수입차 카탈로그 추가)
git add public/data/car-master/porsche_taycan.json
git add public/data/car-master/_index.json
git commit -m "feat(catalog): 포르쉐 타이칸 카탈로그 추가"
git push
```

> ⚠️ `_bundle.js` 는 .gitignore 에 있어서 커밋되지 않음. predev/prebuild 가 자동 생성.

---

## 끝 — 작업 시 우선순위

1. 매물 자주 들어오는 모델 카탈로그 우선 (트림 정확도 > 옵션 정확도)
2. 수입차는 옵션 매칭률보다 트림 정확도 먼저
3. 옵션 의존성/배타는 안 막혀도 동작에 큰 지장 없음 — UI 폴리시
