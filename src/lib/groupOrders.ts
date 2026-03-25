import type { DispatchStatus, Order, OrderGroup, OrderStatus } from "@/types";

/**
 * 같은 orderId를 가진 주문을 하나의 그룹으로 묶는다.
 * 하나의 orderId = 같은 주문번호 = 같은 수령인/배송지.
 * orderDate 기준 내림차순(최신 순) 정렬.
 */
export function groupOrdersByOrderId(orders: Order[]): OrderGroup[] {
  const map = new Map<string, Order[]>();

  for (const order of orders) {
    const existing = map.get(order.orderId);
    if (existing) {
      existing.push(order);
    } else {
      map.set(order.orderId, [order]);
    }
  }

  const groups: OrderGroup[] = [];

  for (const [orderId, groupOrders] of map) {
    const first = groupOrders[0];

    groups.push({
      orderId,
      orders: groupOrders,
      recipientName: first.recipientName,
      recipientAddress: first.recipientAddress,
      recipientAddressDetail: first.recipientAddressDetail,
      recipientZipCode: first.recipientZipCode,
      recipientPhone: first.recipientPhone,
      shippingMemo: groupOrders.find((o) => o.shippingMemo)?.shippingMemo ?? null,
      isNextDayEligible: groupOrders.every((o) => o.isNextDayEligible),
      orderDate: first.orderDate,
    });
  }

  // 최신 주문 순 정렬
  groups.sort(
    (a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
  );

  return groups;
}

/** 그룹 내 상태 요약 (우선순위 기반) */
export function getGroupStatus(orders: Order[]): OrderStatus {
  const statuses = new Set(orders.map((o) => o.status));
  if (statuses.size === 1) return orders[0].status as OrderStatus;
  if (statuses.has("booking")) return "booking";
  if (statuses.has("failed")) return "failed";
  if (statuses.has("pending")) return "pending";
  if (statuses.has("booked")) return "booked";
  if (statuses.has("dispatched")) return "dispatched";
  return "skipped";
}

/**
 * 주문 그룹 기준 상태별 카운트.
 * 화면에 표시되는 모든 숫자는 주문(orderId) 단위.
 */
export function countGroupsByStatus(orders: Order[]): {
  all: number;
  pending: number;
  booking: number;
  booked: number;
  failed: number;
  skipped: number;
  dispatched: number;
} {
  const groups = groupOrdersByOrderId(orders);
  const counts = {
    all: groups.length,
    pending: 0,
    booking: 0,
    booked: 0,
    failed: 0,
    skipped: 0,
    dispatched: 0,
  };

  for (const group of groups) {
    const status = getGroupStatus(group.orders);
    if (status in counts) {
      counts[status as keyof typeof counts]++;
    }
  }

  return counts;
}

/**
 * 서버 대시보드용 카운트.
 * 대기: booked & dispatch_failed 아닌 것 | 발송완료: dispatched | 실패: dispatch_failed
 */
export function countServerGroups(orders: Order[]): {
  waiting: number;
  dispatched: number;
  dispatchFailed: number;
} {
  const groups = groupOrdersByOrderId(orders);
  const counts = { waiting: 0, dispatched: 0, dispatchFailed: 0 };

  for (const group of groups) {
    const status = getGroupStatus(group.orders);
    if (status === "dispatched") {
      counts.dispatched++;
    } else if (status === "booked") {
      // booked 중 dispatch_failed 여부 판단 (그룹 내 첫 번째 기준)
      const dispatchStatus = group.orders[0].dispatchStatus as DispatchStatus | null;
      if (dispatchStatus === "dispatch_failed") {
        counts.dispatchFailed++;
      } else {
        counts.waiting++;
      }
    }
  }

  return counts;
}
