import { NextRequest, NextResponse } from "next/server";

import { bookOrders } from "@/lib/orders";

export async function POST(request: NextRequest) {
  try {
    const { orderIds } = await request.json();

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "예약할 주문 ID 목록이 필요합니다" },
        { status: 400 }
      );
    }

    const result = bookOrders(orderIds);
    return NextResponse.json({
      message: `${result.count}건 예약이 시작되었습니다`,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
