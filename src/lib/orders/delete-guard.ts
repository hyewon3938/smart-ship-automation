import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { bookingLogs, orders } from "@/lib/db/schema";
import { maskId } from "@/lib/log-mask";
import {
  findDeleteBlocker,
  needsServerCheckBeforeDelete,
} from "@/lib/order-lifecycle";

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
