import { z } from "zod";

// 토큰 응답
export const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(), // 초 단위 (기본 24시간으로 가정)
  token_type: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// 변경 주문 목록 응답 (Step 1)
// GET /v1/pay-order/seller/product-orders/last-changed-statuses
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

// 주문 상세 응답 (Step 2)
// POST /v1/pay-order/seller/product-orders/query
export const productOrderDetailSchema = z.object({
  productOrderId: z.string(),
  orderId: z.string(),
  orderDate: z.string(),
  productName: z.string(),
  quantity: z.number(),
  optionManageCode: z.string().optional(),
  totalPaymentAmount: z.number(),
  shippingAddress: z.object({
    name: z.string(),
    tel1: z.string(),
    baseAddress: z.string(),
    detailAddress: z.string().optional(),
    zipCode: z.string(),
  }),
  placeOrderStatus: z.string(),
});

export const productOrdersQueryResponseSchema = z.object({
  data: z.array(
    z.object({
      productOrder: productOrderDetailSchema,
    })
  ),
});

export type ProductOrderDetail = z.infer<typeof productOrderDetailSchema>;
export type ProductOrdersQueryResponse = z.infer<
  typeof productOrdersQueryResponseSchema
>;
