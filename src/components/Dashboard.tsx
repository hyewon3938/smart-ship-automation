"use client";

import { useState } from "react";
import { toast } from "sonner";

import { BookingConfirmDialog } from "@/components/BookingConfirmDialog";
import { OrderTable } from "@/components/OrderTable";
import { OrderTableSkeleton } from "@/components/OrderTableSkeleton";
import { StatusFilter } from "@/components/StatusFilter";
import { SyncButton } from "@/components/SyncButton";
import { Button } from "@/components/ui/button";
import {
  useBookOrders,
  useOrders,
  useSyncOrders,
  useUpdateDeliveryType,
} from "@/hooks/useOrders";

import type { DeliveryType, Order, OrderStatus } from "@/types";

export function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>(
    undefined
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);

  const { data, isLoading, isError } = useOrders(statusFilter);
  const syncMutation = useSyncOrders();
  const updateDeliveryTypeMutation = useUpdateDeliveryType();
  const bookMutation = useBookOrders();

  const orders = data?.orders ?? [];
  const lastSyncTime = data?.lastSyncTime ?? null;

  // 전체 주문(필터 무관)을 기반으로 상태별 카운트 계산
  // useOrders(undefined)는 전체를 조회하므로 현재 data를 활용하되,
  // statusFilter 적용 시에는 UI에서 전체 카운트를 0으로 표시하지 않도록 별도 전체 조회
  const allOrdersQuery = useOrders(undefined);
  const allOrders = allOrdersQuery.data?.orders ?? [];

  const statusCounts = {
    all: allOrders.length,
    pending: allOrders.filter((o) => o.status === "pending").length,
    booking: allOrders.filter((o) => o.status === "booking").length,
    booked: allOrders.filter((o) => o.status === "booked").length,
    failed: allOrders.filter((o) => o.status === "failed").length,
    skipped: allOrders.filter((o) => o.status === "skipped").length,
  };

  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));

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

  function handleDeliveryTypeChange(id: number, type: DeliveryType) {
    updateDeliveryTypeMutation.mutate(
      { id, deliveryType: type },
      {
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  }

  function handleOpenBookingDialog(targetOrders?: Order[]) {
    // targetOrders가 없으면 현재 화면의 pending 주문 전체
    if (targetOrders) {
      setSelectedIds(new Set(targetOrders.map((o) => o.id)));
    }
    setIsBookingDialogOpen(true);
  }

  function handleBookConfirm() {
    const ids = Array.from(selectedIds);
    bookMutation.mutate(ids, {
      onSuccess: (result) => {
        toast.success(result.message);
        setSelectedIds(new Set());
        setIsBookingDialogOpen(false);
      },
      onError: (error) => {
        toast.error(`예약 실패: ${error.message}`);
      },
    });
  }

  const pendingOrders = orders.filter((o) => o.status === "pending");

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
          onDeliveryTypeChange={handleDeliveryTypeChange}
        />
      )}

      {/* 액션 바 */}
      {orders.length > 0 && (
        <div className="flex items-center justify-between gap-4 pt-2 border-t">
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0 ? (
              <span>
                <strong>{selectedIds.size}건</strong> 선택됨
              </span>
            ) : (
              `대기 ${statusCounts.pending}건`
            )}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={selectedIds.size === 0 || bookMutation.isPending}
              onClick={() => handleOpenBookingDialog()}
            >
              선택 예약 ({selectedIds.size}건)
            </Button>
            <Button
              size="sm"
              disabled={pendingOrders.length === 0 || bookMutation.isPending}
              onClick={() => handleOpenBookingDialog(pendingOrders)}
            >
              전체 예약 ({pendingOrders.length}건)
            </Button>
          </div>
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
