import { NextResponse } from "next/server";

import { reconcileFromServer } from "@/lib/sync-to-server";

/**
 * POST /api/orders/reconcile — 서버 → 로컬 상태 역동기화만 수행 (로컬 전용).
 *
 * 동기화 버튼(`/api/orders/sync`)도 역동기화를 하지만 네이버 API 조회가 붙어 있어
 * 무겁고 수동이다. 그래서 "서버가 발송을 끝낸 뒤 사용자가 동기화를 누르기 전까지"
 * 로컬이 계속 예약완료로 남는 공백이 있었다 (ADR-0005의 트리거 공백).
 *
 * 이 라우트는 서버 질의 1회로 끝나므로 대시보드가 주기적으로 호출해도 부담이 없다.
 * 반영할 그룹이 없으면 네트워크 호출조차 하지 않는다.
 */
export async function POST() {
  if (process.env.DEPLOY_MODE === "server") {
    return NextResponse.json(
      { error: "로컬 전용 기능입니다" },
      { status: 400 },
    );
  }

  try {
    const result = await reconcileFromServer();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[orders/reconcile] 역동기화 실패:", error);
    return NextResponse.json(
      { error: "서버 상태 확인에 실패했습니다" },
      { status: 500 },
    );
  }
}
