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

interface VisitPickupConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrders: Order[];
  isPending: boolean;
  onConfirm: () => void;
}

const MAX_PREVIEW_GROUPS = 8;
const MIN_VISIT_PICKUP_COUNT = 2;

export function VisitPickupConfirmDialog({
  open,
  onOpenChange,
  selectedOrders,
  isPending,
  onConfirm,
}: VisitPickupConfirmDialogProps) {
  const groups = useMemo(
    () => groupOrdersByOrderId(selectedOrders),
    [selectedOrders]
  );

  const previewGroups = groups.slice(0, MAX_PREVIEW_GROUPS);
  const remainingCount = groups.length - previewGroups.length;
  const isBelowMinimum = groups.length < MIN_VISIT_PICKUP_COUNT;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>방문택배 예약</DialogTitle>
          <DialogDescription>
            선택한 주문을 하나의 방문택배 예약으로 묶어 폼을 자동 입력합니다.
          </DialogDescription>
        </DialogHeader>

        {/* 요약 */}
        <div className="flex gap-4 py-2 text-sm">
          <span>
            수령인 <strong>{groups.length}명</strong>
            <span className="text-muted-foreground ml-1">
              ({selectedOrders.length}개 상품)
            </span>
          </span>
        </div>

        {/* 수령인 목록 */}
        <div className="border rounded-md divide-y text-sm max-h-56 overflow-y-auto">
          {previewGroups.map((group, i) => (
            <div key={group.orderId} className="flex items-center gap-2 px-3 py-2">
              <span className="text-xs text-muted-foreground w-5 shrink-0">
                {i + 1}.
              </span>
              <span className="font-medium shrink-0">{group.recipientName}</span>
              <span className="text-muted-foreground text-xs truncate">
                {group.recipientAddress}
              </span>
            </div>
          ))}
          {remainingCount > 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              외 {remainingCount}명
            </div>
          )}
        </div>

        {/* 안내사항 */}
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p>- 예약명: 리뷰어 발송 / 보내는 분: 리커밋</p>
          <p>- 폼 입력 후 브라우저에서 직접 예약하기를 클릭해주세요</p>
        </div>

        {isBelowMinimum && (
          <p className="text-xs text-destructive">
            방문택배는 {MIN_VISIT_PICKUP_COUNT}건 이상 선택해야 합니다.
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            취소
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending || isBelowMinimum}
          >
            {isPending ? "입력 중..." : "폼 입력 시작"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
