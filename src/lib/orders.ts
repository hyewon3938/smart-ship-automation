import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

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
