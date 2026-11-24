import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { bookingLogs, orders } from "@/lib/db/schema";

import type { BookingLogEntry } from "@/types";

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
