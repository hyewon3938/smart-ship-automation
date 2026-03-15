import type { InferSelectModel } from "drizzle-orm";

import type { orders } from "@/lib/db/schema";

/** DB에서 조회된 주문 타입 */
export type Order = InferSelectModel<typeof orders>;

/** 주문 동기화 결과 */
export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}
