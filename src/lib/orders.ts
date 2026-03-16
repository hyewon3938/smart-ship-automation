import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { bookingLogs, orders } from "@/lib/db/schema";

import type { BookingLogEntry, DeliveryTrackingStatus, DeliveryType, DispatchStatus, OrderStatus } from "@/types";

/** 전체 주문 목록 조회 (최신순) */
export function getOrders(status?: string) {
  const query = db.select().from(orders).orderBy(desc(orders.createdAt));

  if (status) {
    return query.where(eq(orders.status, status as OrderStatus)).all();
  }

  return query.all();
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

  // 예약 가능 상태(pending/failed)가 아닌 주문 확인
  const bookableStatuses = new Set(["pending", "failed"]);
  const nonBookable = targetOrders.filter(
    (o) => !bookableStatuses.has(o.status)
  );
  if (nonBookable.length > 0) {
    throw new Error(
      `대기/실패 상태의 주문만 예약할 수 있습니다 (${nonBookable.length}건 불가)`
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

/** 복수 주문 조회 (워커에서 사용) */
export function getOrdersByIds(ids: number[]) {
  return db.select().from(orders).where(inArray(orders.id, ids)).all();
}

/** 주문 상태 업데이트 — 여러 ID 일괄 (같은 orderId 그룹) */
export function updateOrderStatusBatch(
  ids: number[],
  status: OrderStatus,
  bookingResult?: string,
  bookingReservationNo?: string
): void {
  if (ids.length === 0) return;
  db.update(orders)
    .set({
      status,
      bookingResult: bookingResult ?? null,
      bookingReservationNo: bookingReservationNo ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(inArray(orders.id, ids))
    .run();
}

/** 주문의 예약 로그 조회 (최신순) */
export function getBookingLogs(orderId: number): BookingLogEntry[] {
  return db
    .select()
    .from(bookingLogs)
    .where(eq(bookingLogs.orderId, orderId))
    .orderBy(desc(bookingLogs.createdAt))
    .all() as BookingLogEntry[];
}

/** 예약 로그 기록 */
export function addBookingLog(
  orderId: number,
  action: string,
  detail?: string,
  screenshotPath?: string
): void {
  db.insert(bookingLogs)
    .values({
      orderId,
      action,
      detail: detail ?? null,
      screenshotPath: screenshotPath ?? null,
    })
    .run();
}

/** 주문 그룹 상태 수동 변경 (orderId 기준, 전체 상품 일괄) */
export function updateGroupStatus(
  orderId: string,
  status: OrderStatus
): void {
  const allowedStatuses = new Set(["pending", "booked", "failed"]);
  if (!allowedStatuses.has(status)) {
    throw new Error(`허용되지 않은 상태입니다: ${status}`);
  }

  const now = new Date().toISOString();
  db.update(orders)
    .set({ status, updatedAt: now })
    .where(eq(orders.orderId, orderId))
    .run();
}

/** 주문 그룹 택배유형 일괄 변경 (orderId 기준) */
export function updateGroupDeliveryType(
  orderId: string,
  deliveryType: DeliveryType
): void {
  const groupOrders = db
    .select()
    .from(orders)
    .where(eq(orders.orderId, orderId))
    .all();

  if (groupOrders.length === 0) throw new Error("주문을 찾을 수 없습니다");

  const bookableStatuses = new Set(["pending", "failed"]);
  const nonBookable = groupOrders.filter(
    (o) => !bookableStatuses.has(o.status)
  );
  if (nonBookable.length > 0) {
    throw new Error("대기/실패 상태의 주문만 변경할 수 있습니다");
  }

  if (deliveryType === "nextDay") {
    const ineligible = groupOrders.filter((o) => !o.isNextDayEligible);
    if (ineligible.length > 0) {
      throw new Error("내일배송 불가 지역입니다");
    }
  }

  db.update(orders)
    .set({
      selectedDeliveryType: deliveryType,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.orderId, orderId))
    .run();
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
  }));
}

/** 운송장번호 업데이트 + pending_dispatch 마킹 (orderId 기준 일괄) */
export function updateTrackingNumbers(
  orderId: string,
  trackingNumber: string
): void {
  db.update(orders)
    .set({
      trackingNumber,
      dispatchStatus: "pending_dispatch" as DispatchStatus,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.orderId, orderId))
    .run();
}

/** 발송처리 상태 업데이트 (orderId 기준 일괄) */
export function updateDispatchStatus(
  orderId: string,
  status: "dispatched" | "dispatch_failed"
): void {
  const now = new Date().toISOString();
  db.update(orders)
    .set({
      dispatchStatus: status as DispatchStatus,
      status: status === "dispatched" ? ("dispatched" as OrderStatus) : undefined,
      dispatchedAt: status === "dispatched" ? now : null,
      updatedAt: now,
    })
    .where(eq(orders.orderId, orderId))
    .run();
}

/**
 * orderId 기준으로 해당 주문 그룹 상태를 일괄 업데이트.
 * 서버에서 로컬 예약 결과를 수신할 때 사용 (DB의 row id가 서버와 다를 수 있음).
 */
export function updateOrdersByOrderId(
  orderId: string,
  status: OrderStatus,
  bookingResult?: string,
  bookingReservationNo?: string
): void {
  db.update(orders)
    .set({
      status,
      bookingResult: bookingResult ?? null,
      bookingReservationNo: bookingReservationNo ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.orderId, orderId))
    .run();
}

/**
 * orderId 기준으로 첫 번째 row를 찾아 예약 로그 기록.
 * 서버에서 로컬 예약 결과를 수신할 때 사용.
 */
export function addBookingLogByOrderId(
  orderId: string,
  action: string,
  detail?: string
): void {
  const first = db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderId, orderId))
    .get();
  if (first) {
    addBookingLog(first.id, action, detail);
  }
}

/** dispatched 상태이면서 배송상태 미확인인 주문의 productOrderId 목록 */
export function getUncheckedDispatchedOrders(): Array<{
  orderId: string;
  productOrderId: string;
}> {
  const dispatched = db
    .select({
      orderId: orders.orderId,
      productOrderId: orders.productOrderId,
      deliveryStatus: orders.deliveryStatus,
    })
    .from(orders)
    .where(eq(orders.status, "dispatched" as OrderStatus))
    .all();

  // 이미 delivering/delivered 확인된 건은 제외
  return dispatched.filter((o) => !o.deliveryStatus);
}

/** 배송상태 업데이트 (productOrderId 기준) */
export function updateDeliveryStatus(
  productOrderId: string,
  deliveryStatus: DeliveryTrackingStatus
): void {
  db.update(orders)
    .set({
      deliveryStatus,
      deliveryStatusCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.productOrderId, productOrderId))
    .run();
}

/**
 * "booking" 상태로 멈춘 주문을 "pending"으로 복구.
 * 서버 재시작 시 워커 초기화에서 호출.
 */
export function recoverStuckBookings(): number {
  const stuck = db
    .select()
    .from(orders)
    .where(eq(orders.status, "booking" as OrderStatus))
    .all();

  if (stuck.length === 0) return 0;

  db.update(orders)
    .set({ status: "pending", updatedAt: new Date().toISOString() })
    .where(eq(orders.status, "booking" as OrderStatus))
    .run();

  return stuck.length;
}
