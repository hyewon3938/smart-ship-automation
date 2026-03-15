"use client";

import { useMemo } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { groupOrdersByOrderId } from "@/lib/groupOrders";

import type { Order } from "@/types";

interface BookingConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrders: Order[];
  isPending: boolean;
  onConfirm: () => void;
}

const DELIVERY_LABELS: Record<string, string> = {
  domestic: "국내택배",
  nextDay: "내일배송",
};

const MAX_PREVIEW_GROUPS = 5;

export function BookingConfirmDialog({
  open,
  onOpenChange,
  selectedOrders,
  isPending,
  onConfirm,
}: BookingConfirmDialogProps) {
  const groups = useMemo(
    () => groupOrdersByOrderId(selectedOrders),
    [selectedOrders]
  );

  const domesticGroups = groups.filter((g) =>
    g.orders.every((o) => o.selectedDeliveryType === "domestic")
  ).length;
  const nextDayGroups = groups.filter((g) =>
    g.orders.every((o) => o.selectedDeliveryType === "nextDay")
  ).length;
  const mixedGroups = groups.length - domesticGroups - nextDayGroups;

  const previewGroups = groups.slice(0, MAX_PREVIEW_GROUPS);
  const remainingCount = groups.length - previewGroups.length;

  /** 그룹 내 택배유형 요약 */
  function getGroupDeliveryLabel(orders: Order[]): string {
    const types = new Set(orders.map((o) => o.selectedDeliveryType));
    if (types.size === 1) {
      return DELIVERY_LABELS[orders[0].selectedDeliveryType] ?? orders[0].selectedDeliveryType;
    }
    return "혼합";
  }

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
            총 <strong>{groups.length}건</strong>
            <span className="text-muted-foreground ml-1">
              ({selectedOrders.length}개 상품)
            </span>
          </span>
          {domesticGroups > 0 && <span>국내택배 {domesticGroups}건</span>}
          {nextDayGroups > 0 && <span>내일배송 {nextDayGroups}건</span>}
          {mixedGroups > 0 && <span>혼합 {mixedGroups}건</span>}
        </div>

        {/* 수령인 목록 (orderId 그룹 기준) */}
        <div className="border rounded-md divide-y text-sm max-h-48 overflow-y-auto">
          {previewGroups.map((group) => (
            <div key={group.orderId}>
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="font-medium shrink-0">
                  {group.recipientName}
                </span>
                <span className="text-muted-foreground text-xs truncate">
                  {group.orders.length === 1
                    ? group.orders[0].productName
                    : `${group.orders.length}개 상품`}
                </span>
                <span className="text-xs shrink-0 ml-auto">
                  {getGroupDeliveryLabel(group.orders)}
                </span>
              </div>
              {group.shippingMemo && (
                <p className="px-3 pb-1 text-xs text-muted-foreground truncate">
                  메모: {group.shippingMemo}
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
