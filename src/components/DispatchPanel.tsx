"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDispatchOrder } from "@/hooks/useDispatch";

import type { Order } from "@/types";

interface Props {
  orders: Order[];
}

/**
 * 발송 실패 복구 패널 (로컬 전용) — `dispatch_failed` 그룹이 있을 때만 나타난다.
 *
 * 정상 진행 중인 예약완료 건은 여기 나오지 않는다. 운송장이 붙기를 기다리는
 * 상태를 로컬에서 지켜볼 이유가 없어서 목록을 뺐다.
 *
 * 실패 건만 남긴 이유: `dispatchBookedGroups`가 `dispatch_failed`를 재시도 대상에서
 * 제외하고 `manual-now`도 운송장 없는 그룹만 다루므로, 이 재처리 버튼
 * (`POST /api/dispatch`)이 실패한 그룹의 유일한 복구 경로다.
 */
export function DispatchPanel({ orders }: Props) {
  const dispatchMutation = useDispatchOrder();

  const failedOrders = orders.filter(
    (o) => o.status === "booked" && o.dispatchStatus === "dispatch_failed",
  );

  // orderId 기준 그룹화
  const groupMap = new Map<string, Order[]>();
  for (const order of failedOrders) {
    const existing = groupMap.get(order.orderId) ?? [];
    existing.push(order);
    groupMap.set(order.orderId, existing);
  }
  const groups = Array.from(groupMap.entries()).map(([orderId, items]) => ({
    orderId,
    recipientName: items[0].recipientName,
    trackingNumber: items[0].trackingNumber,
  }));

  if (groups.length === 0) return null;

  function handleDispatch(orderId: string) {
    dispatchMutation.mutate(orderId, {
      onSuccess: (result) => toast.success(`발송처리 완료: ${result.orderId}`),
      onError: (err) => toast.error(`발송처리 실패: ${err.message}`),
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-destructive">
          발송 실패 {groups.length}건 — 재처리 필요
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.orderId}
              className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {group.recipientName}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {group.trackingNumber && (
                  <span className="text-xs font-mono text-blue-600 dark:text-blue-400">
                    {group.trackingNumber}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => handleDispatch(group.orderId)}
                  disabled={dispatchMutation.isPending}
                >
                  재처리
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
