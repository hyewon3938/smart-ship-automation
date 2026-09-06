# feat(ui): 메인 대시보드 - 주문 목록 및 택배 예약 UI

## 이슈
- 번호: #3
- 브랜치: `feat/3-dashboard-ui`

## 개요
발송대기 주문을 테이블로 표시하고, 택배 유형을 선택하여 예약할 수 있는 대시보드 UI를 구현한다.
Phase 2에서 만든 API(주문 조회/동기화)를 UI로 연결하고, 예약 API는 상태 전환까지만 구현한다(실제 GS택배 자동화는 Phase 4).

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/components/Dashboard.tsx` | 신규 | 메인 대시보드 오케스트레이터 |
| `src/components/OrderTable.tsx` | 신규 | 주문 테이블 (체크박스 선택, 정렬) |
| `src/components/StatusBadge.tsx` | 신규 | 상태별 색상 뱃지 |
| `src/components/StatusFilter.tsx` | 신규 | 상태 필터 탭 |
| `src/components/DeliveryTypeSelector.tsx` | 신규 | 택배 유형 선택 (행별) |
| `src/components/SyncButton.tsx` | 신규 | 동기화 버튼 + 마지막 동기화 시간 |
| `src/components/BookingConfirmDialog.tsx` | 신규 | 예약 확인 다이얼로그 |
| `src/components/OrderTableSkeleton.tsx` | 신규 | 테이블 로딩 스켈레톤 |
| `src/hooks/useOrders.ts` | 신규 | TanStack Query 훅 (조회/동기화/수정/예약) |
| `src/lib/settings.ts` | 신규 | 설정 CRUD 서비스 (lastSyncTime 등) |
| `src/app/api/orders/[id]/route.ts` | 신규 | PATCH 주문 수정 (택배 유형) |
| `src/app/api/orders/book/route.ts` | 신규 | POST 예약 시작 (상태 → booking) |
| `src/app/page.tsx` | 수정 | 플레이스홀더 → Dashboard 컴포넌트 |
| `src/app/api/orders/route.ts` | 수정 | lastSyncTime 포함 응답 |
| `src/lib/orders.ts` | 수정 | updateDeliveryType, bookOrders 함수 추가 |
| `src/types/index.ts` | 수정 | OrderStatus, DeliveryType 타입 추가 |
| shadcn/ui 컴포넌트 (7종) | 설치 | table, checkbox, badge, dialog, select, skeleton, tooltip |

## 구현 상세

### 1. shadcn/ui 컴포넌트 설치

```bash
npx shadcn@latest add table checkbox badge dialog select skeleton tooltip
```

7개 컴포넌트를 `src/components/ui/`에 설치한다.

### 2. 타입 확장 (`src/types/index.ts`)

**Before:**
```typescript
import type { InferSelectModel } from "drizzle-orm";
import type { orders } from "@/lib/db/schema";

export type Order = InferSelectModel<typeof orders>;

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}
```

**After:**
```typescript
import type { InferSelectModel } from "drizzle-orm";
import type { orders } from "@/lib/db/schema";

export type Order = InferSelectModel<typeof orders>;

/** 주문 상태 */
export type OrderStatus = "pending" | "booking" | "booked" | "failed" | "skipped";

/** 택배 유형 */
export type DeliveryType = "domestic" | "nextDay";

/** 주문 동기화 결과 */
export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

/** 주문 목록 API 응답 */
export interface OrdersResponse {
  orders: Order[];
  lastSyncTime: string | null;
}
```

**설명:** API 응답 타입과 상태/택배 유형을 명시적 union 타입으로 추출하여 컴포넌트에서 재사용한다.

### 3. 설정 서비스 (`src/lib/settings.ts`)

**신규 파일:**
```typescript
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

/** 설정값 조회 */
export function getSetting(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

/** 설정값 저장 (upsert) */
export function setSetting(key: string, value: string): void {
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();
  if (existing) {
    db.update(settings)
      .set({ value, updatedAt: new Date().toISOString() })
      .where(eq(settings.key, key))
      .run();
  } else {
    db.insert(settings).values({ key, value }).run();
  }
}
```

**설명:** settings 테이블의 CRUD. lastSyncTime 저장/조회에 사용한다.

### 4. 주문 서비스 확장 (`src/lib/orders.ts`)

**Before:**
```typescript
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

export function getOrders(status?: string) {
  const query = db.select().from(orders).orderBy(desc(orders.createdAt));
  if (status) {
    return query.where(eq(orders.status, status)).all();
  }
  return query.all();
}

export function getOrderById(id: number) {
  return db.select().from(orders).where(eq(orders.id, id)).get();
}
```

**After:**
```typescript
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

import type { DeliveryType } from "@/types";

/** 전체 주문 목록 조회 (최신순) */
export function getOrders(status?: string) {
  const query = db.select().from(orders).orderBy(desc(orders.createdAt));
  if (status) {
    return query.where(eq(orders.status, status)).all();
  }
  return query.all();
}

/** 단일 주문 조회 */
export function getOrderById(id: number) {
  return db.select().from(orders).where(eq(orders.id, id)).get();
}

/** 택배 유형 변경 */
export function updateDeliveryType(id: number, deliveryType: DeliveryType) {
  const order = getOrderById(id);
  if (!order) throw new Error(`주문을 찾을 수 없습니다: ${id}`);
  if (order.status !== "pending") {
    throw new Error(`대기 상태의 주문만 변경할 수 있습니다 (현재: ${order.status})`);
  }
  if (deliveryType === "nextDay" && !order.isNextDayEligible) {
    throw new Error("내일배송 불가 지역입니다");
  }

  db.update(orders)
    .set({
      selectedDeliveryType: deliveryType,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.id, id))
    .run();

  return getOrderById(id);
}

/** 선택 주문 예약 시작 (상태 → booking) */
export function bookOrders(orderIds: number[]) {
  if (orderIds.length === 0) throw new Error("예약할 주문을 선택해주세요");

  const targetOrders = db
    .select()
    .from(orders)
    .where(inArray(orders.id, orderIds))
    .all();

  // 존재하지 않는 주문 확인
  if (targetOrders.length !== orderIds.length) {
    throw new Error("일부 주문을 찾을 수 없습니다");
  }

  // pending 상태가 아닌 주문 확인
  const nonPending = targetOrders.filter((o) => o.status !== "pending");
  if (nonPending.length > 0) {
    throw new Error(
      `대기 상태의 주문만 예약할 수 있습니다 (${nonPending.length}건 불가)`
    );
  }

  // 상태를 booking으로 변경
  const now = new Date().toISOString();
  db.update(orders)
    .set({ status: "booking", updatedAt: now })
    .where(inArray(orders.id, orderIds))
    .run();

  return { count: orderIds.length };
}
```

**설명:**
- `updateDeliveryType`: pending 상태인 주문의 택배 유형만 변경 가능. 내일배송 불가 지역은 nextDay 선택 불가.
- `bookOrders`: 선택한 주문들의 상태를 `booking`으로 변경. Phase 4에서 이 상태의 주문을 Playwright가 실제 예약 처리한다.
- `inArray` import 추가 (drizzle-orm).

### 5. API 라우트 확장

#### 5-1. GET /api/orders 수정 (`src/app/api/orders/route.ts`)

**Before:**
```typescript
return NextResponse.json({ orders: orderList });
```

**After:**
```typescript
import { getSetting } from "@/lib/settings";
// ...
const lastSyncTime = getSetting("lastSyncTime");
return NextResponse.json({ orders: orderList, lastSyncTime });
```

**설명:** 응답에 `lastSyncTime` 포함하여 프론트엔드에서 마지막 동기화 시간을 표시할 수 있게 한다.

#### 5-2. POST /api/orders/sync 수정 (`src/app/api/orders/sync/route.ts`)

동기화 성공 시 lastSyncTime 저장 추가:
```typescript
import { setSetting } from "@/lib/settings";
// ... 기존 syncOrders() 호출 후
setSetting("lastSyncTime", new Date().toISOString());
```

#### 5-3. PATCH /api/orders/[id] 신규 (`src/app/api/orders/[id]/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { updateDeliveryType } from "@/lib/orders";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { selectedDeliveryType } = body;

    if (!selectedDeliveryType || !["domestic", "nextDay"].includes(selectedDeliveryType)) {
      return NextResponse.json(
        { error: "유효하지 않은 택배 유형입니다" },
        { status: 400 }
      );
    }

    const updated = updateDeliveryType(Number(id), selectedDeliveryType);
    return NextResponse.json({ order: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

**설명:** Next.js 16 App Router에서 dynamic route params는 `Promise`로 전달된다. `await params`로 접근.

#### 5-4. POST /api/orders/book 신규 (`src/app/api/orders/book/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { bookOrders } from "@/lib/orders";

export async function POST(request: NextRequest) {
  try {
    const { orderIds } = await request.json();

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "예약할 주문 ID 목록이 필요합니다" },
        { status: 400 }
      );
    }

    const result = bookOrders(orderIds);
    return NextResponse.json({
      message: `${result.count}건 예약이 시작되었습니다`,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

**설명:** Phase 3에서는 상태만 `booking`으로 전환. Phase 4에서 이 엔드포인트에 Playwright 자동화 트리거를 연결한다.

### 6. TanStack Query 훅 (`src/hooks/useOrders.ts`)

```typescript
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DeliveryType, OrdersResponse, SyncResult } from "@/types";

/** 주문 목록 조회 + booking 상태 시 3초 폴링 */
export function useOrders(status?: string) {
  return useQuery<OrdersResponse>({
    queryKey: ["orders", { status }],
    queryFn: async () => {
      const params = status ? `?status=${status}` : "";
      const res = await fetch(`/api/orders${params}`);
      if (!res.ok) throw new Error("주문 목록 조회 실패");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.orders) return false;
      return data.orders.some((o) => o.status === "booking") ? 3000 : false;
    },
  });
}

/** 주문 동기화 (네이버 API → DB) */
export function useSyncOrders() {
  const queryClient = useQueryClient();
  return useMutation<SyncResult & { message: string }>({
    mutationFn: async () => {
      const res = await fetch("/api/orders/sync", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "동기화 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 택배 유형 변경 */
export function useUpdateDeliveryType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, deliveryType }: { id: number; deliveryType: DeliveryType }) => {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedDeliveryType: deliveryType }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "택배 유형 변경 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 선택 주문 예약 */
export function useBookOrders() {
  const queryClient = useQueryClient();
  return useMutation<{ message: string; count: number }, Error, number[]>({
    mutationFn: async (orderIds) => {
      const res = await fetch("/api/orders/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "예약 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
```

**설명:**
- `useOrders`: booking 상태 주문이 있으면 3초 폴링으로 상태 변화 감지
- `useSyncOrders`: invalidateQueries로 동기화 후 목록 자동 갱신
- `useUpdateDeliveryType`: 낙관적 업데이트 없이 서버 응답 후 갱신 (안전)
- `useBookOrders`: orderIds 배열을 받아 예약 시작

### 7. 컴포넌트 구현

#### 7-1. StatusBadge (`src/components/StatusBadge.tsx`)

```typescript
import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/types";

const STATUS_CONFIG: Record<OrderStatus, { label: string; variant: string; className: string }> = {
  pending: { label: "대기", variant: "secondary", className: "bg-muted text-muted-foreground" },
  booking: { label: "예약중", variant: "default", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  booked: { label: "완료", variant: "default", className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  failed: { label: "실패", variant: "destructive", className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  skipped: { label: "건너뜀", variant: "outline", className: "border-muted-foreground/30 text-muted-foreground" },
};

interface StatusBadgeProps {
  status: OrderStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return <Badge className={config.className}>{config.label}</Badge>;
}
```

**설명:** 이슈 요구사항대로 pending=회색, booking=파란색, booked=초록, failed=빨강. skipped은 outline 회색.

#### 7-2. StatusFilter (`src/components/StatusFilter.tsx`)

```typescript
"use client";

import { Button } from "@/components/ui/button";
import type { OrderStatus } from "@/types";

interface StatusCount {
  all: number;
  pending: number;
  booking: number;
  booked: number;
  failed: number;
  skipped: number;
}

interface StatusFilterProps {
  currentStatus: string | undefined;
  counts: StatusCount;
  onStatusChange: (status: string | undefined) => void;
}

const TABS: { key: string | undefined; label: string; countKey: keyof StatusCount }[] = [
  { key: undefined, label: "전체", countKey: "all" },
  { key: "pending", label: "대기", countKey: "pending" },
  { key: "booking", label: "예약중", countKey: "booking" },
  { key: "booked", label: "완료", countKey: "booked" },
  { key: "failed", label: "실패", countKey: "failed" },
];
```

**설명:** 상태별 필터 탭. 각 탭에 해당 상태의 건수를 표시한다. skipped은 탭에 노출하지 않는다 (전체에서만 보임).

#### 7-3. DeliveryTypeSelector (`src/components/DeliveryTypeSelector.tsx`)

```typescript
"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface DeliveryTypeSelectorProps {
  value: "domestic" | "nextDay";
  isNextDayEligible: boolean;
  disabled?: boolean;  // booking/booked/failed 상태면 true
  onChange: (value: "domestic" | "nextDay") => void;
}
```

**설명:**
- `isNextDayEligible=false`이면 "내일배송" 옵션 비활성화 + 툴팁 "내일배송 불가 지역"
- `disabled=true`이면 (pending이 아닌 주문) 전체 비활성화
- 변경 시 `useUpdateDeliveryType` 뮤테이션 호출

#### 7-4. SyncButton (`src/components/SyncButton.tsx`)

```typescript
"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SyncButtonProps {
  lastSyncTime: string | null;
  isPending: boolean;
  onSync: () => void;
}
```

**설명:**
- 동기화 중이면 `RefreshCw` 아이콘 회전 애니메이션 + 버튼 비활성화
- 마지막 동기화 시간은 "N분 전" 형식으로 상대 시간 표시
- 동기화 완료 시 toast로 결과 표시 (Dashboard에서 처리)

#### 7-5. BookingConfirmDialog (`src/components/BookingConfirmDialog.tsx`)

```typescript
"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Order } from "@/types";

interface BookingConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrders: Order[];
  isPending: boolean;
  onConfirm: () => void;
}
```

**설명:**
- 선택한 주문 요약: N건, 국내택배 M건 / 내일배송 K건
- 수령인 목록 (최대 5건, 초과 시 "외 N건")
- "예약 시작" / "취소" 버튼
- isPending=true이면 "예약 시작" 버튼에 로딩 표시

#### 7-6. OrderTableSkeleton (`src/components/OrderTableSkeleton.tsx`)

```typescript
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
```

**설명:** 5행의 스켈레톤 테이블. 실제 테이블과 동일한 컬럼 구조.

#### 7-7. OrderTable (`src/components/OrderTable.tsx`)

```typescript
"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { DeliveryTypeSelector } from "@/components/DeliveryTypeSelector";

import type { Order, DeliveryType } from "@/types";

interface OrderTableProps {
  orders: Order[];
  selectedIds: Set<number>;
  onSelectedChange: (ids: Set<number>) => void;
  onDeliveryTypeChange: (id: number, type: DeliveryType) => void;
}
```

**테이블 컬럼:**

| ☐ | 상품 | 수량 | 금액 | 수령인 | 배송지 | 택배유형 | 상태 |
|---|------|------|------|--------|--------|---------|------|

- **☐**: Checkbox (전체 선택 헤더 포함). pending 상태만 선택 가능.
- **상품**: `productName` + optionInfo 있으면 `(옵션: optionInfo)` 서브텍스트
- **수량**: `quantity`
- **금액**: `totalPrice` → `₩12,000` 형식. null이면 `-`
- **수령인**: `recipientName` + `recipientPhone` 서브텍스트
- **배송지**: `recipientAddress` (40자 초과 시 말줄임) + `recipientZipCode` 서브텍스트
- **택배유형**: `DeliveryTypeSelector` 컴포넌트 인라인
- **상태**: `StatusBadge` 컴포넌트

**전체선택 로직:**
- 헤더 체크박스: 현재 표시된 pending 주문만 전체 선택/해제
- pending이 아닌 주문은 체크박스 비활성화
- 빈 테이블이면 "주문이 없습니다" 표시

#### 7-8. Dashboard (`src/components/Dashboard.tsx`)

```typescript
"use client";

import { useState } from "react";
import { toast } from "sonner";

import { OrderTable } from "@/components/OrderTable";
import { OrderTableSkeleton } from "@/components/OrderTableSkeleton";
import { StatusFilter } from "@/components/StatusFilter";
import { SyncButton } from "@/components/SyncButton";
import { BookingConfirmDialog } from "@/components/BookingConfirmDialog";
import { Button } from "@/components/ui/button";
import { useOrders, useSyncOrders, useUpdateDeliveryType, useBookOrders } from "@/hooks/useOrders";

import type { DeliveryType, Order, OrderStatus } from "@/types";
```

**상태 관리:**
```typescript
const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
```

**레이아웃 구조:**
```
┌─────────────────────────────────────────────────┐
│  Smart Ship Automation                          │
│                                                 │
│  [🔄 동기화] 마지막 동기화: 3분 전              │
│                                                 │
│  전체(50) | 대기(30) | 예약중(5) | 완료(10) | 실패(5)│
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ ☐ │ 상품  │수량│ 금액 │수령인│배송지│유형│상태│  │
│  │───│───────│────│──────│──────│──────│────│────│  │
│  │ ☐ │ ...   │ .. │ ...  │ ... │ ...  │ .. │ .. │  │
│  │ ☐ │ ...   │ .. │ ...  │ ... │ ...  │ .. │ .. │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ✓ 3건 선택됨        [선택 예약] [전체 예약]    │
└─────────────────────────────────────────────────┘
```

**핵심 동작:**
1. `statusFilter` 변경 시 `useOrders(statusFilter)`로 필터된 목록 조회
2. 동기화 완료 시 toast: `"동기화 완료: N건 추가, M건 갱신"`
3. 주문 선택 후 "선택 예약" → BookingConfirmDialog 열림
4. "전체 예약" → 현재 표시된 pending 주문 전체를 selectedOrders로 다이얼로그 열림
5. 예약 확인 시 `useBookOrders` 뮤테이션 → 성공 toast → 선택 초기화 → 다이얼로그 닫기
6. 에러 발생 시 toast.error 표시
7. statusFilter 변경 시 selectedIds 초기화

**빈 상태 처리:**
- 주문 0건 + 한번도 동기화 안 했을 때: "주문을 가져오려면 동기화 버튼을 눌러주세요" 안내
- 특정 필터에 주문 0건: "해당 상태의 주문이 없습니다"

### 8. 메인 페이지 수정 (`src/app/page.tsx`)

**Before:**
```typescript
export default function Home() {
  return (
    <main className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Smart Ship Automation</h1>
      <p className="text-muted-foreground">
        네이버 스마트스토어 주문 → GS택배 자동 예약
      </p>
      <div className="mt-8 p-4 border rounded-lg">
        <p className="text-sm text-muted-foreground">
          Phase 2에서 주문 목록이 여기에 표시됩니다.
        </p>
      </div>
    </main>
  );
}
```

**After:**
```typescript
import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="container mx-auto p-6">
      <Dashboard />
    </main>
  );
}
```

**설명:** page.tsx는 최소한으로 유지. 모든 UI 로직은 Dashboard 클라이언트 컴포넌트에서 처리.

## 커밋 계획

1. `feat(ui): shadcn/ui 컴포넌트 설치 (table, checkbox, badge, dialog, select, skeleton, tooltip)` - shadcn/ui 컴포넌트 7종 설치
2. `feat(api): 주문 수정/예약 API 및 설정 서비스 추가` - types/index.ts, lib/settings.ts, lib/orders.ts, api/orders/[id]/route.ts, api/orders/book/route.ts, api/orders/route.ts, api/orders/sync/route.ts
3. `feat(ui): 대시보드 UI 구현 - 주문 테이블, 상태 필터, 예약 다이얼로그` - 모든 컴포넌트, hooks, page.tsx

## 테스트 계획

- [ ] `npm run build` 성공 확인 (타입 에러 없음)
- [ ] 브라우저에서 대시보드 렌더링 확인
- [ ] 동기화 버튼 클릭 → API 호출 → 주문 목록 갱신
- [ ] 상태 필터 탭 전환 → 목록 필터링
- [ ] 체크박스 선택/전체선택 동작
- [ ] 택배 유형 변경 → DB 반영
- [ ] 예약 확인 다이얼로그 → 상태 booking으로 전환
- [ ] 스켈레톤 로딩 UI 표시

## 체크리스트

- [ ] 프로젝트 컨벤션 규칙 준수 (네이밍, import 순서, 레이어 분리)
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (any 미사용, OrderStatus/DeliveryType union 타입)
- [ ] 에러 핸들링 포함 (API 에러 → toast, 네트워크 에러 처리)
- [ ] API 라우트에서 직접 DB 쿼리 없음 (lib/ 서비스 함수 사용)

## 프로젝트 히스토리 기록

```markdown
### Phase 3: 대시보드 UI (PR #N)
- 주문 테이블 구현 (체크박스 선택, 상태 필터, 택배 유형 변경)
- TanStack Query 기반 데이터 패칭 (booking 상태 시 3초 폴링)
- 예약 확인 다이얼로그 (Phase 4 GS택배 자동화 연결 대기)
- shadcn/ui 컴포넌트 7종 추가 (table, checkbox, badge, dialog, select, skeleton, tooltip)
- 설정 서비스 추가 (lastSyncTime 관리)
```
