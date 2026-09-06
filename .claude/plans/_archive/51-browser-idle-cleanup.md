# fix(gs-delivery): Playwright 브라우저 idle 시 메모리 누수

## 이슈
- 번호: #51
- 브랜치: `fix/51-browser-idle-cleanup`

## 개요
GS택배 예약 작업 완료 후 Playwright Chromium 인스턴스가 정리되지 않아 메모리에 잔존. idle 타임아웃 자동 종료 + visit-pickup 페이지 close 이벤트 + graceful shutdown 3가지 안전장치로 정상 경로 + 사용자 정리 + 프로세스 종료 모두 커버.

## 원인 분석

### Browser 인스턴스 lifecycle 현황

`src/lib/gs-delivery/browser.ts`에서 module-level singleton으로 `browser`/`context`를 관리.

| `closeBrowser()` 호출 케이스 | 호출 안 되는 케이스 |
|---|---|
| 브라우저 크래시 + 예외 (`worker.ts:75`) | **예약 성공 시** (`worker.ts:155` return) |
| `cancelBooking()` 명시 호출 (`worker.ts:230`) | **재시도 다 실패 시** (`worker.ts:180` 이후) |
| visit-pickup 실패 시 (`worker.ts:293`) | **visit-pickup 성공 후** (`worker.ts:280` 의도적 page 유지) |

→ 거의 모든 정상 경로에서 `closeBrowser()` 미호출. chromium 프로세스가 메모리에 영구 잔존.

### 부가 문제: visit-pickup의 page close 미감지

visit-pickup은 의도적으로 page를 안 닫음 (사용자가 직접 예약하라고). 사용자가 브라우저 창을 닫아도 worker가 이를 감지하지 못해 browser/context 정리 안 됨.

### 부가 문제: graceful shutdown 부재

`SIGINT`/`SIGTERM` 핸들러 없음. `next dev` 종료(Ctrl+C) 시 chromium이 좀비로 남을 수 있음 (Playwright가 보통 잘 정리하지만 보장 없음).

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/gs-delivery/browser.ts` | 수정 | idle 타임아웃 메커니즘 추가 (`scheduleIdleShutdown` / `cancelIdleShutdown`) |
| `src/lib/gs-delivery/worker.ts` | 수정 | 작업 enqueue 시 idle timer 취소, 큐 비면 idle timer 시작, visit-pickup 성공 시 page close 핸들러 |
| `src/instrumentation.ts` | 수정 | SIGINT/SIGTERM 핸들러 추가 (graceful shutdown) |

## 구현 상세

### 1. browser.ts — idle 타임아웃 메커니즘

**Before:** (현재)
```typescript
let browser: Browser | null = null;
let context: BrowserContext | null = null;

// ... getBrowser / getContext / newPage / saveCookies / restoreCookies ...

export async function closeBrowser(): Promise<void> {
  await saveCookies();
  if (context) {
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
```

**After:**
```typescript
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Idle 타임아웃 — 큐 비고 N분간 신규 작업 없으면 브라우저 자동 종료 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5분

// ... getBrowser / getContext / newPage / saveCookies / restoreCookies ...

/**
 * Idle 종료 타이머 시작. 이미 예약된 타이머가 있으면 재설정.
 * worker.ts에서 큐 처리 완료 시 호출.
 */
export function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    console.log(`[browser] ${IDLE_TIMEOUT_MS / 1000 / 60}분간 idle — 자동 종료`);
    void closeBrowser();
  }, IDLE_TIMEOUT_MS);
}

/**
 * Idle 종료 타이머 취소.
 * worker.ts에서 신규 작업 enqueue 시 호출.
 */
export function cancelIdleShutdown(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  await saveCookies();
  if (context) {
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
```

**설명:**
- `idleTimer`도 module-level로 관리. 작업 들어오면 cancel, 큐 비면 schedule.
- `closeBrowser()` 시작에서 timer 정리 — 외부에서 명시 종료할 때 잔여 timer 방지.
- 5분 idle 후 자동 종료. 사용자의 "택배 예약할 때만 켜는" 운영 패턴에 맞음 (예약 burst → idle → 자동 정리).
- 쿠키는 파일로 영속화되므로 다음 작업 시 재로그인 불필요.

### 2. worker.ts — idle 타이머 통합

**Before:** (현재 `enqueueBookings`)
```typescript
export function enqueueBookings(tasks: BookingTask[]): void {
  initOnce();
  queue.push(...tasks);
  processNext();
}
```

**After:**
```typescript
import { cancelIdleShutdown, closeBrowser, newPage, scheduleIdleShutdown } from "./browser";
// ... 기존 import ...

export function enqueueBookings(tasks: BookingTask[]): void {
  initOnce();
  cancelIdleShutdown(); // 신규 작업 들어오면 idle 타이머 취소
  queue.push(...tasks);
  processNext();
}
```

**Before:** (현재 `processNext` finally 블록)
```typescript
} finally {
  isProcessing = false;

  if (browserCrashed) {
    drainQueue();
    cancelRequested = false;
  } else if (queue.length === 0) {
    // 큐 처리 완료 — 동기화 누락된 booked 주문 재전송
    void resyncBookedOrders();
  } else {
    processNext();
  }
}
```

**After:**
```typescript
} finally {
  isProcessing = false;

  if (browserCrashed) {
    drainQueue();
    cancelRequested = false;
  } else if (queue.length === 0) {
    // 큐 처리 완료 — 동기화 누락된 booked 주문 재전송
    void resyncBookedOrders();
    scheduleIdleShutdown(); // 큐 비면 5분 후 자동 종료
  } else {
    processNext();
  }
}
```

**Before:** (현재 `enqueueVisitPickup` 시작 부분 + 성공 분기)
```typescript
export async function enqueueVisitPickup(task: VisitPickupTask): Promise<void> {
  initOnce();

  const logId = task.allOrderDbIds[0];
  // ... 로그 ...

  const page = await newPage();
  try {
    // ... 로그인, 폼 자동화 ...

    if (result.success) {
      addBookingLog(
        logId,
        "complete",
        `방문택배 폼 입력 완료: ${task.recipients.length}명 수령인 — 브라우저에서 예약하기를 클릭해주세요`
      );
      console.log(/* ... */);
      // 페이지를 닫지 않음 — 사용자가 직접 확인하고 예약
    } else {
      // ...
    }
  } catch (error) {
    // ...
  }
}
```

**After:**
```typescript
export async function enqueueVisitPickup(task: VisitPickupTask): Promise<void> {
  initOnce();
  cancelIdleShutdown(); // 신규 작업 시작 — idle 타이머 취소

  const logId = task.allOrderDbIds[0];
  // ... 로그 ...

  const page = await newPage();
  try {
    // ... 로그인, 폼 자동화 ...

    if (result.success) {
      addBookingLog(
        logId,
        "complete",
        `방문택배 폼 입력 완료: ${task.recipients.length}명 수령인 — 브라우저에서 예약하기를 클릭해주세요`
      );
      console.log(/* ... */);
      // 페이지를 닫지 않음 — 사용자가 직접 확인하고 예약.
      // 단, 사용자가 페이지 닫으면 브라우저도 정리한다.
      page.once("close", () => {
        console.log("[worker] 방문택배 페이지 종료 감지 — 브라우저 정리");
        void closeBrowser();
      });
    } else {
      // ...
    }
  } catch (error) {
    // ...
  }
}
```

**설명:**
- `enqueueBookings`/`enqueueVisitPickup` 시작 시 `cancelIdleShutdown()` — 작업 burst 중에 timer가 firing되는 것 방지.
- 큐 비면 `scheduleIdleShutdown()` — 5분 후 자동 정리.
- visit-pickup 성공 후 page에 `close` 이벤트 리스너 — 사용자가 창 닫으면 즉시 `closeBrowser()`. 5분 기다릴 필요 없음.
- `page.once("close")`: 한 번만 발화 (보호 차원).

### 3. instrumentation.ts — graceful shutdown

**Before:** (현재)
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DEPLOY_MODE !== "server") return;

  const { startDispatchPolling } = await import("@/lib/dispatch-worker");
  startDispatchPolling();
  console.log("[instrumentation] 서버 모드 — 발송처리 폴링 자동 시작");
}
```

**After:**
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 서버 모드 — 발송처리 폴링 자동 시작
  if (process.env.DEPLOY_MODE === "server") {
    const { startDispatchPolling } = await import("@/lib/dispatch-worker");
    startDispatchPolling();
    console.log("[instrumentation] 서버 모드 — 발송처리 폴링 자동 시작");
  }

  // 종료 시그널 시 브라우저 정리 (좀비 chromium 방지)
  registerShutdownHandlers();
}

let shutdownRegistered = false;

function registerShutdownHandlers(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[instrumentation] ${signal} 수신 — graceful shutdown`);
    try {
      const { closeBrowser } = await import("@/lib/gs-delivery/browser");
      await closeBrowser();
    } catch (err) {
      console.error("[instrumentation] 브라우저 정리 실패:", err);
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
```

**설명:**
- 서버/로컬 모두 적용 (서버는 dispatch-worker가 띄우는 브라우저, 로컬은 worker.ts 브라우저).
- `once`로 등록 — 중복 등록 방지 (Next.js HMR 환경에서 instrumentation이 여러 번 호출될 수 있음).
- `shutdownRegistered` 플래그도 같은 목적의 보호 장치.
- `process.exit(0)` 전에 브라우저 정리 완료 보장.

## ADR 작성 (해당 시)

**대상 여부**: **NO**

**판단 근거**:
- 되돌리기 어렵나? — 아님. 단일 모듈(gs-delivery/browser) lifecycle 정책 변경. 롤백 쉬움.
- 대안이 있었나? — 있음 (매 작업 후 즉시 종료 / 영구 유지). 하지만 트레이드오프가 명확하고 비자명하지 않음 (idle timeout이 일반적 패턴).
- 장기 영향? — 메모리/성능에 영향은 있으나, 6개월 뒤 재참조할 만한 판단은 아님.
- 비자명? — `IDLE_TIMEOUT_MS = 5분` 상수 옆 주석으로 충분.

→ 버그 수정 + 표준적인 idle timeout 패턴 적용이라 ADR 인프라(`docs/adr/`) 없는 현 상황에서도 ADR 대상 아님.

(참고: 현재 프로젝트에 `docs/adr/` 디렉토리 자체가 없음. ADR 인프라 도입은 별건으로 `/init-project` 영역.)

## 커밋 계획

1. `fix(gs-delivery): browser idle timeout 자동 종료 메커니즘 추가`
   - `src/lib/gs-delivery/browser.ts` — `scheduleIdleShutdown` / `cancelIdleShutdown` 추가, `closeBrowser`에서 timer 정리
   - `src/lib/gs-delivery/worker.ts` — `enqueueBookings`/`enqueueVisitPickup` 시작 시 cancel, 큐 비면 schedule

2. `fix(gs-delivery): visit-pickup 페이지 종료 시 브라우저 자동 정리`
   - `src/lib/gs-delivery/worker.ts` — visit-pickup 성공 시 `page.once("close")` 핸들러로 `closeBrowser()` 호출

3. `feat(gs-delivery): SIGINT/SIGTERM graceful shutdown 추가`
   - `src/instrumentation.ts` — 종료 시그널 핸들러로 `closeBrowser()` 호출

## 테스트 계획

수동 테스트 (Playwright 자동화 E2E라 unit test 불가):

- [ ] **Idle 타임아웃 정상 동작**
  - 택배 예약 1건 처리 → 큐 비고 5분 대기 → 로그에 "5분간 idle — 자동 종료" 출력 확인
  - chromium 프로세스가 종료되었는지 macOS에서 확인 (Activity Monitor)
- [ ] **신규 작업 시 timer 취소**
  - 작업 처리 후 3분 대기 → 신규 작업 enqueue → idle timer가 취소되고 작업 처리됨 확인
- [ ] **visit-pickup page close 감지**
  - visit-pickup 폼 입력 후 사용자가 브라우저 창 닫기 → 로그에 "방문택배 페이지 종료 감지" 출력 + 브라우저 정리 확인
- [ ] **Graceful shutdown**
  - `next dev` 실행 중 Ctrl+C → 로그에 "SIGINT 수신 — graceful shutdown" 출력 + chromium 좀비 없는지 확인
- [ ] **쿠키 영속화**
  - idle 자동 종료 후 신규 작업 시 재로그인 없이 진행되는지 (쿠키 파일 유효 시간 내) 확인

## 체크리스트

- [ ] 프로젝트 컨벤션 규칙 준수 (네이밍, 커밋 메시지, import 정렬)
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (`any` 미사용, strict 모드)
- [ ] 에러 핸들링 포함 (`closeBrowser` 실패 시 catch)
- [ ] ADR 작성 필요 여부 판단 완료 (대상 아님 판정)
