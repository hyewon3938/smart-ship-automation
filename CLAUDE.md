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
- 국내택배 / 내일배송 택배 유형 선택 (제주·도서 제외 지역 자동 판별)
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
.claude/worktrees/    # 세션별 git worktree (gitignore)
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

### 작업 방식

워크플로우 스킬은 사용자 레벨(`~/.claude/skills/`)에 설치한 것을 쓴다.

- **기획:** `/design`이 설계 문서와 이슈를 만들고, 작업을 세션으로 나눠 대기열에 넣는다
- **구현:** 새 세션에서 `/next`로 대기열 맨 앞 세션을 열거나 `/build <세션 이름>`으로 고른 세션을 연다. 대기열에 넣지 않은 작은 수정은 `/build #<이슈번호>`로 바로 연다
- **배포 뒤 확인:** `/track`으로 `LOCAL-TRACK.md`의 확인 항목을 처리한다
- **코드 리뷰만:** `/review-code`
- **세션 단위:** 세션 하나는 이슈 1개, 브랜치 1개, PR 1개다. 이슈부터 만들고, `.claude/worktrees/` 아래 이름 붙인 worktree에서 진행한다
- **로컬 파일:** 대기열 `LOCAL-SESSIONS.md`와 배포 뒤 확인 목록 `LOCAL-TRACK.md`는 커밋하지 않는다. 둘 다 메인 체크아웃 루트에만 있으므로 worktree 안에서 작업할 때도 그 경로의 파일을 읽고 고친다

### 반드시 지킬 것
- **변경 전 기존 코드를 반드시 읽고 이해할 것**
- 작업 중에 세션 범위 밖의 일이 생기면 이슈를 따로 만들어 다른 세션에서 진행하길 제안할 것
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
- 주문 조회: 조건형 API로 14일간 PAYED 주문 스캔 → 로컬 DB에 누적 저장.
  조회창은 **결제일** 기준이라 선물하기처럼 배송지가 늦게 채워지는 건도 결제일로만 잡힌다
- 발송처리: 운송장번호 + 택배사 코드(`CJGLS`)로 자동 발송
- Rate Limit: 토큰 버킷 알고리즘, 429 시 지수 백오프

### GS택배 (cvsnet.co.kr)
- API 없음 → Playwright 브라우저 자동화 (로컬 예약) + HTTP fetch (서버 스크래핑)
- 로그인: Cloudflare Turnstile 캡챠 → 로컬 headed 모드에서만 가능
- 국내택배 예약: cvsnet.co.kr/reservation-inquiry/domestic/index.do
- 예약조회 (운송장 확인): cvsnet.co.kr/reservation-inquiry/list (HTTP fetch)
- 내일배송 가능 지역: 전국 (2026-09 권역 확대). 제주(우편번호 63000~63644)와 배로 들어가는
  섬만 제외 — 판별은 `src/lib/naver/regions.ts`, 제외 목록은 예약이 거절된 지역이 나오면 추가
- 신규 주문의 기본 배송 유형은 국내택배. 내일배송은 목록에서 직접 고른다 (요금 판단을 남기기 위함)
- 택배사 코드: `CJGLS` (CJ대한통운 — 국내택배·내일배송 모두 같은 배송사)
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
# 호스트/키는 ~/.ssh/config 또는 로컬 환경에서 관리
ssh <server> \
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
