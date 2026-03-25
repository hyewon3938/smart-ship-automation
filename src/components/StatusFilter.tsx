"use client";

import { Button } from "@/components/ui/button";

import type { OrderStatus } from "@/types";

/** 로컬 모드 상태별 카운트 */
interface StatusCount {
  all: number;
  pending: number;
  booking: number;
  booked: number;
  failed: number;
  skipped: number;
  dispatched: number;
}

/** 서버 모드 카운트 */
interface ServerStatusCount {
  waiting: number;
  dispatched: number;
  dispatchFailed: number;
}

/** 서버 모드 필터 키 */
export type ServerFilterKey = "waiting" | "dispatched" | "dispatch_failed";

interface LocalStatusFilterProps {
  currentStatus: OrderStatus | undefined;
  counts: StatusCount;
  onStatusChange: (status: OrderStatus | undefined) => void;
  isServerMode: false;
}

interface ServerStatusFilterProps {
  currentStatus: ServerFilterKey;
  counts: ServerStatusCount;
  onStatusChange: (status: ServerFilterKey) => void;
  isServerMode: true;
}

type StatusFilterProps = LocalStatusFilterProps | ServerStatusFilterProps;

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
  key: ServerFilterKey;
  label: string;
  countKey: keyof ServerStatusCount;
}[] = [
  { key: "waiting", label: "대기", countKey: "waiting" },
  { key: "dispatched", label: "발송완료", countKey: "dispatched" },
  { key: "dispatch_failed", label: "실패", countKey: "dispatchFailed" },
];

export function StatusFilter(props: StatusFilterProps) {
  if (props.isServerMode) {
    return (
      <div className="flex gap-1 flex-wrap">
        {SERVER_TABS.map((tab) => (
          <Button
            key={tab.key}
            variant={props.currentStatus === tab.key ? "default" : "outline"}
            size="sm"
            onClick={() => props.onStatusChange(tab.key)}
          >
            {tab.label}
            <span className="ml-1 text-xs opacity-70">
              ({props.counts[tab.countKey]})
            </span>
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-1 flex-wrap">
      {LOCAL_TABS.map((tab) => (
        <Button
          key={tab.label}
          variant={props.currentStatus === tab.key ? "default" : "outline"}
          size="sm"
          onClick={() => props.onStatusChange(tab.key)}
        >
          {tab.label}
          <span className="ml-1 text-xs opacity-70">
            ({props.counts[tab.countKey]})
          </span>
        </Button>
      ))}
    </div>
  );
}
