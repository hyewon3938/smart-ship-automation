# Smart Ship Automation

## 프로젝트 개요

네이버 스마트스토어 발송대기 주문을 GS편의점 택배(cvsnet.co.kr)에 자동으로 예약하고,
운송장번호 확인 후 네이버에 자동 발송처리까지 수행하는 로컬+서버 하이브리드 웹 앱.

### 운영 흐름
```
[로컬 Mac]                              [Oracle Cloud 서버]
택배 예약 (Playwright headed)            운송장 스크래핑 (HTTP fetch)
  → GS택배 로그인 + 예약                   → 쿠키 기반 예약조회
  → 쿠키/주문 데이터 서버 동기화             → 운송장번호 추출
                                          → 네이버 API 자동 발송처리
                                          → 배송상태 추적
```

### 핵심 기능
- 네이버 커머스 API로 발송대기 주문 조회 → 리스트 표시
- 주문 선택 후 GS택배 사이트에 Playwright로 자동 예약 (로컬)
- 국내택배 / 내일배송 택배 유형 선택 (내일배송 가능 지역 자동 판별)
- 서버에서 운송장번호 자동 스크래핑 → 네이버 발송처리 (11시~18시 KST)
- 로컬 → 서버 자동 동기화 (쿠키, 주문 데이터, 예약 결과)
- PWA 대시보드 (모바일 홈화면 설치 가능)

### 기술 스택
- **Framework:** Next.js 16 (App Router) + TypeScript
- **UI:** Tailwind CSS + shadcn/ui
- **자동화:** Playwright (로컬 headed 모드) + HTTP fetch (서버 스크래핑)
- **DB:** SQLite (better-sqlite3 + Drizzle ORM) — 로컬/서버 별도
- **Data Fetching:** TanStack Query
- **배포:** Oracle Cloud VM + PM2 + Caddy (자동 HTTPS)
- **테스트:** Vitest (핵심 로직만)

## 아키텍처

### 로컬 ↔ 서버 역할 분리

| 역할 | 로컬 (`DEPLOY_MODE=local`) | 서버 (`DEPLOY_MODE=server`) |
|------|---------------------------|---------------------------|
| GS택배 로그인 | ✅ Playwright headed (캡챠 수동) | ❌ 불가 (Cloudflare Turnstile) |
| 택배 예약 | ✅ Playwright 자동화 | ❌ |
| 운송장 스크래핑 | - | ✅ HTTP fetch + 쿠키 (11~18시) |
| 네이버 발송처리 | - | ✅ 자동 (dispatch-worker) |
| DB | 로컬 SQLite | 서버 SQLite (별도) |

### 동기화 메커니즘

```
로컬 예약 완료
  ├→ POST /api/internal/cookies      (쿠키 → 서버)
  └→ POST /api/internal/booking-result (주문 데이터 upsert → 서버)

서버 폴링 (2분 간격, 11~18시 KST만 스크래핑)
  ├→ scrapeTrackingNumbers()  (HTTP fetch + 쿠키 헤더)
  ├→ updateTrackingNumbers()  (운송장번호 DB 저장)
  ├→ dispatchOrders()         (네이버 API 발송처리)
  └→ fetchDeliveryStatuses()  (배송상태 추적)
```

### 쿠키 관리
- 로컬에서 GS택배 로그인 시 `data/cookies.json` 저장 → 서버 자동 동기화
- 서버는 쿠키로 HTTP fetch (Playwright 불필요, Cloudflare 우회)
- GS택배 세션 만료 시 로컬에서 재로그인 필요 (수시간 유효)
- 운영 팁: 택배 예약 직전에 로그인하면 쿠키 동기화 → 스크래핑 성공률 최대

## 디렉토리 구조

```
src/
├── app/              # Next.js App Router (페이지, API 라우트)
│   ├── api/          # REST API 엔드포인트
│   │   └── internal/ # 로컬↔서버 동기화 API (cookies, booking-result, tracking)
│   └── settings/     # 설정 페이지
├── components/       # React 컴포넌트
│   └── ui/           # shadcn/ui (자동 생성)
├── lib/              # 비즈니스 로직
│   ├── naver/        # 네이버 커머스 API 클라이언트
│   ├── gs-delivery/  # GS택배 자동화 (Playwright + HTTP 스크래핑)
│   ├── db/           # SQLite + Drizzle ORM
│   ├── dispatch-worker.ts  # 서버 폴링 워커 (운송장 감지 + 발송처리)
│   └── sync-to-server.ts   # 로컬→서버 동기화 유틸
└── types/            # 공유 타입 정의

docs/                 # 프로젝트 문서
data/                 # SQLite DB + cookies.json (gitignore)
.claude/commands/     # 개발 워크플로우 스킬
```

## 개발 규칙 요약

상세 내용은 `docs/conventions.md` 참조.

- **네이밍:** 컴포넌트=PascalCase, 함수/변수=camelCase, 상수=UPPER_SNAKE_CASE, DB컬럼=snake_case
- **커밋:** Conventional Commits (`feat(scope): 설명`)
- **브랜치:** `<type>/<이슈번호>-<설명>` (예: `feat/3-naver-api-integration`)
- **PR:** 1 이슈 = 1 브랜치 = 1 PR, Squash and Merge
- **타입:** `strict: true`, `any` 금지, zod로 외부 데이터 파싱
- **레이어:** API 라우트 → lib/ 서비스 함수 → DB. API 라우트에서 직접 DB 쿼리 금지

## Claude 작업 규칙

### 개발 워크플로우
```
기능 개발: /design → /compact → /model sonnet → /build
소규모 수정: /design이 자동 판단하여 직접 처리
코드 리뷰만: /review-code
```

### 반드시 지킬 것
- **변경 전 기존 코드를 반드시 읽고 이해할 것**
- 커밋이 3~5개 쌓이거나 주제가 바뀌면 커밋/브랜치/PR 제안할 것
- 하나의 브랜치에 다른 기능이 섞이면 PR 머지 후 새 브랜치 전환 권유
- 기능 추가 시 테스트 가능하면 테스트 코드 작성 + 실행
- PR/커밋에 민감한 env 정보 포함 금지
- `docs/project-history.md`에 주요 변경사항 기록

### 보안 규칙
- `.env.local`에 모든 크리덴셜 저장. 코드에 하드코딩 절대 금지
- API 키, 비밀번호는 로그에 출력하지 않음
- `.env.local.example`만 커밋 (실제 값은 플레이스홀더)

## 주요 외부 서비스

### 네이버 커머스 API
- 인증: OAuth 2.0 + bcrypt 기반 client_secret_sign
- 토큰 엔드포인트: `POST https://api.commerce.naver.com/external/v1/oauth2/token`
- 주문 조회: 조건형 API로 7일간 PAYED 주문 스캔 → 로컬 DB에 누적 저장
- 발송처리: 운송장번호 + 택배사 코드(`CJGLS`)로 자동 발송
- Rate Limit: 토큰 버킷 알고리즘, 429 시 지수 백오프

### GS택배 (cvsnet.co.kr)
- API 없음 → Playwright 브라우저 자동화 (로컬 예약) + HTTP fetch (서버 스크래핑)
- 로그인: Cloudflare Turnstile 캡챠 → 로컬 headed 모드에서만 가능
- 국내택배 예약: cvsnet.co.kr/reservation-inquiry/domestic/index.do
- 예약조회 (운송장 확인): cvsnet.co.kr/reservation-inquiry/list (HTTP fetch)
- 내일배송 가능 지역: 서울 전체, 인천(계양/남동/부평/연수구), 경기(고양/광명/군포/부천/성남/수원/안산/안양시)
- 택배사 코드: `CJGLS` (CJ대한통운 — GS편의점택배 실제 배송사)
- GS택배 예약번호 ≠ CJ 운송장번호 (예약번호는 GS 내부, 운송장번호가 실제 배송 추적번호)

## 실행 방법

### 로컬 개발
```bash
npm install
npx playwright install
npm run dev
# http://localhost:3000 접속
```

### 서버 배포
```bash
ssh -i ~/.ssh/slack-ai-agents.key ubuntu@140.245.69.231 \
  "cd smart-ship-automation && git pull && npm run build && pm2 restart smart-ship"
```

### 환경 변수 (`.env.local`)
```
# 공통
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...

# 로컬 전용
DEPLOY_MODE=local
SERVER_URL=https://ship.leecommit.kr
INTERNAL_API_KEY=...

# 서버 전용
DEPLOY_MODE=server
INTERNAL_API_KEY=...
```
