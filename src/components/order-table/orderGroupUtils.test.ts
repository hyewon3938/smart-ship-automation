import { describe, expect, it } from "vitest";

import {
  formatPickupDate,
  formatPrice,
  getGroupDeliveryStatus,
  getGroupDeliveryType,
  getGroupPickupDate,
  getGroupTotalPrice,
} from "./orderGroupUtils";
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
    bookedAt: null,
    trackingNumber: null,
    dispatchStatus: null,
    dispatchedAt: null,
    deliveryStatus: null,
    pickupDate: null,
    deliveryStatusCheckedAt: null,
    createdAt: "2026-03-14T09:00:00.000Z",
    updatedAt: "2026-03-14T09:00:00.000Z",
    ...overrides,
  };
}

describe("formatPrice", () => {
  it("금액을 원화 기호와 천 단위 구분으로 표시한다", () => {
    expect(formatPrice(12500)).toBe("₩12,500");
    expect(formatPrice(0)).toBe("₩0");
  });

  it("값이 없으면 대시를 표시한다", () => {
    expect(formatPrice(null)).toBe("-");
    expect(formatPrice(undefined)).toBe("-");
  });
});

describe("getGroupDeliveryType", () => {
  it("그룹 내 유형이 하나면 그 유형을 반환한다", () => {
    const orders = [
      makeOrder({ id: 1, selectedDeliveryType: "nextDay" }),
      makeOrder({ id: 2, selectedDeliveryType: "nextDay" }),
    ];
    expect(getGroupDeliveryType(orders)).toBe("nextDay");
  });

  it("유형이 섞여 있으면 국내택배를 반환한다", () => {
    const orders = [
      makeOrder({ id: 1, selectedDeliveryType: "nextDay" }),
      makeOrder({ id: 2, selectedDeliveryType: "visit" }),
    ];
    expect(getGroupDeliveryType(orders)).toBe("domestic");
  });
});

describe("getGroupTotalPrice", () => {
  it("금액을 합산하고 null은 0으로 센다", () => {
    const orders = [
      makeOrder({ id: 1, totalPrice: 2500 }),
      makeOrder({ id: 2, totalPrice: null }),
      makeOrder({ id: 3, totalPrice: 4000 }),
    ];
    expect(getGroupTotalPrice(orders)).toBe(6500);
  });

  it("빈 그룹은 0이다", () => {
    expect(getGroupTotalPrice([])).toBe(0);
  });
});

describe("getGroupDeliveryStatus", () => {
  it("배송완료가 하나라도 있으면 delivered", () => {
    const orders = [
      makeOrder({ id: 1, deliveryStatus: "delivering" }),
      makeOrder({ id: 2, deliveryStatus: "delivered" }),
    ];
    expect(getGroupDeliveryStatus(orders)).toBe("delivered");
  });

  it("배송완료 없이 배송중이 있으면 delivering", () => {
    const orders = [
      makeOrder({ id: 1, deliveryStatus: null }),
      makeOrder({ id: 2, deliveryStatus: "delivering" }),
    ];
    expect(getGroupDeliveryStatus(orders)).toBe("delivering");
  });

  it("추적 상태가 없으면 null", () => {
    expect(getGroupDeliveryStatus([makeOrder()])).toBeNull();
  });
});

describe("getGroupPickupDate", () => {
  it("가장 늦은 집화일시를 반환한다", () => {
    const orders = [
      makeOrder({ id: 1, pickupDate: "2026-03-15T10:00:00" }),
      makeOrder({ id: 2, pickupDate: null }),
      makeOrder({ id: 3, pickupDate: "2026-03-16T09:30:00" }),
    ];
    expect(getGroupPickupDate(orders)).toBe("2026-03-16T09:30:00");
  });

  it("집화일시가 하나도 없으면 null", () => {
    expect(getGroupPickupDate([makeOrder(), makeOrder({ id: 2 })])).toBeNull();
  });
});

describe("formatPickupDate", () => {
  // 오프셋 없는 ISO 문자열은 로컬 시간으로 해석되므로 실행 환경 타임존과 무관하다
  it("월/일은 그대로, 시·분은 두 자리로 채운다", () => {
    expect(formatPickupDate("2026-03-05T09:07:00")).toBe("3/5 09:07");
    expect(formatPickupDate("2026-11-24T18:30:00")).toBe("11/24 18:30");
  });
});
