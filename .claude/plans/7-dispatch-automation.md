# feat(dispatch): 운송장번호 조회 및 네이버 발송처리 자동화

## 이슈
- 번호: #15
- 브랜치: `feat/7-dispatch-automation`

## 개요
GS택배 예약 완료(booked) 후, 편의점에서 실제 발송하면 운송장번호가 생성된다.
이 운송장번호를 GS택배 사이트에서 주기적으로 스크래핑하고, 네이버 커머스 API로 발송처리를 자동 수행한다.

> **택배사 코드**: 국내택배 = CJ대한통운(`CJGLS`), 내일배송 = 딜리박스(코드 미확정 — 구현 시 네이버 API 택배사 목록으로 확인)

## 설계 결정

### 운송장번호 조회 방식
- GS택배 예약조회 페이지(`/my-page/reservation/list.do`)를 Playwright로 스크래핑
- SSR 페이지 (REST API 없음) → HTML 테이블에서 예약번호 + 운송장번호 추출
- `bookingReservationNo`로 DB 주문과 매칭

### 네이버 발송처리 방식
- 커머스 API: `POST /v1/pay-order/seller/product-orders/dispatch`
- 기존 OAuth 인증 재사용 (`getAccessToken()`)
- **Playwright 불필요** — 순수 API 호출이라 안정적

### 자동 폴링 전략
- `setInterval`로 5분마다 체크 (설정에서 간격 변경 가능)
- 앱이 켜져 있는 동안 자동 실행
- `booked` 상태 주문이 있을 때만 폴링 활성화 (불필요한 스크래핑 방지)

### 승인 모드
- **수동 승인 모드** (기본값 / 테스트용): 운송장번호 감지 시 대시보드에 알림. 사용자가 "발송처리" 버튼 클릭 시 실행
- **자동 모드**: 운송장번호 감지 즉시 네이버 API로 자동 발송처리. 설정에서 토글

### DB 스키마 확장
```
orders 테이블 추가 컬럼:
  tracking_number  TEXT     — 운송장번호
  dispatch_status  TEXT     — 발송처리 상태 (null | pending_dispatch | dispatched | dispatch_failed)
  dispatched_at    TEXT     — 발송처리 완료 시각

status enum 확장:
  기존: pending | booking | booked | failed | skipped
  추가: dispatched (발송처리 완료)
```

### 주문 상태 흐름
```
pending → booking → booked → dispatched
                       ↓
                    (운송장번호 감지)
                       ↓
               dispatch_status: pending_dispatch
                       ↓
               (수동승인 또는 자동)
                       ↓
               dispatch_status: dispatched
               status: dispatched
```

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/db/schema.ts` | 수정 | tracking_number, dispatch_status, dispatched_at 컬럼 추가 |
| `src/lib/db/migrate.ts` | 수정 | ALTER TABLE 마이그레이션 추가 |
| `src/types/index.ts` | 수정 | OrderStatus에 dispatched 추가, DispatchStatus 타입 |
| `src/lib/gs-delivery/selectors.ts` | 수정 | 예약조회 URL, 테이블 셀렉터 추가 |
| `src/lib/gs-delivery/scrape-tracking.ts` | 신규 | GS택배 예약조회 스크래핑 함수 |
| `src/lib/naver/dispatch.ts` | 신규 | 네이버 발송처리 API 호출 함수 |
| `src/lib/dispatch-worker.ts` | 신규 | 폴링 워커 (운송장 조회 → 발송처리) |
| `src/lib/orders.ts` | 수정 | updateTrackingNumber, updateDispatchStatus, getBookedOrders 추가 |
| `src/lib/settings.ts` | 수정 | dispatch 관련 설정 추가 |
| `src/app/api/dispatch/route.ts` | 신규 | POST /api/dispatch (수동 발송처리 트리거) |
| `src/app/api/dispatch/sync-tracking/route.ts` | 신규 | POST /api/dispatch/sync-tracking (운송장 동기화 트리거) |
| `src/app/api/dispatch/settings/route.ts` | 신규 | GET/PUT 발송 설정 (자동/수동 모드) |
| `src/hooks/useDispatch.ts` | 신규 | React Query 훅들 |
| `src/components/DispatchPanel.tsx` | 신규 | 발송처리 패널 (운송장 현황 + 발송처리 버튼) |
| `src/components/OrderTable.tsx` | 수정 | 운송장번호, 발송상태 컬럼 표시 |
| `src/components/StatusBadge.tsx` | 수정 | dispatched 상태 배지 추가 |
| `src/app/page.tsx` | 수정 | DispatchPanel 추가 |

## 구현 상세

### 1. DB 스키마 확장 (`src/lib/db/schema.ts`)

**After:**
```typescript
export const orders = sqliteTable("orders", {
  // ... 기존 컬럼들 ...
  status: text("status", {
    enum: ["pending", "booking", "booked", "failed", "skipped", "dispatched"],
  })
    .notNull()
    .default("pending"),
  // ... 기존 컬럼들 ...
  bookingReservationNo: text("booking_reservation_no"),
  trackingNumber: text("tracking_number"),                    // 추가
  dispatchStatus: text("dispatch_status", {                   // 추가
    enum: ["pending_dispatch", "dispatched", "dispatch_failed"],
  }),
  dispatchedAt: text("dispatched_at"),                        // 추가
  // ... 기존 timestamps ...
});
```

### 2. DB 마이그레이션 (`src/lib/db/migrate.ts`)

기존 마이그레이션 패턴 확인 후, ALTER TABLE 추가:
```typescript
// 새 컬럼 추가 (SQLite ALTER TABLE은 한 번에 하나씩)
db.run(`ALTER TABLE orders ADD COLUMN tracking_number TEXT`);
db.run(`ALTER TABLE orders ADD COLUMN dispatch_status TEXT`);
db.run(`ALTER TABLE orders ADD COLUMN dispatched_at TEXT`);
```

### 3. 타입 확장 (`src/types/index.ts`)

```typescript
export type OrderStatus = "pending" | "booking" | "booked" | "failed" | "skipped" | "dispatched";
export type DispatchStatus = "pending_dispatch" | "dispatched" | "dispatch_failed";
```

### 4. GS택배 예약조회 셀렉터 (`src/lib/gs-delivery/selectors.ts`)

```typescript
export const GS_URLS = {
  // ... 기존 ...
  RESERVATION_LIST: "https://www.cvsnet.co.kr/my-page/reservation/list.do",
} as const;

export const RESERVATION_LIST_SELECTORS = {
  TABLE: "table.tbl_list, table.list_table, .mypage_table table",
  ROWS: "tbody tr",
  // 각 행의 셀 (인덱스 기반 — 실제 사이트 확인 후 조정)
  RESERVATION_NO_CELL: "td:nth-child(1)",    // 예약번호
  TRACKING_NO_CELL: "td:nth-child(2)",       // 운송장번호
  STATUS_CELL: "td:nth-child(3)",            // 상태
  PAGINATION: ".paging a, .pagination a",
  NO_DATA: ".no_data, .empty_list",
} as const;
```

> ⚠️ 셀렉터는 실제 사이트 DevTools로 확인 후 교체할 것

### 5. GS택배 운송장번호 스크래핑 (`src/lib/gs-delivery/scrape-tracking.ts`)

```typescript
import type { Page } from "playwright";
import { newPage } from "./browser";
import { ensureLoggedIn } from "./auth";
import { GS_URLS, RESERVATION_LIST_SELECTORS as SEL, ACTION_DELAY_MS } from "./selectors";

export interface ReservationInfo {
  reservationNo: string;
  trackingNo: string | null;
  status: string;
}

/**
 * GS택배 예약조회 페이지에서 예약번호 → 운송장번호 매핑을 스크래핑.
 * booked 상태 주문의 bookingReservationNo 목록을 받아,
 * 해당 예약번호에 대한 운송장번호를 반환한다.
 */
export async function scrapeTrackingNumbers(
  targetReservationNos: string[]
): Promise<ReservationInfo[]> {
  if (targetReservationNos.length === 0) return [];

  const targetSet = new Set(targetReservationNos);
  const results: ReservationInfo[] = [];
  const page = await newPage();

  try {
    await ensureLoggedIn(page);
    await page.goto(GS_URLS.RESERVATION_LIST, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(ACTION_DELAY_MS * 2);

    // 테이블에서 행 추출
    const rows = await page.locator(SEL.ROWS).all();

    for (const row of rows) {
      const cells = await row.locator("td").all();
      if (cells.length < 3) continue;

      const reservationNo = (await cells[0].textContent())?.trim() ?? "";
      const trackingNo = (await cells[1].textContent())?.trim() || null;
      const status = (await cells[2].textContent())?.trim() ?? "";

      if (targetSet.has(reservationNo)) {
        results.push({ reservationNo, trackingNo, status });
      }
    }

    // TODO: 페이지네이션 처리 (필요 시)
  } finally {
    await page.close().catch(() => {});
  }

  return results;
}
```

> **설명:** 실제 셀렉터와 테이블 구조는 사이트 확인 후 조정 필요. 핵심 로직은 동일.

### 6. 네이버 발송처리 API (`src/lib/naver/dispatch.ts`)

```typescript
import { getAccessToken } from "./auth";

const BASE_URL = "https://api.commerce.naver.com/external/v1";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/** 택배사 코드 (deliveryType → Naver deliveryCompanyCode) */
const DELIVERY_COMPANY_CODE: Record<string, string> = {
  domestic: "CJGLS",        // CJ대한통운
  nextDay: "DELIVERBOX",    // 딜리박스 (실제 코드 확인 필요 — 첫 실행 시 검증)
};

interface DispatchRequest {
  productOrderIds: string[];
  deliveryCompanyCode: string;
  trackingNumber: string;
}

interface DispatchResult {
  success: boolean;
  failProductOrderIds?: string[];
  error?: string;
}

/**
 * 네이버 커머스 API로 발송처리.
 * 같은 운송장번호(같은 orderId 그룹)의 productOrderId들을 일괄 처리.
 */
export async function dispatchOrders(req: DispatchRequest): Promise<DispatchResult> {
  const token = await getAccessToken();

  const body = {
    dispatchProductOrders: req.productOrderIds.map((id) => ({
      productOrderId: id,
      deliveryMethod: "DELIVERY",
      deliveryCompanyCode: req.deliveryCompanyCode,
      trackingNumber: req.trackingNumber,
      dispatchDate: new Date().toISOString(),
    })),
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(
      `${BASE_URL}/pay-order/seller/product-orders/dispatch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (response.status === 429) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    const result = await response.json();

    if (response.ok) {
      // 응답에서 실패 건 확인
      const failIds = result.data?.failProductOrderIds ?? [];
      return {
        success: failIds.length === 0,
        failProductOrderIds: failIds.length > 0 ? failIds : undefined,
      };
    }

    return {
      success: false,
      error: `API 에러 (${response.status}): ${JSON.stringify(result).slice(0, 500)}`,
    };
  }

  return { success: false, error: "429 재시도 한도 초과" };
}
```

> **참고:** `dispatchProductOrders` 배열의 정확한 필드명은 네이버 API 공식 문서 확인 필요. 첫 테스트에서 400/422 에러가 나면 필드명 조정.

### 7. 발송처리 워커 (`src/lib/dispatch-worker.ts`)

```typescript
import { scrapeTrackingNumbers } from "@/lib/gs-delivery/scrape-tracking";
import { dispatchOrders } from "@/lib/naver/dispatch";
import {
  getBookedOrderGroups,
  updateTrackingNumbers,
  updateDispatchStatus,
  addBookingLog,
} from "@/lib/orders";
import { getSetting } from "@/lib/settings";

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5분
let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/** 폴링 시작 */
export function startDispatchPolling(): void {
  if (pollTimer) return;

  const intervalMs = Number(getSetting("dispatch.pollInterval")) || DEFAULT_POLL_INTERVAL_MS;

  // 즉시 1회 실행 후 인터벌 시작
  checkAndDispatch();
  pollTimer = setInterval(checkAndDispatch, intervalMs);
  console.log(`[dispatch-worker] 폴링 시작 (${intervalMs / 1000}초 간격)`);
}

/** 폴링 중지 */
export function stopDispatchPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[dispatch-worker] 폴링 중지");
  }
}

/** 폴링 상태 */
export function getDispatchWorkerStatus() {
  return { isPolling: pollTimer !== null, isRunning };
}

/**
 * 1회 실행: booked 주문의 운송장번호 확인 → 발송처리
 */
export async function checkAndDispatch(): Promise<{
  tracked: number;
  dispatched: number;
  errors: string[];
}> {
  if (isRunning) return { tracked: 0, dispatched: 0, errors: ["이미 실행 중"] };
  isRunning = true;

  const result = { tracked: 0, dispatched: 0, errors: [] as string[] };

  try {
    // 1. booked 상태 + 운송장번호 없는 주문 그룹 조회
    const bookedGroups = getBookedOrderGroups();
    if (bookedGroups.length === 0) {
      return result;
    }

    // 2. GS택배에서 운송장번호 스크래핑
    const reservationNos = bookedGroups
      .map((g) => g.bookingReservationNo)
      .filter(Boolean) as string[];

    const trackingResults = await scrapeTrackingNumbers(reservationNos);

    // 3. DB에 운송장번호 업데이트
    for (const tr of trackingResults) {
      if (!tr.trackingNo) continue;

      const group = bookedGroups.find((g) => g.bookingReservationNo === tr.reservationNo);
      if (!group) continue;

      updateTrackingNumbers(group.orderId, tr.trackingNo);
      result.tracked++;

      const logId = group.firstDbId;
      addBookingLog(logId, "tracking", `운송장번호 감지: ${tr.trackingNo}`);
      console.log(`[dispatch-worker] 운송장 감지 — 주문: ${group.orderId}, 운송장: ${tr.trackingNo}`);
    }

    // 4. 자동 모드이면 바로 발송처리
    const autoDispatch = getSetting("dispatch.autoMode") === "true";
    if (!autoDispatch) {
      // 수동 모드: pending_dispatch로만 마킹, 사용자가 UI에서 확인 후 발송
      return result;
    }

    // 5. 운송장번호가 있고 아직 발송처리 안 된 주문들 처리
    const pendingDispatch = getBookedOrderGroups().filter(
      (g) => g.trackingNumber && !g.dispatchStatus
    );

    for (const group of pendingDispatch) {
      try {
        const deliveryCompanyCode = group.deliveryType === "nextDay" ? "DELIVERBOX" : "CJGLS";

        const dispatchResult = await dispatchOrders({
          productOrderIds: group.productOrderIds,
          deliveryCompanyCode,
          trackingNumber: group.trackingNumber!,
        });

        if (dispatchResult.success) {
          updateDispatchStatus(group.orderId, "dispatched");
          addBookingLog(group.firstDbId, "dispatch", `네이버 발송처리 완료: ${group.trackingNumber}`);
          result.dispatched++;
          console.log(`[dispatch-worker] ✅ 발송처리 완료 — 주문: ${group.orderId}`);
        } else {
          updateDispatchStatus(group.orderId, "dispatch_failed");
          const errMsg = dispatchResult.error ?? "알 수 없는 오류";
          addBookingLog(group.firstDbId, "error", `발송처리 실패: ${errMsg}`);
          result.errors.push(`${group.orderId}: ${errMsg}`);
          console.error(`[dispatch-worker] ❌ 발송처리 실패 — ${group.orderId}: ${errMsg}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "알 수 없는 오류";
        result.errors.push(`${group.orderId}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "알 수 없는 오류";
    result.errors.push(msg);
    console.error("[dispatch-worker] 폴링 실패:", msg);
  } finally {
    isRunning = false;
  }

  return result;
}
```

### 8. orders.ts 확장 (`src/lib/orders.ts`)

```typescript
/** booked 상태 + 운송장번호 없는 주문 그룹 조회 (발송처리 워커용) */
export function getBookedOrderGroups(): Array<{
  orderId: string;
  firstDbId: number;
  bookingReservationNo: string | null;
  trackingNumber: string | null;
  dispatchStatus: string | null;
  deliveryType: string;
  productOrderIds: string[];
}> {
  const bookedOrders = db
    .select()
    .from(orders)
    .where(eq(orders.status, "booked" as OrderStatus))
    .all();

  // orderId 기준 그룹핑
  const groups = new Map<string, typeof bookedOrders>();
  for (const order of bookedOrders) {
    const existing = groups.get(order.orderId) ?? [];
    existing.push(order);
    groups.set(order.orderId, existing);
  }

  return Array.from(groups.entries()).map(([orderId, items]) => ({
    orderId,
    firstDbId: items[0].id,
    bookingReservationNo: items[0].bookingReservationNo,
    trackingNumber: items[0].trackingNumber,
    dispatchStatus: items[0].dispatchStatus,
    deliveryType: items[0].selectedDeliveryType,
    productOrderIds: items.map((o) => o.productOrderId),
  }));
}

/** 운송장번호 업데이트 (orderId 기준 전체) */
export function updateTrackingNumbers(orderId: string, trackingNumber: string): void {
  db.update(orders)
    .set({
      trackingNumber,
      dispatchStatus: "pending_dispatch",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.orderId, orderId))
    .run();
}

/** 발송처리 상태 업데이트 (orderId 기준) */
export function updateDispatchStatus(
  orderId: string,
  status: "dispatched" | "dispatch_failed"
): void {
  const now = new Date().toISOString();
  const updates: Record<string, string> = {
    dispatchStatus: status,
    updatedAt: now,
  };
  if (status === "dispatched") {
    updates.status = "dispatched";
    updates.dispatchedAt = now;
  }
  db.update(orders).set(updates).where(eq(orders.orderId, orderId)).run();
}
```

### 9. API 라우트 — 수동 발송처리 (`src/app/api/dispatch/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dispatchOrders } from "@/lib/naver/dispatch";
import {
  getBookedOrderGroups,
  updateDispatchStatus,
  addBookingLog,
} from "@/lib/orders";

/** POST /api/dispatch — 특정 주문 그룹 수동 발송처리 */
export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId가 필요합니다" }, { status: 400 });
    }

    const groups = getBookedOrderGroups();
    const group = groups.find((g) => g.orderId === orderId);
    if (!group) {
      return NextResponse.json({ error: "해당 주문을 찾을 수 없습니다" }, { status: 404 });
    }
    if (!group.trackingNumber) {
      return NextResponse.json({ error: "운송장번호가 아직 없습니다" }, { status: 400 });
    }

    const deliveryCompanyCode = group.deliveryType === "nextDay" ? "DELIVERBOX" : "CJGLS";

    const result = await dispatchOrders({
      productOrderIds: group.productOrderIds,
      deliveryCompanyCode,
      trackingNumber: group.trackingNumber,
    });

    if (result.success) {
      updateDispatchStatus(orderId, "dispatched");
      addBookingLog(group.firstDbId, "dispatch", `네이버 발송처리 완료: ${group.trackingNumber}`);
      return NextResponse.json({ message: "발송처리 완료", orderId });
    }

    updateDispatchStatus(orderId, "dispatch_failed");
    addBookingLog(group.firstDbId, "error", `발송처리 실패: ${result.error}`);
    return NextResponse.json({ error: result.error }, { status: 500 });
  } catch (error) {
    console.error("발송처리 실패:", error);
    return NextResponse.json({ error: "발송처리 중 오류가 발생했습니다" }, { status: 500 });
  }
}
```

### 10. API 라우트 — 운송장 동기화 (`src/app/api/dispatch/sync-tracking/route.ts`)

```typescript
import { NextResponse } from "next/server";
import { checkAndDispatch } from "@/lib/dispatch-worker";

/** POST /api/dispatch/sync-tracking — 수동으로 운송장 동기화 + 발송처리 트리거 */
export async function POST() {
  try {
    const result = await checkAndDispatch();
    return NextResponse.json({
      message: `운송장 ${result.tracked}건 감지, 발송처리 ${result.dispatched}건 완료`,
      ...result,
    });
  } catch (error) {
    console.error("운송장 동기화 실패:", error);
    return NextResponse.json({ error: "동기화 실패" }, { status: 500 });
  }
}
```

### 11. 설정 확장 (`src/lib/settings.ts`, `src/types/index.ts`)

types/index.ts에 추가:
```typescript
export interface DispatchSettings {
  autoMode: boolean;         // true=자동, false=수동승인
  pollIntervalMin: number;   // 폴링 간격 (분)
}
```

AllSettings에 추가:
```typescript
export interface AllSettings {
  // ... 기존 ...
  dispatch: DispatchSettings;
}
```

settings.ts의 getAllSettings/getAllSettingsRaw에 dispatch 섹션 추가:
```typescript
dispatch: {
  autoMode: getSetting("dispatch.autoMode") === "true",
  pollIntervalMin: Number(getSetting("dispatch.pollInterval")) || 5,
},
```

### 12. UI — DispatchPanel (`src/components/DispatchPanel.tsx`)

대시보드 하단(또는 상단)에 발송처리 현황 패널:
```
┌─────────────────────────────────────────────────┐
│ 발송처리                    [운송장 동기화] [설정]│
├─────────────────────────────────────────────────┤
│ 자동 발송: OFF (수동 승인 모드)                    │
│                                                  │
│ 주문 2026031458195871 | 운송장: 12345678 | [발송] │
│ 주문 2026031457645961 | 운송장 대기 중...         │
└─────────────────────────────────────────────────┘
```

- 운송장번호가 감지된 주문: 파란 배지 + "발송처리" 버튼 (수동 모드일 때)
- 운송장 대기 중: 회색 텍스트
- 이미 발송처리 완료: 초록 체크
- "운송장 동기화" 버튼: 수동으로 GS택배 스크래핑 트리거

### 13. OrderTable 확장 (`src/components/OrderTable.tsx`)

상태 컬럼에 dispatched 상태 추가:
- `dispatched` → 초록 배지 "발송완료"
- 운송장번호가 있으면 주문 상세에 표시

### 14. StatusBadge 확장 (`src/components/StatusBadge.tsx`)

```typescript
// 기존 매핑에 추가
dispatched: { label: "발송완료", className: "bg-emerald-500 ..." },
```

### 15. 폴링 자동 시작

`src/app/api/orders/route.ts` 또는 별도 초기화 지점에서 `startDispatchPolling()` 호출.
booked 주문이 있을 때만 폴링 활성화하는 로직 포함.

### 16. 설정 페이지 — 발송처리 탭 추가 (`src/components/settings/DispatchSettingsTab.tsx`)

- 자동/수동 모드 토글 스위치
- 폴링 간격 (분) 입력
- 딜리박스 택배사 코드 확인/수정 (첫 실행 시 맞는지 검증용)

## 커밋 계획

1. `feat(db): 발송처리 컬럼 추가 (tracking_number, dispatch_status, dispatched_at)` — schema.ts, migrate.ts, types
2. `feat(scrape): GS택배 예약조회 운송장번호 스크래핑` — selectors.ts, scrape-tracking.ts
3. `feat(naver): 네이버 발송처리 API 클라이언트` — dispatch.ts
4. `feat(dispatch): 발송처리 폴링 워커 + API 라우트` — dispatch-worker.ts, API routes, orders.ts, settings.ts
5. `feat(ui): 발송처리 패널 및 설정 UI` — DispatchPanel, DispatchSettingsTab, OrderTable, StatusBadge

## 테스트 계획

- [ ] DB 마이그레이션: 기존 데이터 유지하면서 새 컬럼 추가 확인
- [ ] GS택배 스크래핑: 로그인 → 예약조회 → 운송장번호 추출 (수동 실행)
- [ ] 네이버 발송처리 API: 실제 주문으로 테스트 (수동 승인 모드에서)
- [ ] 딜리박스 택배사 코드 확인: API 호출 시 400/422 에러 여부
- [ ] 수동 모드: 운송장 감지 → UI 알림 → 버튼 클릭 → 발송처리
- [ ] 자동 모드: 폴링 → 운송장 감지 → 자동 발송처리
- [ ] 전체 vitest 테스트 통과

## 체크리스트

- [ ] 프로젝트 컨벤션 준수
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인
- [ ] 에러 핸들링 포함
- [ ] `docs/project-history.md`에 Phase 7 기록

## 주의사항

- **네이버 API 필드명**: `dispatchProductOrders` 배열의 정확한 필드명은 공식 문서 확인 필요. 첫 테스트 시 에러 응답으로 조정.
- **딜리박스 코드**: `DELIVERBOX`는 추정값. 실제로 다른 코드일 수 있음. 설정에서 수정 가능하도록.
- **GS택배 셀렉터**: 예약조회 테이블의 정확한 구조는 실제 사이트 DevTools로 확인 필요.
- **고객 영향**: 발송처리는 고객에게 직접 도달 — 반드시 수동 승인 모드에서 먼저 테스트.

## project-history.md 기록 내용

```markdown
### Phase 7: 운송장번호 조회 및 네이버 발송처리 자동화 (#15)
- GS택배 예약조회 페이지에서 운송장번호 자동 스크래핑 (Playwright)
- 네이버 커머스 API로 발송처리 (POST /v1/pay-order/seller/product-orders/dispatch)
- 택배사 매핑: 국내택배=CJ대한통운(CJGLS), 내일배송=딜리박스
- 자동 폴링 워커: 5분 간격 운송장 확인 → 발송처리
- 수동 승인 모드 / 자동 모드 설정 지원
- 발송처리 패널 UI (운송장 현황 + 수동 발송 버튼)
```
