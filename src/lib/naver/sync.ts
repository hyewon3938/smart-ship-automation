import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { fetchPendingOrders } from "./orders";
import { isNextDayDeliveryEligible } from "./regions";

import type { Order } from "@/types";
import type { ProductOrderDetail } from "./types";

/**
 * 단일 주문을 DB에 upsert (productOrderId 기준 중복 방지)
 * existing이 있으면 update, 없으면 insert
 */
function upsertOrder(order: ProductOrderDetail, existing: Order | undefined): void {
  const baseAddress = order.shippingAddress.baseAddress;
  const detailedAddress = order.shippingAddress.detailedAddress ?? null;
  const fullAddress = `${baseAddress} ${detailedAddress ?? ""}`.trim();
  const isNextDay = isNextDayDeliveryEligible(fullAddress);

  if (existing) {
    db.update(orders)
      .set({
        orderDate: order.orderDate,
        productName: order.productName,
        quantity: order.quantity,
        optionInfo: order.productOption ?? null,
        totalPrice: order.totalPaymentAmount,
        recipientName: order.shippingAddress.name,
        recipientPhone: order.shippingAddress.tel1,
        recipientAddress: baseAddress,
        recipientAddressDetail: detailedAddress,
        recipientZipCode: order.shippingAddress.zipCode,
        shippingMemo: order.shippingMemo,
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
        optionInfo: order.productOption ?? null,
        totalPrice: order.totalPaymentAmount,
        recipientName: order.shippingAddress.name,
        recipientPhone: order.shippingAddress.tel1,
        recipientAddress: baseAddress,
        recipientAddressDetail: detailedAddress,
        recipientZipCode: order.shippingAddress.zipCode,
        shippingMemo: order.shippingMemo,
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
  awaitingAddress: number;
}> {
  const { orders: pendingOrders, awaitingAddress } = await fetchPendingOrders();

  if (awaitingAddress.length > 0) {
    // 예약이 불가능한 이유가 "아직 주소가 없다"는 것뿐이므로, 나중에 주소가 채워지면
    // 다음 동기화에서 정상 주문으로 들어온다. 여기서는 존재만 알린다.
    console.log(
      `[sync] 배송지 대기 ${awaitingAddress.length}건 — ` +
        awaitingAddress
          .map((o) => `${o.productOrderId}(${o.orderDate.slice(0, 10)})`)
          .join(", "),
    );
  }

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

    upsertOrder(order, existing);

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
    awaitingAddress: awaitingAddress.length,
  };
}
