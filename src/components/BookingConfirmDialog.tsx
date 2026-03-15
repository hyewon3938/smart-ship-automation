"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import type { Order } from "@/types";

interface BookingConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrders: Order[];
  isPending: boolean;
  onConfirm: () => void;
}

const MAX_PREVIEW_ROWS = 5;

export function BookingConfirmDialog({
  open,
  onOpenChange,
  selectedOrders,
  isPending,
  onConfirm,
}: BookingConfirmDialogProps) {
  const domesticCount = selectedOrders.filter(
    (o) => o.selectedDeliveryType === "domestic"
  ).length;
  const nextDayCount = selectedOrders.filter(
    (o) => o.selectedDeliveryType === "nextDay"
  ).length;

  const previewOrders = selectedOrders.slice(0, MAX_PREVIEW_ROWS);
  const remainingCount = selectedOrders.length - previewOrders.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>택배 예약 확인</DialogTitle>
          <DialogDescription>
            선택한 주문의 택배 예약을 시작합니다.
          </DialogDescription>
        </DialogHeader>

        {/* 요약 */}
        <div className="flex gap-4 py-2 text-sm">
          <span>
            총 <strong>{selectedOrders.length}건</strong>
          </span>
          {domesticCount > 0 && <span>국내택배 {domesticCount}건</span>}
          {nextDayCount > 0 && <span>내일배송 {nextDayCount}건</span>}
        </div>

        {/* 수령인 목록 */}
        <div className="border rounded-md divide-y text-sm max-h-48 overflow-y-auto">
          {previewOrders.map((order) => (
            <div key={order.id}>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="font-medium truncate max-w-32">
                  {order.recipientName}
                </span>
                <span className="text-muted-foreground text-xs truncate">
                  {order.productName}
                </span>
                <span className="text-xs shrink-0 ml-2">
                  {order.selectedDeliveryType === "nextDay" ? "내일배송" : "국내택배"}
                </span>
              </div>
              {order.shippingMemo && (
                <p className="px-3 pb-1 text-xs text-muted-foreground truncate">
                  메모: {order.shippingMemo}
                </p>
              )}
            </div>
          ))}
          {remainingCount > 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              외 {remainingCount}건
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            취소
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "예약 중..." : "예약 시작"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
