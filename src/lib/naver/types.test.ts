import { describe, it, expect } from "vitest";

import { splitByShippingAddress } from "./types";

import type { ConditionalOrderContent } from "./types";

/** 조건형 API 응답 1건 — shippingAddress 유무만 바꿔가며 쓴다 */
function content(
  productOrderId: string,
  withAddress: boolean,
): ConditionalOrderContent {
  return {
    order: {
      orderId: `O-${productOrderId}`,
      orderDate: "2026-08-10T12:05:24.643+09:00",
    },
    productOrder: {
      productOrderId,
      productOrderStatus: "PAYED",
      productName: "비즈식물 오브제",
      quantity: 1,
      totalPaymentAmount: 26000,
      placeOrderStatus: "OK",
      ...(withAddress
        ? {
            shippingAddress: {
              name: "홍길동",
              tel1: "010-0000-0000",
              baseAddress: "서울특별시 강남구 역삼동",
              zipCode: "06234",
            },
          }
        : {}),
    },
  };
}

describe("splitByShippingAddress", () => {
  it("배송지가 있는 주문만 예약 대상으로 분류한다", () => {
    const { orders, awaitingAddress } = splitByShippingAddress([
      content("1", true),
      content("2", true),
    ]);

    expect(orders.map((o) => o.productOrderId)).toEqual(["1", "2"]);
    expect(awaitingAddress).toEqual([]);
  });

  it("배송지가 없는 주문은 버리지 않고 대기 목록으로 넘긴다", () => {
    const { orders, awaitingAddress } = splitByShippingAddress([
      content("1", true),
      content("2", false),
    ]);

    expect(orders.map((o) => o.productOrderId)).toEqual(["1"]);
    expect(awaitingAddress).toEqual([
      {
        productOrderId: "2",
        orderId: "O-2",
        orderDate: "2026-08-10T12:05:24.643+09:00",
        productName: "비즈식물 오브제",
      },
    ]);
  });

  it("빈 페이지는 빈 결과를 낸다", () => {
    expect(splitByShippingAddress([])).toEqual({
      orders: [],
      awaitingAddress: [],
    });
  });
});
