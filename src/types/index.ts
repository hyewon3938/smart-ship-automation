import type { InferSelectModel } from "drizzle-orm";

import type { orders } from "@/lib/db/schema";

/** DB에서 조회된 주문 타입 */
export type Order = InferSelectModel<typeof orders>;

/** 주문 상태 */
export type OrderStatus = "pending" | "booking" | "booked" | "failed" | "skipped" | "dispatched";

/** 발송처리 상태 */
export type DispatchStatus = "pending_dispatch" | "dispatched" | "dispatch_failed";

/** 서버 대시보드 필터 (발송 흐름 기준) */
export type ServerFilter = "waiting" | "dispatched" | "dispatch_failed";

/** 배송 추적 상태 (네이버 API 기반) */
export type DeliveryTrackingStatus = "delivering" | "delivered";

/** 택배 유형 */
export type DeliveryType = "domestic" | "nextDay";

/** orderId 기준 주문 그룹 (같은 배송지 묶음) */
export interface OrderGroup {
  orderId: string;
  orders: Order[];
  recipientName: string;
  recipientAddress: string;
  recipientAddressDetail: string | null;
  recipientZipCode: string;
  recipientPhone: string;
  shippingMemo: string | null;
  isNextDayEligible: boolean;
  orderDate: string;
}

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

/** 설정 카테고리별 타입 */
export interface NaverSettings {
  clientId: string;
  clientSecret: string;
}

export interface GsSettings {
  username: string;
  password: string;
}

export interface SenderSettings {
  name: string;
  phone: string;
  zipcode: string;
  address: string;
  addressDetail: string;
}

export interface BookingDefaults {
  defaultProductType: string;
  defaultPrice: string;
  defaultDeliveryType: DeliveryType;
}

export interface DispatchSettings {
  autoMode: boolean;
  pollIntervalMin: number;
  /** 내일배송 택배사 코드 (기본값 DELIVERBOX — 실제 확인 필요) */
  nextDayDeliveryCode: string;
}

export interface AllSettings {
  naver: NaverSettings;
  gs: GsSettings;
  sender: SenderSettings;
  booking: BookingDefaults;
  dispatch: DispatchSettings;
}
