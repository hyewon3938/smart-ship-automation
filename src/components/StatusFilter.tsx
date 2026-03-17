"use client";

import { Button } from "@/components/ui/button";

import type { OrderStatus } from "@/types";

interface StatusCount {
  all: number;
  pending: number;
  booking: number;
  booked: number;
  failed: number;
  skipped: number;
  dispatched: number;
}

interface StatusFilterProps {
  currentStatus: OrderStatus | undefined;
  counts: StatusCount;
  onStatusChange: (status: OrderStatus | undefined) => void;
  /** 서버 모드 여부 — false이면 발송완료 탭 숨김 */
  isServerMode?: boolean;
}

const TABS: {
  key: OrderStatus | undefined;
  label: string;
  countKey: keyof StatusCount;
  serverOnly?: boolean;
}[] = [
  { key: "pending", label: "대기", countKey: "pending" },
  { key: "booked", label: "예약완료", countKey: "booked" },
  { key: "dispatched", label: "발송완료", countKey: "dispatched", serverOnly: true },
  { key: "failed", label: "실패", countKey: "failed" },
  { key: undefined, label: "전체", countKey: "all" },
];

export function StatusFilter({
  currentStatus,
  counts,
  onStatusChange,
  isServerMode = false,
}: StatusFilterProps) {
  const visibleTabs = isServerMode
    ? TABS
    : TABS.filter((tab) => !tab.serverOnly);

  return (
    <div className="flex gap-1 flex-wrap">
      {visibleTabs.map((tab) => (
        <Button
          key={tab.label}
          variant={currentStatus === tab.key ? "default" : "outline"}
          size="sm"
          onClick={() => onStatusChange(tab.key)}
        >
          {tab.label}
          <span className="ml-1 text-xs opacity-70">
            ({counts[tab.countKey]})
          </span>
        </Button>
      ))}
    </div>
  );
}
