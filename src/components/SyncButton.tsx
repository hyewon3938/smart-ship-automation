"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SyncButtonProps {
  lastSyncTime: string | null;
  isPending: boolean;
  onSync: () => void;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  return new Date(isoString).toLocaleDateString("ko-KR");
}

export function SyncButton({ lastSyncTime, isPending, onSync }: SyncButtonProps) {
  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={onSync}
        disabled={isPending}
      >
        <RefreshCw className={isPending ? "animate-spin" : ""} />
        {isPending ? "동기화 중..." : "동기화"}
      </Button>
      {lastSyncTime && (
        <span className="text-xs text-muted-foreground">
          마지막 동기화: {formatRelativeTime(lastSyncTime)}
        </span>
      )}
    </div>
  );
}
