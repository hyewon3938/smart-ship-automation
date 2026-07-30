import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { bookingLogs, orders } from "@/lib/db/schema";
import { maskId } from "@/lib/log-mask";
import {
  aggregateGroupState,
  findDeleteBlocker,
  needsServerCheckBeforeDelete,
  resolveServerStateSync,
} from "@/lib/order-lifecycle";

import type { OrderGroupState } from "@/lib/order-lifecycle";

import type { VisitDispatchInfo } from "@/lib/gs-delivery/types";
import type {
  BookingLogEntry,
  DeliveryTrackingStatus,
  DeliveryType,
  DispatchStatus,
  OrderStatus,
} from "@/types";

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

/** 복수 주문 조회 (워커에서 사용) */
export function getOrdersByIds(ids: number[]) {
  return db.select().from(orders).where(inArray(orders.id, ids)).all();
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
  screenshotPath?: string,
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
 * orderId 기준으로 첫 번째 row를 찾아 예약 로그 기록.
 * 서버에서 로컬 예약 결과를 수신할 때 사용.
 */
export function addBookingLogByOrderId(
  orderId: string,
  action: string,
  detail?: string,
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

// ─── 방문택배 자동 발송처리 (ADR-0001 참조) ───

/** 방문택배 매칭 대기 중인 그룹 1건 */
export interface VisitPickupGroup {
  orderId: string;
  /** 그룹 내 첫 row id (로그/로그테이블 키 용도) */
  firstDbId: number;
  /** 그룹 내 모든 row id (status 일괄 업데이트에 사용) */
  allDbIds: number[];
  recipientZipCode: string;
  recipientPhone: string;
}

/**
 * booking 상태이면서 방문택배인 그룹 조회 (dispatch-worker 매칭 대상).
 *
 * 사용자가 폼 입력 + 직접 결제까지 끝낸 후 status="booking" 상태로 멈춰 있다가,
 * 폴링이 GS 예약list에서 운송장을 매칭하면 status="booked"로 전이된다.
 */
export function getBookingVisitPickupGroups(): VisitPickupGroup[] {
  const rows = db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "booking" as OrderStatus),
        eq(orders.selectedDeliveryType, "visit"),
      ),
    )
    .all();

  const groupMap = new Map<string, typeof rows>();
  for (const r of rows) {
    const existing = groupMap.get(r.orderId) ?? [];
    existing.push(r);
    groupMap.set(r.orderId, existing);
  }

  return Array.from(groupMap.entries()).map(([orderId, items]) => ({
    orderId,
    firstDbId: items[0].id,
    allDbIds: items.map((i) => i.id),
    recipientZipCode: items[0].recipientZipCode,
    recipientPhone: items[0].recipientPhone,
  }));
}

/**
 * orderIds 그룹의 selectedDeliveryType을 "visit"으로 마킹.
 * book-visit 라우트에서 bookOrders 직후 호출 — 이후 폴링이 visit 그룹을 추적.
 */
export function markAsVisitPickup(orderIds: number[]): void {
  if (orderIds.length === 0) return;
  db.update(orders)
    .set({
      selectedDeliveryType: "visit",
      updatedAt: new Date().toISOString(),
    })
    .where(inArray(orders.id, orderIds))
    .run();
}

/**
 * 방문택배 스크래핑 결과를 booking 상태 그룹에 매핑 적용.
 *
 * 매칭 키: (recipientZipCode, recipientPhone 끝 4자리). 매칭된 그룹은
 *   - bookingReservationNo = 스크래핑한 GS 예약번호
 *   - trackingNumber       = 상세페이지의 운송장번호
 *   - dispatchStatus       = "pending_dispatch"
 *   - status               = "booked"
 * 로 업데이트되어 다음 폴링에서 일반택배와 같은 dispatch 흐름을 탄다.
 *
 * 매칭 안 된 line/group은 그대로 두어 다음 폴링에서 재시도된다.
 */
export function applyVisitDispatchInfo(infos: VisitDispatchInfo[]): {
  matched: number;
  unmatched: number;
  reservations: string[];
} {
  if (infos.length === 0) {
    return { matched: 0, unmatched: 0, reservations: [] };
  }

  const groups = getBookingVisitPickupGroups();
  const keyToGroup = new Map<string, VisitPickupGroup>();
  for (const g of groups) {
    const key = makeVisitMatchKey(g.recipientZipCode, g.recipientPhone);
    if (!key) continue;
    if (keyToGroup.has(key)) {
      // 동일 (zip+last4) 그룹이 둘 이상 — 매칭 모호. 경고만 남기고 skip
      console.warn(
        `[orders] 방문택배 매칭 키 충돌 — ${key} (orderId: ${maskId(g.orderId)})`,
      );
      continue;
    }
    keyToGroup.set(key, g);
  }

  const now = new Date().toISOString();
  let matched = 0;
  let unmatched = 0;
  const matchedReservations = new Set<string>();

  for (const info of infos) {
    for (const line of info.recipients) {
      const key = `${line.zipCode}:${line.phoneLast4}`;
      const group = keyToGroup.get(key);
      if (!group) {
        unmatched++;
        continue;
      }

      db.update(orders)
        .set({
          status: "booked" as OrderStatus,
          bookingReservationNo: info.reservationNo,
          trackingNumber: line.trackingNo,
          dispatchStatus: "pending_dispatch" as DispatchStatus,
          bookedAt: sql`COALESCE(${orders.bookedAt}, ${now})`,
          updatedAt: now,
        })
        .where(inArray(orders.id, group.allDbIds))
        .run();

      addBookingLog(
        group.firstDbId,
        "tracking",
        `방문택배 매칭: 예약 ${info.reservationNo}, 운송장 ${line.trackingNo}`,
      );

      matched++;
      matchedReservations.add(info.reservationNo);
      // 한 그룹은 한 번만 매칭 — 다른 line으로 재매칭 방지
      keyToGroup.delete(key);
    }
  }

  return {
    matched,
    unmatched,
    reservations: Array.from(matchedReservations),
  };
}

/**
 * 방문택배 타입 + 이미 GS 예약번호가 매핑된(=매칭 완료) 주문의 reservationNo 집합.
 *
 * 폴링이 scrapeVisitPickup을 호출할 때 이 집합을 knownReservationNos로 넘기면,
 * 이미 매칭 완료된 예약의 GS 상세페이지를 다시 fetch하지 않는다.
 * (PR #60 이후 dispatch-worker가 빈 배열로 호출 → GS 봇 감지 트리거 → 세션 조기 만료
 *   되던 문제 해결용 헬퍼. 같은 폴링 사이클에서 반복 fetch 방지가 핵심.)
 */
export function getMatchedVisitReservationNos(): string[] {
  const rows = db
    .select({ no: orders.bookingReservationNo })
    .from(orders)
    .where(
      and(
        eq(orders.selectedDeliveryType, "visit"),
        isNotNull(orders.bookingReservationNo),
      ),
    )
    .all();

  return Array.from(
    new Set(rows.map((r) => r.no).filter((n): n is string => !!n)),
  );
}

/**
 * 방문택배 매칭 키 생성.
 * - zipCode: 5자리 숫자 검증 후 그대로
 * - phone:   숫자만 남기고 끝 4자리 추출
 * 형식이 어긋나면 null 반환 (해당 그룹은 매칭에서 제외).
 */
function makeVisitMatchKey(zipCode: string, phone: string): string | null {
  const z = zipCode.trim();
  if (!/^\d{5}$/.test(z)) return null;
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.match(/(\d{4})$/);
  if (!last4) return null;
  return `${z}:${last4[1]}`;
}

// ─── 서버 → 로컬 상태 역동기화 (ADR-0005) ───

/** 역동기화 조회 범위 — 이보다 오래된 주문은 이미 종결된 것으로 보고 제외 */
function twoWeeksAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString();
}

/**
 * 서버 상태를 확인해야 하는 로컬 주문 그룹의 orderId 목록.
 *
 * 발송 주체는 서버뿐이므로, 로컬에서 아직 "진행 중"(booked/booking)이거나
 * 사용자가 수동으로 실패 처리한(failed) 그룹은 서버가 이미 발송처리했을 수 있다.
 */
export function getReconcilableOrderIds(): string[] {
  const rows = db
    .select({ orderId: orders.orderId })
    .from(orders)
    .where(
      and(
        inArray(orders.status, [
          "booked",
          "booking",
          "failed",
        ] as OrderStatus[]),
        gte(orders.createdAt, twoWeeksAgo()),
      ),
    )
    .all();

  return Array.from(new Set(rows.map((r) => r.orderId)));
}

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
 * 서버에서 받은 그룹 상태를 로컬 DB에 반영.
 *
 * @returns 실제로 변경했으면 변경 사유, 변경할 게 없으면 null
 */
export function applyServerGroupState(
  orderId: string,
  server: OrderGroupState,
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
      ? `서버 발송처리 확인 — 로컬 상태 동기화${patch.trackingNumber ? ` (운송장: ${patch.trackingNumber})` : ""}`
      : `서버에서 운송장 확인 — 로컬 동기화: ${patch.trackingNumber}`,
  );

  return patch.reason;
}

// ─── 주문 그룹 삭제 ───

/** 그룹 내 상태 목록 (삭제 가능 여부 판정용) */
export function getGroupStatuses(orderId: string): string[] {
  return db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.orderId, orderId))
    .all()
    .map((r) => r.status);
}

/** 삭제 전에 서버 상태를 먼저 확인해야 하는 그룹인지 */
export function shouldCheckServerBeforeDelete(orderId: string): boolean {
  return needsServerCheckBeforeDelete(getGroupStatuses(orderId));
}

/**
 * 주문 그룹을 DB에서 완전 삭제 (예약 로그 포함).
 *
 * tombstone을 남기지 않는 hard delete — 네이버에 아직 발송대기로 남아 있는
 * 주문은 다음 동기화에서 다시 수집된다 (ADR-0005).
 *
 * @throws 삭제 불가 상태(booking/dispatched)이거나 주문이 없으면 에러
 */
export function deleteOrderGroup(orderId: string): {
  deleted: number;
  recipientName: string | null;
} {
  const rows = db
    .select({
      id: orders.id,
      status: orders.status,
      recipientName: orders.recipientName,
    })
    .from(orders)
    .where(eq(orders.orderId, orderId))
    .all();

  const blocker = findDeleteBlocker(rows.map((r) => r.status));
  if (blocker) throw new Error(blocker);

  const ids = rows.map((r) => r.id);

  // 예약 로그 먼저 정리 (orders.id 참조 — 고아 레코드 방지)
  db.delete(bookingLogs).where(inArray(bookingLogs.orderId, ids)).run();
  const result = db.delete(orders).where(eq(orders.orderId, orderId)).run();

  console.log(
    `[orders] 주문 삭제 — ${maskId(orderId)} (${result.changes ?? 0}건)`,
  );

  return {
    deleted: result.changes ?? 0,
    recipientName: rows[0]?.recipientName ?? null,
  };
}
