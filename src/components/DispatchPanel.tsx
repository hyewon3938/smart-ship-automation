"use client";

import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useDispatchOrder,
  useDispatchSettings,
  useGsLogin,
  useManualDispatchNow,
} from "@/hooks/useDispatch";

import type { Order } from "@/types";

function formatDispatchedAt(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `발송 ${mm}-${dd} ${hh}:${min}`;
}

interface Props {
  orders: Order[];
  isServerMode?: boolean;
}

/** booked 상태 주문을 orderId 기준으로 그룹화하여 발송처리 현황 표시 */
export function DispatchPanel({ orders, isServerMode = false }: Props) {
  // 훅은 항상 최상단에서 호출 (Rules of Hooks)
  const { data: settingsData } = useDispatchSettings();
  const manualNow = useManualDispatchNow();
  const gsLogin = useGsLogin();
  const dispatchMutation = useDispatchOrder();

  const bookedOrders = orders.filter((o) => o.status === "booked");

  // orderId 기준 그룹화
  const groupMap = new Map<string, Order[]>();
  for (const order of bookedOrders) {
    const existing = groupMap.get(order.orderId) ?? [];
    existing.push(order);
    groupMap.set(order.orderId, existing);
  }
  const groups = Array.from(groupMap.entries()).map(([orderId, items]) => ({
    orderId,
    recipientName: items[0].recipientName,
    trackingNumber: items[0].trackingNumber,
    dispatchStatus: items[0].dispatchStatus,
    deliveryType: items[0].selectedDeliveryType,
    dispatchedAt: items[0].dispatchedAt,
  }));

  if (bookedOrders.length === 0) return null;

  const isAutoMode = settingsData?.dispatch.autoMode ?? false;

  async function handleManualNow() {
    try {
      let res = await manualNow.mutateAsync();

      // 세션 만료 → 로그인(캡챠) 후 1회 재시도
      if (res.needLogin) {
        toast.info(
          "GS택배 세션 만료 — 브라우저에서 로그인(CAPTCHA)을 진행합니다",
        );
        const login = await gsLogin.mutateAsync();
        if (!login.success) {
          toast.error(login.message);
          return;
        }
        res = await manualNow.mutateAsync();
      }

      if (res.needLogin) {
        toast.error("로그인 후에도 세션 확인에 실패했습니다");
        return;
      }
      if (!res.ok) {
        toast.error(res.message ?? "발송처리에 실패했습니다");
        return;
      }

      const dispatched = res.dispatched ?? 0;
      const failedCount = res.failed?.length ?? 0;
      const pending = res.pending ?? 0;

      if (dispatched > 0) {
        toast.success(`발송처리 ${dispatched}건 완료`);
      }
      if (failedCount > 0) {
        toast.error(`발송 실패 ${failedCount}건`);
      }
      if (pending > 0) {
        toast.info(`운송장 미배정 ${pending}건 — 잠시 후 다시 시도하세요`);
      }
      // ok:true인데 아무 항목도 없으면(예: 서버에서 이미 처리됨) 최소 1개 피드백 보장
      if (dispatched === 0 && failedCount === 0 && pending === 0) {
        toast.info(res.message ?? "처리할 발송 건이 없습니다");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "발송처리에 실패했습니다",
      );
    }
  }

  function handleDispatch(orderId: string) {
    dispatchMutation.mutate(orderId, {
      onSuccess: (result) => toast.success(`발송처리 완료: ${result.orderId}`),
      onError: (err) => toast.error(`발송처리 실패: ${err.message}`),
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">발송처리</CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant={isAutoMode ? "default" : "outline"}
              className="text-xs"
            >
              {isAutoMode ? "자동 발송" : "수동 승인"}
            </Badge>
            {!isServerMode && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleManualNow()}
                disabled={manualNow.isPending || gsLogin.isPending}
              >
                {gsLogin.isPending
                  ? "로그인 중..."
                  : manualNow.isPending
                    ? "발송 처리 중..."
                    : "지금 발송처리"}
              </Button>
            )}
          </div>
        </div>
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
                {group.dispatchedAt && (
                  <div className="text-xs text-muted-foreground truncate">
                    {formatDispatchedAt(group.dispatchedAt)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {group.trackingNumber ? (
                  <>
                    <span className="text-xs font-mono text-blue-600 dark:text-blue-400">
                      {group.trackingNumber}
                    </span>
                    {group.dispatchStatus === "dispatched" ? (
                      <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                        발송완료
                      </Badge>
                    ) : group.dispatchStatus === "dispatch_failed" ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => handleDispatch(group.orderId)}
                        disabled={dispatchMutation.isPending}
                      >
                        재처리
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleDispatch(group.orderId)}
                        disabled={dispatchMutation.isPending || isAutoMode}
                      >
                        {isAutoMode ? "자동처리 대기" : "발송처리"}
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    운송장 대기 중...
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
