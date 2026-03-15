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
- **상태:** 예정
- **내용:** OAuth 인증, 발송대기 주문 조회, 로컬 DB 동기화

### Phase 3: 대시보드 UI
- **상태:** 예정
- **내용:** 주문 테이블, 선택/예약 UI, 상태 폴링

### Phase 4: GS택배 Playwright 자동화
- **상태:** 예정
- **내용:** 로그인, 국내택배/내일배송 예약 폼 자동화

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
