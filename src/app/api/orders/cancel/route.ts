import { NextRequest, NextResponse } from "next/server";

import { addBookingLogByOrderId, updateGroupStatus } from "@/lib/orders";
import { syncBookingResult } from "@/lib/sync-to-server";

/** POST /api/orders/cancel — 주문 취소 (로컬 DB 업데이트 + 서버 동기화) */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId } = body;

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "주문번호가 필요합니다" },
        { status: 400 }
      );
    }

    updateGroupStatus(orderId, "skipped");
    addBookingLogByOrderId(orderId, "cancel", "주문 취소");

    // 서버 동기화 (실패해도 로컬은 이미 반영됨)
    syncBookingResult({ orderId, status: "skipped" }).catch((err) => {
      console.error("[cancel] 서버 동기화 실패:", err);
    });

    return NextResponse.json({ success: true, orderId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
