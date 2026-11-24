import type { DeliveryTrackingStatus, DeliveryType, Order } from "@/types";

export const DELIVERY_TYPE_LABELS: Record<string, string> = {
  domestic: "국내택배",
  nextDay: "내일배송",
};

/** 배지로만 표시 (상태 변경 불가 최종 상태) */
export const NON_EDITABLE_BADGE_STATUSES = new Set([
  "booking",
  "dispatched",
  "skipped",
]);

/** 체크박스 선택 가능한 상태 (pending + failed = 재시도 가능) */
export const SELECTABLE_STATUSES = new Set(["pending", "failed"]);

export function formatPrice(price: number | null | undefined): string {
  if (price == null) return "-";
  return `₩${price.toLocaleString("ko-KR")}`;
}

/** 그룹 내 택배유형 값 (셀렉터용) */
export function getGroupDeliveryType(orders: Order[]): DeliveryType {
  const types = new Set(orders.map((o) => o.selectedDeliveryType));
  if (types.size === 1) return orders[0].selectedDeliveryType as DeliveryType;
  return "domestic"; // 혼합 시 기본값
}

/** 그룹 내 총 가격 */
export function getGroupTotalPrice(orders: Order[]): number {
  return orders.reduce((sum, o) => sum + (o.totalPrice ?? 0), 0);
}

/** 그룹 내 배송 추적 상태 (네이버 API 기반, 가장 진행된 상태 반환) */
export function getGroupDeliveryStatus(
  orders: Order[],
): DeliveryTrackingStatus | null {
  if (orders.some((o) => o.deliveryStatus === "delivered")) return "delivered";
  if (orders.some((o) => o.deliveryStatus === "delivering"))
    return "delivering";
  return null;
}

/** 그룹 내 가장 최근 집화일시 */
export function getGroupPickupDate(orders: Order[]): string | null {
  const dates = orders.map((o) => o.pickupDate).filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  return dates.sort().reverse()[0];
}

/** ISO 날짜를 "M/D HH:mm" 형식으로 */
export function formatPickupDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
