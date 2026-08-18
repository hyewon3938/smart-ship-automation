# refactor(ui): 서버 대시보드 탭 구조 개편 — 발송 흐름 중심으로

## 이슈
- 번호: #28
- 브랜치: `refactor/28-server-dashboard-tabs`

## 개요
서버 대시보드의 탭 구조를 발송처리 흐름 중심으로 개편한다.
로컬 예약 흐름(pending→booked)이 아닌, 서버의 핵심 역할인 운송장 감지→발송처리 흐름에 맞게 탭을 재구성하고, 무의미한 DispatchPanel을 제거한다.

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/types/index.ts` | 수정 | ServerFilter 타입 추가 |
| `src/components/StatusFilter.tsx` | 수정 | 서버 모드 탭 구조 변경 (대기/발송완료/실패/전체) |
| `src/lib/groupOrders.ts` | 수정 | 서버 필터용 카운트 함수 추가 |
| `src/components/Dashboard.tsx` | 수정 | 서버 모드 필터 로직 변경 + DispatchPanel 제거 |

## 구현 상세

### 1. ServerFilter 타입 추가 (`src/types/index.ts`)

**After:**
```typescript
/** 서버 대시보드 필터 (발송 흐름 기준) */
export type ServerFilter = "waiting" | "dispatched" | "dispatch_failed";
```

**설명:** 서버 대시보드의 탭 필터는 OrderStatus와 다른 의미를 가지므로 별도 타입으로 정의.
- `waiting`: booked + dispatchStatus !== dispatch_failed (운송장 대기 중)
- `dispatched`: status === dispatched (발송완료)
- `dispatch_failed`: booked + dispatchStatus === dispatch_failed (발송 실패)

---

### 2. 서버 필터용 카운트 함수 추가 (`src/lib/groupOrders.ts`)

**After:**
```typescript
/** 서버 대시보드용 — 발송 흐름 기준 그룹 카운트 */
export function countGroupsByServerFilter(orders: Order[]): {
  all: number;
  waiting: number;
  dispatched: number;
  dispatch_failed: number;
} {
  const groups = groupOrdersByOrderId(orders);
  const counts = { all: groups.length, waiting: 0, dispatched: 0, dispatch_failed: 0 };

  for (const group of groups) {
    const status = getGroupStatus(group.orders);
    const dispatchStatus = group.orders[0]?.dispatchStatus;

    if (status === "dispatched") {
      counts.dispatched++;
    } else if (status === "booked" && dispatchStatus === "dispatch_failed") {
      counts.dispatch_failed++;
    } else if (status === "booked") {
      counts.waiting++;
    }
    // pending, failed, skipped 등은 서버에서 카운트하지 않음
  }

  return counts;
}

/** 서버 필터에 따라 주문 필터링 */
export function filterOrdersByServerFilter(
  orders: Order[],
  filter: ServerFilter | undefined
): Order[] {
  if (!filter) return orders; // 전체

  const groups = groupOrdersByOrderId(orders);
  const matchingOrderIds = new Set<string>();

  for (const group of groups) {
    const status = getGroupStatus(group.orders);
    const dispatchStatus = group.orders[0]?.dispatchStatus;

    const match =
      (filter === "waiting" && status === "booked" && dispatchStatus !== "dispatch_failed") ||
      (filter === "dispatched" && status === "dispatched") ||
      (filter === "dispatch_failed" && status === "booked" && dispatchStatus === "dispatch_failed");

    if (match) matchingOrderIds.add(group.orderId);
  }

  return orders.filter((o) => matchingOrderIds.has(o.orderId));
}
```

**설명:**
- `countGroupsByServerFilter`: StatusFilter 탭의 카운트 배지 표시용
- `filterOrdersByServerFilter`: 탭 선택 시 주문 목록 필터링용
- 그룹 단위 판단: 같은 orderId의 주문은 하나의 그룹으로 묶어서 상태 판단

---

### 3. StatusFilter 서버 탭 변경 (`src/components/StatusFilter.tsx`)

**Before:**
```typescript
const TABS: {
  key: OrderStatus | undefined;
  label: string;
  countKey: keyof StatusCount;
  serverOnly?: boolean;
}[] = [
  { key: "pending", label: "대기", countKey: "pending" },
  { key: "booked", label: "예약완료", countKey: "booked" },
  { key: "dispatched", label: "발송완료", countKey: "dispatched", serverOnly: true },
  { key: "failed", label: "실패", countKey: "failed" },
  { key: undefined, label: "전체", countKey: "all" },
];
```

**After:**
```typescript
import type { OrderStatus, ServerFilter } from "@/types";

// 로컬 모드 탭 (기존 유지, 발송완료 탭 제거)
const LOCAL_TABS: {
  key: OrderStatus | undefined;
  label: string;
  countKey: keyof StatusCount;
}[] = [
  { key: "pending", label: "대기", countKey: "pending" },
  { key: "booked", label: "예약완료", countKey: "booked" },
  { key: "failed", label: "실패", countKey: "failed" },
  { key: undefined, label: "전체", countKey: "all" },
];

// 서버 모드 탭 (발송 흐름 기준)
const SERVER_TABS: {
  key: ServerFilter | undefined;
  label: string;
  countKey: keyof ServerStatusCount;
}[] = [
  { key: "waiting", label: "대기", countKey: "waiting" },
  { key: "dispatched", label: "발송완료", countKey: "dispatched" },
  { key: "dispatch_failed", label: "실패", countKey: "dispatch_failed" },
  { key: undefined, label: "전체", countKey: "all" },
];
```

**Props 변경:**
```typescript
interface ServerStatusCount {
  all: number;
  waiting: number;
  dispatched: number;
  dispatch_failed: number;
}

interface StatusFilterProps {
  currentStatus: OrderStatus | ServerFilter | undefined;
  counts: StatusCount | ServerStatusCount;
  onStatusChange: (status: OrderStatus | ServerFilter | undefined) => void;
  isServerMode?: boolean;
}
```

**렌더링:**
```typescript
export function StatusFilter({ currentStatus, counts, onStatusChange, isServerMode = false }: StatusFilterProps) {
  const tabs = isServerMode ? SERVER_TABS : LOCAL_TABS;

  return (
    <div className="flex gap-1 flex-wrap">
      {tabs.map((tab) => (
        <Button
          key={tab.label}
          variant={currentStatus === tab.key ? "default" : "outline"}
          size="sm"
          onClick={() => onStatusChange(tab.key)}
        >
          {tab.label}
          <span className="ml-1 text-xs opacity-70">
            ({(counts as Record<string, number>)[tab.countKey]})
          </span>
        </Button>
      ))}
    </div>
  );
}
```

**설명:**
- 로컬/서버 탭을 완전히 분리하여 각 모드에 맞는 탭만 표시
- 로컬: 대기 → 예약완료 → 실패 → 전체 (기존, serverOnly 제거)
- 서버: 대기(운송장 대기) → 발송완료 → 실패(발송 실패) → 전체

---

### 4. Dashboard 서버 모드 변경 (`src/components/Dashboard.tsx`)

**주요 변경:**

#### 4-1. 임포트 변경
```typescript
// 제거
- import { DispatchPanel } from "@/components/DispatchPanel";

// 추가
+ import { countGroupsByServerFilter, filterOrdersByServerFilter } from "@/lib/groupOrders";
+ import type { DeliveryType, OrderStatus, ServerFilter } from "@/types";
```

#### 4-2. 필터 상태 분리
```typescript
// Before: 단일 상태
const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>("pending");

// After: 모드별 분리
const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>(
  isServerMode ? undefined : "pending"
);
const [serverFilter, setServerFilter] = useState<ServerFilter | undefined>("waiting");
```

#### 4-3. 서버 모드 주문 목록 — 클라이언트 필터링

```typescript
// 서버 모드: allOrders에서 클라이언트 필터링
// 로컬 모드: 기존 API 필터링 유지
const filteredOrders = isServerMode
  ? filterOrdersByServerFilter(allOrders, serverFilter)
  : orders;

// 서버 모드 카운트
const serverStatusCounts = isServerMode
  ? countGroupsByServerFilter(allOrders)
  : undefined;
```

#### 4-4. StatusFilter props 변경

```typescript
<StatusFilter
  currentStatus={isServerMode ? serverFilter : statusFilter}
  counts={isServerMode ? serverStatusCounts! : statusCounts}
  onStatusChange={isServerMode
    ? (s) => setServerFilter(s as ServerFilter | undefined)
    : handleStatusFilterChange
  }
  isServerMode={isServerMode}
/>
```

#### 4-5. 주문 테이블에 filteredOrders 전달

```typescript
<OrderTable
  orders={isServerMode ? filteredOrders : orders}
  selectedIds={selectedIds}
  onSelectedChange={setSelectedIds}
  onGroupDeliveryTypeChange={handleGroupDeliveryTypeChange}
  onGroupStatusChange={handleGroupStatusChange}
  selectable={!isServerMode}
/>
```

#### 4-6. DispatchPanel 제거

```typescript
// 삭제
- {isServerMode && <DispatchPanel orders={allOrders} isServerMode={isServerMode} />}
```

#### 4-7. 서버 모드 useOrders 호출 최적화

서버 모드에서는 `useOrders(statusFilter)` 호출이 불필요 (allOrders에서 클라이언트 필터링). 하지만 로컬 모드에서는 여전히 API 필터링이 필요하므로:

```typescript
// 로컬 모드만 필터된 쿼리 사용
const { data, isLoading, isError } = useOrders(isServerMode ? undefined : statusFilter);
```

서버 모드에서는 data = allOrdersQuery.data로 통합하여 불필요한 중복 API 호출 제거.

---

## 커밋 계획

1. `refactor(ui): 서버 대시보드 탭 구조를 발송 흐름 기준으로 개편` — 전체 파일

## 테스트 계획
- [ ] 서버 모드: 대기 탭 → booked 상태 주문만 표시 (dispatch_failed 제외)
- [ ] 서버 모드: 발송완료 탭 → dispatched 상태 주문만 표시
- [ ] 서버 모드: 실패 탭 → dispatch_failed 주문만 표시
- [ ] 서버 모드: 전체 탭 → 모든 주문 표시
- [ ] 서버 모드: 각 탭 카운트 배지 정확성
- [ ] 서버 모드: DispatchPanel 미표시 확인
- [ ] 로컬 모드: 기존 탭 구조 유지 (대기/예약완료/실패/전체)
- [ ] 로컬 모드: 발송완료 탭 미표시 확인
- [ ] 빌드 성공 확인 (타입 에러 없음)

## 체크리스트
- [ ] 프로젝트 컨벤션 규칙 준수
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인
- [ ] 에러 핸들링 포함
- [ ] `docs/project-history.md` 기록
