import { NextRequest, NextResponse } from "next/server";

import { startDispatchPolling } from "@/lib/dispatch-worker";
import { getOrders } from "@/lib/orders";
import { getSetting } from "@/lib/settings";

// 서버 시작 후 첫 요청 시 1회만 폴링 시작
let dispatchPollingStarted = false;

export async function GET(request: NextRequest) {
  try {
    if (!dispatchPollingStarted) {
      dispatchPollingStarted = true;
      startDispatchPolling();
    }

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
