"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BookingLogEntry, DeliveryType, OrdersResponse, SyncResult } from "@/types";

/** 주문 목록 조회 + booking 상태 시 3초 폴링 */
export function useOrders(status?: string) {
  return useQuery<OrdersResponse>({
    queryKey: ["orders", { status }],
    queryFn: async () => {
      const params = status ? `?status=${status}` : "";
      const res = await fetch(`/api/orders${params}`);
      if (!res.ok) throw new Error("주문 목록 조회 실패");
      return res.json();
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
    mutationFn: async () => {
      const res = await fetch("/api/orders/sync", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "동기화 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 주문 그룹 상태 수동 변경 */
export function useUpdateGroupStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      status,
    }: {
      orderId: string;
      status: string;
    }) => {
      const res = await fetch("/api/orders/group", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "상태 변경 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 주문 그룹 택배유형 일괄 변경 */
export function useUpdateGroupDeliveryType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      deliveryType,
    }: {
      orderId: string;
      deliveryType: DeliveryType;
    }) => {
      const res = await fetch("/api/orders/group", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, deliveryType }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "택배 유형 변경 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 주문의 예약 로그 조회 */
export function useBookingLogs(orderId: number | null) {
  return useQuery<{ logs: BookingLogEntry[] }>({
    queryKey: ["bookingLogs", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/logs`);
      if (!res.ok) throw new Error("로그 조회 실패");
      return res.json();
    },
    enabled: orderId !== null,
  });
}

/** 선택 주문 예약 */
export function useBookOrders() {
  const queryClient = useQueryClient();
  return useMutation<{ message: string; count: number }, Error, number[]>({
    mutationFn: async (orderIds) => {
      const res = await fetch("/api/orders/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "예약 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 진행 중인 예약 취소 */
export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; recovered: number }>({
    mutationFn: async () => {
      const res = await fetch("/api/orders/cancel-booking", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "예약 취소 실패");
      }
      return res.json();
    },
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
    mutationFn: async (orderIds) => {
      const res = await fetch("/api/orders/book-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "방문택배 예약 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
