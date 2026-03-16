# feat(ui): 발송완료 주문 상태 표시 개선 + 집화 상태 확인 기능

## 이슈
- 번호: #21
- 브랜치: `feat/21-dispatch-status-delivery-tracking`

## 개요
발송완료 탭의 UI 버그 3건(상태 비표시, 주소 잘림) 수정 + 네이버 API를 통한 배송(집화) 상태 확인 기능 추가.
운송장 번호가 정상적으로 처리되었는지 확인할 수 있도록, 네이버에서 주문 상태가 DELIVERING으로 변경되면 "배송중" 배지를 표시한다.

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/components/OrderTable.tsx` | 수정 | 상태 표시 버그 수정 + 주소 전체 표시 + 배송상태 표시 |
| `src/lib/db/schema.ts` | 수정 | `delivery_status` 컬럼 추가 |
| `src/lib/naver/orders.ts` | 수정 | 배송상태 조회 함수 추가 |
| `src/lib/naver/types.ts` | 수정 | 배송상태 조회 응답 타입 추가 |
| `src/lib/orders.ts` | 수정 | 배송상태 업데이트 함수 추가 |
| `src/lib/dispatch-worker.ts` | 수정 | 배송상태 확인 로직 추가 |
| `src/types/index.ts` | 수정 | DeliveryTrackingStatus 타입 추가 |

## 구현 상세

### 1. 발송완료 상태 표시 버그 수정 (OrderTable.tsx)

**문제:** `STATUS_LABELS`에 "dispatched"가 없고, 상태 컬럼이 Select로 렌더링되어 빈칸으로 표시됨.
발송완료 주문은 상태를 변경할 수 없는 최종 상태이므로, StatusBadge로 표시해야 한다.

**Before:** (OrderTable.tsx:44-50, 347-375)
```typescript
const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  booking: "예약중",
  booked: "완료",
  failed: "실패",
  skipped: "건너뜀",
};
```
```tsx
{groupStatus === "booking" ? (
  <StatusBadge status={groupStatus} />
) : (
  <Select value={groupStatus} ...>
    ...
  </Select>
)}
```

**After:**
```typescript
const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  booking: "예약중",
  booked: "완료",
  failed: "실패",
  skipped: "건너뜀",
  dispatched: "발송완료",
};
```
```tsx
// 변경 불가능한 상태(booking, dispatched, skipped)는 StatusBadge 표시
const NON_EDITABLE_BADGE_STATUSES = new Set(["booking", "dispatched", "skipped"]);

// ...

{NON_EDITABLE_BADGE_STATUSES.has(groupStatus) ? (
  <StatusBadge status={groupStatus} />
) : (
  <Select value={groupStatus} ...>
    ...
  </Select>
)}
```

**설명:** dispatched, skipped도 상태 변경이 불가능한 최종 상태이므로 StatusBadge로 통일 표시.

### 2. 배송지 주소 전체 표시 (OrderTable.tsx)

**문제:** `MAX_ADDRESS_LENGTH = 40`과 `truncate()` 함수로 주소가 잘림.

**Before:** (OrderTable.tsx:37, 281-285)
```typescript
const MAX_ADDRESS_LENGTH = 40;
```
```tsx
<p className="text-sm">
  {truncate(fullAddress, MAX_ADDRESS_LENGTH)}
</p>
```

**After:**
```tsx
<p className="text-sm break-words">
  {fullAddress}
</p>
```

**설명:** `MAX_ADDRESS_LENGTH` 상수와 주소에 대한 `truncate()` 호출을 제거. `break-words`로 긴 주소 줄바꿈 처리.
`truncate()` 함수 자체는 다른 곳에서 사용할 수 있으므로 유지하되, 참조하는 곳이 없으면 제거.

### 3. DB 스키마 — 배송상태 컬럼 추가 (schema.ts)

**After:** (orders 테이블에 추가)
```typescript
deliveryStatus: text("delivery_status", {
  enum: ["unknown", "delivering", "delivered"],
}),
deliveryStatusCheckedAt: text("delivery_status_checked_at"),
```

**설명:**
- `delivery_status`: 네이버 API에서 확인한 배송 상태
  - `null`: 아직 확인 안 됨
  - `"delivering"`: 집화 완료 / 배송중 (네이버 productOrderStatus = DELIVERING)
  - `"delivered"`: 배송 완료 (네이버 productOrderStatus = DELIVERED 또는 PURCHASE_DECIDED)
- `delivery_status_checked_at`: 마지막 배송상태 확인 시각

### 4. 타입 추가 (types/index.ts)

```typescript
/** 배송 추적 상태 (네이버 API 기반) */
export type DeliveryTrackingStatus = "delivering" | "delivered";
```

### 5. 네이버 API — 배송상태 조회 함수 (naver/orders.ts)

기존 `fetchOrdersForWindow()` 함수를 재활용하여 DELIVERING 상태 주문을 조회한다.

**추가 함수:**
```typescript
/**
 * 발송처리된 주문의 배송 상태 확인.
 * 조건형 API로 DELIVERING 상태 주문을 조회하여,
 * 우리 DB의 dispatched 주문과 매칭.
 *
 * @returns 배송중으로 확인된 productOrderId 목록
 */
export async function fetchDeliveringOrderIds(): Promise<Set<string>> {
  const token = await getAccessToken();
  const now = new Date();
  const deliveringIds = new Set<string>();

  // DELIVERING 상태는 최근 7일 이내 조회
  for (let daysBack = 0; daysBack < LOOKBACK_DAYS; daysBack++) {
    const from = new Date(now.getTime() - (daysBack + 1) * DAY_MS);
    const to = new Date(now.getTime() - daysBack * DAY_MS);

    const orders = await fetchOrdersForWindow(token, from, to, "DELIVERING");
    for (const order of orders) {
      deliveringIds.add(order.productOrderId);
    }

    if (daysBack < LOOKBACK_DAYS - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  return deliveringIds;
}
```

**설명:**
- 기존 `fetchOrdersForWindow()`에 `statuses` 파라미터가 이미 있으므로, `"DELIVERING"` 전달.
- 7일 룩백으로 조회 (발송 후 7일 이내에 집화가 일어남).
- 반환값: DELIVERING 상태인 productOrderId의 Set.

### 6. 배송상태 업데이트 함수 (orders.ts)

```typescript
/** dispatched 주문 중 배송상태 미확인 건 조회 */
export function getDispatchedProductOrderIds(): Array<{
  orderId: string;
  productOrderId: string;
}> {
  return db
    .select({
      orderId: orders.orderId,
      productOrderId: orders.productOrderId,
    })
    .from(orders)
    .where(eq(orders.status, "dispatched" as OrderStatus))
    .all()
    .filter((o) => !["delivering", "delivered"].includes(
      // deliveryStatus가 null이면 아직 미확인
      db.select({ ds: orders.deliveryStatus })
        .from(orders)
        .where(eq(orders.productOrderId, o.productOrderId))
        .get()?.ds ?? ""
    ));
}
```

실제 구현에서는 더 효율적으로:

```typescript
/** dispatched 주문 중 배송상태 미확인 건의 productOrderId 목록 */
export function getUncheckedDispatchedOrders(): Array<{
  orderId: string;
  productOrderId: string;
}> {
  const dispatched = db
    .select({
      orderId: orders.orderId,
      productOrderId: orders.productOrderId,
      deliveryStatus: orders.deliveryStatus,
    })
    .from(orders)
    .where(eq(orders.status, "dispatched" as OrderStatus))
    .all();

  // 이미 delivering/delivered 확인된 건은 제외
  return dispatched.filter((o) => !o.deliveryStatus);
}

/** 배송상태 업데이트 (productOrderId 기준) */
export function updateDeliveryStatus(
  productOrderId: string,
  deliveryStatus: "delivering" | "delivered"
): void {
  db.update(orders)
    .set({
      deliveryStatus,
      deliveryStatusCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.productOrderId, productOrderId))
    .run();
}
```

### 7. Dispatch Worker에 배송상태 확인 추가 (dispatch-worker.ts)

`checkAndDispatch()` 함수 끝에 배송상태 확인 단계를 추가한다.

```typescript
// 기존 코드 끝 (발송처리 완료 후)...

// 6. 발송완료 주문의 배송상태 확인 (집화 여부)
try {
  const unchecked = getUncheckedDispatchedOrders();
  if (unchecked.length > 0) {
    const deliveringIds = await fetchDeliveringOrderIds();

    for (const order of unchecked) {
      if (deliveringIds.has(order.productOrderId)) {
        updateDeliveryStatus(order.productOrderId, "delivering");
        console.log(
          `[dispatch-worker] 📦 집화 확인 — 주문: ${order.orderId}`
        );
      }
    }
  }
} catch (err) {
  console.error("[dispatch-worker] 배송상태 확인 실패:", err);
}
```

**설명:** 기존 폴링 주기에 배송상태 확인을 함께 실행. 별도 타이머를 두지 않아 복잡성 최소화.

### 8. UI — 발송완료 주문에 배송상태 배지 표시 (OrderTable.tsx)

발송완료 상태 옆에 배송상태 배지를 추가로 표시한다.

```tsx
{NON_EDITABLE_BADGE_STATUSES.has(groupStatus) ? (
  <div className="flex flex-col gap-0.5">
    <StatusBadge status={groupStatus} />
    {groupStatus === "dispatched" && deliveryStatus === "delivering" && (
      <Badge className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0">
        배송중
      </Badge>
    )}
  </div>
) : (
  ...
)}
```

**그룹의 deliveryStatus 결정 로직:**
그룹 내 주문들의 deliveryStatus 중 가장 진행된 상태를 표시.
- 하나라도 `delivering`이면 → "배송중"
- 아직 `null`이면 → 배지 없음 (발송완료만 표시)

`GroupRows` 컴포넌트에서 그룹의 배송상태를 계산:
```typescript
function getGroupDeliveryStatus(orders: Order[]): string | null {
  if (orders.some((o) => o.deliveryStatus === "delivered")) return "delivered";
  if (orders.some((o) => o.deliveryStatus === "delivering")) return "delivering";
  return null;
}
```

## 마이그레이션 참고

SQLite + Drizzle ORM (better-sqlite3)에서 컬럼 추가는 `ALTER TABLE` 필요.
기존 패턴을 확인하여 동일한 방식으로 마이그레이션 적용.
기존 dispatched 주문의 `delivery_status`는 `null`로 시작하며, 다음 폴링에서 자동 업데이트됨.

## 커밋 계획

1. `fix(ui): 발송완료 상태 표시 및 배송지 잘림 수정` — OrderTable.tsx
2. `feat(db): 배송상태 추적 컬럼 추가` — schema.ts, types/index.ts
3. `feat(naver): 배송중 주문 조회 함수 추가` — naver/orders.ts
4. `feat(ui): 발송완료 주문 집화 상태 표시` — OrderTable.tsx, orders.ts, dispatch-worker.ts

## 테스트 계획

- [ ] 발송완료 탭에서 "발송완료" 배지가 정상 표시되는지 확인
- [ ] 배송지 주소가 잘리지 않고 전체 표시되는지 확인
- [ ] skipped 상태도 StatusBadge로 표시되는지 확인
- [ ] 네이버 API로 DELIVERING 상태 조회가 정상 동작하는지 확인 (서버에서 테스트)
- [ ] 집화 확인된 주문에 "배송중" 배지가 표시되는지 확인

## 체크리스트

- [ ] 프로젝트 컨벤션 규칙 준수
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인 (DeliveryTrackingStatus 타입 사용)
- [ ] 에러 핸들링 포함 (배송상태 확인 실패 시 무시하고 다음 폴링에서 재시도)
- [ ] 기존 기능 영향 없음 확인 (배송상태는 부가 정보, 기존 플로우에 영향 없음)
- [ ] docs/project-history.md 업데이트

## 참고: 네이버 API 배송상태 플로우

```
PAYED (결제완료/배송준비)
  → DISPATCHED (발송처리 직후 - 내부 상태)
  → DELIVERING (집화/배송중 - 택배사가 수거 확인)
  → DELIVERED (배송완료)
  → PURCHASE_DECIDED (구매확정)
```

`productOrderStatus`가 `DELIVERING`으로 바뀌면 택배사가 실제로 물건을 수거했다는 의미.
운송장 번호가 잘못 입력된 경우에는 이 상태 전환이 일어나지 않으므로,
발송 후 DELIVERING이 안 되는 주문을 감지할 수 있다.

## 주의사항

1. **네이버 API 응답 확인 필요:** 조건형 API에 `productOrderStatuses=DELIVERING`을 전달했을 때 정상 응답하는지 실제 테스트 필요. 만약 이 상태값을 지원하지 않으면 `last-changed-statuses` API 사용으로 대체.
2. **Rate Limit:** 배송상태 확인은 기존 폴링 주기 안에서 함께 실행하므로, 추가 API 호출량이 생김. 호출 간 대기(800ms)를 유지하여 429 방지.
3. **DB 마이그레이션:** 서버 DB에도 컬럼 추가 필요. `drizzle-kit push` 또는 수동 ALTER TABLE 실행.
