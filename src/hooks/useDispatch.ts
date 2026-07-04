"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DispatchSettings } from "@/types";

interface DispatchWorkerStatus {
  isPolling: boolean;
  isRunning: boolean;
}

interface DispatchSettingsResponse {
  dispatch: DispatchSettings;
  worker: DispatchWorkerStatus;
}

interface SyncTrackingResult {
  message: string;
  tracked: number;
  dispatched: number;
  errors: string[];
}

interface ManualDispatchNowResult {
  ok: boolean;
  needLogin?: boolean;
  scraped?: number;
  dispatched?: number;
  failed?: { orderId: string; error: string }[];
  pending?: number;
  message?: string;
}

interface GsLoginResult {
  success: boolean;
  message: string;
}

/** 발송처리 설정 + 워커 상태 조회 */
export function useDispatchSettings() {
  return useQuery<DispatchSettingsResponse>({
    queryKey: ["dispatch", "settings"],
    queryFn: async () => {
      const res = await fetch("/api/dispatch/settings");
      if (!res.ok) throw new Error("발송 설정 조회 실패");
      return res.json();
    },
    refetchInterval: 30_000, // 30초마다 워커 상태 갱신
  });
}

/** 발송처리 설정 변경 */
export function useUpdateDispatchSettings() {
  const queryClient = useQueryClient();
  return useMutation<
    { message: string; dispatch: DispatchSettings },
    Error,
    Partial<DispatchSettings>
  >({
    mutationFn: async (data) => {
      const res = await fetch("/api/dispatch/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "설정 저장 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch", "settings"] });
    },
  });
}

/** 수동 운송장 동기화 */
export function useSyncTracking() {
  const queryClient = useQueryClient();
  return useMutation<SyncTrackingResult>({
    mutationFn: async () => {
      const res = await fetch("/api/dispatch/sync-tracking", {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "동기화 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 수동 발송처리 */
export function useDispatchOrder() {
  const queryClient = useQueryClient();
  return useMutation<{ message: string; orderId: string }, Error, string>({
    mutationFn: async (orderId) => {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "발송처리 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/**
 * 지금 발송처리 (로컬 전용) — 세션 확인 → 스크래핑 → 서버 즉시 발송.
 * 세션 만료 시 needLogin=true 를 반환하므로, 호출부가 로그인 후 재시도한다.
 */
export function useManualDispatchNow() {
  const queryClient = useQueryClient();
  return useMutation<ManualDispatchNowResult>({
    mutationFn: async () => {
      const res = await fetch("/api/dispatch/manual-now", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || "발송처리 실패");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** GS택배 로그인 (로컬 Playwright headed — 캡챠는 사용자가 처리) */
export function useGsLogin() {
  return useMutation<GsLoginResult>({
    mutationFn: async () => {
      const res = await fetch("/api/gs-login", { method: "POST" });
      if (!res.ok) throw new Error("로그인 요청 실패");
      return res.json();
    },
  });
}
