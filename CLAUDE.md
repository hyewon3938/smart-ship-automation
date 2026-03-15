# Smart Ship Automation

## 프로젝트 개요

네이버 스마트스토어 발송대기 주문을 GS편의점 택배(cvsnet.co.kr)에 자동으로 예약하는 로컬 웹 앱.
주문건마다 수동으로 주소/수령자 정보를 입력하는 반복 작업을 자동화한다.

### 핵심 기능
- 네이버 커머스 API로 발송대기 주문 조회 → 리스트 표시
- 주문 선택 후 GS택배 사이트에 Playwright로 자동 예약
- 국내택배 / 내일배송 택배 유형 선택 (내일배송 가능 지역 자동 판별)

### 기술 스택
- **Framework:** Next.js 15 (App Router) + TypeScript
- **UI:** Tailwind CSS + shadcn/ui
- **자동화:** Playwright (headed 모드)
- **DB:** SQLite (better-sqlite3 + Drizzle ORM)
- **Data Fetching:** TanStack Query
- **테스트:** Vitest (핵심 로직만)

## 디렉토리 구조

```
src/
├── app/              # Next.js App Router (페이지, API 라우트)
│   ├── api/          # REST API 엔드포인트
│   └── settings/     # 설정 페이지
├── components/       # React 컴포넌트
│   └── ui/           # shadcn/ui (자동 생성)
├── lib/              # 비즈니스 로직
│   ├── naver/        # 네이버 커머스 API 클라이언트
│   ├── gs-delivery/  # GS택배 Playwright 자동화
│   └── db/           # SQLite + Drizzle ORM
└── types/            # 공유 타입 정의

docs/                 # 프로젝트 문서
data/                 # SQLite DB 파일 (gitignore)
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
- 주문 조회: 최근 24시간 변경분만 조회 가능 → 로컬 DB에 누적 저장
- Rate Limit: 토큰 버킷 알고리즘, 429 시 지수 백오프

### GS택배 (cvsnet.co.kr)
- API 없음 → Playwright 브라우저 자동화
- 로그인: cvsnet.co.kr/member/login/index.do
- 국내택배 예약: cvsnet.co.kr/reservation-inquiry/domestic/index.do
- 내일배송 가능 지역: 서울 전체, 인천(계양/남동/부평/연수구), 경기(고양/광명/군포/부천/성남/수원/안산/안양시)

## 실행 방법

```bash
npm install
npx playwright install
npm run dev
# http://localhost:3000 접속
```
