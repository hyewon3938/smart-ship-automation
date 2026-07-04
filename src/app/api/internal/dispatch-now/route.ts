import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dispatchBookedGroups } from "@/lib/dispatch-worker";
import { verifyInternalApiKey } from "@/lib/internal-auth";
import { maskId } from "@/lib/log-mask";
import { addBookingLogByOrderId, updateTrackingNumbers } from "@/lib/orders";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        orderId: z.string().min(1),
        trackingNumber: z.string().min(1),
      }),
    )
    .min(1),
});

/**
 * POST /api/internal/dispatch-now — (서버) 로컬에서 스크래핑한 운송장을 수신 →
 * 즉시 네이버 발송처리. 자동 모드 on/off와 무관하게 동작한다.
 *
 * `/api/internal/tracking`(운송장만 저장하고 워커 폴링에 위임)과 달리,
 * 여기서는 저장 직후 `dispatchBookedGroups`로 바로 발송한다.
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyInternalApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "요청 형식이 올바르지 않습니다" },
        { status: 400 },
      );
    }
    const { items } = parsed.data;

    // 1. 운송장 저장 (pending_dispatch로 전환)
    for (const item of items) {
      updateTrackingNumbers(item.orderId, item.trackingNumber);
      addBookingLogByOrderId(
        item.orderId,
        "tracking",
        `운송장 수동 동기화: ${item.trackingNumber}`,
      );
      console.log(
        `[internal/dispatch-now] ${maskId(item.orderId)}: 운송장 ${maskId(item.trackingNumber)}`,
      );
    }

    // 2. 해당 주문만 즉시 발송처리
    const { dispatched, failed } = await dispatchBookedGroups(
      items.map((i) => i.orderId),
    );

    console.log(
      `[internal/dispatch-now] 발송 ${dispatched.length}건 완료, 실패 ${failed.length}건`,
    );

    return NextResponse.json({
      message: `발송 ${dispatched.length}건 완료`,
      dispatched,
      failed,
    });
  } catch (error) {
    console.error("[internal/dispatch-now] 처리 실패:", error);
    return NextResponse.json(
      { error: "발송처리 중 오류가 발생했습니다" },
      { status: 500 },
    );
  }
}
