import type { InferSelectModel } from "drizzle-orm";

import type { orders } from "@/lib/db/schema";

/** DB에서 조회된 주문 타입 */
export type Order = InferSelectModel<typeof orders>;

/** 주문 상태 */
export type OrderStatus = "pending" | "booking" | "booked" | "failed" | "skipped";

/** 택배 유형 */
export type DeliveryType = "domestic" | "nextDay";

/** 주문 동기화 결과 */
export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

/** 주문 목록 API 응답 */
export interface OrdersResponse {
  orders: Order[];
  lastSyncTime: string | null;
}

/** 예약 로그 항목 */
export interface BookingLogEntry {
  id: number;
  orderId: number;
  action: string;
  detail: string | null;
  screenshotPath: string | null;
  createdAt: string;
}
