import { NextResponse } from "next/server";

import { reconcileStaleFromNaver } from "@/lib/naver/reconcile";
import { syncOrders } from "@/lib/naver/sync";
import { setSetting } from "@/lib/settings";
import { reconcileFromServer } from "@/lib/sync-to-server";

export async function POST() {
  try {
    // 1. 서버 → 로컬 상태 역동기화 먼저.
    //    서버가 이미 발송처리한 주문을 로컬에서 정리해야, 아래 네이버 동기화가
    //    끝난 화면에 "운송장 대기중"으로 남아 있는 유령 주문이 사라진다 (ADR-0005).
    //    서버 미설정/연결 실패여도 네이버 동기화는 계속 진행한다.
    const reconciled = await reconcileFromServer();

    // 2. 서버가 모르는 묵은 그룹은 네이버에 직접 물어 정리.
    //    실패해도 동기화 본작업은 계속한다 (정리는 부가 작업).
    let naverReconciled = 0;
    try {
      naverReconciled = (await reconcileStaleFromNaver()).dispatched;
    } catch (err) {
      console.warn(
        "[sync] 네이버 원천 대조 실패:",
        err instanceof Error ? err.message : err,
      );
    }

    const result = await syncOrders();
    setSetting("lastSyncTime", new Date().toISOString());

    return NextResponse.json({
      message: "동기화 완료",
      ...result,
      reconciledDispatched: reconciled.dispatched + naverReconciled,
      reconciledTracked: reconciled.tracked,
    });
  } catch (error) {
    console.error("주문 동기화 실패:", error);
    return NextResponse.json(
      { error: "주문 동기화에 실패했습니다" },
      { status: 500 },
    );
  }
}
