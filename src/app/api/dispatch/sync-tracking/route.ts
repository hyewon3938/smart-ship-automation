import { NextResponse } from "next/server";

import { checkAndDispatch } from "@/lib/dispatch-worker";

/** POST /api/dispatch/sync-tracking — 수동으로 운송장 동기화 + 자동 모드이면 발송처리 */
export async function POST() {
  try {
    const result = await checkAndDispatch();
    return NextResponse.json({
      message: `운송장 ${result.tracked}건 감지, 발송처리 ${result.dispatched}건 완료`,
      ...result,
    });
  } catch (error) {
    console.error("운송장 동기화 실패:", error);
    return NextResponse.json({ error: "운송장 동기화 실패" }, { status: 500 });
  }
}
