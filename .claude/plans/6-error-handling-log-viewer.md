# feat(ui): 에러 핸들링, 토스트 알림, 예약 로그 뷰어

## 이슈
- 번호: #6
- 브랜치: `feat/6-error-handling-log-viewer`

## 개요
예약 실패 시 자동 재시도(최대 2회), 예약 로그 뷰어(로그 + 실패 스크린샷 확인), 로딩/에러 상태 UI를 개선한다.

> **토스트 알림**은 Phase 3/4/5에서 이미 Sonner로 구현 완료 — 동기화/예약/설정 저장 시 toast.success/error 호출 중. 추가 작업 불필요.

## 설계 결정

### 재시도 전략
- 워커(`worker.ts`)에서 `processSingleOrder` 실패 시 최대 2회 재시도
- 재시도 간격: 2초 / 4초 (지수 백오프)
- 브라우저 크래시(페이지 로드 자체 실패)는 재시도하지 않음 (상위 catch에서 처리)
- 재시도 시 로그 기록: `addBookingLog(id, "retry", "재시도 1/2회")`

### 로그 뷰어 위치
- 별도 페이지 대신 **대시보드 내 다이얼로그**로 구현 (orderId 클릭 시 열림)
- 주문 그룹별 로그 표시 (그룹 내 첫 번째 DB ID 기준)
- 실패 스크린샷은 `/api/screenshots/[filename]` 엔드포인트로 서빙

### 스크린샷 서빙
- `data/screenshots/` 파일을 Next.js API 라우트로 서빙
- 경로: `GET /api/screenshots/[filename]`
- Content-Type: `image/png`, 파일 존재 확인 후 스트리밍

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/lib/orders.ts` | 수정 | `getBookingLogs(orderId)` 함수 추가 |
| `src/app/api/orders/[id]/logs/route.ts` | 신규 | GET /api/orders/:id/logs |
| `src/app/api/screenshots/[filename]/route.ts` | 신규 | GET /api/screenshots/:filename (이미지 서빙) |
| `src/lib/gs-delivery/worker.ts` | 수정 | 재시도 로직 추가 (최대 2회) |
| `src/hooks/useOrders.ts` | 수정 | `useBookingLogs(orderId)` 훅 추가 |
| `src/components/BookingLogDialog.tsx` | 신규 | 예약 로그 뷰어 다이얼로그 |
| `src/components/OrderTable.tsx` | 수정 | orderId 클릭 시 로그 다이얼로그 열기 |

## 구현 상세

### 1. 로그 조회 함수 (`src/lib/orders.ts`)

**After:**
```typescript
import type { BookingLogEntry } from "@/types";

/** 주문의 예약 로그 조회 (최신순) */
export function getBookingLogs(orderId: number): BookingLogEntry[] {
  return db
    .select()
    .from(bookingLogs)
    .where(eq(bookingLogs.orderId, orderId))
    .orderBy(desc(bookingLogs.createdAt))
    .all() as BookingLogEntry[];
}
```

### 2. 로그 API 라우트 (`src/app/api/orders/[id]/logs/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getBookingLogs } from "@/lib/orders";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: "유효하지 않은 주문 ID" }, { status: 400 });
    }
    const logs = getBookingLogs(orderId);
    return NextResponse.json({ logs });
  } catch (error) {
    console.error("로그 조회 실패:", error);
    return NextResponse.json({ error: "로그를 조회할 수 없습니다." }, { status: 500 });
  }
}
```

### 3. 스크린샷 서빙 API (`src/app/api/screenshots/[filename]/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const SCREENSHOTS_DIR = join(process.cwd(), "data", "screenshots");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // 경로 조작 방지
  if (filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "잘못된 파일명" }, { status: 400 });
  }

  const filepath = join(SCREENSHOTS_DIR, filename);
  if (!existsSync(filepath)) {
    return NextResponse.json({ error: "파일 없음" }, { status: 404 });
  }

  const buffer = readFileSync(filepath);
  return new NextResponse(buffer, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
}
```

### 4. 워커 재시도 로직 (`src/lib/gs-delivery/worker.ts`)

**Before:**
```typescript
async function processSingleOrder(task: BookingTask): Promise<void> {
  // ... 1회 시도 후 성공/실패 처리
}
```

**After:**
```typescript
const MAX_RETRIES = 2;
const RETRY_DELAYS = [2000, 4000]; // ms

async function processSingleOrder(task: BookingTask): Promise<void> {
  const logId = task.orderDbIds[0];

  addBookingLog(logId, "start", `예약 시작: ${task.recipientName} (${task.orderDbIds.length}개 상품)`);
  console.log(`[worker] 예약 시작 — 주문: ${task.naverOrderId}, 수령인: ${task.recipientName}`);

  let lastResult: BookingResult | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1];
      addBookingLog(logId, "retry", `재시도 ${attempt}/${MAX_RETRIES}회 (${delay / 1000}초 후)`);
      console.log(`[worker] 재시도 ${attempt}/${MAX_RETRIES} — ${delay}ms 후`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const page = await newPage();
    try {
      await ensureLoggedIn(page);
      if (attempt === 0) addBookingLog(logId, "login", "로그인 확인 완료");

      const result = task.deliveryType === "nextDay"
        ? await bookNextDay(page, task)
        : await bookDomestic(page, task);

      lastResult = result;

      if (result.success) {
        // 성공 → DB 반영 후 종료
        updateOrderStatusBatch(task.orderDbIds, "booked", JSON.stringify({ reservationNo: result.reservationNo }), result.reservationNo);
        addBookingLog(logId, "complete", `예약 완료${result.reservationNo ? `: ${result.reservationNo}` : ""}`);
        console.log(`[worker] ✅ 예약 완료 — 예약번호: ${result.reservationNo ?? "(없음)"}`);
        return;
      }

      // 실패 → 재시도 가능하면 계속
      console.warn(`[worker] ⚠️ 시도 ${attempt + 1} 실패: ${result.error}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  // 모든 재시도 소진 → 최종 실패 처리
  updateOrderStatusBatch(task.orderDbIds, "failed", lastResult?.error ?? "알 수 없는 오류");
  addBookingLog(logId, "error", `예약 실패 (${MAX_RETRIES + 1}회 시도): ${lastResult?.error}`, lastResult?.screenshotPath);
  console.error(`[worker] ❌ 최종 실패 — 주문: ${task.naverOrderId}`);
}
```

**설명:** 기존 단일 시도를 for 루프로 래핑. 성공 시 즉시 return, 실패 시 재시도. 모든 재시도 소진 후 failed 처리.

### 5. React Query 훅 (`src/hooks/useOrders.ts`)

**추가:**
```typescript
export function useBookingLogs(orderId: number | null) {
  return useQuery<{ logs: BookingLogEntry[] }>({
    queryKey: ["bookingLogs", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/logs`);
      if (!res.ok) throw new Error("로그 조회 실패");
      return res.json();
    },
    enabled: orderId !== null,
  });
}
```

### 6. 로그 뷰어 다이얼로그 (`src/components/BookingLogDialog.tsx`)

- 트리거: OrderTable에서 주문번호 클릭
- Dialog 안에 로그 목록 테이블:
  - 시간 | 작업 | 상세 | 스크린샷
- action별 Badge 색상: start=파랑, login=회색, complete=초록, error=빨강, retry=노랑, info=회색
- screenshotPath가 있으면 "스크린샷 보기" 링크 → 새 탭에서 `/api/screenshots/{filename}` 열기
- 로딩: Skeleton, 에러: 텍스트 표시

**레이아웃:**
```
┌───────────────────────────────────────────┐
│ 예약 로그 — 주문 2025030112345            │
├───────────────────────────────────────────┤
│ 시간          | 작업     | 상세           │
│ 03-16 14:30  | [시작]   | 예약 시작: 홍.. │
│ 03-16 14:30  | [로그인] | 로그인 확인 완료│
│ 03-16 14:31  | [실패]   | [물품정보] 타임.│
│ 03-16 14:33  | [재시도] | 재시도 1/2회    │
│ 03-16 14:34  | [완료]   | 예약번호: R123  │
└───────────────────────────────────────────┘
```

### 7. OrderTable 수정 (`src/components/OrderTable.tsx`)

- 주문번호(orderId) 텍스트를 클릭 가능한 버튼으로 변경
- 클릭 시 `onViewLogs(firstDbId)` 콜백 호출
- 로그 다이얼로그에 선택된 orderId 전달

## 커밋 계획

1. `feat(orders): 예약 로그 조회 API 및 스크린샷 서빙` — orders.ts, API 라우트 2개
2. `feat(worker): 예약 실패 시 자동 재시도 (최대 2회)` — worker.ts
3. `feat(ui): 예약 로그 뷰어 다이얼로그` — BookingLogDialog, useOrders 훅, OrderTable 수정

## 테스트 계획

- [ ] GET /api/orders/:id/logs → 로그 배열 반환 확인
- [ ] GET /api/screenshots/:filename → 이미지 반환 / 404 처리 확인
- [ ] 경로 조작 방지 (../ 포함 요청 시 400)
- [ ] 워커 재시도: 실패 시 retry 로그 기록 확인 (수동)
- [ ] 로그 다이얼로그: 주문번호 클릭 → 로그 목록 표시 확인 (수동)
- [ ] 전체 vitest 테스트 통과

## 체크리스트

- [ ] 프로젝트 컨벤션 준수
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인
- [ ] 에러 핸들링 포함
- [ ] `docs/project-history.md`에 Phase 6 기록

## project-history.md 기록 내용

```markdown
### Phase 6: 에러 핸들링 및 예약 로그 뷰어 (#6)
- 예약 실패 시 자동 재시도 (최대 2회, 지수 백오프 2s/4s)
- 예약 로그 뷰어 다이얼로그 (주문번호 클릭 → 로그 + 스크린샷 확인)
- 로그 조회 API (`GET /api/orders/:id/logs`)
- 스크린샷 서빙 API (`GET /api/screenshots/:filename`, 경로 조작 방지)
- 토스트 알림은 Phase 3~5에서 이미 구현 완료
```
