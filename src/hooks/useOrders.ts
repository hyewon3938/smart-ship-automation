"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { requestJson } from "@/lib/api-client";
import type {
  BookingLogEntry,
  DeliveryType,
  OrdersResponse,
  SyncResult,
} from "@/types";

/** 주문 목록 조회 + booking 상태 시 3초 폴링 */
export function useOrders(status?: string) {
  return useQuery<OrdersResponse>({
    queryKey: ["orders", { status }],
    queryFn: () => {
      const params = status ? `?status=${status}` : "";
      return requestJson<OrdersResponse>(`/api/orders${params}`);
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.orders) return false;
      return data.orders.some((o) => o.status === "booking") ? 3000 : false;
    },
  });
}

/** 주문 동기화 (네이버 API → DB) */
export function useSyncOrders() {
  const queryClient = useQueryClient();
  return useMutation<SyncResult & { message: string }>({
    mutationFn: () =>
      requestJson<SyncResult & { message: string }>("/api/orders/sync", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 주문 그룹 상태 수동 변경 */
export function useUpdateGroupStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      requestJson("/api/orders/group", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 주문 그룹 택배유형 일괄 변경 */
export function useUpdateGroupDeliveryType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      deliveryType,
    }: {
      orderId: string;
      deliveryType: DeliveryType;
    }) =>
      requestJson("/api/orders/group", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, deliveryType }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/**
 * 주문 그룹 삭제 (앱 목록에서만 제거 — GS 예약·네이버 주문은 취소되지 않음).
 * 대기 상태 삭제 건은 네이버에 남아 있으면 다음 동기화에서 다시 수집된다.
 */
export function useDeleteOrderGroup() {
  const queryClient = useQueryClient();
  return useMutation<
    { success: boolean; deleted: number; recipientName: string | null },
    Error,
    string
  >({
    mutationFn: (orderId) =>
      requestJson<{
        success: boolean;
        deleted: number;
        recipientName: string | null;
      }>(`/api/orders/group?orderId=${encodeURIComponent(orderId)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 주문의 예약 로그 조회 */
export function useBookingLogs(orderId: number | null) {
  return useQuery<{ logs: BookingLogEntry[] }>({
    queryKey: ["bookingLogs", orderId],
    queryFn: () =>
      requestJson<{ logs: BookingLogEntry[] }>(`/api/orders/${orderId}/logs`),
    enabled: orderId !== null,
  });
}

/** 선택 주문 예약 */
export function useBookOrders() {
  const queryClient = useQueryClient();
  return useMutation<{ message: string; count: number }, Error, number[]>({
    mutationFn: (orderIds) =>
      requestJson<{ message: string; count: number }>("/api/orders/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 진행 중인 예약 취소 */
export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; recovered: number }>({
    mutationFn: () =>
      requestJson<{ success: boolean; recovered: number }>(
        "/api/orders/cancel-booking",
        { method: "POST" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 방문택배 다량 접수 */
export function useBookVisitPickup() {
  const queryClient = useQueryClient();
  return useMutation<
    { message: string; groupCount: number; productCount: number },
    Error,
    number[]
  >({
    mutationFn: (orderIds) =>
      requestJson<{
        message: string;
        groupCount: number;
        productCount: number;
      }>("/api/orders/book-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
