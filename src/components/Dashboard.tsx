"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BookingConfirmDialog } from "@/components/BookingConfirmDialog";
import { OrderTable } from "@/components/OrderTable";
import { OrderTableSkeleton } from "@/components/OrderTableSkeleton";
import { StatusFilter } from "@/components/StatusFilter";
import { SyncButton } from "@/components/SyncButton";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  useBookOrders,
  useOrders,
  useSyncOrders,
  useUpdateGroupDeliveryType,
  useUpdateGroupStatus,
} from "@/hooks/useOrders";

import { countGroupsByStatus, groupOrdersByOrderId } from "@/lib/groupOrders";

import type { DeliveryType, OrderStatus } from "@/types";

export function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>(
    "pending"
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);

  // 예약 진행 추적 (2단계):
  // 1단계(waiting): 예약 시작 → "booking" 상태가 나타날 때까지 대기
  // 2단계(monitoring): "booking" 확인 → "booking"이 사라지면 완료 탭 전환
  const bookingPhase = useRef<"idle" | "waiting" | "monitoring">("idle");
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useOrders(statusFilter);
  const syncMutation = useSyncOrders();
  const updateGroupStatusMutation = useUpdateGroupStatus();
  const updateGroupDeliveryTypeMutation = useUpdateGroupDeliveryType();
  const bookMutation = useBookOrders();

  const orders = data?.orders ?? [];
  const lastSyncTime = data?.lastSyncTime ?? null;

  // 전체 주문(필터 무관)을 기반으로 상태별 카운트 계산
  const allOrdersQuery = useOrders(undefined);
  const allOrders = allOrdersQuery.data?.orders ?? [];

  // 주문(orderId) 그룹 기준 상태별 카운트 — 화면에 보이는 숫자는 모두 주문 단위
  const statusCounts = countGroupsByStatus(allOrders);

  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));
  const selectedGroups = groupOrdersByOrderId(selectedOrders);

  // 예약 완료 감지 → 완료 탭으로 자동 이동 (2단계)
  useEffect(() => {
    if (bookingPhase.current === "idle") return;
    if (allOrders.length === 0) return;

    const hasBooking = allOrders.some((o) => o.status === "booking");

    if (bookingPhase.current === "waiting") {
      // 1단계: "booking" 상태가 데이터에 나타날 때까지 대기
      if (hasBooking) {
        bookingPhase.current = "monitoring";
      }
      return;
    }

    if (bookingPhase.current === "monitoring") {
      // 2단계: "booking"이 모두 사라지면 → 완료
      if (!hasBooking) {
        bookingPhase.current = "idle";
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        setStatusFilter("booked");
        toast.success("예약이 모두 완료되었습니다");
      }
    }
  }, [allOrders, queryClient]);

  function handleStatusFilterChange(status: OrderStatus | undefined) {
    setStatusFilter(status);
    setSelectedIds(new Set()); // 필터 변경 시 선택 초기화
  }

  function handleSync() {
    syncMutation.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(
          `동기화 완료: ${result.created}건 추가, ${result.updated}건 갱신`
        );
      },
      onError: (error) => {
        toast.error(`동기화 실패: ${error.message}`);
      },
    });
  }

  function handleGroupDeliveryTypeChange(
    orderId: string,
    deliveryType: DeliveryType
  ) {
    updateGroupDeliveryTypeMutation.mutate(
      { orderId, deliveryType },
      {
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  }

  function handleGroupStatusChange(orderId: string, status: OrderStatus) {
    updateGroupStatusMutation.mutate(
      { orderId, status },
      {
        onSuccess: () => {
          toast.success("상태가 변경되었습니다");
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  }

  function handleOpenBookingDialog() {
    setIsBookingDialogOpen(true);
  }

  function handleBookConfirm() {
    const ids = Array.from(selectedIds);
    bookMutation.mutate(ids, {
      onSuccess: (result) => {
        toast.success(result.message);
        setSelectedIds(new Set());
        setIsBookingDialogOpen(false);
        // 전체 보기로 전환하여 booking→booked 진행 상황 표시
        setStatusFilter(undefined);
        bookingPhase.current = "waiting";
      },
      onError: (error) => {
        toast.error(`예약 실패: ${error.message}`);
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Smart Ship Automation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            네이버 스마트스토어 주문 → GS택배 자동 예약
          </p>
        </div>
        <SyncButton
          lastSyncTime={lastSyncTime}
          isPending={syncMutation.isPending}
          onSync={handleSync}
        />
      </div>

      {/* 상태 필터 */}
      <StatusFilter
        currentStatus={statusFilter}
        counts={statusCounts}
        onStatusChange={handleStatusFilterChange}
      />

      {/* 주문 테이블 */}
      {isLoading ? (
        <OrderTableSkeleton />
      ) : isError ? (
        <div className="border rounded-lg p-12 text-center text-destructive text-sm">
          주문 목록을 불러올 수 없습니다. 페이지를 새로고침해주세요.
        </div>
      ) : orders.length === 0 && !lastSyncTime ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground text-sm space-y-2">
          <p>주문 데이터가 없습니다.</p>
          <p>동기화 버튼을 눌러 네이버 스마트스토어 주문을 가져오세요.</p>
        </div>
      ) : (
        <OrderTable
          orders={orders}
          selectedIds={selectedIds}
          onSelectedChange={setSelectedIds}
          onGroupDeliveryTypeChange={handleGroupDeliveryTypeChange}
          onGroupStatusChange={handleGroupStatusChange}
        />
      )}

      {/* 액션 바 */}
      {orders.length > 0 && (
        <div className="flex items-center justify-between gap-4 pt-2 border-t">
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0 ? (
              <span>
                <strong>{selectedGroups.length}건</strong> 선택됨
                <span className="ml-1 text-xs">({selectedIds.size}개 상품)</span>
              </span>
            ) : (
              `대기 ${statusCounts.pending}건`
            )}
          </span>
          <Button
            size="sm"
            disabled={selectedIds.size === 0 || bookMutation.isPending}
            onClick={() => handleOpenBookingDialog()}
          >
            선택 건 예약 ({selectedGroups.length}건)
          </Button>
        </div>
      )}

      {/* 예약 확인 다이얼로그 */}
      <BookingConfirmDialog
        open={isBookingDialogOpen}
        onOpenChange={setIsBookingDialogOpen}
        selectedOrders={selectedOrders}
        isPending={bookMutation.isPending}
        onConfirm={handleBookConfirm}
      />
    </div>
  );
}
