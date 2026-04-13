"use client";

import { Button } from "@/components/ui/button";

import type { OrderStatus, ServerFilter } from "@/types";

interface StatusCount {
  all: number;
  pending: number;
  booking: number;
  booked: number;
  failed: number;
  skipped: number;
  dispatched: number;
}

interface ServerStatusCount {
  all: number;
  waiting: number;
  dispatched: number;
  dispatch_failed: number;
}

interface StatusFilterProps {
  currentStatus: OrderStatus | ServerFilter | undefined;
  counts: StatusCount | ServerStatusCount;
  onStatusChange: (status: OrderStatus | ServerFilter | undefined) => void;
  isServerMode?: boolean;
}

const LOCAL_TABS: {
  key: OrderStatus | undefined;
  label: string;
  countKey: keyof StatusCount;
}[] = [
  { key: "pending", label: "대기", countKey: "pending" },
  { key: "booked", label: "예약완료", countKey: "booked" },
  { key: "failed", label: "실패", countKey: "failed" },
  { key: undefined, label: "전체", countKey: "all" },
];

const SERVER_TABS: {
  key: ServerFilter | undefined;
  label: string;
  countKey: keyof ServerStatusCount;
}[] = [
  { key: "waiting", label: "대기", countKey: "waiting" },
  { key: "dispatched", label: "발송완료", countKey: "dispatched" },
  { key: "dispatch_failed", label: "실패", countKey: "dispatch_failed" },
  { key: undefined, label: "전체", countKey: "all" },
];

export function StatusFilter({
  currentStatus,
  counts,
  onStatusChange,
  isServerMode = false,
}: StatusFilterProps) {
  const tabs = isServerMode ? SERVER_TABS : LOCAL_TABS;

  return (
    <div className="flex gap-1 flex-wrap">
      {tabs.map((tab) => (
        <Button
          key={tab.label}
          variant={currentStatus === tab.key ? "default" : "outline"}
          size="sm"
          onClick={() => onStatusChange(tab.key)}
        >
          {tab.label}
          <span className="ml-1 text-xs opacity-70">
            ({(counts as unknown as Record<string, number>)[tab.countKey]})
          </span>
        </Button>
      ))}
    </div>
  );
}
