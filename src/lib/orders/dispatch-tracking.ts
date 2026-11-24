import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

import type {
  DeliveryTrackingStatus,
  DispatchStatus,
  OrderStatus,
} from "@/types";

/** 운송장번호 업데이트 + pending_dispatch 마킹 (orderId 기준 일괄) */
export function updateTrackingNumbers(
  orderId: string,
  trackingNumber: string,
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
  status: "dispatched" | "dispatch_failed",
): void {
  const now = new Date().toISOString();
  db.update(orders)
    .set({
      dispatchStatus: status as DispatchStatus,
      status:
        status === "dispatched" ? ("dispatched" as OrderStatus) : undefined,
      dispatchedAt: status === "dispatched" ? now : null,
      updatedAt: now,
    })
    .where(eq(orders.orderId, orderId))
    .run();
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
  deliveryStatus: DeliveryTrackingStatus,
  pickupDate?: string | null,
): void {
  db.update(orders)
    .set({
      deliveryStatus,
      pickupDate: pickupDate ?? null,
      deliveryStatusCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.productOrderId, productOrderId))
    .run();
}

// ─── 서버 → 로컬 상태 역동기화 (ADR-0005) ───

/**
 * 서버 상태를 확인해야 하는 로컬 주문 그룹의 orderId 목록.
 *
 * 발송 주체는 서버뿐이므로, 로컬에서 아직 "진행 중"(booked/booking)이거나
 * 사용자가 수동으로 실패 처리한(failed) 그룹은 서버가 이미 발송처리했을 수 있다.
 *
 * 기간 제한을 두지 않는다. 예전에는 createdAt 2주 이내로 잘랐는데, 그 창을 벗어난
 * 미완결 그룹은 어떤 경로로도 정리되지 않아 "영원히 예약완료"로 남았다.
 * 호출부(`reconcileFromServer`)가 서버 상한(300건)에 맞춰 청크로 나눠 조회한다.
 */
export function getReconcilableOrderIds(): string[] {
  const rows = db
    .select({ orderId: orders.orderId })
    .from(orders)
    .where(
      inArray(orders.status, ["booked", "booking", "failed"] as OrderStatus[]),
    )
    .all();

  return Array.from(new Set(rows.map((r) => r.orderId)));
}

/**
 * 네이버 원천 대조가 필요한 "묵은" 예약완료 항목.
 *
 * 정상 흐름이면 예약완료 그룹은 당일 안에 서버가 운송장을 잡아 발송처리하고,
 * 그 결과가 역동기화로 돌아온다. 하루가 지나도 운송장조차 없는 그룹은 그 경로가
 * 끊긴 것 — 서버 DB가 모르는 그룹(서버 도입 이전 주문 등)이 여기 해당한다.
 *
 * @param olderThanHours 예약(없으면 생성) 시각이 이보다 오래된 건만
 */
export function getStaleBookedProductOrders(
  olderThanHours = 24,
): Array<{ orderId: string; productOrderId: string }> {
  const cutoff = new Date(
    Date.now() - olderThanHours * 60 * 60 * 1000,
  ).toISOString();

  return db
    .select({
      orderId: orders.orderId,
      productOrderId: orders.productOrderId,
      bookedAt: orders.bookedAt,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "booked" as OrderStatus),
        isNull(orders.trackingNumber),
      ),
    )
    .all()
    .filter((r) => (r.bookedAt ?? r.createdAt) < cutoff)
    .map(({ orderId, productOrderId }) => ({ orderId, productOrderId }));
}
