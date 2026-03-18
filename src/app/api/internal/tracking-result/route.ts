import { NextRequest, NextResponse } from "next/server";

import {
  addBookingLogByOrderId,
  updateTrackingNumbers,
} from "@/lib/orders";

/** POST /api/internal/tracking-result — 로컬에서 감지한 운송장번호 수신 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      orderId: string;
      trackingNumber: string;
    };

    if (!body.orderId || !body.trackingNumber) {
      return NextResponse.json(
        { error: "orderId와 trackingNumber가 필요합니다" },
        { status: 400 }
      );
    }

    updateTrackingNumbers(body.orderId, body.trackingNumber);
    addBookingLogByOrderId(
      body.orderId,
      "tracking",
      `운송장번호 감지 (로컬 동기화): ${body.trackingNumber}`
    );

    console.log(
      `[internal/tracking-result] ${body.orderId}: 운송장 ${body.trackingNumber}`
    );

    return NextResponse.json({ message: "동기화 완료", orderId: body.orderId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
