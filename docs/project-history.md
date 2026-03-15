# Smart Ship Automation - 프로젝트 히스토리

## 프로젝트 시작

- **시작일:** 2026-03-15
- **동기:** 네이버 스마트스토어에서 주문이 들어올 때마다 GS편의점 택배 사이트에 수동으로 주소/수령자 정보를 하나하나 입력하는 게 시간이 오래 걸리고 귀찮아서 자동화
- **목표:** 주문 조회 → 리스트 확인 → 선택 → 택배 예약까지의 흐름을 하나의 앱에서 처리

## 초기 설계 결정

| 결정 | 선택 | 대안 | 이유 |
|------|------|------|------|
| 플랫폼 | Next.js 로컬 웹 앱 | Tauri, Electron | GS택배 API 없어서 Playwright 필수 → Node.js 네이티브가 최적 |
| DB | SQLite + Drizzle ORM | PostgreSQL, JSON 파일 | 서버 불필요, 파일 하나로 동작, 타입 안전 |
| UI | Tailwind + shadcn/ui | MUI, Ant Design | 빠른 개발, 커스터마이징 자유도 |
| 네이버 주문 | 커머스 API | Playwright 스크래핑 | 공식 API 존재, 안정적 |
| GS택배 예약 | Playwright | - | API 없음, 브라우저 자동화 유일한 방법 |
| Docker | 미사용 | Dockerfile 포함 | Playwright headed 모드와 Docker 호환성 낮음 |

---

## 마일스톤 기록

### Phase 1: 프로젝트 셋팅
- **완료일:** 2026-03-15
- **PR:** #7
- **주요 변경:**
  - Next.js 16 + TypeScript + Tailwind CSS v4 + shadcn/ui 초기화
  - SQLite + Drizzle ORM 스키마 (orders, settings, bookingLogs)
  - Playwright, bcryptjs, TanStack Query, Vitest 설정
  - 프로젝트 디렉토리 구조 확립
- **기술적 결정:**
  - serverExternalPackages로 better-sqlite3, playwright 번들링 제외 → 네이티브 바이너리 webpack 충돌 방지
  - WAL 모드로 SQLite 동시성 향상
  - Playwright는 chromium만 설치 (경량화)
  - toast 대신 sonner 사용 (shadcn/ui에서 toast deprecated)
- **이슈/교훈:**
  - create-next-app이 최신 버전(v16)으로 설치됨 (계획서는 v15 기준이었으나 v16으로 진행)
  - 기존 파일(.claude/, CLAUDE.md) 충돌로 임시 디렉토리에서 초기화 후 rsync로 복사

### Phase 2: 네이버 커머스 API 연동
- **완료일:** 2026-03-15
- **PR:** #8
- **주요 변경:**
  - OAuth 2.0 인증 (bcrypt 서명 + 모듈 레벨 토큰 캐싱)
  - 발송대기 주문 2단계 조회: last-changed-statuses(PAYED) → product-orders/query
  - 429 Rate Limit 지수 백오프 (1s/2s/4s, 최대 3회)
  - 내일배송 가능 지역 자동 판별 (서울 전체, 인천/경기 일부)
  - DB 동기화: productOrderId 기준 upsert, 처리 중 주문 보호
  - API 라우트: GET /api/orders, POST /api/orders/sync
  - 공유 타입: Order, SyncResult
- **기술적 결정:**
  - zod v4로 외부 API 응답 strict 파싱 → 필드명 변경 즉시 감지
  - 300개 배치 처리 → 네이버 API 제한 대응
  - vitest.config.ts → .mts 변환 → vitest v4 ESM 호환성 확보
- **이슈/교훈:**
  - 네이버 커머스 API 공식 문서(apicenter.commerce.naver.com) 직접 접근 불가 → 커뮤니티 소스 기반 zod 스키마 작성
  - **첫 실제 API 호출 시 응답을 로깅하여 zod 스키마 필드명 보정 필요**
  - vitest v4는 ESM 전용 → config 파일을 .mts로 변환해야 동작

### Phase 3: 대시보드 UI
- **완료일:** 2026-03-15
- **PR:** #11 (원래 #9 → 충돌로 cherry-pick 후 #11로 재생성)
- **주요 변경:**
  - OrderTable: 체크박스 행 선택/전체 선택, 8개 컬럼 (상품/수량/금액/수령인/배송지/택배유형/상태)
  - StatusBadge: 상태별 색상 뱃지 (대기=회색, 예약중=파랑, 완료=초록, 실패=빨강)
  - StatusFilter: 상태별 필터 탭, 건수 표시
  - DeliveryTypeSelector: 행별 택배 유형 변경, 내일배송 불가 지역 비활성화
  - SyncButton: 동기화 트리거 + 상대 시간 표시 ("3분 전")
  - BookingConfirmDialog: 예약 전 수령인 목록/택배유형 요약 확인
  - TanStack Query: booking 상태 주문 있을 때 3초 자동 폴링
  - API 추가: PATCH /api/orders/[id] (택배유형), POST /api/orders/book (예약시작)
  - settings 서비스: lastSyncTime 관리
  - shadcn/ui 7종 추가 (table, checkbox, badge, dialog, select, skeleton, tooltip)
- **기술적 결정:**
  - OrderStatus/DeliveryType union 타입 명시 → Drizzle 컬럼 타입과의 정합성 보장
  - POST /api/orders/book은 Phase 3에서 pending→booking 상태 전환만 수행, Phase 4에서 GS자동화 연결
  - useOrders를 단일 파일에서 4개 훅 export → 응집성 유지
  - `allOrdersQuery`를 별도 호출로 상태 카운트 계산 → 필터된 뷰에서도 전체 건수 표시
- **이슈/교훈:**
  - Phase 2 PR(#8)이 main이 아닌 chore/1-project-setup에 머지됨 → feat/3 브랜치를 chore/1-project-setup 기반으로 rebase
  - @base-ui/react TooltipTrigger는 asChild prop 미지원 → SelectItem에 직접 disabled + 레이블로 불가 지역 표시
  - @base-ui/react Checkbox의 indeterminate 상태는 별도 `indeterminate` prop (Radix UI의 `checked="indeterminate"`와 다름)
  - Toaster 미등록 버그 → providers.tsx에 추가 (코드 리뷰에서 발견)

### Phase 4: GS택배 Playwright 자동화
- **완료일:** 2026-03-15
- **PR:** #12
- **주요 변경:**
  - GS택배(cvsnet.co.kr) 브라우저 자동화 모듈 6개 신규 생성
  - Playwright headed 모드 브라우저 싱글턴 (세션 재사용)
  - 로그인 자동화 (CAPTCHA 60초 수동 대기 포함)
  - 국내택배/내일배송 예약 폼 자동화 (물품정보, 보내는분 주소록, 받는분 정보 입력)
  - 순차 예약 큐(워커): fire-and-forget 패턴으로 1건씩 처리
  - 주문 테이블에 recipientAddressDetail 컬럼 추가 (주소 분리 저장)
  - 네이버 동기화 시 baseAddress/detailAddress 분리 저장으로 변경
  - 예약 실패 시 스크린샷 자동 저장 (data/screenshots/)
  - 예약 로그 기록 (booking_logs 테이블 활용)
  - 서버 재시작 시 stuck 복구 (booking → pending)
- **기술적 결정:**
  - headed 모드 사용 → CAPTCHA 등 수동 개입이 필요할 수 있어 브라우저를 보이게 실행
  - 모듈 레벨 싱글턴으로 Browser/BrowserContext 재사용 → GS택배 로그인 세션 유지
  - 인메모리 큐(배열) 사용 → 1인용 로컬 앱이므로 외부 큐 서비스 불필요
  - 주소 분리 저장 → 네이버 API가 base/detail을 별도 제공하는데, 합치면 GS택배 폼 입력 시 분리 불가능
  - CSS 셀렉터를 selectors.ts에 중앙 집중 → 사이트 구조 변경 시 한 곳만 수정
- **이슈/교훈:**
  - **CSS 셀렉터는 TODO 플레이스홀더 상태** → 실제 cvsnet.co.kr 사이트에서 검증 후 업데이트 필요
  - Phase 2에서 sync.ts가 주소를 합쳐서 저장하고 있었음 → 사후 분리 불가능하여 스키마 변경 + 동기화 로직 수정
  - 전화번호 하이픈 제거 처리 (네이버 API 형식 → GS택배 입력 형식)

### UI 개선: 주문 그룹핑 + 배송메모 + 한글화
- **완료일:** 2026-03-15
- **PR:** (현재 브랜치에 포함)
- **주요 변경:**
  - 네이버 API를 last-changed-statuses에서 조건형 주문 조회 API로 전환
  - 24시간 단위 일별 스캔으로 7일 lookback 구현
  - DB에 shippingMemo 컬럼 추가 + 동기화 시 저장
  - OrderTable을 orderId 기준 그룹으로 재구성 (펼침/접힘)
  - 그룹 헤더에 수령인/배송지/택배유형/내일배송 뱃지/상품수/상태 표시
  - 배송메모를 그룹 헤더 아래에 표시
  - 택배유형 한글화 (domestic → 국내택배, nextDay → 내일배송)
  - 내일배송 가능/불가 뱃지를 테이블에서 바로 확인 가능
  - BookingTask에 shippingMemo 전달
  - groupOrdersByOrderId 유틸 + vitest 테스트 5건
- **기술적 결정:**
  - 조건형 API(GET /v1/pay-order/seller/product-orders) 사용 → 현재 상태 기반 조회로 안정적
  - from~to 24시간 제약 → 일별 순회로 해결, 윈도우 경계 중복은 Set으로 제거
  - auth.ts readRawEnv() → dotenv-expand가 bcrypt salt의 $ 기호를 치환하는 문제 우회
- **이슈/교훈:**
  - last-changed-statuses는 상태 변경 이벤트만 추적 → 현재 PAYED 상태인 주문을 못 찾는 근본 문제 발견
  - 조건형 API에 timezone offset(+09:00)을 쓰면 400 에러 → UTC ISO format(.toISOString()) 사용

### Phase 5: 설정 페이지
- **상태:** 예정
- **내용:** 크리덴셜 관리, 보내는 사람 정보 설정

### Phase 6: 마무리
- **상태:** 예정
- **내용:** 에러 핸들링, 토스트, 로그 뷰어

---

## 기록 형식 템플릿

마일스톤 완료 시 아래 형식으로 기록:

```markdown
### Phase N: [제목]
- **완료일:** YYYY-MM-DD
- **PR:** #번호
- **주요 변경:**
  - 변경사항 1
  - 변경사항 2
- **기술적 결정:**
  - [결정 내용] → [이유]
- **이슈/교훈:**
  - [발생한 문제와 해결 방법]
```
