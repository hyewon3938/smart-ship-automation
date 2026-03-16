"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useBookingLogs } from "@/hooks/useOrders";
import type { BookingLogEntry } from "@/types";

interface Props {
  orderId: number | null;
  naverOrderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACTION_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  start:    { label: "시작",   variant: "default" },
  login:    { label: "로그인", variant: "secondary" },
  complete: { label: "완료",   variant: "default" },
  error:    { label: "실패",   variant: "destructive" },
  retry:    { label: "재시도", variant: "outline" },
  info:     { label: "정보",   variant: "secondary" },
};

function ActionBadge({ action }: { action: string }) {
  const config = ACTION_BADGE[action] ?? { label: action, variant: "secondary" as const };
  const extraClass =
    action === "complete" ? "bg-green-500 hover:bg-green-600" :
    action === "start"    ? "bg-blue-500 hover:bg-blue-600" :
    action === "retry"    ? "border-yellow-500 text-yellow-700" : "";
  return (
    <Badge variant={config.variant} className={extraClass}>
      {config.label}
    </Badge>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}`;
}

function screenshotFilename(path: string): string {
  return path.split("/").pop() ?? path;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

function LogRow({ log }: { log: BookingLogEntry }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">
        {formatTime(log.createdAt)}
      </td>
      <td className="py-2 pr-4">
        <ActionBadge action={log.action} />
      </td>
      <td className="py-2 pr-4 text-sm">{log.detail ? stripAnsi(log.detail) : "-"}</td>
      <td className="py-2 text-sm">
        {log.screenshotPath ? (
          <a
            href={`/api/screenshots/${screenshotFilename(log.screenshotPath)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 underline hover:text-blue-700 text-xs whitespace-nowrap"
          >
            스크린샷 보기
          </a>
        ) : null}
      </td>
    </tr>
  );
}

export function BookingLogDialog({ orderId, naverOrderId, open, onOpenChange }: Props) {
  const { data, isLoading, isError } = useBookingLogs(open ? orderId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>예약 로그 — 주문 {naverOrderId}</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive">로그를 불러오지 못했습니다.</p>
        )}

        {data && (
          data.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">기록된 로그가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">시간</th>
                    <th className="pb-2 pr-4 font-medium">작업</th>
                    <th className="pb-2 pr-4 font-medium">상세</th>
                    <th className="pb-2 font-medium">스크린샷</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((log) => (
                    <LogRow key={log.id} log={log} />
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
