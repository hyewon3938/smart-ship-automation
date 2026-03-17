import { NextRequest, NextResponse } from "next/server";

import {
  addBookingLogByOrderId,
  updateTrackingNumbers,
} from "@/lib/orders";

/** POST /api/internal/tracking — 로컬에서 운송장번호 수신 후 서버 DB 업데이트 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
