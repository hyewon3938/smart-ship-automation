"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OrderStatus } from "@/types";

interface Props {
  /** 삭제 대상 정보. null이면 닫힌 상태 */
  target: {
    orderId: string;
    recipientName: string;
    itemCount: number;
    status: OrderStatus;
  } | null;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: "대기",
  booked: "예약완료",
  failed: "실패",
  skipped: "건너뜀",
};

/**
 * 주문 그룹 삭제 확인 다이얼로그.
 *
 * 삭제는 앱 목록에서만 지운다는 사실을 반드시 알려야 한다 —
 * GS택배 예약이나 네이버 주문 자체는 취소되지 않기 때문에
 * "삭제했으니 취소됐겠지"로 오해하면 실제로는 물건이 배송된다.
 */
export function DeleteOrderDialog({
  target,
  isPending,
  onConfirm,
  onCancel,
}: Props) {
  const isBooked = target?.status === "booked";

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>주문 삭제</DialogTitle>
          <DialogDescription>
            {target && (
              <>
                <span className="font-medium text-foreground">
                  {target.recipientName}
                </span>{" "}
                ({target.itemCount}건 ·{" "}
                {STATUS_LABEL[target.status] ?? target.status}) 주문을 목록에서
                삭제합니다.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">
                GS택배 예약과 네이버 주문은 취소되지 않습니다
              </p>
              <p className="text-xs opacity-90">
                이 앱의 목록에서만 제거됩니다. 실제 취소가 필요하면
                GS택배·네이버 스마트스토어에서 직접 처리해주세요.
              </p>
            </div>
          </div>

          {target?.status === "pending" && (
            <p className="text-xs text-muted-foreground">
              네이버에 발송대기로 남아 있으면 다음 동기화에서 다시 수집됩니다.
            </p>
          )}
          {isBooked && (
            <p className="text-xs text-muted-foreground">
              삭제 전에 서버 발송 여부를 확인합니다. 이미 발송처리된 주문은
              삭제되지 않고 발송완료로 갱신됩니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "삭제 중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
