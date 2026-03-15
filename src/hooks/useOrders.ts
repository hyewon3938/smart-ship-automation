"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DeliveryType, OrdersResponse, SyncResult } from "@/types";

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

/** 택배 유형 변경 */
export function useUpdateDeliveryType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      deliveryType,
    }: {
      id: number;
      deliveryType: DeliveryType;
    }) => {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedDeliveryType: deliveryType }),
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
