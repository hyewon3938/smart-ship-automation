import type { Order, OrderGroup, OrderStatus, ServerFilter } from "@/types";

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
  }

  return counts;
}

/** 서버 필터에 따라 주문 필터링 (전체: undefined) */
export function filterOrdersByServerFilter(
  orders: Order[],
  filter: ServerFilter | undefined
): Order[] {
  if (!filter) return orders;

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
