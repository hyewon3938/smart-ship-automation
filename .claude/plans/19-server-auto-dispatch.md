# 서버 자동 발송처리 - 운송장 스크래핑 + 네이버 발송 자동화

## 이슈
- 번호: #19
- 브랜치: feat/19-server-auto-dispatch
- 선행: PR #18 병합 후 main에서 분기

## 개요
서버(Oracle Cloud VM)에서 GS택배 운송장번호를 5분마다 자동 스크래핑하고,
운송장 확인 시 네이버 발송처리 API를 자동 호출하는 전체 자동화 파이프라인.

feat/7-dispatch-automation 브랜치의 기존 코드를 가져와서 서버 자동화로 통합한다.

## 기존 코드 재사용 (feat/7-dispatch-automation)

| 파일 | 설명 | 수정 필요 |
|------|------|----------|
| `src/lib/gs-delivery/scrape-tracking.ts` | GS택배 운송장 스크래핑 | 없음 |
| `src/lib/naver/dispatch.ts` | 네이버 발송처리 API | 택배사 코드 수정 필요 |
| `src/lib/dispatch-worker.ts` | 폴링 + 자동 발송 워커 | 없음 |
| `src/lib/gs-delivery/selectors.ts` | RESERVATION_LIST 셀렉터 | 이미 추가됨 |
| `src/lib/orders.ts` | getBookedOrderGroups 등 추가 함수 | 없음 |
| `src/lib/db/schema.ts` | tracking_number, dispatch_status 컬럼 | 이미 추가됨 |
| `src/app/api/dispatch/route.ts` | 수동 발송처리 API | 없음 |
| `src/app/api/dispatch/sync-tracking/route.ts` | 수동 운송장 동기화 API | 없음 |
| `src/app/api/dispatch/settings/route.ts` | 발송처리 설정 API | 없음 |
| `src/components/DispatchPanel.tsx` | 발송 상태 UI | 없음 |
| `src/components/settings/DispatchSettingsTab.tsx` | 설정 UI | 없음 |
| `src/hooks/useDispatch.ts` | 발송처리 React 훅 | 없음 |
| `src/types/index.ts` | DispatchStatus 타입 | 없음 |

## 변경 파일 목록 (신규)

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/instrumentation.ts` | 신규 | 서버 시작 시 자동 폴링 시작 |
| `src/lib/naver/dispatch.ts` | 수정 | GS편의점택배 배송사 코드 설정 |
| `next.config.ts` | 수정 | instrumentation 활성화 |

## 구현 상세

### 1. feat/7-dispatch-automation 코드 가져오기

```bash
# PR #18 병합 후 main에서 분기
git checkout main && git pull
git checkout -b feat/19-server-auto-dispatch

# feat/7-dispatch-automation에서 커밋 cherry-pick
git cherry-pick c989453 cf85871 4e2875e e3f65bb 53ed2ac
```

충돌 발생 시 현재 main 코드 기준으로 해결한다.
cherry-pick 대신 수동으로 파일을 복사해도 된다.

### 2. 네이버 발송처리 택배사 코드 수정

**파일:** `src/lib/naver/dispatch.ts`

**Before:**
```typescript
export const DELIVERY_COMPANY_CODES = {
  domestic: "CJGLS",        // CJ대한통운
  nextDay: "DELIVERBOX",    // 딜리박스
} as const;
```

**After:**
```typescript
export const DELIVERY_COMPANY_CODES = {
  domestic: "GSPOSTBOX",    // GS편의점택배 (국내택배)
  nextDay: "GSPOSTBOX",     // GS편의점택배 (내일배송도 동일)
} as const;
```

**설명:** GS택배(cvsnet.co.kr)는 네이버 API에서 "GSPOSTBOX" 코드로 등록되어 있다.
구현 시 네이버 커머스 API 문서에서 정확한 코드를 재확인할 것.
https://apicenter.commerce.naver.com 의 택배사 코드 목록 참조.

### 3. 서버 자동 시작 (instrumentation.ts)

**파일:** `src/instrumentation.ts` (신규)

```typescript
export async function register() {
  // 서버 모드에서만 자동 폴링 시작
  if (process.env.DEPLOY_MODE === "server") {
    const { startDispatchPolling } = await import("@/lib/dispatch-worker");
    startDispatchPolling();
    console.log("[instrumentation] 서버 모드 — 발송처리 폴링 자동 시작");
  }
}
```

**설명:**
- Next.js `instrumentation.ts`는 서버 프로세스 시작 시 1회 호출됨
- `DEPLOY_MODE=server`일 때만 자동 폴링 시작
- 로컬(DEPLOY_MODE=local)에서는 폴링 미시작 → 기존 동작 유지
- dynamic import로 서버 전용 모듈 로딩

**파일:** `next.config.ts` (수정)

```typescript
experimental: {
  instrumentationHook: true,
},
```

Next.js 16에서는 `instrumentationHook` 설정 없이도 동작할 수 있음.
빌드 시 에러 나면 해당 옵션 추가.

### 4. 발송처리 설정 함수 확인

**파일:** `src/lib/settings.ts`

feat/7 브랜치에서 가져올 함수:
```typescript
/** 발송처리 자동 모드 여부 (기본: true) */
export function isDispatchAutoMode(): boolean;

/** 발송처리 폴링 간격 (기본: 5분) */
export function getDispatchPollIntervalMs(): number;

/** 내일배송 택배사 코드 (기본: GSPOSTBOX) */
export function getNextDayDeliveryCode(): string;
```

설정 키: `dispatch.autoMode`, `dispatch.pollIntervalMs`, `dispatch.nextDayDeliveryCode`

### 5. 서버 배포 업데이트

VM에서:
```bash
cd ~/smart-ship-automation
git fetch origin
git checkout feat/19-server-auto-dispatch  # 또는 main 병합 후
npm ci && npm run build
npx drizzle-kit push  # 스키마 변경 시
pm2 restart smart-ship
```

## 커밋 계획

1. `feat(dispatch): GS택배 운송장 스크래핑 + 네이버 발송처리 API`
   - cherry-pick 또는 수동 복사: scrape-tracking.ts, dispatch.ts, orders.ts 추가 함수, types, selectors 추가
2. `feat(dispatch): 발송처리 폴링 워커 + API 라우트`
   - dispatch-worker.ts, route.ts, sync-tracking/route.ts, settings/route.ts
3. `feat(ui): 발송처리 패널 + 설정 UI`
   - DispatchPanel.tsx, DispatchSettingsTab.tsx, useDispatch.ts, Dashboard/Settings 연동
4. `feat(dispatch): 서버 자동 시작 + 택배사 코드 수정`
   - instrumentation.ts, dispatch.ts 택배사 코드 수정, next.config.ts

## 테스트 계획

- [ ] vitest 기존 테스트 통과
- [ ] 로컬(DEPLOY_MODE=local): 폴링 자동시작 안 됨 확인
- [ ] 서버(DEPLOY_MODE=server): 앱 시작 시 "[instrumentation] 서버 모드 — 발송처리 폴링 자동 시작" 로그 확인
- [ ] 수동 운송장 동기화 API (POST /api/dispatch/sync-tracking) 정상 응답
- [ ] 수동 발송처리 API (POST /api/dispatch) 정상 응답
- [ ] 서버 대시보드 발송 패널 표시 + 수동 버튼 동작
- [ ] GS택배 쿠키 만료 시 에러 로그 출력 (크래시 없이 graceful)
- [ ] PM2 재시작 후 폴링 자동 재개

## 체크리스트
- [ ] 프로젝트 컨벤션 규칙 준수
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인
- [ ] 에러 핸들링 포함
- [ ] 네이버 API 택배사 코드 "GSPOSTBOX" 정확성 확인 필요

## 프로젝트 히스토리 기록

### Phase 7: 서버 자동 발송처리
- GS택배 운송장번호 5분 주기 자동 스크래핑 (headless Playwright + 쿠키)
- 운송장 확인 시 네이버 발송처리 API 자동 호출
- Next.js instrumentation으로 서버 시작 시 자동 폴링
- 대시보드 발송 패널 + 수동 트리거 UI
- 기술 결정: instrumentation.ts (서버 프로세스 내 setInterval) vs 외부 cron → 단일 프로세스 관리 선택
