"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

import { BookingConfirmDialog } from "@/components/BookingConfirmDialog";
import { VisitPickupConfirmDialog } from "@/components/VisitPickupConfirmDialog";
import { DispatchPanel } from "@/components/DispatchPanel";
import { OrderTable } from "@/components/OrderTable";
import { OrderTableSkeleton } from "@/components/OrderTableSkeleton";
import { StatusFilter } from "@/components/StatusFilter";
import { SyncButton } from "@/components/SyncButton";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useBookOrders,
  useBookVisitPickup,
  useOrders,
  useSyncOrders,
  useUpdateGroupDeliveryType,
  useUpdateGroupStatus,
} from "@/hooks/useOrders";

import { countGroupsByStatus, groupOrdersByOrderId } from "@/lib/groupOrders";

import type { DeliveryType, OrderStatus } from "@/types";

const isServerMode = process.env.NEXT_PUBLIC_DEPLOY_MODE === "server";

export function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>(
    "pending"
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [isVisitPickupDialogOpen, setIsVisitPickupDialogOpen] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

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
  const visitPickupMutation = useBookVisitPickup();

  // GS택배 쿠키 유효성 확인 (만료 시 로그인 배너 표시)
  const cookieStatusQuery = useQuery({
    queryKey: ["gs-login-status"],
    queryFn: async () => {
      const res = await fetch("/api/gs-login/status");
      return res.json() as Promise<{ valid: boolean; lastSyncAt: string | null }>;
    },
    refetchInterval: 60_000, // 1분마다 재확인
  });
  const isCookieExpired = cookieStatusQuery.data?.valid === false;

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

  async function handleGsLogin() {
    setIsLoggingIn(true);
    toast.info("브라우저에서 GS택배 로그인을 진행합니다. CAPTCHA를 처리해주세요.");
    try {
      const res = await fetch("/api/gs-login", { method: "POST" });
      const data = (await res.json()) as { success: boolean; message: string };
      if (data.success) {
        toast.success(data.message);
        void cookieStatusQuery.refetch();
      } else {
        toast.error(data.message);
      }
    } catch {
      toast.error("로그인 요청 실패");
    } finally {
      setIsLoggingIn(false);
    }
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
        // 예약 완료 → 예약완료 탭으로 이동 + 데이터 갱신
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
        setStatusFilter("booked");
      },
      onError: (error) => {
        toast.error(`예약 실패: ${error.message}`);
      },
    });
  }

  function handleVisitPickupConfirm() {
    const ids = Array.from(selectedIds);
    visitPickupMutation.mutate(ids, {
      onSuccess: (result) => {
        toast.success(result.message);
        setSelectedIds(new Set());
        setIsVisitPickupDialogOpen(false);
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
      },
      onError: (error) => {
        toast.error(`방문택배 실패: ${error.message}`);
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
        <div className="flex items-center gap-3">
          {!isServerMode && (
            <button
              onClick={() => void handleGsLogin()}
              disabled={isLoggingIn}
              className={`text-sm hover:text-foreground disabled:opacity-50 ${
                isLoggingIn
                  ? "animate-pulse text-muted-foreground"
                  : isCookieExpired
                    ? "text-orange-600 font-medium"
                    : "text-muted-foreground"
              }`}
            >
              {isLoggingIn ? "로그인 중..." : `GS로그인${isCookieExpired ? " (만료)" : ""}`}
            </button>
          )}
          <Link
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            설정
          </Link>
          {!isServerMode && (
            <SyncButton
              lastSyncTime={lastSyncTime}
              isPending={syncMutation.isPending}
              onSync={handleSync}
            />
          )}
        </div>
      </div>

      {/* GS택배 로그인 만료 배너 (로컬 모드만) */}
      {!isServerMode && isCookieExpired && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
          <span className="text-orange-800">
            GS택배 로그인 세션이 만료되었습니다. 예약 전에 로그인해주세요.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-orange-300 text-orange-700 hover:bg-orange-100"
            disabled={isLoggingIn}
            onClick={() => void handleGsLogin()}
          >
            {isLoggingIn ? "로그인 중..." : "GS택배 로그인"}
          </Button>
        </div>
      )}

      {/* 상태 필터 */}
      <StatusFilter
        currentStatus={statusFilter}
        counts={statusCounts}
        onStatusChange={handleStatusFilterChange}
        isServerMode={isServerMode}
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
          selectable={!isServerMode}
        />
      )}

      {/* 액션 바 (로컬 모드만) */}
      {!isServerMode && orders.length > 0 && (
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
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                selectedGroups.length < 2 ||
                visitPickupMutation.isPending ||
                bookMutation.isPending
              }
              onClick={() => setIsVisitPickupDialogOpen(true)}
            >
              방문택배 ({selectedGroups.length}건)
            </Button>
            <Button
              size="sm"
              disabled={selectedIds.size === 0 || bookMutation.isPending}
              onClick={() => handleOpenBookingDialog()}
            >
              선택 건 예약 ({selectedGroups.length}건)
            </Button>
          </div>
        </div>
      )}

      {/* 발송처리 패널 (서버 모드에서만 표시) */}
      {isServerMode && <DispatchPanel orders={allOrders} isServerMode={isServerMode} />}

      {/* 예약 확인 다이얼로그 (로컬 모드만) */}
      {!isServerMode && <BookingConfirmDialog
        open={isBookingDialogOpen}
        onOpenChange={setIsBookingDialogOpen}
        selectedOrders={selectedOrders}
        isPending={bookMutation.isPending}
        onConfirm={handleBookConfirm}
      />}

      {/* 방문택배 확인 다이얼로그 (로컬 모드만) */}
      {!isServerMode && <VisitPickupConfirmDialog
        open={isVisitPickupDialogOpen}
        onOpenChange={setIsVisitPickupDialogOpen}
        selectedOrders={selectedOrders}
        isPending={visitPickupMutation.isPending}
        onConfirm={handleVisitPickupConfirm}
      />}
    </div>
  );
}
