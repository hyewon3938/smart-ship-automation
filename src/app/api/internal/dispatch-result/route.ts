import { NextRequest, NextResponse } from "next/server";

import {
  addBookingLogByOrderId,
  updateDispatchStatus,
} from "@/lib/orders";

import type { DispatchStatus } from "@/types";

/** POST /api/internal/dispatch-result — 로컬에서 발송처리 결과 수신 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      orderId: string;
      status: DispatchStatus;
      error?: string;
    };

    if (!body.orderId || !body.status) {
      return NextResponse.json(
        { error: "orderId와 status가 필요합니다" },
        { status: 400 }
      );
    }

    updateDispatchStatus(body.orderId, body.status as "dispatched" | "dispatch_failed");

    if (body.status === "dispatched") {
      addBookingLogByOrderId(
        body.orderId,
        "dispatch",
        "네이버 발송처리 완료 (로컬 동기화)"
      );
    } else {
      addBookingLogByOrderId(
        body.orderId,
        "error",
        `발송처리 실패 (로컬 동기화): ${body.error ?? "알 수 없는 오류"}`
      );
    }

    console.log(
      `[internal/dispatch-result] ${body.orderId}: ${body.status}`
    );

    return NextResponse.json({ message: "동기화 완료", orderId: body.orderId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
