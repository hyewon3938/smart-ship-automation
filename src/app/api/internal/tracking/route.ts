import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifyInternalApiKey } from "@/lib/internal-auth";
import { maskId } from "@/lib/log-mask";
import {
  addBookingLogByOrderId,
  updateTrackingNumbers,
} from "@/lib/orders";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        orderId: z.string().min(1),
        trackingNumber: z.string().min(1),
      })
    )
    .min(1),
});

/** POST /api/internal/tracking — 로컬에서 운송장번호 수신 후 서버 DB 업데이트 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyInternalApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "요청 형식이 올바르지 않습니다" },
        { status: 400 }
      );
    }
    const { items } = parsed.data;

    let updated = 0;
    for (const item of items) {
      updateTrackingNumbers(item.orderId, item.trackingNumber);
      addBookingLogByOrderId(
        item.orderId,
        "tracking",
        `운송장번호 감지 (로컬 동기화): ${item.trackingNumber}`
      );
      updated++;
      console.log(
        `[internal/tracking] ${maskId(item.orderId)}: 운송장 ${maskId(item.trackingNumber)}`
      );
    }

    return NextResponse.json({
      message: `운송장 ${updated}건 동기화 완료`,
      updated,
    });
  } catch (error) {
    console.error("[internal/tracking] 업데이트 실패:", error);
    return NextResponse.json(
      { error: "운송장 동기화 중 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
