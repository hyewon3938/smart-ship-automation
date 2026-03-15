import { NextRequest, NextResponse } from "next/server";

import { getOrders } from "@/lib/orders";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const orderList = getOrders(status);

    return NextResponse.json({ orders: orderList });
  } catch (error) {
    console.error("주문 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "주문 목록을 조회할 수 없습니다." },
      { status: 500 }
    );
  }
}
