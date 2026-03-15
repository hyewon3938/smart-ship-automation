import { z } from "zod";

// ──────────────────────────────────────────
// 토큰 응답
// ──────────────────────────────────────────
export const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(), // 초 단위 (기본 24시간으로 가정)
  token_type: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// ──────────────────────────────────────────
// 조건형 상품 주문 상세 내역 조회 (메인 조회용)
// GET /v1/pay-order/seller/product-orders
// ──────────────────────────────────────────

/** 조건형 API 원시 응답 파싱 (내부용) */
export const conditionalOrderContentSchema = z.object({
  order: z.object({
    orderId: z.string(),
    orderDate: z.string(),
  }),
  productOrder: z.object({
    productOrderId: z.string(),
    productOrderStatus: z.string(),
    productName: z.string(),
    quantity: z.number(),
    totalPaymentAmount: z.number(),
    productOption: z.string().optional(),
    optionCode: z.string().optional(),
    placeOrderStatus: z.string(),
    shippingMemo: z.string().optional(),
    shippingAddress: z.object({
      name: z.string(),
      tel1: z.string(),
      baseAddress: z.string(),
      detailedAddress: z.string().optional(),
      zipCode: z.string(),
    }),
  }),
});

export const conditionalOrdersResponseSchema = z.object({
  data: z.object({
    contents: z.array(
      z.object({
        productOrderId: z.string(),
        content: conditionalOrderContentSchema,
      })
    ),
    pagination: z.object({
      page: z.number(),
      size: z.number(),
      hasNext: z.boolean(),
    }),
  }),
});

export type ConditionalOrderContent = z.infer<typeof conditionalOrderContentSchema>;
export type ConditionalOrdersResponse = z.infer<typeof conditionalOrdersResponseSchema>;

// ──────────────────────────────────────────
// 내부 공통 타입 — sync.ts가 사용하는 주문 상세 인터페이스
// ──────────────────────────────────────────

export interface ProductOrderDetail {
  productOrderId: string;
  orderId: string;
  orderDate: string;
  productName: string;
  quantity: number;
  productOption: string | null;
  totalPaymentAmount: number;
  placeOrderStatus: string;
  shippingMemo: string | null;
  shippingAddress: {
    name: string;
    tel1: string;
    baseAddress: string;
    detailedAddress: string | null;
    zipCode: string;
  };
}

/** 조건형 API 응답 → ProductOrderDetail 변환 */
export function toProductOrderDetail(raw: ConditionalOrderContent): ProductOrderDetail {
  return {
    productOrderId: raw.productOrder.productOrderId,
    orderId: raw.order.orderId,
    orderDate: raw.order.orderDate,
    productName: raw.productOrder.productName,
    quantity: raw.productOrder.quantity,
    productOption: raw.productOrder.productOption ?? null,
    totalPaymentAmount: raw.productOrder.totalPaymentAmount,
    placeOrderStatus: raw.productOrder.placeOrderStatus,
    shippingMemo: raw.productOrder.shippingMemo ?? null,
    shippingAddress: {
      name: raw.productOrder.shippingAddress.name,
      tel1: raw.productOrder.shippingAddress.tel1,
      baseAddress: raw.productOrder.shippingAddress.baseAddress,
      detailedAddress: raw.productOrder.shippingAddress.detailedAddress ?? null,
      zipCode: raw.productOrder.shippingAddress.zipCode,
    },
  };
}

// ──────────────────────────────────────────
// 레거시 — 변경 주문 목록 조회 (last-changed-statuses)
// 조건형 API로 전환 후에도 폴백용으로 유지
// ──────────────────────────────────────────

export const lastChangedStatusesResponseSchema = z.object({
  data: z.object({
    lastChangeStatuses: z.array(
      z.object({
        productOrderId: z.string(),
        orderId: z.string(),
        lastChangedType: z.string(),
      })
    ),
  }),
});

export type LastChangedStatusesResponse = z.infer<
  typeof lastChangedStatusesResponseSchema
>;
