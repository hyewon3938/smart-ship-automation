import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { maskId } from "@/lib/log-mask";
import {
  aggregateGroupState,
  resolveServerStateSync,
} from "@/lib/order-lifecycle";

import { addBookingLog } from "./booking-logs";

import type { OrderGroupState } from "@/lib/order-lifecycle";
import type { DispatchStatus, OrderStatus } from "@/types";

/**
 * 로컬에서 전송된 주문 데이터를 서버 DB에 upsert.
 * 서버 DB에 해당 orderId의 주문이 없으면 INSERT, 있으면 UPDATE.
 */
export function upsertOrdersFromLocal(
  orderId: string,
  orderItems: Array<{
    productOrderId: string;
    orderDate: string;
    productName: string;
    quantity: number;
    optionInfo: string | null;
    totalPrice: number | null;
    recipientName: string;
    recipientPhone: string;
    recipientAddress: string;
    recipientAddressDetail: string | null;
    recipientZipCode: string;
    shippingMemo: string | null;
    isNextDayEligible: boolean;
    selectedDeliveryType: "domestic" | "nextDay" | "visit";
  }>,
  bookingResult?: string,
  bookingReservationNo?: string,
): {
  inserted: number;
  updated: number;
  skippedDispatched: number;
  allDispatched: boolean;
} {
  const now = new Date().toISOString();

  // 기존 주문 확인 (status 포함 — dispatched 보호용)
  const existing = db
    .select({
      productOrderId: orders.productOrderId,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.orderId, orderId))
    .all();

  const existingStatusByProductOrderId = new Map(
    existing.map((r) => [r.productOrderId, r.status]),
  );

  let skippedDispatched = 0;
  let inserted = 0;
  let updated = 0;
  for (const item of orderItems) {
    const existingStatus = existingStatusByProductOrderId.get(
      item.productOrderId,
    );
    if (existingStatus !== undefined) {
      // 발송처리 완료된 주문은 booked로 되돌리지 않음
      if (existingStatus === "dispatched") {
        skippedDispatched++;
        continue;
      }
      // 이미 있으면 UPDATE (selectedDeliveryType 포함 — 로컬에서 변경했을 수 있음)
      // bookedAt은 COALESCE로 최초 1회만 — 재동기화 때마다 예약 시각이 밀려나지 않게.
      db.update(orders)
        .set({
          status: "booked",
          selectedDeliveryType: item.selectedDeliveryType,
          bookingResult: bookingResult ?? null,
          bookingReservationNo: bookingReservationNo ?? null,
          bookedAt: sql`COALESCE(${orders.bookedAt}, ${now})`,
          updatedAt: now,
        })
        .where(eq(orders.productOrderId, item.productOrderId))
        .run();
      updated++;
    } else {
      // 없으면 INSERT
      db.insert(orders)
        .values({
          orderId,
          productOrderId: item.productOrderId,
          orderDate: item.orderDate,
          productName: item.productName,
          quantity: item.quantity,
          optionInfo: item.optionInfo,
          totalPrice: item.totalPrice,
          recipientName: item.recipientName,
          recipientPhone: item.recipientPhone,
          recipientAddress: item.recipientAddress,
          recipientAddressDetail: item.recipientAddressDetail,
          recipientZipCode: item.recipientZipCode,
          shippingMemo: item.shippingMemo,
          isNextDayEligible: item.isNextDayEligible,
          selectedDeliveryType: item.selectedDeliveryType,
          status: "booked",
          bookingResult: bookingResult ?? null,
          bookingReservationNo: bookingReservationNo ?? null,
          bookedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      inserted++;
    }
  }

  const existingCount = existingStatusByProductOrderId.size;
  console.log(
    `[orders] upsert 완료: ${maskId(orderId)} — 기존 ${existingCount}건, 신규 ${orderItems.length - existingCount}건` +
      (skippedDispatched > 0 ? `, 발송완료 보호 ${skippedDispatched}건` : ""),
  );

  // 모든 orderItems 가 dispatched 라서 스킵된 경우 — 로컬에 알려서 로컬 DB 도 dispatched 로 정리하게 함
  const allDispatched =
    orderItems.length > 0 && skippedDispatched === orderItems.length;
  return { inserted, updated, skippedDispatched, allDispatched };
}

/**
 * orderId 기준으로 해당 주문 그룹 상태를 일괄 업데이트.
 * 서버에서 로컬 예약 결과를 수신할 때 사용 (DB의 row id가 서버와 다를 수 있음).
 * 발송처리 완료(dispatched)된 row는 제외 — 로컬 재동기화로 booked로 되돌아가는 것 방지.
 */
export function updateOrdersByOrderId(
  orderId: string,
  status: OrderStatus,
  bookingResult?: string,
  bookingReservationNo?: string,
): void {
  const now = new Date().toISOString();
  db.update(orders)
    .set({
      status,
      bookingResult: bookingResult ?? null,
      bookingReservationNo: bookingReservationNo ?? null,
      // booked 전환 시 예약 시각 최초 1회 기록 (예약 후 1시간 스크래핑 기준점)
      ...(status === "booked"
        ? { bookedAt: sql`COALESCE(${orders.bookedAt}, ${now})` }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(orders.orderId, orderId),
        ne(orders.status, "dispatched" as OrderStatus),
      ),
    )
    .run();
}

/**
 * orderId 기준 전체 주문 그룹을 dispatched 상태로 마킹.
 * 로컬 → 서버 동기화 응답에서 "서버가 이미 dispatched 됐다" 라고 알려줬을 때
 * 로컬 DB 도 dispatched 로 정리하여 재동기화 루프를 끊는다.
 */
export function markOrderGroupAsDispatched(orderId: string): number {
  const now = new Date().toISOString();
  const result = db
    .update(orders)
    .set({
      status: "dispatched" as OrderStatus,
      dispatchStatus: "dispatched" as DispatchStatus,
      dispatchedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(orders.orderId, orderId),
        ne(orders.status, "dispatched" as OrderStatus),
      ),
    )
    .run();
  return result.changes ?? 0;
}

// ─── 서버 → 로컬 상태 역동기화 (ADR-0005) ───

/**
 * orderId 목록의 그룹 상태 조회 (서버가 로컬 질의에 응답할 때 사용).
 * 서버 DB에 없는 orderId는 결과에서 빠진다.
 */
export function getOrderGroupStates(
  orderIds: string[],
): Array<{ orderId: string } & OrderGroupState> {
  if (orderIds.length === 0) return [];

  const rows = db
    .select({
      orderId: orders.orderId,
      status: orders.status,
      dispatchStatus: orders.dispatchStatus,
      trackingNumber: orders.trackingNumber,
      dispatchedAt: orders.dispatchedAt,
    })
    .from(orders)
    .where(inArray(orders.orderId, orderIds))
    .all();

  const byOrderId = new Map<string, typeof rows>();
  for (const r of rows) {
    const existing = byOrderId.get(r.orderId) ?? [];
    existing.push(r);
    byOrderId.set(r.orderId, existing);
  }

  const states: Array<{ orderId: string } & OrderGroupState> = [];
  for (const [orderId, group] of byOrderId) {
    const state = aggregateGroupState(group);
    if (state) states.push({ orderId, ...state });
  }
  return states;
}

/**
 * 발송 주체(서버 또는 네이버)의 그룹 상태를 로컬 DB에 반영.
 *
 * @param source 예약 로그에 남길 출처 표기 — 나중에 "왜 상태가 바뀌었나"를
 *   추적할 때 서버 역동기화와 네이버 원천 대조를 구분할 수 있어야 한다
 * @returns 실제로 변경했으면 변경 사유, 변경할 게 없으면 null
 */
export function applyServerGroupState(
  orderId: string,
  server: OrderGroupState,
  source = "서버",
): "dispatched" | "tracking" | null {
  const rows = db
    .select({
      id: orders.id,
      status: orders.status,
      dispatchStatus: orders.dispatchStatus,
      trackingNumber: orders.trackingNumber,
      dispatchedAt: orders.dispatchedAt,
    })
    .from(orders)
    .where(eq(orders.orderId, orderId))
    .all();

  const local = aggregateGroupState(rows);
  if (!local) return null;

  const patch = resolveServerStateSync(local, server);
  if (!patch) return null;

  const now = new Date().toISOString();
  db.update(orders)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.dispatchStatus ? { dispatchStatus: patch.dispatchStatus } : {}),
      ...(patch.trackingNumber ? { trackingNumber: patch.trackingNumber } : {}),
      ...(patch.reason === "dispatched"
        ? { dispatchedAt: patch.dispatchedAt ?? now }
        : {}),
      updatedAt: now,
    })
    .where(eq(orders.orderId, orderId))
    .run();

  // action은 로그 다이얼로그가 아는 값만 사용 (모르는 값은 배지에 원문 노출)
  addBookingLog(
    rows[0].id,
    patch.reason === "dispatched" ? "complete" : "info",
    patch.reason === "dispatched"
      ? `${source} 발송처리 확인 — 로컬 상태 동기화${patch.trackingNumber ? ` (운송장: ${patch.trackingNumber})` : ""}`
      : `${source}에서 운송장 확인 — 로컬 동기화: ${patch.trackingNumber}`,
  );

  return patch.reason;
}
