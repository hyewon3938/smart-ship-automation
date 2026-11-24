"use client";

import Link from "next/link";

import { ManualDispatchButton } from "@/components/ManualDispatchButton";
import { SyncButton } from "@/components/SyncButton";
import { Button } from "@/components/ui/button";

interface DashboardHeaderProps {
  isServerMode: boolean;
  bookedGroupCount: number;
  isLoggingIn: boolean;
  isCookieExpired: boolean;
  lastSyncTime: string | null;
  isSyncPending: boolean;
  onGsLogin: () => Promise<void>;
  onSync: () => void;
}

/** 대시보드 상단 바 + GS택배 로그인 만료 배너 */
export function DashboardHeader({
  isServerMode,
  bookedGroupCount,
  isLoggingIn,
  isCookieExpired,
  lastSyncTime,
  isSyncPending,
  onGsLogin,
  onSync,
}: DashboardHeaderProps) {
  return (
    <>
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Smart Ship Automation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            네이버 스마트스토어 주문 → GS택배 자동 예약
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isServerMode && (
            <ManualDispatchButton bookedGroupCount={bookedGroupCount} />
          )}
          {!isServerMode && (
            <button
              onClick={() => void onGsLogin()}
              disabled={isLoggingIn}
              className={`text-sm hover:text-foreground disabled:opacity-50 ${
                isLoggingIn
                  ? "animate-pulse text-muted-foreground"
                  : isCookieExpired
                    ? "text-orange-600 font-medium"
                    : "text-muted-foreground"
              }`}
            >
              {isLoggingIn
                ? "로그인 중..."
                : `GS로그인${isCookieExpired ? " (만료)" : ""}`}
            </button>
          )}
          <Link
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            설정
          </Link>
          {!isServerMode && (
            <SyncButton
              lastSyncTime={lastSyncTime}
              isPending={isSyncPending}
              onSync={onSync}
            />
          )}
        </div>
      </div>

      {/* GS택배 로그인 만료 배너 (로컬 모드만) */}
      {!isServerMode && isCookieExpired && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
          <span className="text-orange-800">
            GS택배 로그인 세션이 만료되었습니다. 예약 전에 로그인해주세요.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-orange-300 text-orange-700 hover:bg-orange-100"
            disabled={isLoggingIn}
            onClick={() => void onGsLogin()}
          >
            {isLoggingIn ? "로그인 중..." : "GS택배 로그인"}
          </Button>
        </div>
      )}
    </>
  );
}
