import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

import type { DispatchStatus, OrderStatus } from "@/types";

/** 최근 1주 기준 날짜 생성 */
function oneWeekAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

/** 전체 주문 목록 조회 (최신순, 최근 1주만 — dispatched 포함) */
export function getOrders(status?: string) {
  const since = oneWeekAgo();

  if (status) {
    return db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, status as OrderStatus),
          gte(orders.createdAt, since),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .all();
  }

  return db
    .select()
    .from(orders)
    .where(gte(orders.createdAt, since))
    .orderBy(desc(orders.createdAt))
    .all();
}

/** 복수 주문 조회 (워커에서 사용) */
export function getOrdersByIds(ids: number[]) {
  return db.select().from(orders).where(inArray(orders.id, ids)).all();
}

/** booked 상태 주문 그룹 조회 (발송처리 워커용) */
export function getBookedOrderGroups(): Array<{
  orderId: string;
  firstDbId: number;
  bookingReservationNo: string | null;
  trackingNumber: string | null;
  dispatchStatus: DispatchStatus | null;
  deliveryType: string;
  productOrderIds: string[];
  bookedAt: string | null;
}> {
  const bookedOrders = db
    .select()
    .from(orders)
    .where(eq(orders.status, "booked" as OrderStatus))
    .all();

  const groups = new Map<string, typeof bookedOrders>();
  for (const order of bookedOrders) {
    const existing = groups.get(order.orderId) ?? [];
    existing.push(order);
    groups.set(order.orderId, existing);
  }

  return Array.from(groups.entries()).map(([orderId, items]) => ({
    orderId,
    firstDbId: items[0].id,
    bookingReservationNo: items[0].bookingReservationNo,
    trackingNumber: items[0].trackingNumber,
    dispatchStatus: items[0].dispatchStatus as DispatchStatus | null,
    deliveryType: items[0].selectedDeliveryType,
    productOrderIds: items.map((o) => o.productOrderId),
    bookedAt: items[0].bookedAt,
  }));
}

/** 로컬 DB에서 booked 상태 주문의 동기화용 최소 정보 조회 (orderId 중복 제거) */
export function getLocalBookedOrders(): Array<{
  orderId: string;
  bookingResult: string | null;
  bookingReservationNo: string | null;
}> {
  const rows = db
    .select({
      orderId: orders.orderId,
      bookingResult: orders.bookingResult,
      bookingReservationNo: orders.bookingReservationNo,
    })
    .from(orders)
    .where(eq(orders.status, "booked" as OrderStatus))
    .all();

  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.orderId)) return false;
    seen.add(r.orderId);
    return true;
  });
}

/** orderId로 주문 상세 데이터 조회 (서버 동기화용) */
export function getOrderDetailsByOrderId(orderId: string) {
  return db.select().from(orders).where(eq(orders.orderId, orderId)).all();
}
