import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

import type { DeliveryType } from "@/types";

/** 전체 주문 목록 조회 (최신순) */
export function getOrders(status?: string) {
  const query = db.select().from(orders).orderBy(desc(orders.createdAt));

  if (status) {
    return query.where(eq(orders.status, status)).all();
  }

  return query.all();
}

/** 단일 주문 조회 */
export function getOrderById(id: number) {
  return db.select().from(orders).where(eq(orders.id, id)).get();
}

/** 택배 유형 변경 */
export function updateDeliveryType(id: number, deliveryType: DeliveryType) {
  const order = getOrderById(id);
  if (!order) throw new Error(`주문을 찾을 수 없습니다: ${id}`);
  if (order.status !== "pending") {
    throw new Error(
      `대기 상태의 주문만 변경할 수 있습니다 (현재: ${order.status})`
    );
  }
  if (deliveryType === "nextDay" && !order.isNextDayEligible) {
    throw new Error("내일배송 불가 지역입니다");
  }

  db.update(orders)
    .set({
      selectedDeliveryType: deliveryType,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.id, id))
    .run();

  return getOrderById(id);
}

/** 선택 주문 예약 시작 (상태 → booking) */
export function bookOrders(orderIds: number[]) {
  if (orderIds.length === 0) throw new Error("예약할 주문을 선택해주세요");

  const targetOrders = db
    .select()
    .from(orders)
    .where(inArray(orders.id, orderIds))
    .all();

  // 존재하지 않는 주문 확인
  if (targetOrders.length !== orderIds.length) {
    throw new Error("일부 주문을 찾을 수 없습니다");
  }

  // pending 상태가 아닌 주문 확인
  const nonPending = targetOrders.filter((o) => o.status !== "pending");
  if (nonPending.length > 0) {
    throw new Error(
      `대기 상태의 주문만 예약할 수 있습니다 (${nonPending.length}건 불가)`
    );
  }

  // 상태를 booking으로 변경
  const now = new Date().toISOString();
  db.update(orders)
    .set({ status: "booking", updatedAt: now })
    .where(inArray(orders.id, orderIds))
    .run();

  return { count: orderIds.length };
}
