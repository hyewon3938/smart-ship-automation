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
}

interface StatusFilterProps {
  currentStatus: OrderStatus | undefined;
  counts: StatusCount;
  onStatusChange: (status: OrderStatus | undefined) => void;
}

const TABS: {
  key: OrderStatus | undefined;
  label: string;
  countKey: keyof StatusCount;
}[] = [
  { key: "pending", label: "대기", countKey: "pending" },
  { key: "booked", label: "완료", countKey: "booked" },
  { key: "failed", label: "실패", countKey: "failed" },
  { key: undefined, label: "전체", countKey: "all" },
];

export function StatusFilter({
  currentStatus,
  counts,
  onStatusChange,
}: StatusFilterProps) {
  return (
    <div className="flex gap-1 flex-wrap">
      {TABS.map((tab) => (
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
