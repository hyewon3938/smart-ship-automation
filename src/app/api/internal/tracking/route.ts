import { NextRequest, NextResponse } from "next/server";

import { verifyInternalApiKey } from "@/lib/internal-auth";
import {
  addBookingLogByOrderId,
  updateTrackingNumbers,
} from "@/lib/orders";

/** POST /api/internal/tracking — 로컬에서 운송장번호 수신 후 서버 DB 업데이트 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyInternalApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json()) as {
      items?: Array<{
        orderId: string;
        trackingNumber: string;
      }>;
    };

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "items 배열이 필요합니다" },
        { status: 400 }
      );
    }

    let updated = 0;
    for (const item of body.items) {
      if (!item.orderId || !item.trackingNumber) continue;
      updateTrackingNumbers(item.orderId, item.trackingNumber);
      addBookingLogByOrderId(
        item.orderId,
        "tracking",
        `운송장번호 감지 (로컬 동기화): ${item.trackingNumber}`
      );
      updated++;
      console.log(
        `[internal/tracking] ${item.orderId}: 운송장 ${item.trackingNumber}`
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
