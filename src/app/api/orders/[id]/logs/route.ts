import { NextRequest, NextResponse } from "next/server";

import { getBookingLogs } from "@/lib/orders";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: "유효하지 않은 주문 ID" }, { status: 400 });
    }
    const logs = getBookingLogs(orderId);
    return NextResponse.json({ logs });
  } catch (error) {
    console.error("로그 조회 실패:", error);
    return NextResponse.json({ error: "로그를 조회할 수 없습니다." }, { status: 500 });
  }
}
