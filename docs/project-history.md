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
- **완료일:** 2026-03-16
- **PR:** #12
- **주요 변경:**
  - **GS택배 자동화 모듈** (auth, automation, browser, selectors, types, worker)
    - cvsnet.co.kr 로그인 (Cloudflare Turnstile 캡챠 60초 수동 통과 대기)
    - 국내택배/내일배송 예약 폼 자동화 (물품정보, 보내는분 주소록, 받는분 정보)
    - 배송요청사항 폼 입력 (`#special_contents`), 전화번호 포맷팅 (안심번호 0502 포함)
    - 멀티 전략 예약 성공 감지 (URL 변경 / 텍스트 / 폼 가시성)
    - Playwright headed 모드 브라우저 싱글턴 + 쿠키 기반 세션 유지
  - **예약 워커**
    - orderId 기준 그룹 예약 (같은 주문 = 1건 택배, `BookingTask.orderDbIds`)
    - 개별 실패 시 나머지 건 계속 처리, 브라우저 크래시 시 큐 드레인
    - 서버 재시작 시 "booking" 상태 주문 자동 복구 (`recoverStuckBookings`)
  - **대시보드 UI 전면 개선**
    - OrderTable: orderId 기준 그룹핑 + 펼침/접힘 상품 리스트
    - 그룹 레벨 택배유형 선택 / 상태 수동 편집 (pending/booked/failed)
    - 한글 택배유형 + 내일배송 가능/불가 뱃지 + 그룹별 합계 금액
    - 예약 완료 후 자동 탭 전환 (2-phase 감지: waiting → monitoring)
    - 상태 필터 간소화: 대기/완료/실패/전체 (기본: 대기)
    - 실패 건 재예약 지원
  - **DB / API**
    - recipientAddressDetail, shippingMemo 컬럼 추가
    - 그룹 상태/택배유형 일괄 변경 API (`PATCH /api/orders/group`)
    - 배치 상태 업데이트 (`updateOrderStatusBatch`), dead code 정리
  - **네이버 API 리팩토링**
    - 조건형 주문 조회 API로 전환 (7일간 PAYED 주문 스캔)
    - dotenv-expand bcrypt salt 충돌 우회 (readRawEnv)
- **기술적 결정:**
  - headed 모드 → CAPTCHA 수동 개입 필요, 브라우저 보이게 실행
  - 인메모리 큐 → 1인용 로컬 앱이므로 외부 큐 불필요
  - CSS 셀렉터 중앙 집중 (selectors.ts) → 사이트 변경 시 한 곳만 수정
  - 2-phase 예약 완료 감지 → React Query 캐시 타이밍 문제 해결
    - Phase 1("waiting"): "booking" 상태가 데이터에 나타날 때까지 대기
    - Phase 2("monitoring"): "booking"이 사라지면 완료 탭 전환 + 캐시 무효화
  - 조건형 API 전환 → last-changed-statuses는 현재 PAYED 상태를 못 찾는 근본 문제
- **이슈/교훈:**
  - 배송요청사항 필드가 `#delivery_msg`가 아닌 `#special_contents` → 폼 HTML 덤프로 확인
  - 면책동의 체크박스 `label.click()` + `cb.checked = true` 동시 사용 시 더블 토글 → label만 사용
  - `groupOrdersByOrderId`에서 `first.shippingMemo` 사용 시 null 반환 → `find()` 패턴으로 수정
  - 예약 완료 후 탭 전환 시 stale 캐시로 false trigger → 2-phase ref 패턴으로 해결
  - 조건형 API에 timezone offset 사용 시 400 에러 → UTC ISO format 사용

### Phase 5: 설정 페이지
- **완료일:** 2026-03-16
- **PR:** #13
- **주요 변경:**
  - 설정 페이지 UI (4탭: 네이버 API / GS택배 / 보내는 사람 / 택배 기본값)
  - 설정 CRUD API (`GET/PUT /api/settings`)
  - 네이버 API 연결 테스트 (`POST /api/settings/test-naver`)
  - GS택배 로그인 테스트 (`POST /api/settings/test-gs`)
  - DB 설정 우선, env 폴백 전략 (`getConfigValue(dbKey, envKey)`)
  - 비밀값 마스킹 처리 (`****{last4}`) + PUT 시 마스킹 값 유지
  - 기존 `.env.local` 사용자 하위 호환 유지
  - `settings.ts` 단위 테스트 11개 추가
  - 대시보드 헤더에 설정 페이지 링크 추가
  - shadcn/ui input/label/tabs/card 추가
- **기술적 결정:**
  - DB 평문 저장 (로컬 SQLite 1인 사용 → 암호화 불필요)
  - `getAllSettingsRaw()` 내부용 별도 제공 (test-gs 등 실제 크리덴셜 필요한 곳에 활용)
  - clientSecret bcrypt salt 처리: DB 값 있으면 사용, 없으면 readRawEnv 폴백 유지
- **이슈/교훈:**
  - vi.mock 파셜 모킹은 같은 모듈 내 함수 호출에 미적용 → DB 체인 모킹으로 해결

### Phase 6: 서버 배포 + 자동 발송처리 + PWA
- **완료일:** 2026-03-16
- **이슈:** #17
- **PR:** #18 (예정)
- **주요 변경:**
  - Oracle Cloud VM 배포 (PM2 + Caddy + 자동 HTTPS Let's Encrypt)
  - `DEPLOY_MODE=server` 환경변수로 headless Playwright 전환 (Linux VM 옵션 포함)
  - 로컬↔서버 동기화 API (`POST /api/internal/cookies`, `POST /api/internal/booking-result`)
  - `INTERNAL_API_KEY` 헤더 인증으로 내부 API 보호
  - 예약 완료/실패 시 서버 DB 자동 동기화 (worker.ts)
  - GS택배 로그인 후 쿠키 서버 자동 동기화 (auth.ts)
  - `sync-to-server.ts`: 환경변수 미설정 시 no-op → 기존 로컬 전용 사용자 영향 없음
  - PWA 대시보드 (manifest.json, sw.js, 아이콘, viewport 메타태그)
  - 모바일 홈화면 설치 가능, 오프라인 폴백
- **아키텍처 변경:**
  - 서버: Next.js 프로덕션 + SQLite + 자동 발송처리 폴링 + PWA 대시보드
  - 로컬: GS택배 Playwright headed 예약 + 서버로 결과/쿠키 자동 동기화
  - 서버에서 headless Playwright로 운송장번호 스크래핑 → 네이버 자동 발송처리
- **기술적 결정:**
  - Caddy 선택 → 설정 한 줄로 자동 HTTPS, nginx보다 설정 간단
  - 동기화 실패가 로컬 동작 방해하지 않도록 `void` 비동기 패턴 사용
  - `ServerURL` 미설정 시 기존 로컬 전용 동작 100% 유지 → 하위 호환
  - PM2 `max_memory_restart` 500MB → SQLite + Playwright 메모리 누수 방지
  - 서비스 워커: Network-first (대시보드 항상 최신) + API 요청은 캐시 제외
  - SVG 아이콘 + PNG 폴백 (maskable 지원)
- **이슈/교훈:**
  - 서버에서 headless Playwright 실행 시 `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage` 필수 (root 또는 VM 환경)
  - GS택배 쿠키 만료 시 자동 갱신 불가 (캡챠 때문에 서버에서 로그인 불가) → 다음 로컬 예약 시 자동 재동기화됨
  - Next.js Metadata API에서 `viewport`는 별도 `export const viewport: Viewport`로 분리 필요 (metadata 내 viewport 옵션은 deprecated)

### Phase 7: 에러 핸들링 및 예약 로그 뷰어 (#6)
- **완료일:** 2026-03-16
- **PR:** #14
- **주요 변경:**
  - 예약 실패 시 자동 재시도 (최대 2회, 지수 백오프 2s/4s)
  - 예약 로그 뷰어 다이얼로그 (주문번호 클릭 → 로그 + 스크린샷 확인)
  - 로그 조회 API (`GET /api/orders/:id/logs`)
  - 스크린샷 서빙 API (`GET /api/screenshots/:filename`, 경로 조작 방지)
  - 토스트 알림은 Phase 3~5에서 이미 구현 완료
- **기술적 결정:**
  - 로그 뷰어 별도 페이지 대신 다이얼로그로 구현 (orderId 클릭 트리거)
  - 재시도 실패 시에도 스크린샷 경로 마지막 result에서 보존
- **이슈/교훈:**
  - 없음

### Phase 8: 발송완료 상태 표시 개선 + 집화 상태 확인 (#21)
- **완료일:** 2026-03-16
- **PR:** #22
- **주요 변경:**
  - 발송완료/건너뜀 상태 Select → StatusBadge로 교체 (빈칸 버그 수정)
  - 배송지 40자 잘림 제거 (전체 표시)
  - 발송완료 주문에 집화 확인 시 "배송중" 배지 추가
  - DB: delivery_status, delivery_status_checked_at 컬럼 추가
  - 네이버 API DELIVERING 상태 조회로 집화 여부 자동 확인
- **기술적 결정:**
  - 배송상태 확인을 별도 타이머 없이 dispatch-worker 폴링에 포함 → 복잡성 최소화
  - 배송상태 확인 실패 시 무시하고 다음 폴링에서 재시도 (부가 기능이므로)
- **이슈/교훈:**
  - 네이버 API DELIVERING 상태 응답 여부는 서버 실제 테스트 필요 (조건형 API에서 지원 확인)

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

## 2026-03-17 — PR #24: 원격 스크린샷 로그인 제거 → 로컬 직접 로그인 전환

- 서버 원격 스크린샷 CAPTCHA 방식 불안정 → 제거
- `loginDirect()`: headed 브라우저에서 ID/PW 자동입력, 사용자가 CAPTCHA 직접 처리 (최대 120초 대기)
- `GsLoginModal`, `gs-login/screenshot`, `gs-login/click` API 삭제
- 국내택배 예약 시 "내일배송 전환" 팝업 자동 처리 ("국내택배로 계속" 클릭)
- 수령인 이름/주소 특수문자 sanitize (마스킹 * 등)
- 보내는 분 주소록 "리커밋" 선택 검증 + 재시도 로직

## 2026-03-18~19 — 서버 운송장 스크래핑 안정화 + 동기화 개선

### 운송장 스크래핑 Playwright → HTTP fetch 전환
- **문제:** 서버 headless Playwright로 GS택배 접속 시 Cloudflare Turnstile 차단
- **해결:** `scrape-tracking.ts`를 HTTP fetch + Cookie 헤더 방식으로 교체
- Playwright 없이 `data/cookies.json`의 쿠키로 예약조회 페이지 직접 요청
- 302 리다이렉트 / "비로그인" 텍스트로 세션 만료 감지
- HTML 테이블 정규표현식 파싱으로 예약번호 ↔ 운송장번호 매칭

### 운송장 스크래핑 영업시간 제한
- `isWithinScrapeWindow()`: KST 11시~18시 사이에만 스크래핑 실행
- 그 외 시간은 폴링은 계속하되 GS택배 HTTP 요청 스킵
- 밤에 예약해도 불필요한 요청 방지 + 쿠키 낭비 방지

### 로컬 → 서버 주문 데이터 upsert
- **문제:** 서버 DB에 주문이 없을 때 `booking-result` 동기화가 UPDATE 0건으로 무시됨
- **해결:** `syncBookingResult`에서 주문 상세 데이터(수령인, 주소, 상품 등) 함께 전송
- `booking-result` API에서 서버 DB에 주문 없으면 INSERT (upsert 로직)
- `upsertOrdersFromLocal()`: productOrderId 기준으로 기존 → UPDATE, 신규 → INSERT
- `resyncBookedOrders()`도 동일 경로로 재동기화 → 동기화 누락 자동 복구

### 기술적 결정
- HTTP fetch가 Playwright보다 서버 환경에 적합 (Cloudflare 우회, 리소스 절약)
- 쿠키 유효성은 파일 수정시간 24시간 + 실제 HTTP 응답으로 이중 확인
- upsert는 서버 DB에 주문이 없어도 로컬 예약만으로 자동 발송처리 가능하게 함

### 이슈/교훈
- 서버 PM2 로그 시간은 UTC 표시 (02:00 UTC = 11:00 KST) — 혼동 주의
- GS택배 세션은 24시간보다 짧게 만료될 수 있음 → 예약 직전 로그인 권장
- Oracle Cloud VM 빌드 5~7분 소요 (메모리 제한)

## 2026-03-26 — PR #26: 방문택배 다량 접수 예약 기능 (#25)

### 방문택배 Playwright 자동화
- 3건 이상 주문을 하나의 방문택배 예약으로 묶어 폼 자동 입력
- 주의사항 팝업 → 접수 확인 → 다량 접수 → 물품정보 → 방문일 → 전달방식 → 보내는 분 → N명 수령인 순차 입력
- 수령인 추가: 1→2번째 `#btn_receiver_add` + alert, 3번째+ `.btn_receiver_plus`
- 예약명 "리뷰어 발송" 고정, 박스 크기 2kg이하 × 1, 전달방식 "부재중으로 현관문 앞에 두겠습니다"
- 예약하기 미클릭 — 사용자가 직접 결제

### 기술적 결정
- 기존 국내택배와 달리 1 예약 = N명 수령인 구조 → 별도 `visit-pickup.ts` 분리
- 페이지 미닫음 (사용자 결제 필요) → 워커에서 `page.close()` 스킵
- `VisitPickupTask` 타입 신규: `BookingTask`와 구조가 다름 (recipients 배열)
- 최소 건수 검증을 `bookOrders()` 전에 수행하여 상태 고착 방지

## 2026-04-02 — PR #29: 서버 대시보드 탭 구조 개편 (#28)

### 서버 대시보드 탭 재구성
- 기존: 대기(pending)/예약완료(booked)/발송완료(dispatched)/실패(failed)/전체
- 변경: **대기**(운송장 대기 중)/발송완료/실패(발송처리 실패)/전체
- `DispatchPanel` 제거 — 자동 모드 전용 운영, 수동 재처리 불필요
- 로컬 탭은 대기/예약완료/실패/전체 유지 (발송완료 서버전용 탭 제거)

### 기술적 결정
- `ServerFilter` 타입 신규: `waiting | dispatched | dispatch_failed` (OrderStatus와 구별)
  - `waiting` = `status === booked AND dispatchStatus !== dispatch_failed`
  - `dispatched` = `status === dispatched`
  - `dispatch_failed` = `status === booked AND dispatchStatus === dispatch_failed`
- 서버 모드 필터링을 클라이언트사이드로 처리 → API 변경 없음 (주문 수 적어 성능 문제 없음)
- `useOrders(undefined)` 쿼리 키 공유로 중복 API 호출 없음

## 2026-04-15 — 서버 배포 시간 단축 (standalone + 로컬 빌드)

### 문제
- 매 배포마다 서버에서 `npm run build` 실행 → 실측 22분+ 소요
- VM 메모리 제약(~1GB)으로 빌드 시 1.5GB swap 사용 → I/O wait 27~43%
- `git pull && npm run build && pm2 restart` 패턴은 저사양 환경에서 현실성 낮음

### 해결
- Next.js `output: "standalone"` 활성화 → 필요한 파일만 번들 (52MB)
- 빌드는 로컬(Mac)에서 수행, `.next/standalone` + `.next/static` + `public` 만 rsync로 서버 전송
- `scripts/deploy-fast.sh` 신규 (`npm run deploy`): 빌드 → rsync → symlink 보정 → PM2 startOrRestart
- `ecosystem.config.cjs`: `.next/standalone/server.js` 실행 방식으로 전환
- Linux용 `better_sqlite3.node`는 서버의 기존 `node_modules`에서 복사 — 재컴파일 스킵
- `data/`, `.env.local`은 `.next/standalone/` 내부에서 프로젝트 루트로 symlink (server.js의 `process.chdir(__dirname)` 대응)
- 배포 설정(`DEPLOY_SSH_HOST` 등)은 `.env.local`로 분리 → 스크립트에 호스트/경로 하드코딩 없음

### 결과
- **배포 총 시간: 22분+ → 21초 (약 63배)**
- 서버 부팅 시간: 7.5초 → 3.8초 (standalone 부팅이 더 가벼움)
- 서버에서 `npm run build` 완전 제거

### 기술적 결정
- `outputFileTracingExcludes`: `typescript`, `data/**`, 테스트 파일, `playwright-core/.local-browsers` 제외
- `serverExternalPackages`의 native 모듈(`better-sqlite3`, `playwright`)은 번들 제외 유지 — 플랫폼별 바이너리 처리 단순화
- PM2 `cwd`는 프로젝트 루트 유지 (로그 경로 불변), Node는 server.js에서 standalone 폴더로 chdir
- deploy-fast.sh는 `.env.local`의 `DEPLOY_*` 변수만 선택 로드 → 다른 변수 값의 공백 이슈 회피

## 2026-05-28 — PR #60: 방문택배 자동 발송처리 (#59)

### 폴링 합류 + 마스킹 매칭
- 일반택배와 달리 방문택배는 사용자가 직접 결제하므로 시스템이 결제 완료 시점을 자동
  인지하지 못했다 — 폼 입력 후 `status=booking`에서 영구히 멈춰 운송장 매칭 불가
- 기존 `dispatch-worker` 폴링(2분 간격, 11\~18시 KST)에 방문택배 매칭 단계를 합류
- GS 예약list에서 "구분=방문" 행을 찾고 상세페이지의 마스킹된 수신정보를
  **(우편번호 + 전화 끝 4자리)** 키로 로컬 그룹과 매칭 → `booked` 전환 → 같은 폴링에서
  일반 발송처리 흐름 합류

### 기술적 결정 (ADR-0001)
- **트리거 = 폴링만**: 방문택배 빈도 낮음 + 일반택배 폴링 패턴 이미 검증 → 별도 트리거 없이 합류
- **매칭 키 = (우편번호, 전화 끝 4자리)**: 한 방문택배 내 N명 수령인에서 사실상 unique →
  Cloudflare Turnstile 캡챠가 필요한 "숨김 해제" 자동화 회피
- `recoverStuckBookings`는 visit 그룹 제외 — booking 상태가 정상이므로 서버 재시작 시 보존
- 결제 페이지 자동화는 사용자 본인 책임으로 유지 (PG/카드 입력은 자동화 대상 아님)

### 산출물
- 신규 모듈: `src/lib/gs-delivery/scrape-visit-pickup.ts` (예약list 필터 + 상세페이지 마스킹 파서)
- 단위 테스트 9건 (HTML fixture 기반)
- ADR-0001 영구 결정 기록

## 2026-07-04 — PR #67: 윈도우 밖 수동 즉시 발송 버튼 (#66)

### 원버튼 복구 흐름
- 스크래핑 윈도우(8\~18시) 밖 예약은 자동 발송이 안 되고, 세션 idle 만료까지 겹쳐
  재로그인 → 스크래핑 → 서버 반영 → 발송을 수동으로 일일이 밟아야 했다
- 로컬 대시보드 "지금 발송처리" 버튼이 세션 실측 → (만료 시 로그인) → 윈도우 우회
  스크래핑 → 서버 즉시 발송을 한 번에 오케스트레이션
- 발송 로직을 `dispatchBookedGroups`로 추출해 워커(자동)와 수동 경로가 동일 코드 공유

### 기술적 결정 (ADR-0003)
- **서버 단독 발송 유지**: 트리거는 로컬(캡챠)이지만 발송은 서버가 단독 → 이중발송 방지 +
  로컬↔서버 역할 분리 유지
- **세션 live 프로브**: 쿠키 파일 나이가 아닌 실제 요청(200/302)으로 세션 실측 →
  파일 신선/세션 사망을 구분 못 하던 오판 제거
- **윈도우 게이트 우회**: `scrapeTrackingNumbers` 직접 호출로 시간대 무관 스크래핑

### 산출물
- 신규: `src/lib/gs-delivery/session.ts`(프로브), `api/dispatch/manual-now`(로컬 오케스트레이터),
  `api/internal/dispatch-now`(서버 즉시 발송)
- 단위 테스트 6건 (`dispatchBookedGroups`)
- ADR-0003 영구 결정 기록

## 2026-07-19 — 예약 후 1시간 하이브리드 스크래핑 + 수동발송 버튼 재연결

### 배경
- 절대 시각 윈도우(8\~18시)만으로는 밤·이른 아침 예약을 자동으로 못 잡음. 예약 직후는 GS
  세션이 살아있어 스크래핑 성공률이 가장 높은데, 그 창이 윈도우 밖이면 놓쳤다
- ADR-0003 수동 "지금 발송처리" 버튼이 이 케이스를 담당했으나 매번 수동 + 그 버튼이 든
  `DispatchPanel`이 #28 이후 어디에도 마운트되지 않아 실제로는 화면에서 쓸 수 없었다

### 하이브리드 스크래핑
- 스크래핑 게이트를 `isWithinScrapeWindow() || hasRecentlyBookedGroup()`로 변경 — 기존
  윈도우 유지 + 예약 후 1시간 이내 그룹이 있으면 시간 무관 스크래핑
- `orders.bookedAt` 컬럼 신설(예약 완료 최초 시각). booked 전환 지점 전부에서
  `COALESCE(booked_at, now)`로 1회만 기록 → 재동기화로 1시간 창이 밀리지 않게
- `DispatchPanel`을 로컬 대시보드에 재연결 — 자동화가 못 잡는 예외용 수동 백업으로 유지

### 기술적 결정 (ADR-0004)
- **상대 창 + 절대 윈도우 병행**: 1시간 내 미배정 건은 낮 윈도우가 이어받아 방치 없음.
  1시간 지나면 상대 창이 닫혀 booked 잔재에 대한 무한 스크래핑 방지
- **전용 컬럼 신설**: `updatedAt`은 후속 write마다 덮어써져 예약 시각으로 못 씀
- **방문택배는 범위 밖**: `booking` 상태라 `bookedAt`이 없어 절대 윈도우 유지

### 산출물
- `orders.bookedAt` 컬럼(런타임 `addColumnIfNotExists` 반영), `hasRecentlyBookedGroup`
  게이트, `DispatchPanel` 로컬 재연결
- 단위 테스트 4건 추가 (checkAndDispatch 시간 게이트, fake timer 기반)
- ADR-0004 영구 결정 기록

## 2026-07-30 — 서버 → 로컬 상태 역동기화 + 주문 삭제 기능

### 배경
- 서버가 이미 네이버 발송처리를 끝낸 주문이 로컬 화면에는 계속 "운송장 대기 중"으로 남았다.
  발송(운송장 스크래핑 + 네이버 발송처리)은 서버 단독 책임인데, 그 결과가 로컬로 돌아오는
  경로가 사실상 없었기 때문
- 유일한 역동기화 트리거(`resyncBookedOrders()`)가 **예약 큐 드레인 직후** = 서버가 운송장을
  잡기 몇 분 전에 호출돼 방금 예약한 배치는 항상 어긋났고, 이후 재호출도 없었다
- 동기화 버튼은 네이버 *발송대기* 주문만 가져오므로 이미 발송된 건은 응답에서 빠져 복구 불가
- 사용자가 수동으로 실패 처리해 치워둔 그룹은 `getLocalBookedOrders()`(booked만 조회) 대상
  밖이라 영구 고착
- 또한 동기화로 올라온 주문을 취소하고 싶어도 목록에서 지울 방법이 없었다

### 역동기화 (pull)
- 서버에 읽기 전용 조회 엔드포인트 신설: `POST /api/internal/order-state`
- 로컬 `reconcileFromServer()`가 미완결 그룹(booked/booking/failed, 최근 2주)을 서버에 물어
  로컬 DB를 정정 — 발송 관련 필드는 항상 서버가 진실
- 호출 지점 3곳: 동기화 버튼(네이버 조회 전), `manual-now` step 0(불필요한 GS 접근 차단),
  예약 큐 드레인 직후(지난 배치 회수)
- 상태 판정을 순수 모듈 `lib/order-lifecycle.ts`로 분리 — `lib/orders.ts`는 import 시 실제
  SQLite를 열기 때문에 정책만 떼어내 DB 없이 테스트
- 로컬 대시보드에 **발송완료 탭** 추가 — 역동기화로 생긴 dispatched가 조용히 사라지지 않게

### 주문 삭제
- `DELETE /api/orders/group` — 대기·예약완료·실패·건너뜀 삭제 가능. tombstone 없는 hard
  delete라 네이버에 남아 있는 주문은 다음 동기화에서 다시 수집됨
- 삭제를 서버까지 전파(`DELETE /api/internal/orders`) — 로컬에서만 지우면 서버 폴링이 계속
  추적해 발송해버린다
- 예약완료·실패는 삭제 직전 그 그룹만 역동기화 → 서버가 이미 발송했으면 거부(409) 후
  발송완료로 정정
- `booking`(워커가 잡고 있음)·`dispatched`(복구 불가)는 삭제 제외
- 확인 다이얼로그에 "GS택배 예약·네이버 주문은 취소되지 않음" 명시

### 기술적 결정 (ADR-0005)
- **pull 방식 채택**: 로컬 Mac은 공개 주소가 없어 서버 → 로컬 push(웹훅)가 불가.
  사용자 행동(동기화/발송 버튼)에 역동기화를 얹는 방식이 로컬 폴링보다 싸고 확실
- **그룹 전체 dispatched만 인정**: 부분 발송을 완료로 오인하지 않도록
- **hard delete**: soft delete면 네이버 재수집이 tombstone에 막힘

### 산출물
- 신규: `lib/order-lifecycle.ts`(순수 정책), `api/internal/order-state`(서버 조회),
  `api/internal/orders`(삭제 전파), `components/DeleteOrderDialog.tsx`
- 단위 테스트 19건 (`order-lifecycle.test.ts`) + 실 DB 복사본 대상 통합 검증(일회성)
- ADR-0005 영구 결정 기록

---

## 2026-08-10 — 역동기화 사각지대 해소: 자동 트리거 + 네이버 원천 대조

ADR-0005의 pull 역동기화를 운영하면서 드러난 두 공백을 메웠다. 서버가 발송의 **주체**인 건
맞지만 발송 기록의 **유일한 보관처**는 아니라는 게 핵심 인식 — 최종 원천은 네이버다.

### 트리거 공백
- 역동기화가 사용자 행동(동기화 버튼 등) 3곳에서만 돌아, 서버가 발송처리해도 버튼을 누르기
  전까지 로컬은 계속 "예약완료"로 표시했다
- `POST /api/orders/reconcile` 신설 — 네이버 조회를 빼고 서버 대조만 하는 경량 엔드포인트
- 대시보드가 2분 주기 + 탭 복귀 시 자동 호출 (`useReconcileFromServer`).
  반영된 건이 있을 때만 목록을 무효화하고 토스트로 알린다

### 원천 공백
- 대조 대상의 `createdAt` 2주 필터 제거 — 그 창을 벗어난 미완결 그룹은 어떤 경로로도
  정리되지 않았다. 대신 서버 상한(300건)에 맞춰 청크로 나눠 조회
- 창을 걷어내도 **서버 DB에 기록이 없는 그룹**(서버 도입 이전 예약)은 남는다 → 네이버에 직접
  조회하는 `reconcileStaleFromNaver()` 추가. 24시간 이상 묵고 운송장도 없는 예약완료 그룹만
  대상으로, 동기화 버튼에서만 실행 (2분 폴링에 넣으면 무의미한 외부 호출이 하루 720회)
- 판정은 보수적으로: 발송 이후 상태가 있고 발송 전 상태가 하나도 없을 때만 확정.
  취소·반품만 남은 그룹은 건드리지 않는다
- 도입 시점에 남아 있던 10개 그룹이 네이버 기준 운송장·발송일과 함께 발송완료로 정리됨

### UI 정리
- "운송장 대기 중" 목록을 로컬 대시보드에서 제거 (#68에서 "지금 발송처리" 버튼을 붙이며
  딸려 들어왔던 것). 버튼은 `ManualDispatchButton`으로 분리해 헤더로 이동
- `DispatchPanel`은 발송 실패 재처리 전용으로 축소 — 워커가 `dispatch_failed`를 재시도
  대상에서 제외하므로 이 버튼이 실패 그룹의 유일한 복구 경로다

### 산출물
- 신규: `api/orders/reconcile`, `lib/naver/reconcile.ts`, `components/ManualDispatchButton.tsx`
- 단위 테스트 10건 추가 (네이버 그룹 판정 6건, 청크 분할·부분 실패 4건)
- ADR-0006 영구 결정 기록
