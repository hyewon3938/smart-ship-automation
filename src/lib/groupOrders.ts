import type { Order, OrderGroup } from "@/types";

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
      shippingMemo: first.shippingMemo,
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
