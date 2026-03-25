"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

import { BookingConfirmDialog } from "@/components/BookingConfirmDialog";
import { OrderTable } from "@/components/OrderTable";
import { OrderTableSkeleton } from "@/components/OrderTableSkeleton";
import { StatusFilter } from "@/components/StatusFilter";
import type { ServerFilterKey } from "@/components/StatusFilter";
import { SyncButton } from "@/components/SyncButton";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useBookOrders,
  useCancelOrder,
  useOrders,
  useSyncOrders,
  useUpdateGroupDeliveryType,
  useUpdateGroupStatus,
} from "@/hooks/useOrders";

import { countGroupsByStatus, countServerGroups, groupOrdersByOrderId } from "@/lib/groupOrders";

import type { DeliveryType, OrderStatus } from "@/types";

const isServerMode = process.env.NEXT_PUBLIC_DEPLOY_MODE === "server";

/** 탭별 체크박스 선택 가능 상태 */
const SELECTABLE_PENDING = new Set(["pending", "failed"]);
const SELECTABLE_BOOKED = new Set(["booked"]);

/** 서버 모드 필터 → API 파라미터 매핑 */
function getServerApiParams(filter: ServerFilterKey): {
  status: string;
  dispatchFilter?: string;
} {
  switch (filter) {
    case "waiting":
      return { status: "booked", dispatchFilter: "pending" };
    case "dispatched":
      return { status: "dispatched" };
    case "dispatch_failed":
      return { status: "booked", dispatchFilter: "dispatch_failed" };
  }
}

export function Dashboard() {
  // 로컬 모드 필터
  const [localFilter, setLocalFilter] = useState<OrderStatus | undefined>("pending");
  // 서버 모드 필터
  const [serverFilter, setServerFilter] = useState<ServerFilterKey>("waiting");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // 예약 진행 추적 (2단계, 로컬 모드만)
  const bookingPhase = useRef<"idle" | "waiting" | "monitoring">("idle");
  const queryClient = useQueryClient();

  // 서버 모드: 필터에 따라 status + dispatchFilter 파라미터 생성
  const serverApiParams = isServerMode ? getServerApiParams(serverFilter) : null;

  // 데이터 조회 — 서버/로컬 모드별 다른 파라미터
  const { data, isLoading, isError } = useOrders(
    isServerMode ? serverApiParams!.status : localFilter,
    isServerMode ? serverApiParams!.dispatchFilter : undefined,
  );

  const syncMutation = useSyncOrders();
  const cancelMutation = useCancelOrder();
  const updateGroupStatusMutation = useUpdateGroupStatus();
  const updateGroupDeliveryTypeMutation = useUpdateGroupDeliveryType();
  const bookMutation = useBookOrders();

  // GS택배 쿠키 유효성 확인 (로컬 모드만)
  const cookieStatusQuery = useQuery({
    queryKey: ["gs-login-status"],
    queryFn: async () => {
      const res = await fetch("/api/gs-login/status");
      return res.json() as Promise<{ valid: boolean; lastSyncAt: string | null }>;
    },
    refetchInterval: 60_000,
    enabled: !isServerMode,
  });
  const isCookieExpired = cookieStatusQuery.data?.valid === false;

  const orders = data?.orders ?? [];
  const lastSyncTime = data?.lastSyncTime ?? null;

  // 전체 주문(필터 무관)을 기반으로 카운트 계산
  const allOrdersQuery = useOrders(undefined);
  const allOrders = allOrdersQuery.data?.orders ?? [];

  // 모드별 카운트
  const localStatusCounts = !isServerMode ? countGroupsByStatus(allOrders) : null;
  const serverStatusCounts = isServerMode ? countServerGroups(allOrders) : null;

  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));
  const selectedGroups = groupOrdersByOrderId(selectedOrders);

  // 예약 완료 감지 → 완료 탭으로 자동 이동 (로컬 모드만)
  useEffect(() => {
    if (isServerMode) return;
    if (bookingPhase.current === "idle") return;
    if (allOrders.length === 0) return;

    const hasBooking = allOrders.some((o) => o.status === "booking");

    if (bookingPhase.current === "waiting") {
      if (hasBooking) {
        bookingPhase.current = "monitoring";
      }
      return;
    }

    if (bookingPhase.current === "monitoring") {
      if (!hasBooking) {
        bookingPhase.current = "idle";
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        setLocalFilter("booked");
        toast.success("예약이 모두 완료되었습니다");
      }
    }
  }, [allOrders, queryClient]);

  function handleLocalFilterChange(status: OrderStatus | undefined) {
    setLocalFilter(status);
    setSelectedIds(new Set());
  }

  function handleServerFilterChange(filter: ServerFilterKey) {
    setServerFilter(filter);
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

  function handleCancelOrder(orderId: string) {
    cancelMutation.mutate(orderId, {
      onSuccess: () => {
        toast.success("주문이 취소되었습니다");
      },
      onError: (error) => {
        toast.error(`취소 실패: ${error.message}`);
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
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
        setLocalFilter("booked");
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
            {isServerMode
              ? "발송 대기 → 자동 발송처리"
              : "네이버 스마트스토어 주문 → GS택배 자동 예약"}
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

      {/* 상태 필터 — 서버/로컬 완전 분리 */}
      {isServerMode ? (
        <StatusFilter
          currentStatus={serverFilter}
          counts={serverStatusCounts!}
          onStatusChange={handleServerFilterChange}
          isServerMode={true}
        />
      ) : (
        <StatusFilter
          currentStatus={localFilter}
          counts={localStatusCounts!}
          onStatusChange={handleLocalFilterChange}
          isServerMode={false}
        />
      )}

      {/* 주문 테이블 */}
      {isLoading ? (
        <OrderTableSkeleton />
      ) : isError ? (
        <div className="border rounded-lg p-12 text-center text-destructive text-sm">
          주문 목록을 불러올 수 없습니다. 페이지를 새로고침해주세요.
        </div>
      ) : orders.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground text-sm space-y-2">
          <p>{isServerMode ? "해당 상태의 주문이 없습니다." : "주문 데이터가 없습니다."}</p>
          {!isServerMode && !lastSyncTime && (
            <p>동기화 버튼을 눌러 네이버 스마트스토어 주문을 가져오세요.</p>
          )}
        </div>
      ) : (
        <OrderTable
          orders={orders}
          selectedIds={selectedIds}
          onSelectedChange={setSelectedIds}
          onGroupDeliveryTypeChange={handleGroupDeliveryTypeChange}
          onGroupStatusChange={handleGroupStatusChange}
          selectable={!isServerMode}
          selectableStatuses={localFilter === "booked" ? SELECTABLE_BOOKED : SELECTABLE_PENDING}
          isServerMode={isServerMode}
          onCancelOrder={!isServerMode ? handleCancelOrder : undefined}
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
              localFilter === "booked"
                ? `예약완료 ${localStatusCounts!.booked}건`
                : `대기 ${localStatusCounts!.pending}건`
            )}
          </span>
          {localFilter === "booked" ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={selectedIds.size === 0 || cancelMutation.isPending}
              onClick={() => {
                if (window.confirm(`선택한 ${selectedGroups.length}건을 취소하시겠습니까?`)) {
                  for (const group of selectedGroups) {
                    handleCancelOrder(group.orderId);
                  }
                  setSelectedIds(new Set());
                }
              }}
            >
              선택 건 취소 ({selectedGroups.length}건)
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={selectedIds.size === 0 || bookMutation.isPending}
              onClick={() => handleOpenBookingDialog()}
            >
              선택 건 예약 ({selectedGroups.length}건)
            </Button>
          )}
        </div>
      )}

      {/* 예약 확인 다이얼로그 (로컬 모드만) */}
      {!isServerMode && <BookingConfirmDialog
        open={isBookingDialogOpen}
        onOpenChange={setIsBookingDialogOpen}
        selectedOrders={selectedOrders}
        isPending={bookMutation.isPending}
        onConfirm={handleBookConfirm}
      />}
    </div>
  );
}
