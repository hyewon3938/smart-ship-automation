"use client";

import { Button } from "@/components/ui/button";

interface SelectionActionBarProps {
  /** 선택된 상품(행) 수 */
  selectedCount: number;
  /** 선택된 주문(그룹) 수 */
  selectedGroupCount: number;
  pendingCount: number;
  bookingCount: number;
  isCancelPending: boolean;
  isVisitPickupPending: boolean;
  isBookPending: boolean;
  onCancelBooking: () => void;
  onOpenVisitPickupDialog: () => void;
  onOpenBookingDialog: () => void;
}

/** 하단 선택 액션 바 — 선택 건 예약·방문택배·예약 취소 */
export function SelectionActionBar({
  selectedCount,
  selectedGroupCount,
  pendingCount,
  bookingCount,
  isCancelPending,
  isVisitPickupPending,
  isBookPending,
  onCancelBooking,
  onOpenVisitPickupDialog,
  onOpenBookingDialog,
}: SelectionActionBarProps) {
  return (
    <div className="flex items-center justify-between gap-4 pt-2 border-t">
      <span className="text-sm text-muted-foreground">
        {selectedCount > 0 ? (
          <span>
            <strong>{selectedGroupCount}건</strong> 선택됨
            <span className="ml-1 text-xs">({selectedCount}개 상품)</span>
          </span>
        ) : (
          `대기 ${pendingCount}건`
        )}
      </span>
      <div className="flex gap-2">
        {(bookingCount ?? 0) > 0 ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={isCancelPending}
            onClick={onCancelBooking}
          >
            {isCancelPending ? "취소 중..." : "예약 취소"}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={
                selectedGroupCount < 2 || isVisitPickupPending || isBookPending
              }
              onClick={() => onOpenVisitPickupDialog()}
            >
              방문택배 ({selectedGroupCount}건)
            </Button>
            <Button
              size="sm"
              disabled={selectedCount === 0 || isBookPending}
              onClick={() => onOpenBookingDialog()}
            >
              선택 건 예약 ({selectedGroupCount}건)
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
