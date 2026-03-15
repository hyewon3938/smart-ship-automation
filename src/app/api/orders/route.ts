import { NextRequest, NextResponse } from "next/server";

import { getOrders } from "@/lib/orders";
import { getSetting } from "@/lib/settings";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const orderList = getOrders(status);
    const lastSyncTime = getSetting("lastSyncTime");

    return NextResponse.json({ orders: orderList, lastSyncTime });
  } catch (error) {
    console.error("주문 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "주문 목록을 조회할 수 없습니다." },
      { status: 500 }
    );
  }
}
