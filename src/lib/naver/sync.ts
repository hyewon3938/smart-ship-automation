import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

import { fetchPendingOrders } from "./orders";
import { isNextDayDeliveryEligible } from "./regions";
import type { ProductOrderDetail } from "./types";

/**
 * 단일 주문을 DB에 upsert (productOrderId 기준 중복 방지)
 * pending 상태가 아닌 주문(이미 처리 중/완료)은 업데이트하지 않음
 */
function upsertOrder(order: ProductOrderDetail): void {
  const address =
    `${order.shippingAddress.baseAddress} ${order.shippingAddress.detailAddress ?? ""}`.trim();
  const isNextDay = isNextDayDeliveryEligible(address);

  const existing = db
    .select()
    .from(orders)
    .where(eq(orders.productOrderId, order.productOrderId))
    .get();

  if (existing) {
    if (existing.status !== "pending") return;

    db.update(orders)
      .set({
        orderDate: order.orderDate,
        productName: order.productName,
        quantity: order.quantity,
        optionInfo: order.optionManageCode ?? null,
        totalPrice: order.totalPaymentAmount,
        recipientName: order.shippingAddress.name,
        recipientPhone: order.shippingAddress.tel1,
        recipientAddress: address,
        recipientZipCode: order.shippingAddress.zipCode,
        isNextDayEligible: isNextDay,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(orders.productOrderId, order.productOrderId))
      .run();
  } else {
    db.insert(orders)
      .values({
        orderId: order.orderId,
        productOrderId: order.productOrderId,
        orderDate: order.orderDate,
        productName: order.productName,
        quantity: order.quantity,
        optionInfo: order.optionManageCode ?? null,
        totalPrice: order.totalPaymentAmount,
        recipientName: order.shippingAddress.name,
        recipientPhone: order.shippingAddress.tel1,
        recipientAddress: address,
        recipientZipCode: order.shippingAddress.zipCode,
        status: "pending",
        isNextDayEligible: isNextDay,
        selectedDeliveryType: isNextDay ? "nextDay" : "domestic",
      })
      .run();
  }
}

/**
 * 네이버 API에서 발송대기 주문을 조회하고 DB에 동기화
 */
export async function syncOrders(): Promise<{
  total: number;
  created: number;
  updated: number;
  skipped: number;
}> {
  const pendingOrders = await fetchPendingOrders();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const order of pendingOrders) {
    const existing = db
      .select()
      .from(orders)
      .where(eq(orders.productOrderId, order.productOrderId))
      .get();

    if (existing && existing.status !== "pending") {
      skipped++;
      continue;
    }

    upsertOrder(order);

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  return {
    total: pendingOrders.length,
    created,
    updated,
    skipped,
  };
}
