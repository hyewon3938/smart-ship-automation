import { describe, expect, it } from "vitest";

import { groupOrdersByOrderId } from "./groupOrders";
import type { Order } from "@/types";

/** 테스트용 Order 생성 헬퍼 */
function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    orderId: "2026030744965061",
    productOrderId: "2026030744965061001",
    orderDate: "2026-03-14T08:49:00.000Z",
    productName: "테스트 상품",
    quantity: 1,
    optionInfo: null,
    totalPrice: 2500,
    recipientName: "홍길동",
    recipientPhone: "010-1234-5678",
    recipientAddress: "서울시 강남구",
    recipientAddressDetail: "101호",
    recipientZipCode: "06000",
    shippingMemo: null,
    status: "pending",
    isNextDayEligible: true,
    selectedDeliveryType: "domestic",
    bookingResult: null,
    bookingReservationNo: null,
    trackingNumber: null,
    dispatchStatus: null,
    dispatchedAt: null,
    createdAt: "2026-03-14T09:00:00.000Z",
    updatedAt: "2026-03-14T09:00:00.000Z",
    ...overrides,
  };
}

describe("groupOrdersByOrderId", () => {
  it("같은 orderId 주문을 하나의 그룹으로 묶는다", () => {
    const orders = [
      makeOrder({ id: 1, productOrderId: "001", orderId: "A" }),
      makeOrder({ id: 2, productOrderId: "002", orderId: "A" }),
      makeOrder({ id: 3, productOrderId: "003", orderId: "B" }),
    ];

    const groups = groupOrdersByOrderId(orders);
    expect(groups).toHaveLength(2);

    const groupA = groups.find((g) => g.orderId === "A");
    const groupB = groups.find((g) => g.orderId === "B");

    expect(groupA?.orders).toHaveLength(2);
    expect(groupB?.orders).toHaveLength(1);
  });

  it("빈 배열이면 빈 배열을 반환한다", () => {
    expect(groupOrdersByOrderId([])).toEqual([]);
  });

  it("수령인/주소 정보는 첫 번째 주문에서 가져온다", () => {
    const orders = [
      makeOrder({
        id: 1,
        orderId: "A",
        productOrderId: "001",
        recipientName: "김철수",
        shippingMemo: "문 앞에 두세요",
      }),
      makeOrder({
        id: 2,
        orderId: "A",
        productOrderId: "002",
        recipientName: "김철수",
        shippingMemo: "문 앞에 두세요",
      }),
    ];

    const groups = groupOrdersByOrderId(orders);
    expect(groups[0].recipientName).toBe("김철수");
    expect(groups[0].shippingMemo).toBe("문 앞에 두세요");
  });

  it("isNextDayEligible은 그룹 내 전체가 eligible일 때만 true", () => {
    const allEligible = [
      makeOrder({ id: 1, orderId: "A", productOrderId: "001", isNextDayEligible: true }),
      makeOrder({ id: 2, orderId: "A", productOrderId: "002", isNextDayEligible: true }),
    ];
    expect(groupOrdersByOrderId(allEligible)[0].isNextDayEligible).toBe(true);

    const mixed = [
      makeOrder({ id: 1, orderId: "B", productOrderId: "001", isNextDayEligible: true }),
      makeOrder({ id: 2, orderId: "B", productOrderId: "002", isNextDayEligible: false }),
    ];
    expect(groupOrdersByOrderId(mixed)[0].isNextDayEligible).toBe(false);
  });

  it("orderDate 기준 최신 순으로 정렬한다", () => {
    const orders = [
      makeOrder({
        id: 1,
        orderId: "OLD",
        productOrderId: "001",
        orderDate: "2026-03-10T00:00:00.000Z",
      }),
      makeOrder({
        id: 2,
        orderId: "NEW",
        productOrderId: "002",
        orderDate: "2026-03-14T00:00:00.000Z",
      }),
    ];

    const groups = groupOrdersByOrderId(orders);
    expect(groups[0].orderId).toBe("NEW");
    expect(groups[1].orderId).toBe("OLD");
  });
});
