import { NextRequest, NextResponse } from "next/server";

import { getAllSettings, updateDispatchSettings } from "@/lib/settings";
import { getDispatchWorkerStatus, startDispatchPolling, stopDispatchPolling } from "@/lib/dispatch-worker";
import type { DispatchSettings } from "@/types";

/** GET /api/dispatch/settings — 발송처리 설정 + 폴링 상태 조회 */
export async function GET() {
  try {
    const settings = getAllSettings();
    const workerStatus = getDispatchWorkerStatus();
    return NextResponse.json({
      dispatch: settings.dispatch,
      worker: workerStatus,
    });
  } catch (error) {
    console.error("발송 설정 조회 실패:", error);
    return NextResponse.json({ error: "설정 조회 실패" }, { status: 500 });
  }
}

/** PUT /api/dispatch/settings — 발송처리 설정 변경 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as Partial<DispatchSettings>;

    const current = getAllSettings().dispatch;
    const updated: DispatchSettings = {
      autoMode: body.autoMode ?? current.autoMode,
      pollIntervalMin: body.pollIntervalMin ?? current.pollIntervalMin,
      nextDayDeliveryCode: body.nextDayDeliveryCode ?? current.nextDayDeliveryCode,
    };

    updateDispatchSettings(updated);

    // 폴링 재시작 (인터벌 변경 반영)
    stopDispatchPolling();
    startDispatchPolling();

    return NextResponse.json({ message: "설정 저장 완료", dispatch: updated });
  } catch (error) {
    console.error("발송 설정 저장 실패:", error);
    return NextResponse.json({ error: "설정 저장 실패" }, { status: 500 });
  }
}
