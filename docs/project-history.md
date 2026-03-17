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
