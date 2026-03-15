# Smart Ship Automation - 코드 컨벤션

## 핵심 원칙 (Stable Rules)

### 네이밍 규칙

| 대상 | 규칙 | 예시 | 근거 |
|------|------|------|------|
| 파일 (컴포넌트) | PascalCase | `OrderTable.tsx` | React 컴포넌트 네이밍 관례 |
| 파일 (유틸/라이브러리) | camelCase | `auth.ts`, `regions.ts` | Node.js 생태계 관례 |
| 파일 (Next.js 라우트) | kebab-case (폴더) | `api/orders/sync/route.ts` | Next.js App Router 규칙 |
| 변수/함수 | camelCase | `fetchOrders`, `isNextDayEligible` | TypeScript 표준 |
| 상수 | UPPER_SNAKE_CASE | `NEXT_DAY_ELIGIBLE_AREAS` | 불변값 명확히 구분 |
| 타입/인터페이스 | PascalCase | `Order`, `BookingResult` | TypeScript 관례 |
| DB 컬럼 | snake_case | `product_order_id` | SQL 표준 관례 |
| 환경변수 | UPPER_SNAKE_CASE | `NAVER_CLIENT_ID` | dotenv 관례 |

### 커밋 메시지 컨벤션

Conventional Commits 기반:

```
<type>(<scope>): <description>

[optional body]
```

**타입:**
- `feat`: 새 기능 추가
- `fix`: 버그 수정
- `refactor`: 기능 변경 없는 코드 구조 개선
- `style`: 코드 포맷팅 (동작 변경 없음)
- `docs`: 문서 변경
- `test`: 테스트 추가/수정
- `chore`: 빌드, 설정, 의존성 등 기타

**스코프:** `naver`, `gs-delivery`, `ui`, `db`, `settings`, `config`

**예시:**
```
feat(naver): 발송대기 주문 동기화 구현
fix(gs-delivery): 국내택배 예약 폼 주소 입력 오류 수정
refactor(db): orders 테이블 스키마 마이그레이션 추가
```

**근거:** 커밋 히스토리에서 변경 성격과 영향 범위를 즉시 파악 가능

### 보안 규칙

- `.env.local`에 모든 크리덴셜 저장. 절대 코드에 하드코딩 금지
- `.env.local`은 `.gitignore`에 포함. `.env.local.example`만 커밋
- API 키, 비밀번호 등은 로그에 출력하지 않음
- GS택배 로그인 정보는 로컬 SQLite에 저장 (settings 테이블)

**근거:** 개인 프로젝트여도 실수로 크리덴셜이 GitHub에 올라가면 복구 불가

### 테스트 원칙

- **테스트 대상:** 핵심 유틸리티 함수 (bcrypt 서명 생성, 내일배송 지역 판별, 주소 파싱)
- **테스트 도구:** Vitest
- **테스트 파일 위치:** 소스 파일 옆 (`auth.test.ts`, `regions.test.ts`)
- **커버리지 기준:** 설정하지 않음 (핵심 로직만 선택적 테스트)

**근거:** Playwright 자동화는 외부 사이트 의존이라 E2E 테스트 불가. 순수 로직만 테스트

### 가독성 원칙

- 함수는 하나의 역할만 수행
- 3번 이상 반복되면 추출 고려 (단, 2번은 인라인 유지)
- 매직 넘버 금지 → 상수로 추출 (예: `const MAX_BATCH_SIZE = 300`)
- 주석은 "왜"를 설명할 때만 사용. "무엇"은 코드 자체로 표현

---

## 프로젝트 적응 규칙 (Evolving Rules)

### 디렉토리 구조

```
src/
├── app/           # Next.js App Router (페이지, API 라우트)
├── components/    # React 컴포넌트
│   └── ui/        # shadcn/ui 컴포넌트 (자동 생성)
├── lib/           # 비즈니스 로직, 외부 서비스 연동
│   ├── naver/     # 네이버 커머스 API
│   ├── gs-delivery/ # GS택배 Playwright 자동화
│   └── db/        # SQLite + Drizzle
└── types/         # 공유 타입 정의
```

**근거:** Next.js App Router 관례를 따르되, 비즈니스 로직은 `lib/`에 분리하여 API 라우트를 얇게 유지

### 추상화 수준 기준

- **헬퍼 생성 기준:** 3곳 이상에서 동일 패턴 사용 시
- **인라인 유지:** 한두 곳에서만 사용하는 로직
- **레이어 분리:** API 라우트 → 서비스 함수(lib/) → DB 쿼리. API 라우트에서 직접 DB 쿼리 금지

**근거:** 1인 프로젝트라 과도한 추상화는 오버. 단, 레이어 분리는 테스트와 유지보수에 필수

### import 정렬

```typescript
// 1. React/Next.js
import { useState } from 'react';
import { NextRequest } from 'next/server';

// 2. 외부 라이브러리
import { eq } from 'drizzle-orm';

// 3. 내부 모듈 (@/ alias)
import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';

// 4. 타입 (type-only import)
import type { Order } from '@/types';
```

**근거:** 의존성 방향을 한눈에 파악 가능

### 에러 핸들링 패턴

- **API 라우트:** try/catch로 감싸고 적절한 HTTP 상태 코드 반환
- **Playwright 자동화:** 각 단계별 try/catch + 실패 시 스크린샷 저장
- **네이버 API:** 토큰 만료 시 자동 재발급, 429(Rate Limit) 시 지수 백오프
- **사용자 알림:** 에러 발생 시 토스트로 표시, 상세 내용은 로그 페이지에서 확인

**근거:** 외부 서비스(네이버 API, cvsnet.co.kr) 의존도가 높아 에러 대응이 핵심

### TypeScript 설정

- `strict: true` 사용
- `any` 사용 금지 (외부 API 응답은 zod로 파싱)
- `as` 타입 단언 최소화 → 타입 가드 또는 zod 사용

**근거:** 주문 데이터 다루는 앱이라 타입 안전성이 직접적으로 버그 방지

---

## 리팩토링 기준

### 리팩토링 트리거

| 조건 | 액션 | 우선순위 |
|------|------|----------|
| 동일 코드 3회 이상 반복 | 공통 함수/컴포넌트 추출 | 높음 |
| 함수 50줄 초과 | 역할별 분리 | 중간 |
| 파일 300줄 초과 | 모듈 분리 | 중간 |
| Playwright 셀렉터 5개 이상 하드코딩 | 셀렉터 상수 파일 분리 | 낮음 |
| API 라우트에서 직접 DB 쿼리 | lib/ 서비스 함수로 추출 | 높음 |

### 지금 고칠 것 vs 나중에 고칠 것

- **지금:** 보안 이슈, 타입 에러, 명확한 버그
- **나중에:** 성능 최적화 (측정 후 판단), UI 디자인 개선, 코드 스타일 통일
- **하지 않을 것:** 사용하지 않는 코드에 대한 리팩토링, 가설적 미래 요구사항 대응

### 규모 변화 시 재검토 포인트

이 프로젝트가 다음 상황이 되면 컨벤션 재검토:
- 다른 택배 서비스 추가 시 → `lib/` 하위 모듈화 전략 재검토
- 멀티 유저 지원 시 → 인증/권한 레이어, DB 구조 재검토
- 배포 환경 변경 시 → 환경변수 관리, 빌드 설정 재검토

---

## 브랜치 전략

### 전략: Trunk-Based Development (간소화)

**근거:** 1인 개발 프로젝트라 Git Flow는 오버. main 브랜치를 기반으로 기능 브랜치를 만들고 PR로 병합하는 단순한 구조가 적합.

### 브랜치 네이밍

```
<type>/<이슈번호>-<간단한설명>
```

| 타입 | 용도 | 예시 |
|------|------|------|
| `feat/` | 새 기능 | `feat/3-naver-api-integration` |
| `fix/` | 버그 수정 | `fix/12-address-parsing-error` |
| `refactor/` | 코드 개선 | `refactor/8-extract-booking-service` |
| `chore/` | 설정/의존성 | `chore/1-project-setup` |
| `docs/` | 문서 | `docs/5-api-usage-guide` |

### 워크플로우

```
main (항상 안정)
  └── feat/3-naver-api → PR → main에 병합
  └── feat/7-dashboard-ui → PR → main에 병합
```

### PR 규칙

- **1 이슈 = 1 브랜치 = 1 PR** (scope creep 방지)
- PR 제목은 커밋 메시지 컨벤션과 동일한 형식
- 머지 방식: Squash and Merge (커밋 히스토리 깔끔하게 유지)
- `/build` 스킬이 코드 리뷰 체크리스트 실행 후 PR 생성

---

## GitHub 라벨 사용 가이드

| 라벨 | 용도 | 색상 |
|------|------|------|
| `feat` | 새 기능 | #1D76DB |
| `bug` | 버그 수정 | #D73A4A |
| `refactor` | 코드 구조 개선 | #A2EEEF |
| `docs` | 문서 추가/수정 | #0075CA |
| `chore` | 설정, 의존성, 빌드 등 | #E4E669 |
| `test` | 테스트 추가/수정 | #BFD4F2 |
| `ui` | UI/UX 관련 | #D4C5F9 |
| `naver-api` | 네이버 커머스 API 관련 | #2EA44F |
| `gs-delivery` | GS택배 자동화 관련 | #F9D0C4 |
| `priority:high` | 높은 우선순위 | #B60205 |
| `priority:medium` | 중간 우선순위 | #FBCA04 |
| `priority:low` | 낮은 우선순위 | #0E8A16 |

**라벨 조합 예시:**
- 네이버 주문 동기화 기능: `feat` + `naver-api` + `priority:high`
- GS택배 예약 폼 셀렉터 깨짐: `bug` + `gs-delivery` + `priority:high`
- 대시보드 테이블 디자인 개선: `ui` + `priority:low`
