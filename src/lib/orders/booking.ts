import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

import type { DeliveryType, DispatchStatus, OrderStatus } from "@/types";

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
    (o) => !bookableStatuses.has(o.status),
  );
  if (nonBookable.length > 0) {
    throw new Error(
      `대기/실패 상태의 주문만 예약할 수 있습니다 (${nonBookable.length}건 불가)`,
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

/** 주문 상태 업데이트 — 여러 ID 일괄 (같은 orderId 그룹) */
export function updateOrderStatusBatch(
  ids: number[],
  status: OrderStatus,
  bookingResult?: string,
  bookingReservationNo?: string,
): void {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  db.update(orders)
    .set({
      status,
      bookingResult: bookingResult ?? null,
      bookingReservationNo: bookingReservationNo ?? null,
      // 예약 완료(booked) 전환 시 최초 시각만 기록 — 예약 후 1시간 스크래핑의 기준점.
      // COALESCE로 이미 값이 있으면 유지(재호출 시 1시간 창이 밀려나지 않게).
      ...(status === "booked"
        ? { bookedAt: sql`COALESCE(${orders.bookedAt}, ${now})` }
        : {}),
      updatedAt: now,
    })
    .where(inArray(orders.id, ids))
    .run();
}

/** 주문 그룹 상태 수동 변경 (orderId 기준, 전체 상품 일괄) */
export function updateGroupStatus(orderId: string, status: OrderStatus): void {
  const allowedStatuses = new Set([
    "pending",
    "booked",
    "failed",
    "dispatched",
  ]);
  if (!allowedStatuses.has(status)) {
    throw new Error(`허용되지 않은 상태입니다: ${status}`);
  }

  const now = new Date().toISOString();

  if (status === "dispatched") {
    // 수동 발송완료: status + dispatchStatus + dispatchedAt 일괄 설정
    db.update(orders)
      .set({
        status,
        dispatchStatus: "dispatched" as DispatchStatus,
        dispatchedAt: now,
        updatedAt: now,
      })
      .where(eq(orders.orderId, orderId))
      .run();
  } else if (status === "booked") {
    // booked 로 (되)돌릴 때 예약 시각 최초 1회 기록 (예약 후 1시간 스크래핑 기준점)
    db.update(orders)
      .set({
        status,
        bookedAt: sql`COALESCE(${orders.bookedAt}, ${now})`,
        updatedAt: now,
      })
      .where(eq(orders.orderId, orderId))
      .run();
  } else {
    db.update(orders)
      .set({ status, updatedAt: now })
      .where(eq(orders.orderId, orderId))
      .run();
  }
}

/** 주문 그룹 택배유형 일괄 변경 (orderId 기준) */
export function updateGroupDeliveryType(
  orderId: string,
  deliveryType: DeliveryType,
): void {
  const groupOrders = db
    .select()
    .from(orders)
    .where(eq(orders.orderId, orderId))
    .all();

  if (groupOrders.length === 0) throw new Error("주문을 찾을 수 없습니다");

  const bookableStatuses = new Set(["pending", "failed"]);
  const nonBookable = groupOrders.filter(
    (o) => !bookableStatuses.has(o.status),
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

/**
 * "booking" 상태로 멈춘 주문을 "pending"으로 복구.
 * 서버 재시작 시 워커 초기화에서 호출.
 *
 * 방문택배(selectedDeliveryType="visit")는 사용자가 결제할 때까지 booking 상태가
 * 정상 — 폴링 매칭 대상이므로 복구 대상에서 제외한다.
 */
export function recoverStuckBookings(): number {
  const stuck = db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "booking" as OrderStatus),
        ne(orders.selectedDeliveryType, "visit"),
      ),
    )
    .all();

  if (stuck.length === 0) return 0;

  db.update(orders)
    .set({ status: "pending", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(orders.status, "booking" as OrderStatus),
        ne(orders.selectedDeliveryType, "visit"),
      ),
    )
    .run();

  return stuck.length;
}
