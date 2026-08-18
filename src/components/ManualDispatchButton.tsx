"use client";

import { toast } from "sonner";

import { useGsLogin, useManualDispatchNow } from "@/hooks/useDispatch";

interface Props {
  /** 예약완료(booked) 그룹 수 — 0이면 버튼을 숨긴다 */
  bookedGroupCount: number;
}

/**
 * "지금 발송처리" (로컬 전용) — 스크래핑 윈도우 밖이나 세션 만료 상황용 수동 트리거.
 *
 * 원래 DispatchPanel 안에 있었는데, 그 패널이 예약완료 건을 통째로 나열하는 바람에
 * "운송장 대기 중..." 목록이 로컬 대시보드에 다시 노출됐다. 버튼만 헤더로 분리한다.
 */
export function ManualDispatchButton({ bookedGroupCount }: Props) {
  const manualNow = useManualDispatchNow();
  const gsLogin = useGsLogin();

  if (bookedGroupCount === 0) return null;

  async function handleClick() {
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

  const isPending = manualNow.isPending || gsLogin.isPending;

  return (
    <button
      onClick={() => void handleClick()}
      disabled={isPending}
      className={`text-sm hover:text-foreground disabled:opacity-50 ${
        isPending ? "animate-pulse text-muted-foreground" : "text-foreground"
      }`}
    >
      {gsLogin.isPending
        ? "로그인 중..."
        : manualNow.isPending
          ? "발송 처리 중..."
          : `지금 발송처리 (${bookedGroupCount})`}
    </button>
  );
}
